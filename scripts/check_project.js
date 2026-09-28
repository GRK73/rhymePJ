const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.join(__dirname, '..');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function checkAppSyntax() {
    [
        'public/js/v2/phoneme-similarity-config.js',
        'public/js/phonetics.js',
        'public/js/search/preloader.js',
        'public/js/render.js',
        'public/js/tts.js',
        'public/js/search/word-engine.js',
        'public/js/search/word-query.js',
        'public/js/search/g2p-heami.js',
        'public/js/search/topic-vectors.js',
        'public/js/search/linked-engine.js',
        'public/js/search/word-runtime.js',
        'public/workers/word-worker.js',
        'public/js/app.js',
        'scripts/stage_pages_artifact.js',
    ].forEach(relativePath => {
        const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
        new vm.Script(source, { filename: relativePath });
    });
    // Every script the page loads must exist; the retired engines must not come back.
    const index = fs.readFileSync(path.join(ROOT_DIR, 'public/index.html'), 'utf8');
    for (const [, src] of index.matchAll(/<script src="([^"?]+)/g)) {
        assert(fs.existsSync(path.join(ROOT_DIR, 'public', src)), `index.html loads a missing script: ${src}`);
    }
    ['public/js/v2/search-core.js', 'public/workers/search-worker.js', 'public/workers/linked-worker.js',
        'public/js/semantic.js', 'public/js/linkedRhyme.js', 'public/js/search/linked-data.js'].forEach(relativePath => {
        assert(!fs.existsSync(path.join(ROOT_DIR, relativePath)), `${relativePath} was retired (archive, 2026-09-28)`);
    });
}

function checkWordSearchEngine() {
    const indexSource = fs.readFileSync(path.join(ROOT_DIR, 'public/index.html'), 'utf8');
    const runtimePosition = indexSource.indexOf('js/search/word-runtime.js');
    const appPosition = indexSource.indexOf('js/app.js');
    assert(runtimePosition >= 0 && appPosition > runtimePosition, 'word search runtime must load before app.js');
    assert(!indexSource.includes('js/v2/search-runtime.js'), 'the retired V2 static word search must not be loaded');
    const workerSource = fs.readFileSync(path.join(ROOT_DIR, 'public/workers/word-worker.js'), 'utf8');
    ['word-engine.js', 'word-query.js', 'g2p-heami.js', 'phonetics.js', 'topic-vectors.js', 'linked-engine.js'].forEach(file => {
        assert(workerSource.includes(file), `word worker must load ${file}`);
    });
    // Word search compares ko/en topics in one space; translation belongs to linked search only.
    ['semantic.js', 'topic-translations.js', 'translate.googleapis.com'].forEach(file => {
        assert(!workerSource.includes(file), `word worker must not use ${file}`);
    });

    const context = { TextEncoder, TextDecoder };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(ROOT_DIR, 'public/js/search/word-engine.js'), 'utf8'), context);
    const Engine = context.RhymeWordEngine;
    const vowels = new Set(['a', 'i']);
    const lexicon = Engine.buildLexicon([
        { word: '가', lang: 'ko', zipf: 4, ko: [['k', 'a']] },
        { word: '나', lang: 'ko', zipf: 4, ko: [['n', 'a']] },
        { word: '다', lang: 'ko', zipf: 4, ko: [['t', 'a']] },
        { word: '기', lang: 'ko', zipf: null, ko: [['k', 'i']] },
    ], (a, b) => (vowels.has(a) === vowels.has(b) ? 0.5 : 0), p => vowels.has(p));
    const request = { query: '카', languages: ['ko'], mode: 'hybrid', vowelWeight: 2.5, consonantWeight: 1, frequencyWeight: 0,
        queryPhonemes: { native: ['k', 'a'], korean: [['k', 'a']] }, isVowel: p => vowels.has(p) };
    const results = Engine.search(lexicon, request);
    const words = Array.from(results.words, w => lexicon.words[w]);
    assert(words[0] === '가' && results.scores[0] === 100, 'identical pronunciation must score 100');
    assert(words.slice(1, 3).join(',') === '나,다', 'equal scores must be ordered 가나다');
    assert(Math.abs(Engine.applyFrequencyWeight(80, 5, 10) - 85.33333333333333) < 1e-12, 'frequency weighting must match V1');
    const vowelOnly = Engine.search(lexicon, { ...request, vowelsOnly: true });
    // Consonants removed: 가/나/다 all become [a] (identical), 기 becomes [i].
    assert(Array.from(vowelOnly.scores).join(',') === '100,100,100,50', 'vowel-only search must compare vowels only');

    const appSource = fs.readFileSync(path.join(ROOT_DIR, 'public/js/app.js'), 'utf8');
    const wordSearchStart = appSource.indexOf('async function handleWordSearch()');
    const wordSearchEnd = appSource.indexOf('async function handleLinkedRhymeSearch()', wordSearchStart);
    const wordSearchSource = appSource.slice(wordSearchStart, wordSearchEnd);
    assert(wordSearchSource.includes('wordSearchRuntime.search'), 'word mode must call the V2 word search runtime');
    const linkedStart = appSource.indexOf('async function handleLinkedRhymeSearch()');
    const linkedSource = appSource.slice(linkedStart, appSource.indexOf("searchBtn.addEventListener('click'", linkedStart));
    assert(linkedSource.includes('wordSearchRuntime.linked'), 'linked mode must call the V2 linked engine in the word Worker');
    assert(!linkedSource.includes('linkedSearchRuntime'), 'linked mode must not use the retired linked Worker');
    assert(!wordSearchSource.includes('for (const item of dictionary)'), 'word mode must not scan the dictionary on the main thread');
    ['vowelOnlySearch', 'searchProgressBar', 'cancelSearchBtn', 'pronunciationModeOptions'].forEach(id => {
        assert(indexSource.includes(`id="${id}"`), `word search UI is missing #${id}`);
    });
}

