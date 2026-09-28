// Topic similarity for the V2 engines: every lexicon word has a vector in one shared
// ko/en meaning space (LaBSE, built by scripts/semantic/build_topic_vectors.py), so a
// topic in either language is compared with words in both languages directly, without
// translation. Row w belongs to lexicon word w; linked search appends the rows of its
// Korean surfaces that the lexicon lacks (extend()).
// Rows are 4-bit values (-7..7, per-row scale) packed two per byte (value + 8, even
// dimension in the high nibble); they stay packed and are scored through per-byte tables.
(function (root) {
    'use strict';

    const HIGH = new Int8Array(256), LOW = new Int8Array(256), SQUARE = new Int16Array(256);
    for (let b = 0; b < 256; b += 1) {
        HIGH[b] = (b >> 4) - 8; LOW[b] = (b & 15) - 8;
        SQUARE[b] = HIGH[b] * HIGH[b] + LOW[b] * LOW[b];
    }

    function inverseNorms(rows, rowBytes, from, to, out) {
        for (let w = from, p = from * rowBytes; w < to; w += 1) {
            let square = 0;
            for (let k = 0; k < rowBytes; k += 1, p += 1) square += SQUARE[rows[p]];
            out[w] = square ? 1 / Math.sqrt(square) : 0;
        }
    }

    class TopicVectors {
        // manifest: topic.json; buffer: the decompressed packed rows (count x dims/2 bytes).
        constructor(manifest, buffer) {
            if (manifest.schema_version !== 2 || manifest.bits !== 4) throw new Error('unsupported topic vector format');
            this.dims = manifest.dims;
            this.rowBytes = manifest.dims / 2;
            this.count = manifest.count;
            this.rows = new Uint8Array(buffer);
            if (this.rows.length !== this.rowBytes * this.count) throw new Error('topic vectors do not match their manifest');
            // The per-row scale cancels in the cosine; only each row's inverse norm is needed.
            this.inverseNorm = new Float32Array(this.count);
            inverseNorms(this.rows, this.rowBytes, 0, this.count, this.inverseNorm);
        }

        // Appends rows (linked-search surfaces); their numbers continue after the current rows.
        extend(count, buffer) {
            const extra = new Uint8Array(buffer);
            if (extra.length !== this.rowBytes * count) throw new Error('linked topic vectors do not match their manifest');
            const rows = new Uint8Array(this.rows.length + extra.length);
            rows.set(this.rows); rows.set(extra, this.rows.length);
            const inverseNorm = new Float32Array(this.count + count);
            inverseNorm.set(this.inverseNorm);
            inverseNorms(rows, this.rowBytes, this.count, this.count + count, inverseNorm);
            this.rows = rows; this.inverseNorm = inverseNorm; this.count += count;
        }

        // Cosine similarity of every row with row `topic`, as a Float32Array in row order.
        similarities(topic) {
            const { rows, rowBytes, count, inverseNorm } = this;
            // table[k * 256 + b]: dot of byte position k of the topic with byte value b.
            const table = new Int16Array(rowBytes * 256);
            for (let k = 0; k < rowBytes; k += 1) {
                const q = rows[topic * rowBytes + k], high = HIGH[q], low = LOW[q];
                for (let b = 0; b < 256; b += 1) table[k * 256 + b] = HIGH[b] * high + LOW[b] * low;
            }
            const out = new Float32Array(count);
            const scale = inverseNorm[topic];
            for (let w = 0, p = 0; w < count; w += 1) {
                let dot = 0;
                for (let k = 0; k < rowBytes; k += 1, p += 1) dot += table[(k << 8) | rows[p]];
                out[w] = dot * inverseNorm[w] * scale;
            }
            return out;
        }

        cosine(a, b) {
            const { rows, rowBytes } = this;
            let dot = 0;
            for (let k = 0, p = a * rowBytes, q = b * rowBytes; k < rowBytes; k += 1) {
                const x = rows[p + k], y = rows[q + k];
                dot += HIGH[x] * HIGH[y] + LOW[x] * LOW[y];
            }
            return dot * this.inverseNorm[a] * this.inverseNorm[b];
        }
    }

    root.RhymeTopicVectors = Object.freeze({ TopicVectors });
})(typeof self !== 'undefined' ? self : globalThis);
