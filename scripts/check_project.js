const fs = require('fs');
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
        'public/js/data.js',
        'public/js/phonetics.js',
        'public/js/koreanPronunciation.js',
        'public/js/semantic.js',
        'public/js/linkedRhyme.js',
        'public/js/render.js',
        'public/js/tts.js',
        'public/js/app.js',
    ].forEach(relativePath => {
        const fullPath = path.join(ROOT_DIR, relativePath);
        if (!fs.existsSync(fullPath)) return;

        const source = fs.readFileSync(fullPath, 'utf8');
        new vm.Script(source, { filename: relativePath });
    });
}

function checkKoreanPronunciationRules() {
    const context = { console, dictionary: [] };
    context.window = context;
    vm.createContext(context);

    ['public/js/phonetics.js', 'public/js/koreanPronunciation.js'].forEach(relativePath => {
        const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
        vm.runInContext(source, context, { filename: relativePath });
    });

    const samples = {
        같이: '가치',
        굳이: '구지',
        국물: '궁물',
        먹는: '멍는',
        신라: '실라',
        좋아: '조아',
        놓고: '노코',
        못해: '모태',
        꽃이: '꼬치',
        값이: '갑씨',
    };

    Object.entries(samples).forEach(([word, expected]) => {
        const actual = vm.runInContext(`getStandardKoreanReading(${JSON.stringify(word)})`, context);
        assert(actual === expected, `${word} standard pronunciation must be ${expected}, got ${actual}`);
    });

    const readGoCandidates = JSON.parse(vm.runInContext(
        `JSON.stringify(getKoreanStandardPronunciationCandidates(${JSON.stringify('읽고')}).map(candidate => candidate.reading))`,
        context
    ));
    assert(readGoCandidates.includes('익꼬') && readGoCandidates.includes('일꼬'), '읽고 must keep both ㄺ pronunciation candidates');
}

function checkDictionary() {
    const dictionary = readJson('public/data/rhyme_dict_practical.json');
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

function checkLoanwordOverrides() {
    const overrides = readJson('public/data/loanword_overrides.json');
    assert(overrides && typeof overrides === 'object' && !Array.isArray(overrides), 'loanword overrides must be an object');
    assert(Object.keys(overrides).length > 1000, 'loanword overrides look unexpectedly small');
    assert(Array.isArray(overrides.mobile) && overrides.mobile.includes('모바일'), 'missing mobile -> 모바일 override');
    assert(Array.isArray(overrides.touchdown) && overrides.touchdown.includes('터치다운'), 'missing touchdown -> 터치다운 override');
}

function checkSemanticVectorFile(relativePath) {
    const vectorPath = path.join(ROOT_DIR, relativePath);
    if (!fs.existsSync(vectorPath)) return;

    const semantic = readJson(relativePath);
    const vectors = semantic.words || semantic.vectors || semantic;
    assert(vectors && typeof vectors === 'object' && !Array.isArray(vectors), `${relativePath} must be an object or contain a words/vectors object`);

    const entries = Object.entries(vectors);
    assert(entries.length > 0, `${relativePath} must contain at least one vector`);

    const [word, vector] = entries[0];
    assert(typeof word === 'string' && word.length > 0, `${relativePath} keys must be non-empty strings`);
    assert(Array.isArray(vector) && vector.length > 0, `${relativePath} values must be numeric arrays`);
    assert(vector.every(value => typeof value === 'number' && Number.isFinite(value)), `${relativePath} values must be finite numbers`);
}

function checkSemanticVectors() {
    [
        'public/data/semantic_vectors_ko.json',
        'public/data/semantic_vectors_en.json',
        'public/data/semantic_vectors.json',
    ].forEach(checkSemanticVectorFile);
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
        'public/data/bigram_next_ko.json',
        'public/data/bigram_next_en.json',
    ].forEach(checkBigramIndexFile);
}

function checkSurfaceBigramIndex() {
    const relativePath = 'public/data/bigram_surface_ko.json';
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

function checkCompoundPronunciations() {
    const relativePath = 'public/data/compound_pronunciations_ko.json';
    const indexPath = path.join(ROOT_DIR, relativePath);
    if (!fs.existsSync(indexPath)) return;

    const compounds = readJson(relativePath);
    assert(compounds && typeof compounds === 'object' && !Array.isArray(compounds), `${relativePath} must be an object`);
    const entries = Object.entries(compounds);
    assert(entries.length > 0, `${relativePath} must contain at least one entry`);

    const [word, rows] = entries[0];
    assert(typeof word === 'string' && word.length > 0, `${relativePath} keys must be non-empty strings`);
    assert(Array.isArray(rows) && rows.length > 0, `${relativePath} values must be non-empty candidate arrays`);
    const row = rows[0];
    assert(Array.isArray(row) && row.length >= 3, `${relativePath} candidate rows must be [label, reading, phonemes]`);
    assert(typeof row[0] === 'string' && row[0].length > 0, `${relativePath} candidate label must be a string`);
    assert(typeof row[1] === 'string' && row[1].length > 0, `${relativePath} candidate reading must be a string`);
    assert(Array.isArray(row[2]) && row[2].length > 0, `${relativePath} candidate phonemes must be a non-empty array`);
    assert(entries.some(([, candidateRows]) => candidateRows.some(candidate => String(candidate[0]).includes('형태소'))), `${relativePath} must include morphology-based candidates`);
}

function main() {
    checkAppSyntax();
    checkKoreanPronunciationRules();
    checkDictionary();
    checkLoanwordOverrides();
    checkSemanticVectors();
    checkBigramIndexes();
    checkSurfaceBigramIndex();
    checkCompoundPronunciations();
    console.log('Project check passed.');
}

main();
