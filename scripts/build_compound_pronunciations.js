const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_DICT = path.join(ROOT_DIR, 'public', 'data', 'rhyme_dict_practical.json');
const DEFAULT_OUTPUT = path.join(ROOT_DIR, 'public', 'data', 'compound_pronunciations_ko.json');
const DEFAULT_MORPH_CACHE = path.join(ROOT_DIR, 'scripts', 'cache', 'morph_analysis_ko.json');

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const MEDIALS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const EMPTY_ONSET = 'ㅇ';
const N_INSERTION_MEDIALS = new Set(['ㅣ', 'ㅑ', 'ㅕ', 'ㅛ', 'ㅠ', 'ㅒ', 'ㅖ']);
const SINGLE_SYLLABLE_RIGHT_COMPOUNDS = new Set(['잎', '일', '옷']);
const WHOLE_WORD_COMPOUND_TAGS = new Set(['NNG', 'NNP']);
const LEFT_COMPOUND_TAGS = new Set(['NNG', 'NNP', 'NNB', 'NR', 'NP', 'XR', 'XPN', 'SL', 'SN']);
const RIGHT_COMPOUND_TAGS = new Set(['NNG', 'NNP', 'NNB', 'NR', 'SL', 'SN']);

function loadPronunciationRuntime() {
    const context = { console, dictionary: [] };
    context.window = context;
    vm.createContext(context);

    ['public/js/phonetics.js', 'public/js/koreanPronunciation.js'].forEach(relativePath => {
        const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
        vm.runInContext(source, context, { filename: relativePath });
    });

    return context;
}

function isHangulSyllable(char) {
    const code = char.charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3;
}

function isHangulWord(word) {
    return Array.from(String(word || '')).every(isHangulSyllable);
}

function decompose(char) {
    if (!isHangulSyllable(char)) return null;
    const offset = char.charCodeAt(0) - 0xac00;
    const finalIndex = offset % 28;
    const medialIndex = Math.floor(offset / 28) % 21;
    const initialIndex = Math.floor(offset / (28 * 21));
    return {
        initial: INITIALS[initialIndex],
        medial: MEDIALS[medialIndex],
        final: FINALS[finalIndex],
    };
}

function compose(syllable) {
    const initialIndex = INITIALS.indexOf(syllable.initial || EMPTY_ONSET);
    const medialIndex = MEDIALS.indexOf(syllable.medial);
    const finalIndex = FINALS.indexOf(syllable.final || '');
    if (initialIndex < 0 || medialIndex < 0 || finalIndex < 0) return '';
    return String.fromCharCode(0xac00 + initialIndex * 21 * 28 + medialIndex * 28 + finalIndex);
}

function replaceInitial(char, initial) {
    const syllable = decompose(char);
    if (!syllable) return char;
    return compose({ ...syllable, initial });
}

function removeFinalSiot(word) {
    const chars = Array.from(word);
    if (chars.length === 0) return word;
    const last = decompose(chars[chars.length - 1]);
    if (!last || last.final !== 'ㅅ') return word;
    chars[chars.length - 1] = compose({ ...last, final: '' });
    return chars.join('');
}

function hasFinalConsonant(char) {
    const syllable = decompose(char);
    return Boolean(syllable && syllable.final);
}

function startsWithNInsertionVowel(char) {
    const syllable = decompose(char);
    return Boolean(syllable && syllable.initial === EMPTY_ONSET && N_INSERTION_MEDIALS.has(syllable.medial));
}

function ensureMorphCache(dictPath, cachePath) {
    if (fs.existsSync(cachePath)) return;

    const scriptPath = path.join(ROOT_DIR, 'scripts', 'extract_korean_morph_cache.py');
    const result = spawnSync('python', [scriptPath, dictPath, cachePath], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
        const message = (result.stderr || result.stdout || '').trim();
        console.warn(`Morph cache generation skipped. Install kiwipiepy to enable it. ${message}`);
    } else if (result.stdout) {
        console.log(result.stdout.trim());
    }
}

function loadMorphCache(dictPath) {
    ensureMorphCache(dictPath, DEFAULT_MORPH_CACHE);
    if (!fs.existsSync(DEFAULT_MORPH_CACHE)) return {};

    try {
        return JSON.parse(fs.readFileSync(DEFAULT_MORPH_CACHE, 'utf8'));
    } catch (error) {
        console.warn(`Failed to load morph cache: ${error.message}`);
        return {};
    }
}

function isMorphBoundaryEligible(boundary) {
    if (!Array.isArray(boundary) || boundary.length < 3) return false;
    return LEFT_COMPOUND_TAGS.has(boundary[1]) && RIGHT_COMPOUND_TAGS.has(boundary[2]);
}

function isFallbackSplitAllowed(morphEntry) {
    if (!morphEntry) return true;
    if (morphEntry.tag) return WHOLE_WORD_COMPOUND_TAGS.has(morphEntry.tag);
    return false;
}

