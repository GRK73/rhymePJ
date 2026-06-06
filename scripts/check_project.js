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
        'public/js/lyricsAnalysis.js',
        'public/js/lyricsAnalysisMetrics.js',
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
    const dictionary = readJson('public/data/model/rhyme_dict_practical.json');
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

function checkLyricsEnglishRimes() {
    const context = {
        console,
        dictionary: readJson('public/data/model/rhyme_dict_practical.json'),
        loanwordOverrides: {},
        document: { getElementById: () => null, querySelectorAll: () => [] },
        window: {}
    };
    context.globalThis = context;
    vm.createContext(context);

    [
        'public/js/data.js',
        'public/js/phonetics.js',
        'public/js/koreanPronunciation.js',
        'public/js/lyricsAnalysis.js',
        'public/js/lyricsAnalysisMetrics.js',
    ].forEach(relativePath => {
        const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
        vm.runInContext(source, context, { filename: relativePath });
    });

    const crownSignature = vm.runInContext('getRhymeSignature("crown")', context);
    const clownSignature = vm.runInContext('getRhymeSignature("clown")', context);
    const skillSignature = vm.runInContext('getRhymeSignature("skill")', context);
    const killSignature = vm.runInContext('getRhymeSignature("kill")', context);
    const mixedEnding = vm.runInContext('getLineEndingRhymeData("\\uC655\\uAD00 crown")', context);
    const endingWindows = JSON.parse(vm.runInContext(
        `JSON.stringify(getLineRhymeSpanCandidates({
            section: { id: "test" },
            index: 0,
            line: "\\uC798\\uD574\\uC57C \\uD55C\\uB2E8 \\uAC15\\uBC15, \\uBAA9\\uC744 \\uC870\\uB974\\uB358 crown"
        }, 2, 2).filter(row => row.isEnding).map(row => ({ text: row.text, lang: row.lang })))`,
        context
    ));
    const mixedWindows = JSON.parse(vm.runInContext(
        `JSON.stringify(getLineRhymeSpanCandidates({
            section: { id: "test" },
            index: 1,
            line: "\\uBB34\\uAE30\\uB825 stuck, \\uC2A4\\uC2A4\\uB85C lock"
        }, 1, 3).map(row => ({ text: row.text, lang: row.lang })))`,
        context
    ));

    assert(crownSignature === clownSignature, 'crown and clown must share an English rime signature');
    assert(skillSignature === killSignature, 'skill and kill must share an English rime signature');
    assert(String(crownSignature).startsWith('en:'), 'English rhyme signatures must use English rime cores');
    assert(mixedEnding.text === 'crown', 'mixed Korean/English line endings must prefer the final English token');
    assert(mixedEnding.signature === crownSignature, 'mixed Korean/English line ending must keep the English rime signature');
    assert(endingWindows.some(row => row.text === 'crown' && row.lang === 'en'), 'structural ending candidates must prefer final English words');
    assert(!mixedWindows.some(row => row.lang === 'mixed'), 'mixed Korean/English token windows must not become structural rhyme spans');
}

