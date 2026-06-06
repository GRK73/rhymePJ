const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_STABLE_PASSES = 3;

function readJson(relativePath, fallback) {
    const fullPath = path.join(ROOT_DIR, relativePath);
    if (!fs.existsSync(fullPath)) return fallback;
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function createContext() {
    const context = {
        console,
        dictionary: readJson('public/data/model/rhyme_dict_practical.json', []),
        loanwordOverrides: readJson('public/data/model/loanword_overrides.json', {}),
        compoundPronunciationsKo: readJson('public/data/model/compound_pronunciations_ko.json', {}),
        document: { getElementById: () => ({ checked: false }), querySelectorAll: () => [] },
        vowelWeightInput: { value: '1' },
        consoWeightInput: { value: '1' },
        window: {}
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);

    ['public/js/data.js', 'public/js/phonetics.js', 'public/js/koreanPronunciation.js'].forEach(relativePath => {
        const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
        vm.runInContext(source, context, { filename: relativePath });
    });

    return context;
}

function parseArgs() {
    const args = new Map();
    process.argv.slice(2).forEach(arg => {
        const [key, value] = arg.split('=');
        args.set(key.replace(/^--/, ''), value || true);
    });
    return {
        maxIterations: Number(args.get('iterations')) || DEFAULT_MAX_ITERATIONS,
        stablePasses: Number(args.get('stable-passes')) || DEFAULT_STABLE_PASSES
    };
}

function compareRows(a, b) {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
    const rimeDiff = (b.rimeScore || 0) - (a.rimeScore || 0);
    if (Math.abs(rimeDiff) > 0.001) return rimeDiff;
    const stressDiff = (b.stressRimeScore || 0) - (a.stressRimeScore || 0);
    if (Math.abs(stressDiff) > 0.001) return stressDiff;
    const syllableDiff = (b.koreanSyllableScore || 0) - (a.koreanSyllableScore || 0);
    if (Math.abs(syllableDiff) > 0.001) return syllableDiff;
    const rawDiff = (b.rawScore || 0) - (a.rawScore || 0);
    if (Math.abs(rawDiff) > 0.001) return rawDiff;
    return String(a.word || '').localeCompare(String(b.word || ''));
}

function getDictionaryItem(context, word, lang) {
    return context.dictionary.find(item => item && item.word === word && item.lang === lang) || null;
}

function makeKoreanItem(context, word) {
    const found = getDictionaryItem(context, word, 'ko');
    if (found) return found;
    const candidates = context.getKoreanStandardPronunciationCandidates
        ? context.getKoreanStandardPronunciationCandidates(word)
        : [];
    const primary = candidates[0] || context.getKoreanIpaPhonemes(word);
    return {
        word,
        display: word,
        lang: 'ko',
        phonemes: primary.phonemes || [],
        reading: primary.reading || word
    };
}

function makeEnglishItem(context, word) {
    const found = getDictionaryItem(context, word, 'en');
    if (found) return found;
    const queryData = context.getQueryPhonemes(word);
    return {
        word,
        display: word,
        lang: 'en',
        phonemes: queryData.phonemes || [],
        stress: queryData.stress || []
    };
}

function scoreCandidates(context, query, mode, candidates) {
    const queryData = context.getQueryPhonemes(query);
    return candidates
        .filter(item => item.word !== query)
        .map(item => {
            const result = context.calculatePronunciationScore(item, queryData, [], mode);
            return {
                word: item.word,
                lang: item.lang,
                score: result.score,
                rawScore: result.rawScore,
                rimeScore: result.rimeScore,
                stressRimeScore: result.stressRimeScore,
                koreanSyllableScore: result.koreanSyllableScore,
                layer: result.matchLayer
            };
        })
        .filter(row => Number.isFinite(row.score))
        .sort(compareRows);
}

function assertOrder(rows, beforeWord, afterWord, message) {
    const beforeIndex = rows.findIndex(row => row.word === beforeWord);
    const afterIndex = rows.findIndex(row => row.word === afterWord);
    if (beforeIndex < 0 || afterIndex < 0 || beforeIndex > afterIndex) {
        throw new Error(`${message}: ${beforeWord} index=${beforeIndex}, ${afterWord} index=${afterIndex}`);
    }
}

function runIteration(context, iteration) {
    const failures = [];

    const englishRows = scoreCandidates(context, 'skill', 'native', [
        makeEnglishItem(context, 'skill'),
        makeEnglishItem(context, 'kill'),
        makeEnglishItem(context, 'skills'),
        makeEnglishItem(context, 'skilled')
    ]);
    try {
        assertOrder(englishRows, 'kill', 'skills', 'English rime core should outrank plural suffix substring matches');
    } catch (error) {
        failures.push(error.message);
    }

    const clownRows = scoreCandidates(context, 'clown', 'native', [
        makeEnglishItem(context, 'clown'),
        makeEnglishItem(context, 'crown'),
        makeEnglishItem(context, 'clowney'),
        makeEnglishItem(context, 'clowns')
    ]);
    try {
        assertOrder(clownRows, 'crown', 'clowney', 'English rime core should keep crown above clowney');
    } catch (error) {
        failures.push(error.message);
    }

    const koreanRows = scoreCandidates(context, '\uC0AC\uB791\uC740', 'mixed', [
        makeKoreanItem(context, '\uC0AC\uB791'),
        makeKoreanItem(context, '\uC0AC\uB791\uC740'),
        makeKoreanItem(context, '\uBC14\uB78C')
    ]);
    try {
        assertOrder(koreanRows, '\uC0AC\uB791', '\uBC14\uB78C', 'Korean contextual G2P should keep particle-stripped stems searchable');
    } catch (error) {
        failures.push(error.message);
    }

    const mixedEnglishToKoreanRows = scoreCandidates(context, 'mobile', 'mixed', [
        makeEnglishItem(context, 'mobile'),
        makeKoreanItem(context, '\uBAA8\uBC14\uC77C'),
        makeKoreanItem(context, '\uBAA8\uB378')
    ]);
    try {
        assertOrder(mixedEnglishToKoreanRows, '\uBAA8\uBC14\uC77C', '\uBAA8\uB378', 'English query koreanized candidates should match Korean loanword targets');
    } catch (error) {
        failures.push(error.message);
    }

    const mixedKoreanToEnglishRows = scoreCandidates(context, '\uBAA8\uBC14\uC77C', 'mixed', [
        makeEnglishItem(context, 'mobile'),
        makeEnglishItem(context, 'model'),
        makeKoreanItem(context, '\uBAA8\uBC14\uC77C')
    ]);
    try {
        assertOrder(mixedKoreanToEnglishRows, 'mobile', 'model', 'Korean query should use English koreanized target layer');
    } catch (error) {
        failures.push(error.message);
    }

    return {
        iteration,
        passed: failures.length === 0,
        failures,
        samples: {
            englishTop: englishRows[0],
            clownTop: clownRows[0],
            koreanTop: koreanRows[0],
            mixedEnglishToKoreanTop: mixedEnglishToKoreanRows[0],
            mixedKoreanToEnglishTop: mixedKoreanToEnglishRows[0]
        }
    };
}

function main() {
    const options = parseArgs();
    const context = createContext();
    let stableCount = 0;

    for (let iteration = 1; iteration <= options.maxIterations; iteration++) {
        const result = runIteration(context, iteration);
        if (result.passed) {
            stableCount += 1;
            console.log(`Iteration ${iteration}: PASS`, JSON.stringify(result.samples));
        } else {
            stableCount = 0;
            console.log(`Iteration ${iteration}: FAIL`);
            result.failures.forEach(failure => console.log(`  ${failure}`));
            throw new Error('phonetic search validation failed');
        }

        if (stableCount >= options.stablePasses) {
            console.log(`Early stopping: ${stableCount} consecutive stable iterations passed.`);
            return;
        }
    }
}

main();
