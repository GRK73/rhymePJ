// Evaluate Heami pronunciations against the project's references.
//   English: loanword table (official Hangul spellings) is the gold standard.
//            Compared with the current rule heuristic (getKoreanizedEnglishPhonemes).
//   Korean : agreement with the project's standard-pronunciation rules.
// The rules are V1's (commit 5df2ae8, read from Git): the rule code left the working
// tree when the V2 engines replaced it (2026-09-28).
// Usage: node scripts/pronunciation/evaluate-heami.mjs [raw.tsv] [report.json]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeHeamiEvents, parseRawLine } from './heami-normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rawPath = process.argv[2] || path.join(ROOT, 'data/derived/pronunciations_heami/v0/heami_raw.tsv');
const reportPath = process.argv[3] || path.join(ROOT, 'data/derived/pronunciations_heami/v0/evaluation.json');
const require = createRequire(import.meta.url);

const V1 = '5df2ae8';
const gitShow = file => execFileSync('git', ['show', `${V1}:${file}`], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }).toString('utf8');

function loadProjectPhonetics() {
    const context = { console, Math, JSON, Number, String, Array, Object, Set, Map, isFinite, parseFloat,
        Hangul: require('hangul-js') };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    for (const file of ['public/js/data.js', 'public/js/phonetics.js', 'public/js/koreanPronunciation.js']) {
        vm.runInContext(gitShow(file), context, { filename: `${V1}:${file}` });
    }
    context.compoundPronunciationsKo = JSON.parse(gitShow('public/data/model/compound_pronunciations_ko.json'));
    return context;
}

function editDistance(left, right) {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
            previous = current;
        }
    }
    return row[right.length];
}

// Best match of a candidate against any reference pronunciation.
function compare(candidate, references) {
    let best = { exact: false, errorRate: 1 };
    for (const reference of references) {
        const distance = editDistance(candidate, reference);
        const errorRate = distance / Math.max(reference.length, 1);
        if (errorRate < best.errorRate) best = { exact: distance === 0, errorRate, reference };
    }
    return best;
}

function summarize(results) {
    const count = results.length;
    const exact = results.filter(result => result.exact).length;
    const meanError = results.reduce((sum, result) => sum + result.errorRate, 0) / Math.max(count, 1);
    return { count, exact, exact_rate: exact / Math.max(count, 1), mean_phoneme_error_rate: meanError };
}

const phonetics = loadProjectPhonetics();
const standard = word => phonetics.getKoreanStandardPronunciationCandidates(word)
    .map(candidate => candidate.phonemes).filter(phonemes => phonemes.length);
const loanwords = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/model/loanword_overrides.json'), 'utf8'));

const heami = new Map();
const failures = { empty: [], unknown_symbols: new Map() };
for (const line of fs.readFileSync(rawPath, 'utf8').split('\n')) {
    if (!line) continue;
    const { lang, word, events } = parseRawLine(line);
    const { phonemes, unknown } = normalizeHeamiEvents(events);
    if (!phonemes.length) { failures.empty.push(`${lang}:${word}`); continue; }
    for (const symbol of unknown) failures.unknown_symbols.set(symbol, (failures.unknown_symbols.get(symbol) || 0) + 1);
    heami.set(`${lang}\t${word}`, phonemes);
}

// English vs official loanword spellings.
const englishHeami = [];
const englishHeuristic = [];
const englishExamples = [];
for (const [word, spellings] of Object.entries(loanwords)) {
    const phonemes = heami.get(`en\t${word}`);
    if (!phonemes) continue;
    const references = spellings.flatMap(standard);
    if (!references.length) continue;
    const heamiResult = compare(phonemes, references);
    // Rule heuristic only; getKoreanizedEnglishCandidates would consult the loanword table (gold leakage).
    const heuristic = phonetics.getKoreanizedEnglishPhonemes(word);
    const heuristicResult = compare(heuristic, references);
    englishHeami.push(heamiResult);
    englishHeuristic.push(heuristicResult);
    if (englishExamples.length < 40 && !heamiResult.exact) {
        englishExamples.push({ word, gold: spellings, gold_phonemes: heamiResult.reference.join(' '),
            heami: phonemes.join(' '), heuristic: heuristic.join(' ') });
    }
}

// Korean vs project standard-pronunciation rules.
const korean = [];
const koreanExamples = [];
for (const [key, phonemes] of heami) {
    const [lang, word] = key.split('\t');
    if (lang !== 'ko') continue;
    const references = standard(word);
    if (!references.length) continue;
    const result = compare(phonemes, references);
    korean.push(result);
    if (!result.exact) {
        if (koreanExamples.length < 40 && koreanExamples.length * 2500 < korean.length) {
            koreanExamples.push({ word, rules: result.reference.join(' '), heami: phonemes.join(' ') });
        }
    }
}

const report = {
    words_with_output: heami.size,
    empty_output: failures.empty.length,
    empty_examples: failures.empty.slice(0, 20),
    unknown_symbols: Object.fromEntries(failures.unknown_symbols),
    english_vs_loanword_gold: { heami: summarize(englishHeami), rule_heuristic: summarize(englishHeuristic) },
    korean_vs_standard_rules: summarize(korean),
    english_mismatch_examples: englishExamples,
    korean_mismatch_examples: koreanExamples,
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, english_mismatch_examples: undefined, korean_mismatch_examples: undefined }, null, 2));