function checkPhoneticSimilarityEngine() {
    const context = {
        console,
        dictionary: [],
        document: { getElementById: () => ({ checked: false }) },
        vowelWeightInput: { value: '1' },
        consoWeightInput: { value: '1' },
        window: {}
    };
    context.globalThis = context;
    vm.createContext(context);

    const source = fs.readFileSync(path.join(ROOT_DIR, 'public/js/phonetics.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'public/js/phonetics.js' });

    const exactStop = vm.runInContext('get_score_1d("p", "p")', context);
    const voicedStop = vm.runInContext('get_score_1d("p", "b")', context);
    const adjacentStop = vm.runInContext('get_score_1d("p", "t")', context);
    const distantStop = vm.runInContext('get_score_1d("p", "k")', context);
    const nasalMismatch = vm.runInContext('get_score_1d("p", "m")', context);

    assert(exactStop === 1, 'identical phonemes must keep exact similarity');
    assert(voicedStop > adjacentStop, 'same-place stop voicing must outrank place-shifted stops');
    assert(adjacentStop > distantStop, 'nearby stop places must outrank distant stop places');
    assert(distantStop > 0, 'consonant place differences should retain a conservative soft score');
    assert(nasalMismatch < adjacentStop, 'manner mismatches must stay below same-manner stops');

    const exactScore = vm.runInContext('calculateScore(["k", "a", "t"], ["k", "a", "t"]).score', context);
    const baseScore = vm.runInContext('calculateScore(["k", "a", "t"], ["p", "a", "t"]).score', context);
    const candidate = vm.runInContext('scoreCandidate(["k", "a", "t"], ["p", "a", "t"], [], "native", "")', context);
    const suffixMismatch = vm.runInContext('scoreCandidate(["s", "k", "i", "l", "z"], ["s", "k", "i", "l"], [], "native", "")', context);
    const koreanSyllableScore = vm.runInContext('getKoreanSyllableScore("\\uAC00\\uB09C", "\\uBC14\\uB09C")', context);
    const koreanContextReadings = JSON.parse(vm.runInContext(
        'JSON.stringify(getKoreanContextualPronunciationCandidates("\\uC0AC\\uB791\\uC740").map(candidate => candidate.reading))',
        context
    ));
    const stressCandidate = vm.runInContext(
        'scoreCandidate(["k", "a", "t"], ["b", "a", "t"], [], "native", "", 1, { lang: "en", targetStress: [1], queryStress: [1] })',
        context
    );
    const mixedKoTarget = vm.runInContext(
        'calculatePronunciationScore({ word: "\\uB77C\\uC784", lang: "ko", phonemes: ["\\u027E", "a", "i", "m"] }, { phonemes: ["\\u027E", "a", "i", "m"], koreanizedCandidates: [{ phonemes: ["\\u027E", "a", "i", "m"], label: "test", form: "\\uB77C\\uC784" }] }, [], "mixed")',
        context
    );

    assert(exactScore === 100, 'exact phoneme sequences must remain 100');
    assert(candidate.rimeScore > baseScore, 'ending rime score must detect shared vowel-coda tails');
    assert(candidate.score > baseScore && candidate.score <= 100, 'candidate score must include a bounded rime boost');
    assert(suffixMismatch.rawScore === 100 && suffixMismatch.score < 95, 'non-ending substring matches must not keep an unqualified 100 score');
    assert(koreanSyllableScore > 70 && koreanSyllableScore < 100, 'Korean syllable score must reward shared nucleus/coda while preserving onset differences');
    assert(koreanContextReadings.includes('\uC0AC\uB791'), 'Korean contextual G2P must add particle-stripped stem candidates');
    assert(stressCandidate.stressRimeScore > 70, 'English stress-aware rime score must be exposed on scored candidates');
    assert(mixedKoTarget.score > 90, 'mixed search must allow English query koreanized candidates to match Korean targets');
}

function checkLinkedSurfaceHelpers() {
    const context = {
        console,
        ipaFeatures: {},
        calculateScore: () => ({ score: 0, matchIndices: [] }),
        remapDetailMultipliers: (values) => values
    };
    vm.createContext(context);

    const source = fs.readFileSync(path.join(ROOT_DIR, 'public/js/linkedRhyme.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'public/js/linkedRhyme.js' });

    const exact = vm.runInContext('getBoundarySurfaceMatch("소가", "가", "end")', context);
    assert(exact.exact && exact.score === 100, 'surface helper must detect exact left boundary matches');

    const partial = vm.runInContext('getBoundarySurfaceMatch("나간다", "나다", "start")', context);
    assert(!partial.exact && partial.score > 0, 'surface helper must detect partial right boundary matches');

    const display = vm.runInContext('formatSurfaceLinkedDisplay("A가나", "다B", "가나", "다")', context);
    assert(display === 'A[가나 다]B', `surface display must bracket split-length matches, got ${display}`);

    const balanced = vm.runInContext(`getWeightedLinkedBoundaryScore({
        leftSurfaceMatch: { score: 100 },
        rightSurfaceMatch: { score: 0 },
        leftPhoneticScore: 100,
        rightPhoneticScore: 0,
        leftDetailMultipliers: [1],
        rightDetailMultipliers: [1]
    }).score`, context);
    const rightHeavy = vm.runInContext(`getWeightedLinkedBoundaryScore({
        leftSurfaceMatch: { score: 100 },
        rightSurfaceMatch: { score: 0 },
        leftPhoneticScore: 100,
        rightPhoneticScore: 0,
        leftDetailMultipliers: [1],
        rightDetailMultipliers: [4]
    }).score`, context);
    assert(rightHeavy < balanced, 'detail weights must lower results missing a heavily weighted boundary');

    const matchType = vm.runInContext('getSurfaceMatchType({ exact: true, score: 100 }, { exact: true, score: 100 }).type', context);
    assert(matchType === 'exact-surface', 'exact surface matches must be labelled exact-surface');

    const rareSpike = vm.runInContext('getCountAwareBigramScore(12, 5)', context);
    const commonPhrase = vm.runInContext('getCountAwareBigramScore(1.5, 500)', context);
    assert(commonPhrase >= rareSpike * 0.85, 'count-aware bigram score must dampen rare association spikes');
}

function checkLyricsTemplateWithBugsSample() {
    const bugsPath = path.join(ROOT_DIR, '..', 'bugs_hiphop_corpus.json');
    if (!fs.existsSync(bugsPath)) return;

    const corpus = JSON.parse(fs.readFileSync(bugsPath, 'utf8'));
    const sample = corpus.find(item => typeof item.lyrics === 'string' && item.lyrics.split(/\r?\n/).filter(Boolean).length >= 6);
    assert(sample, 'bugs lyrics corpus must include a usable lyrics sample');

    const context = {
        console,
        dictionary: readJson('public/data/model/rhyme_dict_practical.json'),
        loanwordOverrides: {},
        document: { getElementById: () => null, querySelectorAll: () => [] },
        window: {},
        sampleLyrics: sample.lyrics
    };
    context.globalThis = context;
    vm.createContext(context);

    [
        'public/js/data.js',
        'public/js/phonetics.js',
        'public/js/koreanPronunciation.js',
        'public/js/lyricsAnalysis.js',
        'public/js/lyricsAnalysisMetrics.js',
    ].forEach(relativePath => {
        const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
        vm.runInContext(source, context, { filename: relativePath });
    });

    const template = JSON.parse(vm.runInContext(`
        const bugsLines = splitLyricsLines(sampleLyrics).slice(0, 8);
        const bugsSection = { id: 'bugs', type: 'Verse', lines: bugsLines };
        const bugsRows = bugsLines.map((line, index) => {
            const tokens = tokenizeLyrics(line);
            const endingWord = getLastLyricWord(line);
            const endingData = getLineEndingRhymeData(line);
            return {
                section: bugsSection,
                index,
                line,
                tokens,
                wordCount: tokens.length,
                linePhonemes: tokens.flatMap(token => getLyricWordPhonemes(token)),
                endingWord,
                endingRhymeText: endingData.text,
                rhymeSignature: endingData.signature
            };
        });
        const bugsPatternMap = new Map();
        bugsRows.forEach((row, index) => {
            if (row.rhymeSignature) bugsPatternMap.set(row.section.id + ':' + row.index, index % 2);
        });
        JSON.stringify(buildLyricsSectionTemplate(bugsSection, bugsRows, bugsPatternMap));
    `, context));

    assert(template.lineCount > 0, 'bugs lyrics template must include lines');
    assert(template.patternLabels.length === template.lineCount, 'section template pattern must align with line count');
    assert(Number.isFinite(template.repeatRate), 'section template repeat rate must be finite');
    assert(Number.isFinite(template.patternRegularity), 'section template regularity must be finite');
    assert(template.avgSyllables > 0, 'section template must estimate syllable density from bugs lyrics');
}

function checkLoanwordOverrides() {
    const overrides = readJson('public/data/model/loanword_overrides.json');
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
        'public/data/model/semantic_vectors_ko.json',
        'public/data/model/semantic_vectors_en.json',
        'public/data/model/semantic_vectors.json',
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
        'public/data/model/bigram_next_ko.json',
        'public/data/model/bigram_next_en.json',
    ].forEach(checkBigramIndexFile);
}

function checkSurfaceBigramIndex() {
    const relativePath = 'public/data/model/bigram_surface_ko.json';
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
    const relativePath = 'public/data/model/compound_pronunciations_ko.json';
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
    checkLyricsEnglishRimes();
    checkPhoneticSimilarityEngine();
    checkLinkedSurfaceHelpers();
    checkLyricsTemplateWithBugsSample();
    checkLoanwordOverrides();
    checkSemanticVectors();
    checkBigramIndexes();
    checkSurfaceBigramIndex();
    checkCompoundPronunciations();
    console.log('Project check passed.');
}

main();
