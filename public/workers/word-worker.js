'use strict';
// V2 word search Worker (V2검색엔진설계.md §4-6).
// Owns the lexicon, query pronunciation (lexicon -> Heami-imitating model), topic
// vectors (LaBSE, one ko/en space), linked-search data, the phonetic score caches and the
// finished results for paging. Word and linked search share the lexicon, model and vectors.
self.RHYME_DATA_BASE = new URL('../', self.location.href).href;
importScripts(
    '../js/v2/phoneme-similarity-config.js',
    '../js/phonetics.js',
    '../js/search/word-engine.js?v=20260928-engine1',
    '../js/search/g2p-heami.js?v=20260928-final1',
    '../js/search/word-query.js?v=20260928-final1',
    '../js/search/topic-vectors.js?v=20260928-int4',
    '../js/search/linked-engine.js?v=20260928-int4',
);

const Engine = self.RhymeWordEngine;
const ASSET_BASE = new URL('../assets/', self.location.href);
const PAGE_SIZE = 99;
const LAYER_LABELS = { ko: '한국어 발음', native: '실제 영어', koreanized: '한국식', cross: '교차' };

let lexiconPromise = null;
let lexiconManifest = null;
let topicVectorsPromise = null;
let topicManifest = null;
let linkedPromise = null;
let linkedManifest = null;
let linkedTopicPromise = null;
let linkedCache = null;
let resolver = null;
let rawCache = null;
// Finished results by search (request id), for paging the list on screen: the newest two,
// so a list stays pageable after a newer search was cancelled. Cancelled searches are
// never kept, and one cancelled while waiting for a download stops before computing.
const finished = new Map();
const running = new Set();
const cancelled = new Set();
function keep(requestId, state) {
    finished.set(requestId, state);
    while (finished.size > 2) finished.delete(finished.keys().next().value);
}

function send(type, requestId, payload = {}) {
    self.postMessage({ type, request_id: requestId, ...payload });
}

function failure(code, message) {
    return Object.assign(new Error(message), { code });
}

// Fetch a gzip asset, verify its SHA-256, and return the decompressed bytes.
async function loadGzip(url, expected, onBytes) {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw failure('asset_unavailable', `asset unavailable: ${url}`);
    const total = expected.gzip_bytes || Number(response.headers.get('content-length')) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onBytes?.(received, total);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== expected.gzip_sha256) throw failure('asset_integrity', `asset integrity failure: ${url}`);
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

function ensureLexicon(onProgress) {
    if (!lexiconPromise) {
        lexiconPromise = (async () => {
            const manifestUrl = new URL('lexicon/v1/lexicon.json', ASSET_BASE);
            const manifestResponse = await fetch(manifestUrl, { cache: 'no-cache' });
            if (!manifestResponse.ok) throw failure('asset_unavailable', 'word lexicon manifest unavailable');
            const manifest = await manifestResponse.json();
            lexiconManifest = manifest;
            const buffer = await loadGzip(new URL(manifest.bin.file, manifestUrl), manifest.bin,
                (received, total) => onProgress?.({ phase: 'lexicon', completed: received, total }));
            const lexicon = Engine.deserializeLexicon(manifest, buffer);
            resolver = new self.RhymeWordQuery.QueryResolver(lexicon, {
                loadModel: loadG2P,
                jamoPhonemes: text => getKoreanPhoneticInputPhonemes(text),
            });
            return lexicon;
        })().catch(error => { lexiconPromise = null; throw error; });
    }
    return lexiconPromise;
}

// Progress sink of the request being handled, for loads started deep inside it (the
// pronunciation model is loaded by the query resolver).
let reportProgress = null;

async function loadG2P(lang) {
    const manifestUrl = new URL(`g2p/v1/${lang}/model.json`, ASSET_BASE);
    const response = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!response.ok) throw failure('asset_unavailable', `pronunciation model unavailable: ${lang}`);
    const manifest = await response.json();
    const buffer = await loadGzip(new URL(manifest.weights.file, manifestUrl), manifest.weights,
        (received, total) => reportProgress?.({ phase: 'model', completed: received, total }));
    return new self.RhymeHeamiG2P.HeamiG2P(manifest, buffer);
}

const isVowel = phoneme => Boolean(ipaFeatures[phoneme]);