function getDefaultPhonemeKeys(item) {
    const keys = new Set();
    if (Array.isArray(item.phonemes) && item.phonemes.length > 0) {
        keys.add(item.phonemes.join('|'));
    }
    if (Array.isArray(item.pronunciations)) {
        item.pronunciations.forEach(row => {
            if (Array.isArray(row) && Array.isArray(row[2]) && row[2].length > 0) {
                keys.add(row[2].join('|'));
            }
        });
    }
    return keys;
}

function makeRowsFromSeed(runtime, seed, label) {
    const candidates = runtime.getKoreanStandardPronunciationCandidates(seed) || [];
    return candidates
        .filter(candidate => candidate.layer !== 'written')
        .map(candidate => [label, candidate.reading, candidate.phonemes, 'compound'])
        .filter(row => row[1] && Array.isArray(row[2]) && row[2].length > 0);
}

function getCandidateSplits(word, wordSet, morphEntry) {
    const chars = Array.from(word);
    const splits = new Map();

    if (morphEntry && Array.isArray(morphEntry.boundaries)) {
        morphEntry.boundaries
            .filter(isMorphBoundaryEligible)
            .forEach(boundary => {
                const split = boundary[0];
                splits.set(split, 'morph');
            });
    }

    if (!isFallbackSplitAllowed(morphEntry)) return splits;

    for (let split = 1; split < chars.length; split++) {
        const left = chars.slice(0, split).join('');
        const right = chars.slice(split).join('');
        const leftBase = removeFinalSiot(left);
        const leftKnown = wordSet.has(left) || wordSet.has(leftBase);
        const rightKnown = wordSet.has(right);
        if (!leftKnown || !rightKnown) continue;
        if (Array.from(right).length === 1 && !SINGLE_SYLLABLE_RIGHT_COMPOUNDS.has(right)) continue;
        if (!splits.has(split)) splits.set(split, 'lexicon');
    }

    return splits;
}

function findCompoundSeeds(word, wordSet, morphEntry) {
    const chars = Array.from(word);
    const seeds = [];

    getCandidateSplits(word, wordSet, morphEntry).forEach((source, split) => {
        const left = chars.slice(0, split).join('');

        const leftLast = decompose(chars[split - 1]);
        const rightFirst = decompose(chars[split]);
        if (!leftLast || !rightFirst) return;

        if (hasFinalConsonant(chars[split - 1]) && startsWithNInsertionVowel(chars[split])) {
            seeds.push({
                label: source === 'morph' ? '형태소 ㄴ첨가' : '합성어 ㄴ첨가',
                seed: `${left}${replaceInitial(chars[split], 'ㄴ')}${chars.slice(split + 1).join('')}`,
            });
        }

        if (leftLast.final === 'ㅅ' && rightFirst.initial === EMPTY_ONSET) {
            seeds.push({
                label: source === 'morph' ? '형태소 사이시옷' : '합성어 사이시옷',
                seed: `${left}${replaceInitial(chars[split], 'ㄴ')}${chars.slice(split + 1).join('')}`,
            });
        }
    });

    return seeds;
}

function buildCompoundPronunciations(dictPath, outputPath) {
    const runtime = loadPronunciationRuntime();
    const dictionary = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
    const koreanItems = dictionary.filter(item => item && item.lang === 'ko' && isHangulWord(item.word));
    const wordSet = new Set(koreanItems.map(item => item.word));
    const morphCache = loadMorphCache(dictPath);
    const output = {};
    let candidateWordCount = 0;

    koreanItems.forEach(item => {
        const word = item.word;
        if (Array.from(word).length < 2) return;

        const defaultKeys = getDefaultPhonemeKeys(item);
        const seen = new Set();
        const rows = [];

        findCompoundSeeds(word, wordSet, morphCache[word]).forEach(({ seed, label }) => {
            makeRowsFromSeed(runtime, seed, label).forEach(row => {
                const key = row[2].join('|');
                if (!key || defaultKeys.has(key) || seen.has(key)) return;
                seen.add(key);
                rows.push(row);
            });
        });

        if (rows.length > 0) {
            output[word] = rows;
            candidateWordCount++;
        }
    });

    fs.writeFileSync(outputPath, JSON.stringify(output), 'utf8');
    console.log(`Built ${path.relative(ROOT_DIR, outputPath)}: ${candidateWordCount.toLocaleString()} compound pronunciation entries.`);
}

function main() {
    const [dictArg, outputArg] = process.argv.slice(2);
    const dictPath = dictArg ? path.resolve(process.cwd(), dictArg) : DEFAULT_DICT;
    const outputPath = outputArg ? path.resolve(process.cwd(), outputArg) : DEFAULT_OUTPUT;
    buildCompoundPronunciations(dictPath, outputPath);
}

main();
