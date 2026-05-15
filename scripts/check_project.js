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
    const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8');
    new vm.Script(source, { filename: 'public/app.js' });
}

function checkDictionary() {
    const dictionary = readJson('public/rhyme_dict_practical.json');
    assert(Array.isArray(dictionary), 'rhyme_dict_practical.json must be an array');
    assert(dictionary.length > 200000, 'practical dictionary looks unexpectedly small');
    assert(dictionary.some(item => item.word === 'rhyme' && item.lang === 'en'), 'missing English sample word: rhyme');
    assert(dictionary.some(item => item.lang === 'ko'), 'missing Korean dictionary entries');
}

function checkLoanwordOverrides() {
    const overrides = readJson('public/loanword_overrides.json');
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
        'public/semantic_vectors_ko.json',
        'public/semantic_vectors_en.json',
        'public/semantic_vectors.json',
    ].forEach(checkSemanticVectorFile);
}

function main() {
    checkAppSyntax();
    checkDictionary();
    checkLoanwordOverrides();
    checkSemanticVectors();
    console.log('Project check passed.');
}

main();
