// Parity check (V2검색엔진설계.md §8-1/§8-2).
// Reference: V1 word search (commit 5df2ae8, its own code and data) with the
// corrections removed by §9 — no rime/syllable/stress blends, no cross-layer
// penalties, no corpus boost — and ties ordered by word.
// Candidate: the V2 engine fed with the same V1 pronunciation candidates.
// Both must produce the same words in the same order with scores within 0.001.
//
// Topic cases (--topic) compare V1 semantic.js + applySemanticWeight with the engine's topic
// step fed V1's similarity, on V1's vectors: this checks the engine's topic formula and order
// of operations. (The V2 Worker now uses LaBSE vectors, V2 design §9-9.) V1 translated Korean
// topics with Google each time; each case pins that translation.
//
// The reference is V1 itself: every word scored in plain JS, 16-130 s per case (V2: <1 s).
// V1 is frozen, so each case's reference result is cached (build/parity-cache/) as a digest
// of its exact words and scores; a later run recomputes only the engine and compares
// digests, and recomputes the reference only on a miss or a mismatch. The cache key covers
// the V1 commit, the reference code below and the case, so it cannot go stale. Cases run
// in parallel worker threads (--jobs, default half the CPU threads, at most 6), and each
// finished case is saved at once, so an interrupted run resumes where it stopped.
//
// Usage: node scripts/search/check_word_engine_v1.mjs [--extra] [--topic] [--match ID-SUBSTRING] [--limit N]
//        [--jobs N] [--fresh] [--out report.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '../..');
const V1 = '5df2ae8';
const require = createRequire(import.meta.url);
const args = isMainThread ? process.argv.slice(2) : workerData.args;
const flag = name => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const gitShow = file => execFileSync('git', ['show', `${V1}:${file}`], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

// ---- V1 runtime (reference) ------------------------------------------------------
let dictionary, v1;
function setupReference() {
    dictionary = JSON.parse(gitShow('public/data/model/rhyme_dict_practical.json'));
    v1 = { console, Math, JSON, Number, String, Array, Object, Set, Map, isFinite, parseFloat,
        Hangul: require('hangul-js'),
        vowelWeightInput: { value: '2.5' }, consoWeightInput: { value: '1.0' }, detailChecked: false };
    v1.document = { getElementById: id => (id === 'useDetailWeights' ? { checked: v1.detailChecked } : null) };
    v1.window = v1; v1.globalThis = v1;
    vm.createContext(v1);
    for (const file of ['public/js/phonetics.js', 'public/js/koreanPronunciation.js']) vm.runInContext(gitShow(file), v1, { filename: file });
    vm.runInContext(`loanwordOverrides = ${gitShow('public/data/model/loanword_overrides.json')}; var dictionary = [];`, v1);
    v1.compoundPronunciationsKo = JSON.parse(gitShow('public/data/model/compound_pronunciations_ko.json'));
    v1.dictionary = dictionary;

    // §9 removals: blends become identity, cross-layer penalties become 1.
    v1.blendCandidateScore = baseScore => baseScore;
    const originalScoreCandidate = v1.scoreCandidate;
    v1.scoreCandidate = (t, q, d, layer, label, penalty, meta) => originalScoreCandidate(t, q, d, layer, label, 1, meta);
    // V1 picks among near-equal pronunciation candidates (within 0.001) by rime/stress/syllable
    // scores, which §9 removes; without them the best candidate is simply the highest score.
    v1.getBestPronunciationCandidate = candidates => candidates.reduce((best, current) => (
        !best || current.score > best.score ? current : best), null);
    // Candidate generation is pure per word; memoize it so reference runs stay tractable.
    for (const name of ['getKoreanStandardPronunciationCandidates', 'getKoreanContextualPronunciationCandidates',
        'getKoreanizedEnglishCandidates', 'getKoreanCompoundPronunciationCandidates']) {
        const original = v1[name];
        const memo = new Map();
        v1[name] = word => { if (!memo.has(word)) memo.set(word, original(word)); return memo.get(word); };
    }
}

// V1 topic code and vectors (only when topic cases run).
let topicLoaded = false;
function v1TopicContext(testCase) {
    const c = testCase.controls;
    if (!c.topic_word || !(c.topic_weight > 0)) return null;
    if (!topicLoaded) {
        const read = lang => JSON.parse(gitShow(`public/data/model/semantic_vectors_${lang}.json`)).words;
        vm.runInContext(gitShow('public/js/semantic.js'), v1, { filename: 'v1/semantic.js' });
        v1.semanticVectorStores = { ko: read('ko'), en: read('en') };
        topicLoaded = true;
    }
    v1.topicTranslations = {};
    if (c.topic_translations?.length) v1.topicTranslations[v1.normalizeSemanticKey(c.topic_word)] = c.topic_translations;
    const context = v1.buildSemanticContext(c.topic_word, c.topic_weight);
    return context.active ? context : null;
}

// V1 app.js isExcludedWord (app.js is DOM-bound, so it is not loaded).
function isExcludedWord(word, excludeWords) {
    if (excludeWords.length === 0) return false;
    const lowerWord = String(word || '').toLowerCase();
    return excludeWords.some(exWord => lowerWord.includes(exWord));
}

function referenceSearch(testCase) {
    const c = testCase.controls;
    v1.vowelWeightInput.value = String(c.vowel_weight);
    v1.consoWeightInput.value = String(c.consonant_weight);
    v1.detailChecked = Boolean(c.use_detail_weights);
    const query = testCase.query.trim();
    const q = v1.getQueryPhonemes(query);
    const detail = c.detail || new Array(q.phonemes.length).fill(1.0);
    const excludeWords = (c.exclude_words || []).map(w => w.trim().toLowerCase()).filter(Boolean);
    const allowed = new Set(testCase.target_languages);
    const semanticContext = v1TopicContext(testCase);
    const best = new Map();
    for (const item of dictionary) {
        if (!allowed.has(item.lang)) continue;
        if (item.word.toLowerCase() === query.toLowerCase()) continue;
        if (isExcludedWord(item.word, excludeWords)) continue;
        const result = v1.calculatePronunciationScore(item, q, detail, c.pronunciation_mode);
        if (!result || typeof result.score !== 'number' || !Number.isFinite(result.score)) continue;
        if (!(result.score > 40)) continue;
        const zipf = item.zipf !== undefined ? item.zipf : 1.0;
        let score = v1.applyFrequencyWeight(result.score, zipf, c.frequency_weight);
        if (semanticContext) {
            const semanticResult = v1.applySemanticWeight(score, item, semanticContext);
            if (!semanticResult.matched) continue;
            score = semanticResult.score;
        }
        const key = `${item.lang}:${item.word}`;
        const current = best.get(key);
        // Duplicate dictionary entries: keep the higher score (V1 kept the first within 0.001).
        if (!current || score > current.score) best.set(key, { lang: item.lang, word: item.word, score });
    }
    // Tie rule (V2 design): equal after rounding to 0.001, then 가나다/abc (stable).
    return [...best.values()].sort((a, b) => (Math.round(b.score * 1000) - Math.round(a.score * 1000)) || a.word.localeCompare(b.word));
}

// ---- V2 engine fed with V1 candidates ---------------------------------------------
let Engine, lexicon, kernel;
function setupEngine() {
    const engineContext = { TextEncoder, TextDecoder };
    engineContext.globalThis = engineContext;
    vm.createContext(engineContext);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js/search/word-engine.js'), 'utf8'), engineContext);
    Engine = engineContext.RhymeWordEngine;
    lexicon = Engine.buildLexicon(lexiconEntries(), (a, b) => v1.get_score_1d(a, b), p => Boolean(v1.ipaFeatures[p]),
        [...Object.keys(v1.ipaFeatures), ...Object.keys(v1.ipaConsoFeatures)]);
    kernel = Engine.createKernel(lexicon);
}

function lexiconEntries() {
    const byKey = new Map();
    const entries = [];
    for (const item of dictionary) {
        const key = `${item.lang}\t${item.word}`;
        let entry = byKey.get(key);
        if (!entry) {
            entry = { word: item.word, lang: item.lang, zipf: item.zipf, ko: [], native: [], koreanized: [] };
            byKey.set(key, entry);
            entries.push(entry);
        }
        const nativePhonemes = item.phonemes || item.vowels || [];
        if (item.lang === 'ko') {
            const stored = v1.getStoredKoreanPronunciationCandidates(item);
            const generated = stored.length ? stored : v1.getKoreanStandardPronunciationCandidates(item.word);
            const targets = v1.dedupeKoreanPronunciationCandidates([...generated, ...v1.getKoreanContextualPronunciationCandidates(item.word)]);
            entry.ko.push(...targets.map(t => t.phonemes));
            entry.native.push(nativePhonemes);
        } else {
            entry.native.push(nativePhonemes);
            if (!entry.koreanized.length) entry.koreanized.push(...v1.getKoreanizedEnglishCandidates(item.word).map(t => t.phonemes));
        }
    }
    return entries;
}

// V1's similarity per word, cached like the Worker caches it.
function v1Similarity(context) {
    const state = new Uint8Array(lexicon.words.length), values = new Float64Array(lexicon.words.length);
    return w => {
        if (state[w] === 0) {
            const value = v1.getBestSemanticSimilarity({ word: lexicon.words[w], display: lexicon.words[w],
                lang: lexicon.lang[w] === Engine.LANG.ko ? 'ko' : 'en' }, context);
            state[w] = value === null ? 2 : 1;
            values[w] = value ?? 0;
        }
        return state[w] === 2 ? null : values[w];
    };
}

function engineSearch(testCase) {
    const c = testCase.controls;
    const context = v1TopicContext(testCase);
    const query = testCase.query.trim();
    const q = v1.getQueryPhonemes(query);
    const results = Engine.search(lexicon, {
        query, languages: testCase.target_languages, mode: c.pronunciation_mode,
        queryPhonemes: {
            native: q.phonemes,
            korean: q.koreanPronunciationCandidates?.map(candidate => candidate.phonemes),
            koreanized: q.koreanizedCandidates?.map(candidate => candidate.phonemes),
            koreanizedFallback: q.koreanizedPhonemes,
        },
        detail: c.detail || new Array(q.phonemes.length).fill(1.0),
        useDetailWeights: Boolean(c.use_detail_weights), vowelWeight: c.vowel_weight, consonantWeight: c.consonant_weight,
        frequencyWeight: c.frequency_weight, excludeWords: (c.exclude_words || []).map(w => w.trim().toLowerCase()).filter(Boolean),
        topic: context ? { weight: c.topic_weight, similarity: v1Similarity(context) } : null, isVowel: p => Boolean(v1.ipaFeatures[p]),
        // V1 moves detail weights between query layers by position ratio.
        detailTransfer: Engine.proportionalTransfer,
    }, kernel);
    return Array.from(results.words, (w, i) => ({ lang: lexicon.lang[w] === 0 ? 'ko' : 'en', word: lexicon.words[w], score: results.scores[i] }));
}

// ---- One case (in a worker thread) ------------------------------------------------------
// Exact words, order and scores (shortest round-trip form of each double).
const digest = rows => sha256(rows.map(r => `${r.lang}:${r.word}:${r.score}`).join('\n'));
const orderHash = rows => sha256(rows.map(r => `${r.lang}:${r.word}`).join('\n')).slice(0, 16);

function runCase(testCase, cacheKeyOf, cached, fresh) {
    if (testCase.controls.detail === 'first-heavy') {
        const length = v1.getQueryPhonemes(testCase.query.trim()).phonemes.length;
        testCase.controls = { ...testCase.controls, detail: Array.from({ length }, (_, i) => (i === 0 ? 5 : 1)) };
    }
    const key = cacheKeyOf(testCase);
    const entry = fresh ? null : cached[key];
    const t0 = Date.now(); const actual = engineSearch(testCase);
    const engineMs = Date.now() - t0;
    const actualDigest = digest(actual);
    const base = { id: testCase.id, query: testCase.query, engine_count: actual.length, engine_hash: orderHash(actual), engine_ms: engineMs };
    // Identical to the cached V1 result: exact equality, stricter than the 0.001 tolerance.
    if (entry && entry.digest === actualDigest) {
        return { key, report: { ...base, ok: true, count: entry.count, reference_hash: entry.order, first_diff: -1, max_score_diff: 0,
            reference_ms: 0, reference: 'cached', diff: null } };
    }
    const t1 = Date.now(); const expected = referenceSearch(testCase);
    const referenceMs = Date.now() - t1;
    let firstDiff = -1, maxScoreDiff = 0;
    const length = Math.max(expected.length, actual.length);
    for (let i = 0; i < length; i += 1) {
        const e = expected[i], a = actual[i];
        if (!e || !a || e.word !== a.word || e.lang !== a.lang) { firstDiff = i; break; }
        maxScoreDiff = Math.max(maxScoreDiff, Math.abs(e.score - a.score));
    }
    return {
        key, entry: { digest: digest(expected), count: expected.length, order: orderHash(expected), id: testCase.id },
        report: { ...base, ok: firstDiff < 0 && maxScoreDiff <= 0.001, count: expected.length, reference_hash: orderHash(expected),
            first_diff: firstDiff, max_score_diff: maxScoreDiff, reference_ms: referenceMs, reference: 'computed',
            diff: firstDiff < 0 ? null : { expected: expected.slice(firstDiff, firstDiff + 3), actual: actual.slice(firstDiff, firstDiff + 3) } },
    };
}

// The cache key: V1 commit, this file's reference section (any change to it invalidates the
// cache) and the case with its detail weights resolved.
function makeCacheKey() {
    const source = fs.readFileSync(SELF, 'utf8');
    const section = source.slice(source.indexOf('// ---- V1 runtime (reference)'), source.indexOf('// ---- V2 engine fed'));
    const referenceHash = sha256(section);
    return testCase => sha256(JSON.stringify([V1, referenceHash, testCase.query, testCase.target_languages, testCase.controls]));
}

if (!isMainThread) {
    const started = Date.now();
    setupReference();
    setupEngine();
    parentPort.postMessage({ type: 'ready', ms: Date.now() - started, words: lexicon.words.length, sequences: lexicon.seqJoin.length, phonemes: lexicon.phonemes.length });
    const cacheKeyOf = makeCacheKey();
    parentPort.on('message', ({ testCase, index }) => {
        try { parentPort.postMessage({ type: 'done', index, ...runCase(testCase, cacheKeyOf, workerData.cached, workerData.fresh) }); }
        catch (error) { parentPort.postMessage({ type: 'failed', index, message: error.stack || String(error) }); }
    });
}

// ---- Cases ---------------------------------------------------------------------------
function buildCases() {
    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/search_product_v1.json'), 'utf8'));
    let cases = fixture.cases.filter(testCase => testCase.mode === 'word' && testCase.query.trim());
    if (flag('--extra')) {
        const base = cases.slice(0, 1)[0].controls;
        const variants = [
            ['native', { pronunciation_mode: 'native' }], ['koreanized', { pronunciation_mode: 'koreanized' }],
            ['f0', { frequency_weight: 0 }], ['f10', { frequency_weight: 10 }], ['vowel0', { vowel_weight: 0 }],
            ['cons5', { consonant_weight: 5 }], ['detail', { use_detail_weights: true, detail: 'first-heavy' }],
            ['exclude', { exclude_words: ['사', 'ti', 'a'] }],
        ];
        const seeds = ['사랑', '학교', '맛있다', 'time', 'love', 'money'];
        const extra = [];
        for (const query of seeds) for (const [name, patch] of variants) {
            extra.push({ id: `extra-${query}-${name}`, query, target_languages: ['ko', 'en'], controls: { ...base, ...patch } });
        }
        cases = cases.concat(extra);
    }
    if (flag('--topic')) {
        const base = cases[0].controls;
        // [query, topic, weight, languages, pinned translation of a Korean topic]
        const topicCases = [
            ['사랑', '이별', 5, ['ko', 'en'], ['breakup', 'separation']], ['time', '사랑', 5, ['ko', 'en'], ['love']],
            ['money', '돈', 10, ['ko', 'en'], ['money']], ['love', 'night', 3],
            ['학교', 'school', 5], ['맛있다', '바다', 10, ['ko', 'en'], ['ocean']], ['사랑', '성공', 1, ['ko', 'en'], ['success']],
            ['사랑', 'love', 5, ['ko']], ['time', '사랑', 5, ['en'], ['love']], ['money', '돈', 10, ['ko'], ['money']],
            ['love', '고양이', 5, ['ko', 'en'], ['cat']], ['학교', '뷁뷁', 5],
        ];
        cases = cases.concat(topicCases.map(([query, topic, weight, languages = ['ko', 'en'], translations]) => ({
            id: `topic-${query}-${topic}-${weight}-${languages.join('')}`, query, target_languages: languages,
            controls: { ...base, topic_word: topic, topic_weight: weight, ...(translations ? { topic_translations: translations } : {}) },
        })));
    }
    const match = option('--match', '');
    if (match) cases = cases.filter(testCase => match.split(',').some(part => testCase.id.includes(part)));
    const limit = Number(option('--limit', 0));
    if (limit) cases = cases.slice(0, limit);
    return cases;
}

if (isMainThread) {
    const cases = buildCases();
    const cacheFile = path.join(ROOT, 'build/parity-cache/v1-reference.json');
    const cached = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
    const saveCache = () => {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile + '.tmp', JSON.stringify(cached));
        fs.renameSync(cacheFile + '.tmp', cacheFile);
    };
    const jobs = Math.max(1, Math.min(cases.length, Number(option('--jobs', 0)) || Math.min(6, Math.floor(os.availableParallelism() / 2))));
    const fresh = flag('--fresh');
    const started = Date.now();
    console.log(`${cases.length} cases, ${jobs} worker threads, ${Object.keys(cached).length} cached V1 results${fresh ? ' (ignored: --fresh)' : ''}`);
    // English cases are the slowest references: start them first so no thread is left with a long tail.
    const queue = cases.map((testCase, index) => ({ testCase, index }))
        .sort((a, b) => Number(/^[가-힣]/.test(a.testCase.query)) - Number(/^[가-힣]/.test(b.testCase.query)));
    const reports = new Array(cases.length);
    let passed = 0, finished = 0, failedToRun = 0;
    await Promise.all(Array.from({ length: jobs }, (_, thread) => new Promise((resolve, reject) => {
        const worker = new Worker(SELF, { workerData: { args, cached, fresh } });
        const next = () => { const job = queue.shift(); if (job) worker.postMessage(job); else worker.terminate().then(resolve); };
        worker.on('message', message => {
            if (message.type === 'ready') {
                if (thread === 0) console.log(`lexicon: ${message.words.toLocaleString()} words, ${message.sequences.toLocaleString()} sequences, ${message.phonemes} phonemes (${message.ms} ms)`);
            } else if (message.type === 'failed') {
                failedToRun += 1; finished += 1;
                console.log(`ERROR ${cases[message.index].id}: ${message.message}`);
            } else {
                const { report, entry, key } = message;
                reports[message.index] = report;
                if (entry) { cached[key] = entry; saveCache(); }
                if (report.ok) passed += 1;
                finished += 1;
                console.log(`${report.ok ? 'PASS' : 'FAIL'} [${finished}/${cases.length}] ${report.id} ${JSON.stringify(report.query)} results=${report.count} `
                    + `ref=${report.reference === 'cached' ? 'cached' : report.reference_ms + 'ms'} engine=${report.engine_ms}ms`
                    + `${report.ok ? '' : ` first_diff=${report.first_diff} maxΔ=${report.max_score_diff.toExponential(2)}`}`);
            }
            next(); // ready, done or failed: the thread takes the next case
        });
        worker.on('error', reject);
    })));
    const out = option('--out', path.join(ROOT, 'reports/generated/word-engine-v1-parity.json'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ passed, total: cases.length, cases: reports.filter(Boolean) }, null, 2));
    console.log(`\n${passed}/${cases.length} identical (${((Date.now() - started) / 60000).toFixed(1)} min)`);
    if (passed !== cases.length || failedToRun) process.exitCode = 1;
}