// Topic vectors are loaded the first time a topic is used.
function ensureTopicVectors(onProgress) {
    if (!topicVectorsPromise) {
        topicVectorsPromise = (async () => {
            const manifestUrl = new URL('topic/v1/topic.json', ASSET_BASE);
            const response = await fetch(manifestUrl, { cache: 'no-cache' });
            if (!response.ok) throw failure('asset_unavailable', 'topic vectors unavailable');
            const manifest = await response.json();
            if (manifest.lexicon_sha256 !== lexiconManifest.bin.sha256) throw failure('asset_integrity', 'topic vectors were built for another lexicon');
            topicManifest = manifest;
            const buffer = await loadGzip(new URL(manifest.bin.file, manifestUrl), manifest.bin,
                (received, total) => onProgress?.({ phase: 'topic', completed: received, total }));
            return new self.RhymeTopicVectors.TopicVectors(manifest, buffer);
        })().catch(error => { topicVectorsPromise = null; throw error; });
    }
    return topicVectorsPromise;
}

// The topic must be a lexicon word (Korean or English); it is compared with every word
// in the shared meaning space. A topic outside the lexicon is reported and not applied.
function findTopicWord(text) {
    const word = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
    const lang = /[가-힣]/.test(word) ? Engine.LANG.ko : Engine.LANG.en;
    return resolver.lookup(lang, word);
}

// Linked search also needs the rows of its Korean surfaces that the lexicon lacks.
function ensureLinkedTopicRows(vectors, onProgress) {
    if (!linkedTopicPromise) {
        linkedTopicPromise = (async () => {
            const entry = topicManifest.linked;
            if (!entry || entry.bin.sha256 !== linkedManifest.topic_linked_sha256) throw failure('asset_integrity', 'linked topic vectors do not match the linked data');
            const buffer = await loadGzip(new URL('topic/v1/' + entry.bin.file, ASSET_BASE), entry.bin,
                (received, total) => onProgress?.({ phase: 'topic', completed: received, total }));
            vectors.extend(entry.count, buffer);
        })().catch(error => { linkedTopicPromise = null; throw error; });
    }
    return linkedTopicPromise;
}

let topicCache = null;
async function topicContext(request, lexicon, progress, linked = false) {
    const topicWord = String(request.topicWord || '').trim();
    const weight = Number(request.topicWeight);
    if (!topicWord || !(weight > 0)) return { requested: false, similarity: null };
    const w = findTopicWord(topicWord);
    if (w === undefined) return { requested: true, missing: true, similarity: null };
    progress('topic');
    const vectors = await ensureTopicVectors(p => progress(p.phase, p));
    if (linked) await ensureLinkedTopicRows(vectors, p => progress(p.phase, p));
    // Similarities for the current topic are kept for re-ranks with other weights.
    if (topicCache?.word !== w || topicCache.values.length !== vectors.count) topicCache = { word: w, values: vectors.similarities(w) };
    const { values } = topicCache;
    return { requested: true, word: lexicon.words[w], similarity: index => values[index], values, vectors };
}

function engineRequest(request, resolved, topic) {
    const native = resolved.phonemes;
    const detail = Array.isArray(request.detail) && request.detail.length === native.length ? request.detail : new Array(native.length).fill(1);
    return {
        query: resolved.tokens.length ? resolved.tokens.join('') : request.query,
        languages: request.languages, mode: request.mode,
        queryPhonemes: self.RhymeWordQuery.toEngineQuery(resolved), detail,
        useDetailWeights: Boolean(request.useDetailWeights), vowelWeight: Number(request.vowelWeight),
        consonantWeight: Number(request.consonantWeight), vowelsOnly: Boolean(request.vowelsOnly),
        frequencyWeight: Number(request.frequencyWeight), excludeWords: request.excludeWords || [], isVowel,
        topic: topic.similarity ? { weight: Number(request.topicWeight), similarity: topic.similarity } : null,
    };
}

