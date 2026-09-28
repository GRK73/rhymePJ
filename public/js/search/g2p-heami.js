// Browser/Worker inference for the Heami-imitating G2P model
// (scripts/pronunciation/train_g2p.py). Plain JavaScript, no dependencies.
// Mirrors PyTorch semantics exactly: GRU gate order [r, z, n] with the hidden
// bias inside the reset product, bidirectional encoder, Luong attention with
// input feeding, greedy decoding.
(function (root) {
    'use strict';

    function inputTokens(word, lang) {
        if (lang !== 'ko') return Array.from(word);
        const tokens = [];
        for (const char of word) {
            const code = char.codePointAt(0) - 0xac00;
            if (code >= 0 && code <= 11171) {
                tokens.push(`C${Math.floor(code / 588)}`, `V${Math.floor((code % 588) / 28)}`);
                if (code % 28) tokens.push(`J${code % 28}`);
            } else {
                tokens.push(char);
            }
        }
        return tokens;
    }

    // y = W x + b for W of shape [rows, cols] stored row-major.
    function affine(weight, bias, x, rows, cols, out, outOffset = 0) {
        for (let r = 0; r < rows; r += 1) {
            let sum = bias ? bias[r] : 0;
            const base = r * cols;
            for (let c = 0; c < cols; c += 1) sum += weight[base + c] * x[c];
            out[outOffset + r] = sum;
        }
        return out;
    }

    const sigmoid = value => 1 / (1 + Math.exp(-value));

    function gruStep(cell, x, h, size) {
        const gi = affine(cell.wih, cell.bih, x, 3 * size, x.length, cell.gi);
        const gh = affine(cell.whh, cell.bhh, h, 3 * size, size, cell.gh);
        const next = new Float32Array(size);
        for (let i = 0; i < size; i += 1) {
            const r = sigmoid(gi[i] + gh[i]);
            const z = sigmoid(gi[size + i] + gh[size + i]);
            const n = Math.tanh(gi[2 * size + i] + r * gh[2 * size + i]);
            next[i] = (1 - z) * n + z * h[i];
        }
        return next;
    }

    class HeamiG2P {
        constructor(manifest, buffer) {
            if (manifest.schema_version !== 1 || manifest.architecture !== 'bigru-luong-inputfeed') {
                throw new Error('unsupported G2P model manifest');
            }
            this.lang = manifest.lang;
            this.inputIndex = new Map(manifest.input_vocab.map((token, index) => [token, index]));
            this.output = manifest.output_vocab;
            this.bos = manifest.output_vocab.indexOf(manifest.specials.bos);
            this.eos = manifest.output_vocab.indexOf(manifest.specials.eos);
            const tensors = {};
            for (const tensor of manifest.tensors) {
                const length = tensor.shape.reduce((a, b) => a * b, 1);
                tensors[tensor.name] = { data: new Float32Array(buffer, tensor.offset, length), shape: tensor.shape };
            }
            const t = name => tensors[name].data;
            this.emb = tensors['src_embed.weight'].shape[1];
            this.enc = tensors['encoder.weight_hh_l0'].shape[1];
            this.dec = manifest.dec_size;
            const cell = (wih, whh, bih, bhh, size) => ({ wih: t(wih), whh: t(whh), bih: t(bih), bhh: t(bhh),
                gi: new Float32Array(3 * size), gh: new Float32Array(3 * size) });
            this.srcEmbed = t('src_embed.weight');
            this.tgtEmbed = t('tgt_embed.weight');
            this.forwardCell = cell('encoder.weight_ih_l0', 'encoder.weight_hh_l0', 'encoder.bias_ih_l0', 'encoder.bias_hh_l0', this.enc);
            this.backwardCell = cell('encoder.weight_ih_l0_reverse', 'encoder.weight_hh_l0_reverse',
                'encoder.bias_ih_l0_reverse', 'encoder.bias_hh_l0_reverse', this.enc);
            this.decoderCell = cell('decoder.weight_ih', 'decoder.weight_hh', 'decoder.bias_ih', 'decoder.bias_hh', this.dec);
            this.bridge = { w: t('bridge.weight'), b: t('bridge.bias') };
            this.attn = t('attn.weight');
            this.combine = { w: t('combine.weight'), b: t('combine.bias') };
            this.out = { w: t('out.weight'), b: t('out.bias') };
        }

        embed(table, index, size) {
            return table.subarray(index * size, (index + 1) * size);
        }

        // Returns project phonemes, or [] when the word has no known input symbols.
        predict(word, maxLength = 0) {
            const ids = inputTokens(word, this.lang).map(token => this.inputIndex.get(token)).filter(id => id !== undefined);
            if (!ids.length) return [];
            const steps = ids.length, enc = this.enc, dec = this.dec, width = 2 * enc;
            const memory = new Float32Array(steps * width);
            let h = new Float32Array(enc);
            for (let i = 0; i < steps; i += 1) {
                h = gruStep(this.forwardCell, this.embed(this.srcEmbed, ids[i], this.emb), h, enc);
                memory.set(h, i * width);
            }
            h = new Float32Array(enc);
            for (let i = steps - 1; i >= 0; i -= 1) {
                h = gruStep(this.backwardCell, this.embed(this.srcEmbed, ids[i], this.emb), h, enc);
                memory.set(h, i * width + enc);
            }
            const mean = new Float32Array(width);
            for (let i = 0; i < steps; i += 1) for (let j = 0; j < width; j += 1) mean[j] += memory[i * width + j];
            for (let j = 0; j < width; j += 1) mean[j] /= steps;
            let hidden = affine(this.bridge.w, this.bridge.b, mean, dec, width, new Float32Array(dec)).map(Math.tanh);
            let feed = new Float32Array(dec);
            let token = this.bos;
            const phonemes = [];
            const query = new Float32Array(width), scores = new Float32Array(steps);
            const joined = new Float32Array(dec + width), context = new Float32Array(width);
            const logits = new Float32Array(this.output.length);
            const limit = maxLength || steps * 2 + 8;
            for (let step = 0; step < limit; step += 1) {
                const input = new Float32Array(this.emb + dec);
                input.set(this.embed(this.tgtEmbed, token, this.emb));
                input.set(feed, this.emb);
                hidden = gruStep(this.decoderCell, input, hidden, dec);
                affine(this.attn, null, hidden, width, dec, query);
                let max = -Infinity;
                for (let i = 0; i < steps; i += 1) {
                    let sum = 0;
                    for (let j = 0; j < width; j += 1) sum += memory[i * width + j] * query[j];
                    scores[i] = sum;
                    if (sum > max) max = sum;
                }
                let total = 0;
                for (let i = 0; i < steps; i += 1) { scores[i] = Math.exp(scores[i] - max); total += scores[i]; }
                context.fill(0);
                for (let i = 0; i < steps; i += 1) {
                    const weight = scores[i] / total;
                    for (let j = 0; j < width; j += 1) context[j] += weight * memory[i * width + j];
                }
                joined.set(hidden);
                joined.set(context, dec);
                feed = affine(this.combine.w, this.combine.b, joined, dec, dec + width, new Float32Array(dec)).map(Math.tanh);
                affine(this.out.w, this.out.b, feed, this.output.length, dec, logits);
                let best = 0;
                for (let i = 1; i < logits.length; i += 1) if (logits[i] > logits[best]) best = i;
                if (best === this.eos) break;
                phonemes.push(this.output[best]);
                token = best;
            }
            return phonemes;
        }
    }

    root.RhymeHeamiG2P = Object.freeze({ HeamiG2P, inputTokens });
})(typeof self !== 'undefined' ? self : globalThis);