function checkDeploymentAndPrivacyGuards() {
    const deploy = fs.readFileSync(path.join(ROOT_DIR, '.github/workflows/deploy.yml'), 'utf8');
    const deploymentChecker = fs.readFileSync(path.join(ROOT_DIR, 'scripts/check_deployment_artifact.js'), 'utf8');
    assert(deploy.includes('workflow_dispatch:'), 'Pages deployment must require a manual dispatch');
    assert(!/^\s*push:\s*$/m.test(deploy), 'Pages deployment must not run directly on push');
    assert(
        deploy.includes('test ! -e build/pages/data/corpus') && deploy.includes('test ! -e build/pages/data/source')
            && deploy.includes('public/data/deployment-allowlist.json'),
        'Pages deployment must block the restricted corpus and build inputs and require a reviewed allowlist'
    );
    assert(deploy.includes('check:search-assets -- --allowlist public/data/deployment-allowlist.json'),
        'Pages deployment must verify the search assets against the reviewed pins');
    assert(deploy.includes('npm test'), 'Pages deployment must run release tests');
    assert(deploy.includes('npm run stage:pages'), 'Pages deployment must stage the reviewed artifact');
    assert(!fs.existsSync(path.join(ROOT_DIR, 'public/data/model')), 'build inputs belong in data/source, not in public/');
    assert(deploy.includes("path: './build/pages'"), 'Pages deployment must upload the staged artifact');
    assert(deploy.includes('check:deploy-artifact'), 'Pages deployment must validate the artifact allowlist and size budgets');
    assert(deploymentChecker.includes('DEFAULT_TOTAL_LIMIT = 900 * MIB'), 'artifact checker must enforce the 900 MiB total budget');
    assert(deploymentChecker.includes('DEFAULT_FILE_LIMIT = 95 * MIB'), 'artifact checker must enforce the 95 MiB file budget');
    assert(deploymentChecker.includes('allowed_files'), 'artifact checker must enforce an explicit file allowlist');
    assert(deploymentChecker.includes('SERVER_ONLY_API_PATTERN'), 'artifact checker must reject server-only generation calls');
    assert(deploymentChecker.includes('EXTERNAL_EXECUTABLE_HTML_PATTERN'), 'artifact checker must reject external executable dependencies');

    const ignore = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf8');
    assert(ignore.includes('public/data/corpus/'), 'restricted public corpus path must be ignored');

    const index = fs.readFileSync(path.join(ROOT_DIR, 'public/index.html'), 'utf8');
    assert(!/<script[^>]+src="https?:/.test(index), 'the page must not load external scripts');
    const app = fs.readFileSync(path.join(ROOT_DIR, 'public/js/app.js'), 'utf8');
    const wordWorker = fs.readFileSync(path.join(ROOT_DIR, 'public/workers/word-worker.js'), 'utf8');
    // Result meanings (V1 behaviour, restored 2026-09-28 by the owner) are the page's only
    // outside requests: a result word is looked up when it scrolls into view.
    assert(app.includes('function lookupMeaning('), 'result meanings are looked up by lookupMeaning');
    // Topics are compared in one ko/en meaning space; no search or topic word is translated.
    assert(!wordWorker.includes('translate.googleapis.com'), 'topic words must not be sent to Google Translate');
    assert(!index.includes('Google 번역으로 전송'), 'the UI must not describe a topic translation that no longer happens');
    assert(app.includes('renderExternalDictionaryLink(meaningEl'), 'a result without a meaning falls back to a dictionary link');
    assert(index.includes('결과 단어의 뜻:'), 'the footer must say where result meanings come from');
    assert(!app.includes('api/v2/generate'), 'search product must not call the retired generation API');
    assert(!index.includes('data-search-mode="generate"'), 'search product must not expose generation');
}

function checkDeploymentArtifactChecker() {
    const { checkArtifact } = require('./check_deployment_artifact');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rhyme-pages-gate-'));
    const artifactRoot = path.join(tempRoot, 'public');
    const allowlistPath = path.join(tempRoot, 'allowlist.json');
    try {
        fs.mkdirSync(path.join(artifactRoot, 'js'), { recursive: true });
        fs.writeFileSync(path.join(artifactRoot, 'index.html'), '<!doctype html>', 'utf8');
        fs.writeFileSync(path.join(artifactRoot, 'js', 'app.js'), 'void 0;', 'utf8');
        fs.writeFileSync(allowlistPath, JSON.stringify({
            schema_version: 2,
            reviewed: true,
            allowed_files: ['index.html', 'js/app.js'],
        }), 'utf8');

        const accepted = checkArtifact(artifactRoot, allowlistPath, { totalLimit: 100, fileLimit: 100 });
        assert(accepted.fileCount === 2, 'artifact checker must accept a fully reviewed fixture');

        let rejectedFileSize = false;
        try {
            checkArtifact(artifactRoot, allowlistPath, { totalLimit: 100, fileLimit: 5 });
        } catch (error) {
            rejectedFileSize = /File exceeds/.test(error.message);
        }
        assert(rejectedFileSize, 'artifact checker must reject files over the per-file budget');

        let rejectedTotalSize = false;
        try {
            checkArtifact(artifactRoot, allowlistPath, { totalLimit: 10, fileLimit: 100 });
        } catch (error) {
            rejectedTotalSize = /Artifact exceeds/.test(error.message);
        }
        assert(rejectedTotalSize, 'artifact checker must reject artifacts over the total budget');

        fs.writeFileSync(path.join(artifactRoot, 'unreviewed.txt'), 'x', 'utf8');
        let rejectedUnreviewed = false;
        try {
            checkArtifact(artifactRoot, allowlistPath, { totalLimit: 100, fileLimit: 100 });
        } catch (error) {
            rejectedUnreviewed = /absent from the reviewed/.test(error.message);
        }
        assert(rejectedUnreviewed, 'artifact checker must reject files missing from the allowlist');
        fs.unlinkSync(path.join(artifactRoot, 'unreviewed.txt'));

        fs.writeFileSync(path.join(artifactRoot, 'js', 'app.js'), "fetch(new URL('api/v2/generate', document.baseURI));", 'utf8');
        let rejectedServerApi = false;
        try {
            checkArtifact(artifactRoot, allowlistPath, { totalLimit: 1000, fileLimit: 1000 });
        } catch (error) {
            rejectedServerApi = /Server-only generation API/.test(error.message);
        }
        assert(rejectedServerApi, 'artifact checker must reject server-only generation calls');
        fs.writeFileSync(path.join(artifactRoot, 'js', 'app.js'), 'void 0;', 'utf8');

        fs.writeFileSync(path.join(artifactRoot, 'index.html'), '<script src="https://example.com/runtime.js"></script>', 'utf8');
        let rejectedExternalRuntime = false;
        try {
            checkArtifact(artifactRoot, allowlistPath, { totalLimit: 1000, fileLimit: 1000 });
        } catch (error) {
            rejectedExternalRuntime = /External executable dependency/.test(error.message);
        }
        assert(rejectedExternalRuntime, 'artifact checker must reject external executable dependencies');
        fs.writeFileSync(path.join(artifactRoot, 'index.html'), '<!doctype html>', 'utf8');

        fs.mkdirSync(path.join(artifactRoot, 'data', 'corpus'), { recursive: true });
        fs.writeFileSync(path.join(artifactRoot, 'data', 'corpus', 'lyrics.jsonl'), '{}', 'utf8');
        fs.writeFileSync(allowlistPath, JSON.stringify({
            schema_version: 2,
            reviewed: true,
            allowed_files: ['index.html', 'js/app.js', 'data/corpus/lyrics.jsonl'],
        }), 'utf8');
        let rejectedCorpus = false;
        try {
            checkArtifact(artifactRoot, allowlistPath, { totalLimit: 100, fileLimit: 100 });
        } catch (error) {
            rejectedCorpus = /Forbidden source/.test(error.message);
        }
        assert(rejectedCorpus, 'artifact checker must reject restricted corpus even if allowlisted');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function checkPhonemeSimilaritySingleSource() {
    const { generate, renderGolden, OUTPUT_PATH, GOLDEN_PATH } = require('./build_phoneme_similarity_config');
    assert(generate() === fs.readFileSync(OUTPUT_PATH, 'utf8'),
        'public/js/v2/phoneme-similarity-config.js is stale; run npm run build:similarity-config');
    assert(renderGolden() === fs.readFileSync(GOLDEN_PATH, 'utf8'),
        'tests/fixtures/phoneme_similarity_golden_v0.json is stale; run npm run build:similarity-config');
    const phonetics = fs.readFileSync(path.join(ROOT_DIR, 'public/js/phonetics.js'), 'utf8');
    assert(!/height \* 0\.42|place \* 0\.4/.test(phonetics),
        'public/js/phonetics.js must not inline the similarity constants; use PHONEME_SIMILARITY');

    const sourceConfig = readJson('configs/phoneme_similarity_v0.json');
    const context = { console };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(OUTPUT_PATH, 'utf8'), context);
    assert(context.PHONEME_SIMILARITY.CONFIG.config_version === sourceConfig.config_version,
        'browser similarity config version must match the JSON source');
    const golden = readJson('tests/fixtures/phoneme_similarity_golden_v0.json');
    assert(golden.config_version === sourceConfig.config_version, 'golden fixture version must match the JSON source');
    for (const [kind, cases] of [['vowelSimilarity', golden.vowel_cases], ['consonantSimilarity', golden.consonant_cases]]) {
        cases.forEach(({ inputs, expected }) => {
            const actual = context.PHONEME_SIMILARITY[kind](...inputs);
            assert(Math.abs(actual - expected) < 1e-9, `${kind} golden mismatch for ${JSON.stringify(inputs)}: ${actual} vs ${expected}`);
        });
    }
}

function checkDictionary() {
    const dictionary = readJson('data/source/rhyme_dict_practical.json');
    assert(Array.isArray(dictionary), 'rhyme_dict_practical.json must be an array');
    assert(dictionary.length > 200000, 'practical dictionary looks unexpectedly small');
    assert(dictionary.some(item => item.word === 'rhyme' && item.lang === 'en'), 'missing English sample word: rhyme');
    assert(dictionary.some(item => item.lang === 'ko'), 'missing Korean dictionary entries');

    const 같이 = dictionary.find(item => item.word === '같이' && item.lang === 'ko');
    if (같이) {
        assert(Array.isArray(같이.phonemes) && 같이.phonemes.join('|') === 'k|a|tɕʰ|i', '같이 must store standard pronunciation phonemes');
        assert(같이.reading === '가치', '같이 must store standard reading 가치');
    }
}

function checkPhoneticSimilarityEngine() {
    const context = { console };
    context.globalThis = context;
    vm.createContext(context);
    ['public/js/v2/phoneme-similarity-config.js', 'public/js/phonetics.js'].forEach(relativePath => {
        vm.runInContext(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'), context, { filename: relativePath });
    });
    const score = (a, b) => vm.runInContext(`get_score_1d(${JSON.stringify(a)}, ${JSON.stringify(b)})`, context);
    const exactStop = score('p', 'p'), voicedStop = score('p', 'b'), adjacentStop = score('p', 't');
    const distantStop = score('p', 'k'), nasalMismatch = score('p', 'm');
    assert(exactStop === 1, 'identical phonemes must keep exact similarity');
    assert(voicedStop > adjacentStop, 'same-place stop voicing must outrank place-shifted stops');
    assert(adjacentStop > distantStop, 'nearby stop places must outrank distant stop places');
    assert(distantStop > 0, 'consonant place differences should retain a conservative soft score');
    assert(nasalMismatch < adjacentStop, 'manner mismatches must stay below same-manner stops');

    const exact = vm.runInContext('calculateScore(["k", "a", "t"], ["k", "a", "t"])', context);
    const near = vm.runInContext('calculateScore(["k", "a", "t"], ["p", "a", "t"]).score', context);
    assert(exact.score === 100 && exact.matchIndices.join() === '0,1,2', 'exact phoneme sequences must remain 100 with every index matched');
    assert(near > 40 && near < 100, 'a one-consonant difference must score between the threshold and 100');
    const jamo = vm.runInContext('JSON.stringify(getKoreanPhoneticInputPhonemes("ㅋㅏ").phonemes)', context);
    assert(jamo === '["kʰ","a"]', 'jamo input must be read letter by letter');
}

function checkLoanwordOverrides() {
    const overrides = readJson('data/source/loanword_overrides.json');
    assert(overrides && typeof overrides === 'object' && !Array.isArray(overrides), 'loanword overrides must be an object');
    assert(Object.keys(overrides).length > 1000, 'loanword overrides look unexpectedly small');
    assert(Array.isArray(overrides.mobile) && overrides.mobile.includes('모바일'), 'missing mobile -> 모바일 override');
    assert(Array.isArray(overrides.touchdown) && overrides.touchdown.includes('터치다운'), 'missing touchdown -> 터치다운 override');
}

function checkBigramIndexFile(relativePath) {
    const indexPath = path.join(ROOT_DIR, relativePath);
    if (!fs.existsSync(indexPath)) return;

    const bigram = readJson(relativePath);
    assert(bigram && typeof bigram === 'object' && !Array.isArray(bigram), `${relativePath} must be an object`);
    assert(bigram.entries && typeof bigram.entries === 'object' && !Array.isArray(bigram.entries), `${relativePath} must contain entries`);
    assert(Object.keys(bigram.entries).length > 0, `${relativePath} must contain at least one head word`);

    const [head, followers] = Object.entries(bigram.entries)[0];
    assert(typeof head === 'string' && head.length > 0, `${relativePath} head words must be non-empty strings`);
    assert(Array.isArray(followers) && followers.length > 0, `${relativePath} followers must be non-empty arrays`);
    assert(Array.isArray(followers[0]) && followers[0].length >= 3, `${relativePath} follower rows must be [word, count, score]`);
    assert(typeof followers[0][0] === 'string' && followers[0][0].length > 0, `${relativePath} follower word must be a string`);
    assert(Number.isFinite(followers[0][1]) && followers[0][1] > 0, `${relativePath} follower count must be positive`);
    assert(Number.isFinite(followers[0][2]), `${relativePath} follower score must be finite`);
}

function checkBigramIndexes() {
    [
        'data/source/bigram_next_en.json',
    ].forEach(checkBigramIndexFile);
}

function checkSurfaceBigramIndex() {
    const relativePath = 'data/source/bigram_surface_ko.json';
    const indexPath = path.join(ROOT_DIR, relativePath);
    if (!fs.existsSync(indexPath)) return;

    const bigram = readJson(relativePath);
    assert(bigram && typeof bigram === 'object' && !Array.isArray(bigram), `${relativePath} must be an object`);
    assert(bigram.entries && typeof bigram.entries === 'object' && !Array.isArray(bigram.entries), `${relativePath} must contain entries`);
    assert(Object.keys(bigram.entries).length > 0, `${relativePath} must contain at least one surface head`);

    const [head, payload] = Object.entries(bigram.entries)[0];
    assert(typeof head === 'string' && head.length > 0, `${relativePath} surface heads must be non-empty strings`);
    assert(Array.isArray(payload) && payload.length >= 2, `${relativePath} head payloads must be [normalizedHead, followers]`);
    assert(typeof payload[0] === 'string', `${relativePath} normalized head must be a string`);
    assert(Array.isArray(payload[1]) && payload[1].length > 0, `${relativePath} followers must be non-empty arrays`);

    const row = payload[1][0];
    assert(Array.isArray(row) && row.length >= 3, `${relativePath} follower rows must be [surfaceNext, count, score, normalizedNext?]`);
    assert(typeof row[0] === 'string' && row[0].length > 0, `${relativePath} follower surface must be a string`);
    assert(Number.isFinite(row[1]) && row[1] > 0, `${relativePath} follower count must be positive`);
    assert(Number.isFinite(row[2]), `${relativePath} follower score must be finite`);
    if (row.length > 3) {
        assert(typeof row[3] === 'string', `${relativePath} optional normalized follower must be a string`);
    }
}

function main() {
    checkAppSyntax();
    checkWordSearchEngine();
    checkDeploymentAndPrivacyGuards();
    checkDeploymentArtifactChecker();
    checkPhonemeSimilaritySingleSource();
    checkDictionary();
    checkPhoneticSimilarityEngine();
    checkLoanwordOverrides();
    checkBigramIndexes();
    checkSurfaceBigramIndex();
    console.log('Project check passed.');
}

main();
