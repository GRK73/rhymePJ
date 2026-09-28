// V2 word search engine (design: V2검색엔진설계.md).
// Scores every lexicon word with V1's calculateScore semantics (weighted DP and
// sliding window, V1 vowel/consonant/detail weights) over typed arrays, then
// applies V1's threshold, frequency and topic formulas. No hidden corrections:
// no rime/syllable/stress blends, no cross-layer penalties, no corpus boost.
// Ties are ordered by word (가나다 / abc).
(function (root) {
    'use strict';

    const THRESHOLD = 40;
    const LANG = Object.freeze({ ko: 0, en: 1 });
    const LAYERS = Object.freeze(['ko', 'native', 'koreanized']);

    // ---- Lexicon ---------------------------------------------------------

    // entries: [{word, lang: 'ko'|'en', zipf: number|null, ko: [[phoneme]], native: [[phoneme]], koreanized: [[phoneme]]}]
    // similarity(a, b) and isVowel(p) define the phoneme model (V1 get_score_1d / ipaFeatures).
    // extraPhonemes: every phoneme the model knows, so query phonemes absent from the
    // lexicon still get their true similarity to lexicon phonemes.
    // compare: tie order for equal scores (가나다 / abc); defaults to String#localeCompare's collation.
    function wordOrder(words, compare) {
        const indices = Array.from(words.keys()).sort((a, b) => compare(words[a], words[b]));
        // Stable sort: collation-equal words keep lexicon order, so every rank is unique.
        const order = new Uint32Array(words.length);
        indices.forEach((index, position) => { order[index] = position; });
        return order;
    }

    function buildLexicon(entries, similarity, isVowel, extraPhonemes = [], compare = new Intl.Collator().compare) {
        const phonemeIndex = new Map();
        const phonemes = [];
        const sequenceIndex = new Map();
        const sequences = [];
        const joinIndex = new Map();
        const idOf = phoneme => {
            if (!phonemeIndex.has(phoneme)) { phonemeIndex.set(phoneme, phonemes.length); phonemes.push(phoneme); }
            return phonemeIndex.get(phoneme);
        };
        const sequenceOf = list => {
            const key = list.join(' ');
            if (!sequenceIndex.has(key)) { sequenceIndex.set(key, sequences.length); sequences.push(list); }
            return sequenceIndex.get(key);
        };
        const layers = Object.fromEntries(LAYERS.map(name => [name, { offsets: [0], ids: [] }]));
        for (const entry of entries) {
            for (const name of LAYERS) {
                const layer = layers[name];
                for (const list of entry[name] || []) if (list.length) layer.ids.push(sequenceOf(list));
                layer.offsets.push(layer.ids.length);
            }
        }
        for (const list of sequences) list.forEach(idOf);
        extraPhonemes.forEach(idOf);
        const count = sequences.length;
        const seqOffset = new Uint32Array(count + 1);
        sequences.forEach((list, index) => { seqOffset[index + 1] = seqOffset[index] + list.length; });
        const seqData = new Uint8Array(seqOffset[count]);
        const seqJoin = new Int32Array(count);
        sequences.forEach((list, index) => {
            list.forEach((phoneme, offset) => { seqData[seqOffset[index] + offset] = phonemeIndex.get(phoneme); });
            const joined = list.join('');
            if (!joinIndex.has(joined)) joinIndex.set(joined, joinIndex.size);
            seqJoin[index] = joinIndex.get(joined);
        });
        // Row stride n + 1: the last column stands for any phoneme the model does not
        // know, which V1 scores 0 against every lexicon phoneme.
        const n = phonemes.length, stride = n + 1;
        const sim = new Float64Array(n * stride);
        const vowel = new Uint8Array(n);
        phonemes.forEach((a, i) => {
            vowel[i] = isVowel(a) ? 1 : 0;
            phonemes.forEach((b, j) => { sim[i * stride + j] = a === b ? 1 : similarity(a, b); });
        });
        return {
            phonemes, phonemeIndex, sim, stride, vowel, seqData, seqOffset, seqJoin, joinIndex,
            words: entries.map(entry => entry.word),
            order: wordOrder(entries.map(entry => entry.word), compare),
            lang: Uint8Array.from(entries, entry => LANG[entry.lang] ?? 255),
            zipf: Float64Array.from(entries, entry => Number.isFinite(entry.zipf) ? entry.zipf : NaN),
            layers: Object.fromEntries(LAYERS.map(name => [name, {
                offsets: Uint32Array.from(layers[name].offsets), ids: Int32Array.from(layers[name].ids),
            }])),
        };
    }

    // ---- Binary format ----------------------------------------------------
    // One buffer of 8-byte-aligned sections plus a JSON manifest. Join ids and the
    // phoneme/join indexes are rebuilt on load (same order, so same ids).
    const ZIPF_SCALE = 10000;
    const ZIPF_MISSING = -2147483648;
    const SECTION_TYPES = { Float64Array, Uint8Array, Uint32Array, Int32Array };

    function serializeLexicon(lexicon) {
        const words = new TextEncoder().encode(lexicon.words.join('\n'));
        const zipf = Int32Array.from(lexicon.zipf, value => (Number.isNaN(value) ? ZIPF_MISSING : Math.round(value * ZIPF_SCALE)));
        const sections = [['sim', lexicon.sim], ['vowel', lexicon.vowel], ['seqData', lexicon.seqData],
            ['seqOffset', lexicon.seqOffset], ['lang', lexicon.lang], ['zipf', zipf], ['order', lexicon.order], ['words', words]];
        for (const name of LAYERS) {
            sections.push([`${name}.offsets`, lexicon.layers[name].offsets], [`${name}.ids`, lexicon.layers[name].ids]);
        }
        let size = 0;
        const layout = sections.map(([name, array]) => {
            const entry = { name, type: array.constructor.name, offset: size, length: array.length };
            size += Math.ceil(array.byteLength / 8) * 8;
            return entry;
        });
        const buffer = new ArrayBuffer(size);
        sections.forEach(([, array], index) => {
            new Uint8Array(buffer, layout[index].offset, array.byteLength).set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
        });
        const manifest = { schema_version: 1, phonemes: lexicon.phonemes, stride: lexicon.stride,
            word_count: lexicon.words.length, sequence_count: lexicon.seqOffset.length - 1, zipf_scale: ZIPF_SCALE, sections: layout };
        return { manifest, buffer };
    }

    function deserializeLexicon(manifest, buffer) {
        if (manifest.schema_version !== 1) throw new Error('unsupported lexicon schema');
        const section = Object.fromEntries(manifest.sections.map(entry =>
            [entry.name, new SECTION_TYPES[entry.type](buffer, entry.offset, entry.length)]));
        const phonemes = manifest.phonemes;
        const phonemeIndex = new Map(phonemes.map((phoneme, index) => [phoneme, index]));
        const { seqData, seqOffset } = section;
        const count = seqOffset.length - 1;
        const joinIndex = new Map();
        const seqJoin = new Int32Array(count);
        for (let index = 0; index < count; index += 1) {
            let joined = '';
            for (let k = seqOffset[index]; k < seqOffset[index + 1]; k += 1) joined += phonemes[seqData[k]];
            if (!joinIndex.has(joined)) joinIndex.set(joined, joinIndex.size);
            seqJoin[index] = joinIndex.get(joined);
        }
        return {
            phonemes, phonemeIndex, sim: section.sim, stride: manifest.stride, vowel: section.vowel,
            seqData, seqOffset, seqJoin, joinIndex,
            words: new TextDecoder().decode(section.words).split('\n'),
            order: section.order,
            lang: section.lang,
            zipf: Float64Array.from(section.zipf, value => (value === ZIPF_MISSING ? NaN : value / manifest.zipf_scale)),
            layers: Object.fromEntries(LAYERS.map(name => [name, { offsets: section[`${name}.offsets`], ids: section[`${name}.ids`] }])),
        };
    }

    // ---- Kernel (V1 calculateScore, score only) -----------------------------

    // Scores tl phonemes of data from start (a whole sequence, or a boundary span in linked
    // search) against a prepared query: weighted DP and sliding window, the higher wins.
    function createSpanScorer(lexicon) {
        const { sim, stride, vowel } = lexicon;
        let dp = new Float64Array(64 * 64);
        // query: {ids: Uint8Array, weights: Float64Array, weightSum}; weights already hold base*detail.
        return function span(data, start, tl, query, vowelWeight, consonantWeight) {
            const q = query.ids, qw = query.weights, ql = q.length;
            if (!ql || !tl) return 0;
            const width = ql + 1;
            if ((tl + 1) * width > dp.length) dp = new Float64Array((tl + 1) * width * 2);
            dp[0] = 0;
            let tSum = 0;
            for (let i = 1; i <= tl; i += 1) {
                const w = vowel[data[start + i - 1]] ? vowelWeight : consonantWeight;
                dp[i * width] = dp[(i - 1) * width] + w;
            }
            for (let j = 1; j <= ql; j += 1) dp[j] = dp[j - 1] + qw[j - 1];
            for (let i = 1; i <= tl; i += 1) {
                const t = data[start + i - 1];
                const tw = vowel[t] ? vowelWeight : consonantWeight;
                tSum += tw;
                const row = t * stride, here = i * width, above = (i - 1) * width;
                for (let j = 1; j <= ql; j += 1) {
                    const w = qw[j - 1];
                    const insertion = dp[here + j - 1] + w;
                    const deletion = dp[above + j] + tw;
                    const substitution = dp[above + j - 1] + (tw > w ? tw : w) * (1 - sim[row + q[j - 1]]);
                    let best = insertion < deletion ? insertion : deletion;
                    if (substitution < best) best = substitution;
                    dp[here + j] = best;
                }
            }
            const maxDistance = tSum > query.weightSum ? tSum : query.weightSum;
            const dpScore = Math.max(1 - dp[tl * width + ql] / maxDistance, 0) * 100;
            let sliding = 0;
            if (tl >= ql) {
                for (let s = 0; s + ql <= tl; s += 1) {
                    let total = 0;
                    for (let j = 0; j < ql; j += 1) total += sim[data[start + s + j] * stride + q[j]] * qw[j];
                    const percentage = query.weightSum > 0 ? total / query.weightSum * 100 : 0;
                    if (percentage > sliding) sliding = percentage;
                }
            }
            return dpScore > sliding ? dpScore : sliding;
        };
    }

    // Whole lexicon sequences, with V1's shortcut: identical joined spelling scores 100.
    function createKernel(lexicon) {
        const { seqData, seqOffset, seqJoin } = lexicon;
        const span = createSpanScorer(lexicon);
        return function score(sequence, query, vowelWeight, consonantWeight) {
            const start = seqOffset[sequence], tl = seqOffset[sequence + 1] - start;
            if (!query.ids.length || !tl) return 0;
            if (seqJoin[sequence] === query.join) return 100;
            return span(seqData, start, tl, query, vowelWeight, consonantWeight);
        };
    }

    // ---- Vowel-only view ------------------------------------------------------
    // Same sequence ids and layers, consonants removed. Built once per lexicon.
    function vowelView(lexicon) {
        if (lexicon.vowelView) return lexicon.vowelView;
        const { seqData, seqOffset, vowel, phonemes } = lexicon;
        const count = seqOffset.length - 1;
        const offsets = new Uint32Array(count + 1);
        for (let s = 0; s < count; s += 1) {
            let kept = 0;
            for (let k = seqOffset[s]; k < seqOffset[s + 1]; k += 1) kept += vowel[seqData[k]];
            offsets[s + 1] = offsets[s] + kept;
        }
        const data = new Uint8Array(offsets[count]);
        const joinIndex = new Map();
        const seqJoin = new Int32Array(count);
        for (let s = 0, out = 0; s < count; s += 1) {
            let joined = '';
            for (let k = seqOffset[s]; k < seqOffset[s + 1]; k += 1) {
                if (!vowel[seqData[k]]) continue;
                data[out++] = seqData[k];
                joined += phonemes[seqData[k]];
            }
            if (!joinIndex.has(joined)) joinIndex.set(joined, joinIndex.size);
            seqJoin[s] = joinIndex.get(joined);
        }
        lexicon.vowelView = { ...lexicon, seqData: data, seqOffset: offsets, seqJoin, joinIndex, vowelView: null, kernel: null };
        return lexicon.vowelView;
    }

    // ---- Query variants -------------------------------------------------------

    // V1 remapDetailMultipliers: proportional index mapping between query layers.
    function remapProportional(detail, sourceLength, targetLength) {
        if (!Array.isArray(detail) || targetLength <= 0) return [];
        if (sourceLength === targetLength) return detail.slice();
        if (sourceLength <= 0) return new Array(targetLength).fill(1);
        return Array.from({ length: targetLength }, (_, index) =>
            detail[Math.min(sourceLength - 1, Math.floor(index * sourceLength / targetLength))] ?? 1);
    }

    const proportionalTransfer = (detail, source, target) => remapProportional(detail, source.length, target.length);

    // Move per-phoneme weights from one pronunciation to another by pairing similar
    // sounds (love: l ʌ v -> ɾ ʌ p ɯ keeps the ʌ weight on ʌ, not on p). Pairing cost
    // is 1 - similarity; a gap costs ALIGN_GAP, so sounds of different classes
    // (similarity 0, cost 1 > two gaps) are never paired. A sound only the target has
    // (the ɯ of 러브, the second half of aɪ -> a i) takes the weight of the sound before it.
    const ALIGN_GAP = 0.45;
    function alignedTransfer(view) {
        const unknown = view.phonemes.length;
        return (detail, source, target) => {
            if (!target.length) return [];
            if (!source.length) return new Array(target.length).fill(1);
            const s = source.map(p => view.phonemeIndex.get(p) ?? unknown);
            const t = target.map(p => view.phonemeIndex.get(p) ?? unknown);
            const similarity = (i, j) => (s[i] === unknown
                ? (source[i] === target[j] ? 1 : 0) : view.sim[s[i] * view.stride + t[j]]);
            const n = source.length, m = target.length, width = m + 1;
            const cost = new Float64Array((n + 1) * width);
            for (let i = 1; i <= n; i += 1) cost[i * width] = i * ALIGN_GAP;
            for (let j = 1; j <= m; j += 1) cost[j] = j * ALIGN_GAP;
            for (let i = 1; i <= n; i += 1) {
                for (let j = 1; j <= m; j += 1) {
                    cost[i * width + j] = Math.min(cost[(i - 1) * width + j - 1] + 1 - similarity(i - 1, j - 1),
                        cost[(i - 1) * width + j] + ALIGN_GAP, cost[i * width + j - 1] + ALIGN_GAP);
                }
            }
            // Trace back from the end. On equal cost, leave the later target sound unpaired
            // so the source sound pairs with the earlier one (f l oʊ -> pʰ ɯ l ɾ o: f pairs
            // with pʰ, not with the equally similar l).
            const pairedWith = new Array(m).fill(-1);
            const same = (a, b) => Math.abs(a - b) < 1e-9;
            for (let i = n, j = m; i > 0 || j > 0;) {
                const here = cost[i * width + j];
                if (j > 0 && (i === 0 || same(here, cost[i * width + j - 1] + ALIGN_GAP))) {
                    j -= 1;
                } else if (i > 0 && j > 0 && same(here, cost[(i - 1) * width + j - 1] + 1 - similarity(i - 1, j - 1))) {
                    pairedWith[j - 1] = i - 1; i -= 1; j -= 1;
                } else {
                    i -= 1;
                }
            }
            const weightOf = i => (detail[i] !== undefined ? detail[i] : 1);
            const weights = new Array(m);
            for (let j = 0; j < m; j += 1) {
                if (pairedWith[j] >= 0) { weights[j] = weightOf(pairedWith[j]); continue; }
                // Unpaired: borrow from the neighbouring paired sound it resembles more,
                // the previous one on a tie (flow -> 플로: the extra ㄹ follows l, not f).
                let before = -1, after = -1;
                for (let k = j - 1; k >= 0 && before < 0; k -= 1) before = pairedWith[k];
                for (let k = j + 1; k < m && after < 0; k += 1) after = pairedWith[k];
                const owner = before < 0 ? after : after < 0 ? before
                    : similarity(after, j) > similarity(before, j) ? after : before;
                weights[j] = owner < 0 ? 1 : weightOf(owner);
            }
            return weights;
        };
    }

    function isVowelIn(view, options) {
        return phoneme => {
            const id = view.phonemeIndex.get(phoneme);
            return id === undefined ? Boolean(options.isVowel?.(phoneme)) : view.vowel[id] === 1;
        };
    }

    // phonemes/detail are kept on the result so callers can explain a match with V1 calculateScore.
    function prepareQuery(view, phonemes, detail, options) {
        const isVowel = isVowelIn(view, options);
        if (options.vowelsOnly) {
            const keep = phonemes.map(isVowel);
            detail = detail.filter((_, index) => keep[index]);
            phonemes = phonemes.filter((_, index) => keep[index]);
        }
        const vowelWeight = options.useDetailWeights ? 1 : options.vowelWeight;
        const consonantWeight = options.useDetailWeights ? 1 : options.consonantWeight;
        // Phonemes the model does not know map to the zero column.
        const unknown = view.phonemes.length;
        const ids = Uint8Array.from(phonemes, phoneme => view.phonemeIndex.get(phoneme) ?? unknown);
        const weights = Float64Array.from(phonemes, (phoneme, index) =>
            (isVowel(phoneme) ? vowelWeight : consonantWeight) * (detail[index] !== undefined ? detail[index] : 1));
        const join = view.joinIndex.get(phonemes.join('')) ?? -1;
        return { phonemes, detail, ids, weights, weightSum: weights.reduce((a, b) => a + b, 0), join,
            key: `${phonemes.join(' ')}|${[...weights].join(',')}` };
    }

    function uniqueLists(lists) {
        const seen = new Set();
        return lists.filter(list => {
            const key = list.join(' ');
            if (!list.length || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function searchOptions(request) {
        return {
            useDetailWeights: Boolean(request.useDetailWeights),
            vowelWeight: Number(request.vowelWeight), consonantWeight: Number(request.consonantWeight),
            vowelsOnly: Boolean(request.vowelsOnly), isVowel: request.isVowel,
        };
    }

    // The query variants V1 compares against each layer (getQueryPhonemes shape in, prepared queries out).
    // Query phonemes with their detail weights, per layer they are compared with:
    // native (English native layer), korean (Korean words), koreanized (English Korean-style layer).
    function queryVariants(view, request) {
        const native = request.queryPhonemes.native || [];
        const detail = request.detail || new Array(native.length).fill(1);
        // Default: sound-pairing transfer (V2 design §4.4). The V1 parity check passes proportionalTransfer.
        const transfer = request.detailTransfer || alignedTransfer(view);
        // V1 treats a missing candidate list and an empty one differently.
        const given = request.queryPhonemes;
        const korean = uniqueLists([
            ...(Array.isArray(given.korean) ? given.korean : [native]),
            ...(given.koreanized || []),
        ]);
        const koreanized = Array.isArray(given.koreanized) ? given.koreanized : [given.koreanizedFallback || native];
        const variant = list => ({ phonemes: list, detail: transfer(detail, native, list) });
        return { native: { phonemes: native, detail }, korean: korean.map(variant), koreanized: koreanized.map(variant) };
    }

    function buildQueries(view, request) {
        const options = searchOptions(request);
        const variants = queryVariants(view, request);
        const prepare = variant => prepareQuery(view, variant.phonemes, variant.detail, options);
        return {
            options,
            native: prepare(variants.native),
            korean: variants.korean.map(prepare),
            koreanized: variants.koreanized.map(prepare),
        };
    }

    // Layer/query pairings per word, in V1 order: [layer, queries, label].
    function pairings(lexicon, word, mode, queries) {
        const has = name => lexicon.layers[name].offsets[word + 1] > lexicon.layers[name].offsets[word];
        if (lexicon.lang[word] === LANG.ko) return [[has('ko') ? 'ko' : 'native', queries.korean, 'ko']];
        if (mode === 'native') return [['native', [queries.native], 'native']];
        if (mode === 'koreanized') return [['koreanized', queries.koreanized, 'koreanized']];
        const list = [['native', [queries.native], 'native']];
        // V1 computes the cross pairings only inside its loop over koreanized targets.
        if (has('koreanized')) {
            list.push(['koreanized', queries.koreanized, 'koreanized'], ['native', queries.koreanized, 'cross'],
                ['koreanized', [queries.native], 'cross']);
        }
        return list;
    }

    // ---- Search -----------------------------------------------------------------

    // V1 applyFrequencyWeight, with V1's exact operation order (bit-identical results).
    function applyFrequencyWeight(score, zipf, frequencyWeight) {
        if (zipf >= 3.5) {
            const zipfNorm = Math.min(1.0, (zipf - 3.5) / 4.5);
            const boostFactor = zipfNorm * (frequencyWeight / 10) * 0.8;
            return score + (100 - score) * boostFactor;
        }
        const x = 3.5 - Math.max(0, zipf);
        const penaltyMultiplier = Math.pow(x / 3.5, 2.5);
        const penalty = penaltyMultiplier * (frequencyWeight / 10);
        return score * (1 - penalty);
    }

    const RANK_SPACE = 1 << 20;
    const cancelled = () => Object.assign(new Error('search cancelled'), { code: 'search_cancelled' });

    // request: {
    //   query, languages: ['ko'|'en'], mode: 'hybrid'|'native'|'koreanized',
    //   queryPhonemes: {native: [p], korean?: [[p]], koreanized?: [[p]], koreanizedFallback?: [p]},  // V1 getQueryPhonemes shape
    //   detail: [number] (per native query phoneme), detailTransfer?(detail, source, target),
    //   useDetailWeights, vowelWeight, consonantWeight, vowelsOnly, frequencyWeight, excludeWords: [string],
    //   topic: {weight, similarity(wordIndex) -> number|null} | null,
    //   isVowel(p) for query phonemes missing from the lexicon inventory, isCancelled?() -> boolean
    // }

    // Phonetic score per word (-Infinity when not scored). Depends only on the pronunciation
    // settings, so frequency/topic changes can re-rank the same array (V2 design §6).
    function scoreRaw(lexicon, request, kernel) {
        const view = request.vowelsOnly ? vowelView(lexicon) : lexicon;
        if (!kernel || request.vowelsOnly) kernel = view.kernel || (view.kernel = createKernel(view));
        const queries = buildQueries(view, request);
        const { vowelWeight: vwInput, consonantWeight: cwInput, useDetailWeights } = queries.options;
        const vw = useDetailWeights ? 1 : vwInput;
        const cw = useDetailWeights ? 1 : cwInput;
        const wordCount = lexicon.words.length;
        const isCancelled = request.isCancelled || (() => false);

        // Words to score: allowed language, not the query itself, not excluded (V1 order of checks).
        if (!lexicon.lowerWords) lexicon.lowerWords = lexicon.words.map(word => word.toLowerCase());
        const allowed = new Set((request.languages || ['ko', 'en']).map(lang => LANG[lang]));
        const excludeWords = request.excludeWords || [];
        const queryLower = String(request.query).toLowerCase();
        const filters = { ko: new Uint8Array(wordCount), koFallback: new Uint8Array(wordCount),
            en: new Uint8Array(wordCount), enCross: new Uint8Array(wordCount) };
        const hasKo = lexicon.layers.ko.offsets, hasKoreanized = lexicon.layers.koreanized.offsets;
        for (let w = 0; w < wordCount; w += 1) {
            if ((w & 16383) === 0 && isCancelled()) throw cancelled();
            const lang = lexicon.lang[w];
            if (!allowed.has(lang)) continue;
            const lower = lexicon.lowerWords[w];
            if (lower === queryLower) continue;
            if (excludeWords.length && excludeWords.some(exclusion => lower.includes(exclusion))) continue;
            if (lang === LANG.ko) (hasKo[w + 1] > hasKo[w] ? filters.ko : filters.koFallback)[w] = 1;
            else if (lang === LANG.en) { filters.en[w] = 1; if (hasKoreanized[w + 1] > hasKoreanized[w]) filters.enCross[w] = 1; }
        }

        // Best score per word for one layer against query variants; each sequence scored once per variant.
        // The calls below are the pairings() plan, laid out as tight loops over whole layers.
        const raw = new Float64Array(wordCount).fill(-Infinity);
        const caches = new Map();
        const layerBest = (name, list, filter) => {
            const { offsets, ids } = lexicon.layers[name];
            for (const query of list) {
                let cache = caches.get(query.key);
                if (!cache) { cache = new Float64Array(view.seqJoin.length).fill(NaN); caches.set(query.key, cache); }
                for (let w = 0; w < wordCount; w += 1) {
                    if (!filter[w]) continue;
                    if ((w & 16383) === 0 && isCancelled()) throw cancelled();
                    let top = raw[w];
                    for (let k = offsets[w]; k < offsets[w + 1]; k += 1) {
                        const sequence = ids[k];
                        let value = cache[sequence];
                        if (value !== value) { value = kernel(sequence, query, vw, cw); cache[sequence] = value; }
                        if (value > top) top = value;
                    }
                    raw[w] = top;
                }
            }
        };
        layerBest('ko', queries.korean, filters.ko);
        layerBest('native', queries.korean, filters.koFallback);
        if (request.mode === 'native') layerBest('native', [queries.native], filters.en);
        else if (request.mode === 'koreanized') layerBest('koreanized', queries.koreanized, filters.en);
        else {
            layerBest('native', [queries.native], filters.en);
            layerBest('koreanized', queries.koreanized, filters.enCross);
            layerBest('native', queries.koreanized, filters.enCross);
            layerBest('koreanized', [queries.native], filters.enCross);
        }
        return raw;
    }

    // Returns {length, words, scores, raws, similarities} (typed arrays, best first). Ties: equal score
    // after rounding to 0.001 are ordered by lexicon.order (가나다 / abc).
    function rank(lexicon, raw, request) {
        const wordCount = lexicon.words.length;
        if (!lexicon.byRank) {
            lexicon.byRank = new Uint32Array(wordCount);
            lexicon.order.forEach((position, w) => { lexicon.byRank[position] = w; });
        }
        const frequencyWeight = Number(request.frequencyWeight);
        const keys = [];
        const scoreByWord = new Float64Array(wordCount), similarityByWord = new Float64Array(wordCount);
        for (let w = 0; w < wordCount; w += 1) {
            if (!(raw[w] > THRESHOLD)) continue;
            const zipf = Number.isNaN(lexicon.zipf[w]) ? 1.0 : lexicon.zipf[w];
            let score = applyFrequencyWeight(raw[w], zipf, frequencyWeight);
            let similarity = NaN;
            if (request.topic) {
                const value = request.topic.similarity(w);
                if (value === null) continue;
                similarity = value;
                const normalized = Math.max(0, Math.min(1, (value + 1) / 2));
                score *= 1 - (1 - normalized) * (request.topic.weight / 10 * 0.7);
            }
            scoreByWord[w] = score;
            similarityByWord[w] = similarity;
            keys.push((100000 - Math.round(score * 1000)) * RANK_SPACE + lexicon.order[w]);
        }
        const sorted = Float64Array.from(keys).sort();
        const length = sorted.length;
        const out = { length, words: new Uint32Array(length), scores: new Float64Array(length),
            raws: new Float64Array(length), similarities: new Float64Array(length) };
        for (let i = 0; i < length; i += 1) {
            const w = lexicon.byRank[sorted[i] % RANK_SPACE];
            out.words[i] = w;
            out.scores[i] = scoreByWord[w]; out.raws[i] = raw[w]; out.similarities[i] = similarityByWord[w];
        }
        return out;
    }

    function search(lexicon, request, kernel) {
        return rank(lexicon, scoreRaw(lexicon, request, kernel), request);
    }

    // Which pronunciation won for one word: the first highest-scoring (layer, query) pair.
    // Returns {label, target: [phoneme], query: {phonemes, detail}, score} for display.
    function explain(lexicon, word, request) {
        const view = request.vowelsOnly ? vowelView(lexicon) : lexicon;
        const kernel = view.kernel || (view.kernel = createKernel(view));
        const queries = buildQueries(view, request);
        const { useDetailWeights, vowelWeight, consonantWeight } = queries.options;
        const vw = useDetailWeights ? 1 : vowelWeight, cw = useDetailWeights ? 1 : consonantWeight;
        let best = null;
        for (const [layer, list, label] of pairings(lexicon, word, request.mode, queries)) {
            const { offsets, ids } = lexicon.layers[layer];
            for (let k = offsets[word]; k < offsets[word + 1]; k += 1) {
                for (const query of list) {
                    const score = kernel(ids[k], query, vw, cw);
                    if (!best || score > best.score) best = { label, sequence: ids[k], query, score };
                }
            }
        }
        if (!best) return null;
        const target = [];
        for (let p = view.seqOffset[best.sequence]; p < view.seqOffset[best.sequence + 1]; p += 1) {
            target.push(view.phonemes[view.seqData[p]]);
        }
        return { label: best.label, target, query: { phonemes: best.query.phonemes, detail: best.query.detail }, score: best.score };
    }

    root.RhymeWordEngine = Object.freeze({ THRESHOLD, LANG, buildLexicon, serializeLexicon, deserializeLexicon,
        createKernel, createSpanScorer, vowelView, search, scoreRaw, rank, explain, applyFrequencyWeight, remapProportional,
        proportionalTransfer, alignedTransfer, queryVariants, prepareQuery, searchOptions });
})(typeof self !== 'undefined' ? self : globalThis);
