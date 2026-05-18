const CORPUS_TOKEN_BLOCKLIST = new Set([
    'name', 'url', 'http', 'https', 'www', 'com',
    '월', '일', '년', '시', '분', '초'
]);

let corpusAffinityStores = null;
let corpusAffinityLoadingPromise = null;
let linkedCorpusStores = null;
let linkedCorpusLoadingPromise = null;

function normalizeCorpusToken(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^[\s"'([{]+|[\s"'\])}.!,?:;]+$/g, '');
}

function isUsefulCorpusToken(token) {
    if (!token || token.length < 2) return false;
    if (CORPUS_TOKEN_BLOCKLIST.has(token)) return false;
    return /[\uAC00-\uD7A3a-z]/i.test(token);
}

function getCorpusCandidateTokens(item) {
    const tokens = [
        item?.word,
        item?.display,
        item?.semanticWord
    ].map(normalizeCorpusToken).filter(isUsefulCorpusToken);
    return [...new Set(tokens)];
}

function normalizeZipfLocal(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(1, (numeric - 4.2) / 3.1));
}

function buildVocabAffinityStore(data) {
    const map = new Map();
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    entries.forEach((row, index) => {
        const word = normalizeCorpusToken(row?.word || row?.[0]);
        if (!isUsefulCorpusToken(word)) return;
        const zipfScore = normalizeZipfLocal(row?.zipfLocal);
        const rankScore = entries.length > 1 ? 1 - (index / (entries.length - 1)) : 1;
        const score = Math.max(zipfScore, rankScore * 0.85);
        map.set(word, Math.max(map.get(word) || 0, score));
    });
    return map;
}

function getBestVocabAffinity(store, item) {
    if (!store || store.size === 0) return 0;
    return getCorpusCandidateTokens(item).reduce((best, token) => {
        return Math.max(best, store.get(token) || 0);
    }, 0);
}

async function ensureCorpusAffinityResourcesLoaded() {
    if (corpusAffinityStores) return corpusAffinityStores;
    if (corpusAffinityLoadingPromise) return corpusAffinityLoadingPromise;

    corpusAffinityLoadingPromise = (async () => {
        const [hiphopVocab, translatedVocab, spokenVocab] = await Promise.all([
            loadOptionalJson(dataPath('hiphop_vocab_stats_ko.json')),
            loadOptionalJson(dataPath('translated_hiphop_vocab_ko.json')),
            loadOptionalJson(dataPath('spoken_korean_vocab_ko.json'))
        ]);
        corpusAffinityStores = {
            hiphop: buildVocabAffinityStore(hiphopVocab),
            translated: buildVocabAffinityStore(translatedVocab),
            spoken: buildVocabAffinityStore(spokenVocab)
        };
        return corpusAffinityStores;
    })();

    return corpusAffinityLoadingPromise;
}

function getCorpusAffinity(item) {
    if (!corpusAffinityStores || item?.lang !== 'ko') {
        return { score: 0, hiphop: 0, translated: 0, spoken: 0 };
    }

    const hiphop = getBestVocabAffinity(corpusAffinityStores.hiphop, item);
    const translated = getBestVocabAffinity(corpusAffinityStores.translated, item);
    const spoken = getBestVocabAffinity(corpusAffinityStores.spoken, item);
    const score = hiphop * 0.45 + translated * 0.25 + spoken * 0.30;
    return { score, hiphop, translated, spoken };
}

function applyCorpusAffinityWeight(score, item) {
    const affinity = getCorpusAffinity(item);
    if (affinity.score <= 0) {
        return { score, affinity };
    }

    const boost = Math.min(0.10, affinity.score * 0.10);
    return {
        score: score + (100 - score) * boost,
        affinity
    };
}

function buildNgramCountStore(data) {
    const map = new Map();
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    let maxCount = 0;

    entries.forEach(row => {
        const phrase = Array.isArray(row) ? row[0] : row?.phrase;
        const count = Number(Array.isArray(row) ? row[1] : row?.count) || 0;
        if (!phrase || count <= 0) return;
        const key = normalizeCorpusPhraseKey(phrase);
        if (!key) return;
        const nextCount = Math.max(map.get(key) || 0, count);
        map.set(key, nextCount);
        maxCount = Math.max(maxCount, nextCount);
    });

    return { map, maxCount };
}

function normalizeCorpusPhraseKey(value) {
    const tokens = String(value || '')
        .split(/\s+/)
        .map(normalizeCorpusToken)
        .filter(isUsefulCorpusToken);
    return tokens.length >= 2 ? `${tokens[0]} ${tokens[1]}` : '';
}

function getLinkedPhraseKeys(first, second) {
    const firstTokens = getCorpusCandidateTokens(first);
    const secondTokens = getCorpusCandidateTokens(second);
    const keys = [];
    firstTokens.forEach(left => {
        secondTokens.forEach(right => {
            keys.push(`${left} ${right}`);
        });
    });
    return keys;
}

async function ensureLinkedCorpusResourcesLoaded() {
    if (linkedCorpusStores) return linkedCorpusStores;
    if (linkedCorpusLoadingPromise) return linkedCorpusLoadingPromise;

    linkedCorpusLoadingPromise = (async () => {
        const [hiphopBigram, translatedBigram, spokenBigram] = await Promise.all([
            loadOptionalJson(dataPath('hiphop_2gram_ko.json')),
            loadOptionalJson(dataPath('translated_hiphop_bigram_ko.json')),
            loadOptionalJson(dataPath('spoken_korean_2gram_ko.json'))
        ]);
        linkedCorpusStores = {
            hiphop: buildNgramCountStore(hiphopBigram),
            translated: buildNgramCountStore(translatedBigram),
            spoken: buildNgramCountStore(spokenBigram)
        };
        return linkedCorpusStores;
    })();

    return linkedCorpusLoadingPromise;
}

function normalizeCorpusCount(count, maxCount) {
    if (!count || !maxCount) return 0;
    return Math.max(0, Math.min(100, Math.log1p(count) / Math.log1p(maxCount) * 100));
}

function getBestLinkedStoreScore(store, keys) {
    if (!store?.map || store.map.size === 0) return 0;
    return keys.reduce((best, key) => {
        return Math.max(best, normalizeCorpusCount(store.map.get(key) || 0, store.maxCount));
    }, 0);
}

function getLinkedCorpusScore(first, second, lang) {
    if (lang !== 'ko' || !linkedCorpusStores) return 0;
    const keys = getLinkedPhraseKeys(first, second);
    if (keys.length === 0) return 0;

    const hiphop = getBestLinkedStoreScore(linkedCorpusStores.hiphop, keys);
    const translated = getBestLinkedStoreScore(linkedCorpusStores.translated, keys);
    const spoken = getBestLinkedStoreScore(linkedCorpusStores.spoken, keys);
    return hiphop * 0.50 + translated * 0.25 + spoken * 0.25;
}

function blendLinkedCorpusScore(baseScore, corpusScore) {
    if (!corpusScore || corpusScore <= 0) return baseScore;
    return baseScore * 0.90 + corpusScore * 0.10;
}