function hydrate(lexicon, results, request, from, count) {
    const items = [];
    const options = { useDetailWeights: request.useDetailWeights, vowelWeight: request.vowelWeight, consonantWeight: request.consonantWeight };
    for (let i = from; i < Math.min(results.length, from + count); i += 1) {
        const w = results.words[i];
        const explained = Engine.explain(lexicon, w, request);
        const match = explained ? calculateScore(explained.target, explained.query.phonemes, explained.query.detail, options) : null;
        const similarity = results.similarities[i];
        items.push({
            word: lexicon.words[w], display: lexicon.words[w], lang: lexicon.lang[w] === Engine.LANG.ko ? 'ko' : 'en',
            score: results.scores[i], rawScore: results.raws[i],
            semanticSimilarity: Number.isNaN(similarity) ? null : similarity, corpusAffinity: 0,
            matchPhonemes: explained ? explained.target : [], matchIndices: match ? match.matchIndices : [],
            matchLayerLabel: explained ? LAYER_LABELS[explained.label] + (request.vowelsOnly ? ' · 모음만' : '') : '',
        });
    }
    return items;
}

// Linked-search data, loaded the first time linked search is used.
function ensureLinked(onProgress) {
    if (!linkedPromise) {
        linkedPromise = (async () => {
            const manifestUrl = new URL('linked/v2/linked.json', ASSET_BASE);
            const response = await fetch(manifestUrl, { cache: 'no-cache' });
            if (!response.ok) throw failure('asset_unavailable', 'linked search data unavailable');
            const manifest = await response.json();
            if (manifest.lexicon_sha256 !== lexiconManifest.bin.sha256) throw failure('asset_integrity', 'linked data was built for another lexicon');
            const buffer = await loadGzip(new URL(manifest.bin.file, manifestUrl), manifest.bin,
                (received, total) => onProgress?.({ phase: 'linked', completed: received, total }));
            linkedManifest = manifest;
            return self.RhymeLinkedEngine.deserializeLinked(manifest, buffer);
        })().catch(error => { linkedPromise = null; throw error; });
    }
    return linkedPromise;
}

function resultSummary(resolved, topic, started, computeStarted, rerankOnly) {
    return {
        resolved: { phonemes: resolved.phonemes, charMap: resolved.charMap, tokens: resolved.tokens, sources: resolved.sources, skipped: resolved.skipped },
        topic: { requested: topic.requested, active: Boolean(topic.similarity), missing: Boolean(topic.missing), word: topic.word || null },
        timings: { compute_ms: performance.now() - computeStarted, total_ms: performance.now() - started }, rerankOnly,
    };
}

function describeLinked(state, from, count) {
    const items = [];
    for (let i = from; i < Math.min(state.ranked.length, from + count); i += 1) {
        items.push(self.RhymeLinkedEngine.describe(state.lexicon, state.linked, state.raw, state.ranked, i));
    }
    return items;
}

// An older search that resumes after a slow download, once a newer one has started (or
// once it was cancelled), stops before computing.
let latestSearch = 0;
function stillWanted(ticket, requestId) {
    if (cancelled.has(requestId)) throw failure('search_cancelled', 'search cancelled');
    if (ticket !== latestSearch) throw failure('search_superseded', 'a newer search replaced this one');
}

async function handleLinked(requestId, request) {
    const ticket = ++latestSearch;
    const started = performance.now();
    const progress = (phase, details = {}) => send('progress', requestId, { progress: { phase, ...details } });
    reportProgress = details => progress(details.phase, details);
    const lexicon = await ensureLexicon(p => progress(p.phase, p));
    progress('resolve');
    const resolved = await resolver.resolve(request.query);
    if (!resolved.phonemes.length) throw failure('no_pronunciation', 'query has no pronunciation');
    const linked = await ensureLinked(p => progress(p.phase, p));
    const topic = await topicContext(request, lexicon, progress, true);
    // A Korean query splits only between its written syllables (one syllable: no split, as V1).
    const syllables = resolved.koreanPronunciationCandidates && resolved.charMap.length
        ? { chars: resolved.charMap.map(item => item.char), starts: resolved.charMap.map(item => item.startIndex) } : null;
    const engine = {
        ...engineRequest(request, resolved, { similarity: null }), vowelsOnly: false, syllables,
        allowFirstParticle: Boolean(request.allowFirstParticle),
        topic: topic.values ? { weight: Number(request.topicWeight), similarity: topic.values, cosine: (a, b) => topic.vectors.cosine(a, b) } : null,
    };
    const key = JSON.stringify([engine.queryPhonemes, engine.languages, engine.mode, engine.detail, engine.useDetailWeights,
        engine.vowelWeight, engine.consonantWeight, engine.excludeWords, engine.allowFirstParticle, syllables]);
    stillWanted(ticket, requestId);
    progress('compute');
    const computeStarted = performance.now();
    const rerankOnly = linkedCache?.key === key;
    const raw = rerankOnly ? linkedCache.raw : self.RhymeLinkedEngine.collect(lexicon, linked, engine);
    if (!raw.splits.length) throw failure('no_splits', 'query cannot be split');
    linkedCache = { key, raw };
    const ranked = self.RhymeLinkedEngine.rank(lexicon, linked, raw, engine);
    const state = { kind: 'linked', lexicon, linked, raw, ranked };
    keep(requestId, state);
    send('result', requestId, { result: {
        searchId: requestId, total: ranked.length, items: describeLinked(state, 0, PAGE_SIZE),
        ...resultSummary(resolved, topic, started, computeStarted, rerankOnly),
    } });
}

