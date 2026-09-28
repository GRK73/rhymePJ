// Query pronunciation for the V2 word engine (V2검색엔진설계.md §4.2).
// A query gets its phonemes exactly the way lexicon words got theirs:
//   1. a word in the lexicon  -> its stored Heami-derived pronunciation
//   2. any other word         -> the Heami-imitating G2P model (g2p-heami.js)
//   3. jamo input (ㅏㅏ, ㅋㅋ) -> V1 jamo rules; it is not a word to pronounce
// Punctuation and emoji are dropped; whitespace and script changes split tokens,
// which are resolved separately and concatenated. A number outside the lexicon (123) is
// dropped and reported: it has several readings (일이삼, 백이십삼, one two three) and
// guessing one would be a hidden choice.
(function (root) {
    'use strict';

    const KO = 0, EN = 1;
    const HANGUL = /^[가-힣]+$/;
    const JAMO = /[ㄱ-ㅎㅏ-ㅣ]/;
    const DIGITS = /^[0-9]+$/;
    const TOKEN = /[가-힣ㄱ-ㅎㅏ-ㅣ]+|[a-z0-9']+/g;
    const VOWELS = new Set(['a', 'ɛ', 'ʌ', 'e', 'o', 'u', 'ɯ', 'i',
        'ja', 'jɛ', 'jʌ', 'je', 'jo', 'ju', 'wa', 'wɛ', 'we', 'wʌ', 'wi', 'ɰi']);

    // One slider per Hangul syllable: onset consonant(s), vowel and coda. Falls back
    // to one slider per phoneme when vowels and syllables do not line up.
    // Each written syllable gets the sounds that come from its own letters, even when
    // pronunciation moves them (맛있다 [마딛따]: the t from ㅅ stays with 맛).
    function syllableMap(word, phonemes, offset) {
        const syllables = Array.from(word);
        const vowels = phonemes.flatMap((phoneme, index) => (VOWELS.has(phoneme) ? [index] : []));
        const codes = syllables.map(char => char.codePointAt(0) - 0xac00);
        if (vowels.length !== syllables.length || codes.some(code => code < 0 || code > 11171)) {
            // No syllable alignment: spread the sounds evenly over the written syllables.
            return syllables.map((char, k) => ({ char,
                startIndex: offset + Math.floor(k * phonemes.length / syllables.length),
                endIndex: offset + Math.floor((k + 1) * phonemes.length / syllables.length) }));
        }
        const starts = [0];
        for (let k = 1; k < syllables.length; k += 1) {
            const first = vowels[k - 1] + 1;
            const between = vowels[k] - first;
            const hasFinal = codes[k - 1] % 28 !== 0;
            const silentOnset = Math.floor(codes[k] / 588) === 11; // ㅇ
            // Before a silent ㅇ every consonant came from the previous final (연음, ㄴ첨가);
            // otherwise the last consonant is this syllable's onset and the rest the previous final.
            const toPrevious = silentOnset ? between : hasFinal ? Math.max(between - 1, 0) : 0;
            starts.push(first + toPrevious);
        }
        return syllables.map((char, k) => ({ char, startIndex: offset + starts[k],
            endIndex: offset + (k + 1 < syllables.length ? starts[k + 1] : phonemes.length) }));
    }

    function phonemeMap(phonemes, offset) {
        return phonemes.map((char, index) => ({ char, startIndex: offset + index, endIndex: offset + index + 1 }));
    }

    class QueryResolver {
        // loadModel(lang) -> Promise<{predict(word) -> [phoneme]}>; jamoPhonemes(text) -> {phonemes, charMap}
        constructor(lexicon, { loadModel, jamoPhonemes }) {
            this.lexicon = lexicon;
            this.loadModel = loadModel;
            this.jamoPhonemes = jamoPhonemes;
            this.models = new Map();
            this.index = null;
        }

        lookup(lang, word) {
            if (!this.index) {
                this.index = new Map();
                this.lexicon.words.forEach((text, w) => {
                    const key = `${this.lexicon.lang[w]}\t${text.toLowerCase()}`;
                    if (!this.index.has(key)) this.index.set(key, w);
                });
            }
            return this.index.get(`${lang}\t${word}`);
        }

        layer(name, w) {
            const { offsets, ids } = this.lexicon.layers[name];
            const lists = [];
            for (let k = offsets[w]; k < offsets[w + 1]; k += 1) {
                const id = ids[k];
                const phonemes = [];
                for (let p = this.lexicon.seqOffset[id]; p < this.lexicon.seqOffset[id + 1]; p += 1) {
                    phonemes.push(this.lexicon.phonemes[this.lexicon.seqData[p]]);
                }
                lists.push(phonemes);
            }
            return lists;
        }

        async model(lang) {
            if (!this.models.has(lang)) this.models.set(lang, this.loadModel(lang));
            return this.models.get(lang);
        }

        async resolveToken(token) {
            if (JAMO.test(token)) {
                const jamo = this.jamoPhonemes(token);
                return { korean: true, native: jamo.phonemes, koreanized: jamo.phonemes, source: 'jamo', text: token, charMap: jamo.charMap };
            }
            if (HANGUL.test(token)) {
                const w = this.lookup(KO, token);
                const phonemes = w !== undefined ? this.layer('ko', w)[0] : (await this.model('ko')).predict(token);
                return { korean: true, native: phonemes, koreanized: phonemes, source: w !== undefined ? 'lexicon' : 'model', text: token };
            }
            const w = this.lookup(EN, token);
            if (w === undefined && DIGITS.test(token)) return { korean: false, native: [], koreanized: [], source: 'number', text: token };
            if (w !== undefined) {
                const koreanized = this.layer('koreanized', w)[0] || [];
                const native = this.layer('native', w)[0] || koreanized;
                return { korean: false, native, koreanized, source: 'lexicon', text: token };
            }
            const phonemes = (await this.model('en')).predict(token);
            return { korean: false, native: phonemes, koreanized: phonemes, source: 'model', text: token };
        }

        // Returns V1 getQueryPhonemes-shaped data plus {tokens, sources} for the UI.
        async resolve(text) {
            const query = String(text || '').trim();
            // Accents are dropped (café -> cafe) so Latin words match the lexicon and model vocabulary.
            const folded = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
            const tokens = folded.match(TOKEN) || [];
            const parts = [];
            const skipped = [];
            for (const token of tokens) {
                const part = await this.resolveToken(token);
                if (part.native.length) parts.push(part);
                else if (part.source === 'number') skipped.push(token);
            }
            const native = parts.flatMap(part => part.native);
            if (!native.length) return { query, phonemes: [], charMap: [], tokens: [], sources: [], skipped };
            let offset = 0;
            const charMap = parts.flatMap(part => {
                const map = part.charMap ? part.charMap.map(item => ({ ...item, startIndex: item.startIndex + offset, endIndex: item.endIndex + offset }))
                    : part.korean ? syllableMap(part.text, part.native, offset) : phonemeMap(part.native, offset);
                offset += part.native.length;
                return map;
            });
            const allKorean = parts.every(part => part.korean);
            const koreanized = parts.flatMap(part => part.koreanized);
            return {
                query, phonemes: native, charMap,
                koreanPronunciationCandidates: allKorean ? [{ phonemes: native }] : undefined,
                koreanizedCandidates: allKorean ? undefined : [{ phonemes: koreanized }],
                tokens: parts.map(part => part.text), sources: parts.map(part => part.source), skipped,
            };
        }
    }

    // Engine request fields (queryPhonemes/detail sizing) from a resolved query.
    function toEngineQuery(resolved) {
        return {
            native: resolved.phonemes,
            korean: resolved.koreanPronunciationCandidates?.map(candidate => candidate.phonemes),
            koreanized: resolved.koreanizedCandidates?.map(candidate => candidate.phonemes),
        };
    }

    root.RhymeWordQuery = Object.freeze({ QueryResolver, toEngineQuery, syllableMap });
})(typeof self !== 'undefined' ? self : globalThis);
