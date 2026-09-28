// V2 linked rhyme engine: two words in a row whose boundary sounds like the query
// (사랑해 -> [사랑 해] / [사 랑해] ...). The query is split at every allowed point; the
// first word's ending is compared with the left part and the next word's beginning
// with the right part, using the word engine's kernel and the same pronunciations
// (Heami for Korean, native / Korean-style layers for English).
//
// Score, the same steps as word search (2026-09-28: no letter-match priority, no hip-hop /
// spoken corpus boost, no split-balance factor, no bigram share in the score):
//   pronunciation = left and right sound scores averaged by query sounds (detail weights);
//                   both sides must be above 40
//   frequency     = V1 applyFrequencyWeight with the mean zipf of the two words (slider 0: none)
//   topic         = V1 penalty (up to 70% at weight 10) from the similarity of the pair's mean
//                   meaning vector to the topic
// The bigram data only decides which pairs exist (words seen next to each other).
// Ties: Korean pairs first, then 가나다 / abc.
(function (root) {
    'use strict';

    const Engine = root.RhymeWordEngine;
    const THRESHOLD = 40;
    const LANG = Engine.LANG;
    const SECTION_TYPES = { Float64Array, Float32Array, Uint8Array, Uint32Array, Int32Array };
    const ZIPF_MISSING = -2147483648;
    const TIE_SPACE = 1 << 19;   // word order ranks (lexicon and surfaces are both below 2^19)
    const RANK_SPACE = 1 << 21;  // pairs sorted with one numeric key when fewer than this

    function deserializeLinked(manifest, buffer) {
        if (manifest.schema_version !== 1) throw new Error('unsupported linked schema');
        const section = Object.fromEntries(manifest.sections.map(entry =>
            [entry.name, new SECTION_TYPES[entry.type](buffer, entry.offset, entry.length)]));
        return {
            surfaces: new TextDecoder().decode(section.surfaces).split('\n'),
            pronOffsets: section['pron.offsets'], pronData: section['pron.data'], norm: section.norm,
            zipf: Float64Array.from(section.zipf, value => (value === ZIPF_MISSING ? NaN : value / manifest.zipf_scale)),
            topicRow: section.topicRow, order: section.order,
            ko: { offsets: section['ko.offsets'], target: section['ko.target'] },
            en: { heads: section['en.heads'], offsets: section['en.offsets'], target: section['en.target'] },
        };
    }

    // Missing frequency counts as zipf 1.0 (V1 default).
    const zipfOrDefault = zipf => (Number.isFinite(zipf) ? zipf : 1.0);
    const importance = detail => detail.reduce((sum, value) => sum + (Number.isFinite(value) ? Math.max(0, value) : 1), 0) || 1;

    // ---- Splits ---------------------------------------------------------------------

    // A Korean query splits between written syllables (starts: first phoneme of each
    // syllable). Other queries follow V1's English rule: split next to a vowel, each side
    // at least 1 phoneme (2 when the query has more than 4).
    function splitsOf(phonemes, syllables, isVowel) {
        const splits = [];
        if (syllables) {
            for (let k = 1; k < syllables.starts.length; k += 1) {
                const at = syllables.starts[k];
                if (at <= 0 || at >= phonemes.length) continue;
                const leftText = syllables.chars.slice(0, k).join(''), rightText = syllables.chars.slice(k).join('');
                splits.push({ at, leftText, rightText, label: `${leftText} / ${rightText}`, syllabic: true });
            }
            return splits;
        }
        const minimum = phonemes.length <= 4 ? 1 : 2;
        for (let at = minimum; at <= phonemes.length - minimum; at += 1) {
            if (!isVowel(phonemes[at - 1]) && !isVowel(phonemes[at])) continue;
            const leftText = phonemes.slice(0, at).join(' '), rightText = phonemes.slice(at).join(' ');
            splits.push({ at, leftText, rightText, label: `${leftText} / ${rightText}`, syllabic: false });
        }
        return splits;
    }

    // ---- Boundary scoring -----------------------------------------------------------

    // Score of the last (end) or first (start) query-length sounds of data[start, start+length).
    // Shorter words score 0 (V1). Equal segments are scored once per query side.
    function boundaryScorer(span, query, side, vw, cw) {
        const length = query.ids.length;
        const cache = new Map();
        const exact = length <= 7;
        return (data, start, total) => {
            if (total < length) return 0;
            const from = side === 'end' ? start + total - length : start;
            let key = exact ? 0 : '';
            for (let k = 0; k < length; k += 1) key = exact ? key * 128 + data[from + k] : `${key},${data[from + k]}`;
            let score = cache.get(key);
            if (score === undefined) {
                let same = true;
                for (let k = 0; k < length && same; k += 1) same = data[from + k] === query.ids[k];
                score = same ? 100 : span(data, from, length, query, vw, cw);
                cache.set(key, score);
            }
            return score;
        };
    }

    // ---- Pair table ---------------------------------------------------------------------

    class PairTable {
        constructor() {
            this.size = 0;
            this.mask = (1 << 16) - 1;
            this.slots = new Int32Array(this.mask + 1).fill(-1);
            this.grow(1 << 15);
        }

        grow(capacity) {
            const next = { lang: new Uint8Array(capacity), first: new Int32Array(capacity), second: new Int32Array(capacity),
                boundary: new Float64Array(capacity), left: new Float32Array(capacity), right: new Float32Array(capacity),
                zipf: new Float32Array(capacity), split: new Int32Array(capacity) };
            for (const name of Object.keys(next)) { if (this[name]) next[name].set(this[name].subarray(0, this.size)); this[name] = next[name]; }
            this.capacity = capacity;
        }

        slotOf(lang, first, second) {
            let slot = (Math.imul(first, 0x9e3779b1) ^ Math.imul(second, 0x85ebca77) ^ lang) & this.mask;
            for (;;) {
                const i = this.slots[slot];
                if (i < 0 || (this.first[i] === first && this.second[i] === second && this.lang[i] === lang)) return slot;
                slot = (slot + 1) & this.mask;
            }
        }

        // New pair: its index (zipf is filled in by the caller); else -1.
        add(lang, first, second, boundary, left, right, split) {
            let slot = this.slotOf(lang, first, second);
            const at = this.slots[slot];
            if (at >= 0) {
                if (boundary > this.boundary[at]) { this.boundary[at] = boundary; this.left[at] = left; this.right[at] = right; this.split[at] = split; }
                return -1;
            }
            if (this.size === this.capacity) this.grow(this.capacity * 2);
            if ((this.size + 1) * 2 > this.mask + 1) { this.rehash(); slot = this.slotOf(lang, first, second); }
            const i = this.size++;
            this.slots[slot] = i;
            this.lang[i] = lang; this.first[i] = first; this.second[i] = second; this.boundary[i] = boundary;
            this.left[i] = left; this.right[i] = right; this.split[i] = split;
            return i;
        }

        rehash() {
            this.mask = this.mask * 2 + 1;
            this.slots = new Int32Array(this.mask + 1).fill(-1);
            for (let i = 0; i < this.size; i += 1) this.slots[this.slotOf(this.lang[i], this.first[i], this.second[i])] = i;
        }

        finish() {
            const out = {};
            for (const name of ['lang', 'first', 'second', 'boundary', 'left', 'right', 'zipf', 'split']) out[name] = this[name].slice(0, this.size);
            return out;
        }
    }

    // ---- Collect (pronunciation settings) ---------------------------------------------

    // request: {languages, mode, queryPhonemes, detail, syllables?: {chars, starts} (Korean
    //   query), useDetailWeights, vowelWeight, consonantWeight, excludeWords, allowFirstParticle,
    //   isVowel, isCancelled?}
    // Returns every pair above the threshold with the best split, independent of frequency
    // and topic, so those settings only re-rank (rank()).
    function collect(lexicon, linked, request) {
        const options = { ...Engine.searchOptions(request), vowelsOnly: false };
        const variants = Engine.queryVariants(lexicon, request);
        const span = lexicon.spanScorer || (lexicon.spanScorer = Engine.createSpanScorer(lexicon));
        const vw = options.useDetailWeights ? 1 : options.vowelWeight;
        const cw = options.useDetailWeights ? 1 : options.consonantWeight;
        const isCancelled = request.isCancelled || (() => false);
        const cancelled = () => Object.assign(new Error('search cancelled'), { code: 'search_cancelled' });
        const isVowel = phoneme => { const id = lexicon.phonemeIndex.get(phoneme); return id === undefined ? Boolean(request.isVowel?.(phoneme)) : lexicon.vowel[id] === 1; };
        const languages = request.languages || ['ko', 'en'];
        const excludeWords = request.excludeWords || [];
        const excluded = text => excludeWords.length > 0 && excludeWords.some(word => text.toLowerCase().includes(word));

        // Pairs: best split per (language, first, second), in typed arrays with an
        // open-addressing index (a JS Map of this size dominates the search time).
        const pairs = new PairTable();
        const add = (lang, first, second, boundary, left, right, split) => pairs.add(lang, first, second, boundary, left, right, split);
        const splitList = [];

        // Syllable splits apply to the query's own (Korean) pronunciation, not to other variants.
        const nativeKey = variants.native.phonemes.join(' ');
        const forEachSplit = (variantList, visit) => {
            for (const variant of variantList) {
                const syllables = request.syllables && variant.phonemes.join(' ') === nativeKey ? request.syllables : null;
                for (const split of splitsOf(variant.phonemes, syllables, isVowel)) {
                    const leftDetail = variant.detail.slice(0, split.at), rightDetail = variant.detail.slice(split.at);
                    const left = Engine.prepareQuery(lexicon, variant.phonemes.slice(0, split.at), leftDetail, options);
                    const right = Engine.prepareQuery(lexicon, variant.phonemes.slice(split.at), rightDetail, options);
                    splitList.push(split);
                    visit({ left: boundaryScorer(span, left, 'end', vw, cw), right: boundaryScorer(span, right, 'start', vw, cw),
                        importanceLeft: importance(leftDetail), importanceRight: importance(rightDetail), split: splitList.length - 1 });
                }
            }
        };

        if (languages.includes('ko')) {
            const { pronOffsets, pronData, norm, zipf, surfaces, ko } = linked;
            const count = surfaces.length;
            const blocked = new Uint8Array(count);
            if (excludeWords.length) {
                for (let s = 0; s < count; s += 1) if (excluded(surfaces[s]) || (norm[s] >= 0 && excluded(surfaces[norm[s]]))) blocked[s] = 1;
            }
            // Frequency of the meaning word (normalized form when it has a count), as V1.
            if (!linked.meaningZipf) {
                linked.meaningZipf = Float32Array.from(zipf, (_, s) =>
                    zipfOrDefault(norm[s] >= 0 && !Number.isNaN(zipf[norm[s]]) ? zipf[norm[s]] : zipf[s]));
            }
            const zipfOf = linked.meaningZipf;
            forEachSplit(variants.korean, plan => {
                // Followers repeat across heads; score each once per split.
                const rightOf = new Float32Array(count).fill(NaN);
                for (let h = 0; h < count; h += 1) {
                    if (ko.offsets[h + 1] === ko.offsets[h] || blocked[h]) continue;
                    if (!request.allowFirstParticle && norm[h] >= 0) continue;
                    if ((h & 8191) === 0 && isCancelled()) throw cancelled();
                    const left = plan.left(pronData, pronOffsets[h], pronOffsets[h + 1] - pronOffsets[h]);
                    if (!(left > THRESHOLD)) continue;
                    for (let r = ko.offsets[h]; r < ko.offsets[h + 1]; r += 1) {
                        const t = ko.target[r];
                        if (blocked[t]) continue;
                        let right = rightOf[t];
                        if (right !== right) right = rightOf[t] = plan.right(pronData, pronOffsets[t], pronOffsets[t + 1] - pronOffsets[t]);
                        if (!(right > THRESHOLD)) continue;
                        const boundary = (left * plan.importanceLeft + right * plan.importanceRight) / (plan.importanceLeft + plan.importanceRight);
                        const i = add(LANG.ko, h, t, boundary, left, right, plan.split);
                        if (i >= 0) pairs.zipf[i] = (zipfOf[h] + zipfOf[t]) / 2;
                    }
                }
            });
        }

        if (languages.includes('en')) {
            const { en } = linked;
            const layerNames = request.mode === 'native' ? ['native'] : request.mode === 'koreanized' ? ['koreanized'] : ['native', 'koreanized'];
            const variantList = request.mode === 'native' ? [variants.native]
                : request.mode === 'koreanized' ? variants.koreanized : [variants.native, ...variants.koreanized];
            if (!lexicon.lowerWords) lexicon.lowerWords = lexicon.words.map(word => word.toLowerCase());
            const blockedWord = w => excluded(lexicon.lowerWords[w]);
            const zipfOf = w => zipfOrDefault(lexicon.zipf[w]);
            const best = (scorer, w) => {
                let top = 0;
                for (const name of layerNames) {
                    const { offsets, ids } = lexicon.layers[name];
                    for (let k = offsets[w]; k < offsets[w + 1]; k += 1) {
                        const sequence = ids[k];
                        const start = lexicon.seqOffset[sequence];
                        const value = scorer(lexicon.seqData, start, lexicon.seqOffset[sequence + 1] - start);
                        if (value > top) top = value;
                    }
                }
                return top;
            };
            forEachSplit(variantList, plan => {
                const rightOf = new Float32Array(lexicon.words.length).fill(NaN);
                for (let k = 0; k < en.heads.length; k += 1) {
                    const h = en.heads[k];
                    if (blockedWord(h)) continue;
                    if ((k & 8191) === 0 && isCancelled()) throw cancelled();
                    const left = best(plan.left, h);
                    if (!(left > THRESHOLD)) continue;
                    for (let r = en.offsets[k]; r < en.offsets[k + 1]; r += 1) {
                        const t = en.target[r];
                        if (blockedWord(t)) continue;
                        let right = rightOf[t];
                        if (right !== right) right = rightOf[t] = best(plan.right, t);
                        if (!(right > THRESHOLD)) continue;
                        const boundary = (left * plan.importanceLeft + right * plan.importanceRight) / (plan.importanceLeft + plan.importanceRight);
                        const i = add(LANG.en, h, t, boundary, left, right, plan.split);
                        if (i >= 0) pairs.zipf[i] = (zipfOf(h) + zipfOf(t)) / 2;
                    }
                }
            });
        }

        const length = pairs.size;
        const result = pairs.finish();
        const orderOf = (lang, word) => (lang === LANG.ko ? linked.order[word] : lexicon.order[word]);
        const tieKey = new Float64Array(length);
        for (let i = 0; i < length; i += 1) {
            const lang = result.lang[i];
            tieKey[i] = (lang * TIE_SPACE + orderOf(lang, result.first[i])) * TIE_SPACE + orderOf(lang, result.second[i]);
        }
        // Tie keys are unique (one entry per pair); rank them once, reuse for every re-rank.
        const sortedTies = Float64Array.from(tieKey).sort();
        const tieRankOf = new Map();
        for (let rank = 0; rank < length; rank += 1) tieRankOf.set(sortedTies[rank], rank);
        const tieRank = new Uint32Array(length), byTie = new Uint32Array(length);
        for (let i = 0; i < length; i += 1) { tieRank[i] = tieRankOf.get(tieKey[i]); byTie[tieRank[i]] = i; }
        return { length, splits: splitList, tieRank, byTie, ...result };
    }

    // ---- Rank (frequency and topic) ---------------------------------------------------

    // topic: {weight, similarity: Float32Array per topic row, cosine(rowA, rowB)} | null
    // Phrase meaning is the mean of the two word vectors (V1: the sum), compared with the topic.
    // As in word search, a pair without meaning vectors is left out while a topic is on.
    function rank(lexicon, linked, raw, request) {
        const frequencyWeight = Number(request.frequencyWeight);
        const topic = request.topic;
        const penalty = topic ? Number(topic.weight) / 10 * 0.7 : 0;
        const rowOf = (lang, word) => (lang === LANG.ko ? linked.topicRow[word] : word);
        const scores = new Float64Array(raw.length), similarities = new Float64Array(raw.length).fill(NaN);
        const kept = [];
        for (let i = 0; i < raw.length; i += 1) {
            let score = Engine.applyFrequencyWeight(raw.boundary[i], raw.zipf[i], frequencyWeight);
            if (topic) {
                const a = rowOf(raw.lang[i], raw.first[i]), b = rowOf(raw.lang[i], raw.second[i]);
                if (a < 0 || b < 0) continue;
                const norm = Math.sqrt(Math.max(2 + 2 * topic.cosine(a, b), 1e-9));
                const similarity = Math.max(-1, Math.min(1, (topic.similarity[a] + topic.similarity[b]) / norm));
                similarities[i] = similarity;
                score *= 1 - (1 - Math.max(0, Math.min(1, (similarity + 1) / 2))) * penalty;
            }
            scores[i] = score;
            kept.push(i);
        }
        // Score rounded to 0.001, then the tie order from collect(), as one numeric key.
        let ids;
        if (raw.length < RANK_SPACE) {
            const keys = Float64Array.from(kept, i => (100000 - Math.round(scores[i] * 1000)) * RANK_SPACE + raw.tieRank[i]).sort();
            ids = Uint32Array.from(keys, key => raw.byTie[key % RANK_SPACE]);
        } else {
            ids = Uint32Array.from(kept.sort((x, y) =>
                (Math.round(scores[y] * 1000) - Math.round(scores[x] * 1000)) || (raw.tieRank[x] - raw.tieRank[y])));
        }
        return { length: ids.length, ids, scores, similarities };
    }

    // ---- Display -----------------------------------------------------------------------

    // V1 layout: the boundary part in brackets, 역[사상 최]고의.
    function bracketed(first, second, leftText, rightText) {
        const a = Array.from(first), b = Array.from(second);
        const left = Math.max(1, Math.min(a.length, Array.from(leftText).length || 1));
        const right = Math.max(1, Math.min(b.length, Array.from(rightText).length || 1));
        return `${a.slice(0, a.length - left).join('')}[${a.slice(a.length - left).join('')} ${b.slice(0, right).join('')}]${b.slice(right).join('')}`;
    }

    function describe(lexicon, linked, raw, ranked, position) {
        const i = ranked.ids[position];
        const lang = raw.lang[i];
        const word = id => (lang === LANG.ko ? linked.surfaces[id] : lexicon.words[id]);
        const first = word(raw.first[i]), second = word(raw.second[i]);
        const split = raw.splits[raw.split[i]];
        const similarity = ranked.similarities[i];
        return {
            resultType: 'linked', lang: lang === LANG.ko ? 'ko' : 'en',
            first: { word: first, display: first }, second: { word: second, display: second },
            word: `${first} ${second}`,
            surfaceDisplay: lang === LANG.ko && split.syllabic ? bracketed(first, second, split.leftText, split.rightText) : `${first} + ${second}`,
            score: ranked.scores[i], splitLabel: split.label, leftScore: raw.left[i], rightScore: raw.right[i],
            pronunciationScore: raw.boundary[i], zipf: raw.zipf[i],
            topicSimilarity: Number.isNaN(similarity) ? null : similarity,
        };
    }

    root.RhymeLinkedEngine = Object.freeze({ THRESHOLD, deserializeLinked, splitsOf, collect, rank, describe });
})(typeof self !== 'undefined' ? self : globalThis);