async function handleSearch(requestId, request) {
    const ticket = ++latestSearch;
    const started = performance.now();
    const progress = (phase, details = {}) => send('progress', requestId, { progress: { phase, ...details } });
    reportProgress = details => progress(details.phase, details);
    const lexicon = await ensureLexicon(p => progress(p.phase, p));
    progress('resolve');
    const resolved = await resolver.resolve(request.query);
    if (!resolved.phonemes.length) throw failure('no_pronunciation', 'query has no pronunciation');
    const languages = request.languages;
    const topic = await topicContext(request, lexicon, progress);
    const engine = engineRequest(request, resolved, topic);
    // Phonetic scores depend only on these fields; frequency and topic re-rank the cached array.
    const key = JSON.stringify([engine.query, engine.queryPhonemes, languages, engine.mode, engine.detail, engine.useDetailWeights,
        engine.vowelWeight, engine.consonantWeight, engine.vowelsOnly, engine.excludeWords]);
    stillWanted(ticket, requestId);
    progress('compute');
    const computeStarted = performance.now();
    const rerankOnly = rawCache?.key === key;
    const raw = rerankOnly ? rawCache.raw : Engine.scoreRaw(lexicon, engine);
    rawCache = { key, raw };
    const results = Engine.rank(lexicon, raw, engine);
    keep(requestId, { kind: 'word', lexicon, results, engine });
    send('result', requestId, { result: {
        searchId: requestId, total: results.length, items: hydrate(lexicon, results, engine, 0, PAGE_SIZE),
        ...resultSummary(resolved, topic, started, computeStarted, rerankOnly),
    } });
}

self.onmessage = async event => {
    const { type, request_id: requestId, ...payload } = event.data || {};
    if (type === 'cancel') {
        // No reply: the caller was already released.
        if (running.has(payload.target)) cancelled.add(payload.target);
        finished.delete(payload.target);
        return;
    }
    try {
        if (type === 'init') {
            const lexicon = await ensureLexicon(p => send('progress', requestId, { progress: p }));
            send('ready', requestId, { status: { words: lexicon.words.length } });
        } else if (type === 'resolve') {
            reportProgress = progress => send('progress', requestId, { progress });
            await ensureLexicon();
            const resolved = await resolver.resolve(payload.query);
            send('resolved', requestId, { resolved: { phonemes: resolved.phonemes, charMap: resolved.charMap,
                tokens: resolved.tokens, sources: resolved.sources, skipped: resolved.skipped } });
        } else if (type === 'search' || type === 'linked') {
            running.add(requestId);
            try { await (type === 'search' ? handleSearch : handleLinked)(requestId, payload.request); }
            finally { running.delete(requestId); cancelled.delete(requestId); }
        } else if (type === 'page') {
            const state = finished.get(payload.searchId);
            if (!state) throw failure('stale_results', 'these search results are no longer kept');
            send('page', requestId, { items: state.kind === 'linked' ? describeLinked(state, payload.offset, payload.count)
                : hydrate(state.lexicon, state.results, state.engine, payload.offset, payload.count) });
        } else {
            throw failure('unsupported_message', `unsupported message: ${type}`);
        }
    } catch (error) {
        send('error', requestId, { error: { code: error.code || 'word_search_failed', message: String(error.message || error) } });
    }
};
