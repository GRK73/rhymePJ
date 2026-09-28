// Build the single-pronunciation table that replaces the rule candidates.
// Covers the V1 dictionary and the lyric-corpus vocabulary.
//   ko : Heami reading of the Korean word, with obstruent codas restored where
//        Heami merges them into a following tense onset (국가 → k u k k* a).
//   en : Korean-style reading. Heami's reading of the official loanword spelling
//        when one exists (time → 타임), otherwise Heami's reading of the English word.
// English native pronunciations are not part of this table.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeHeamiEvents, parseRawLine, restoreCodas } from './heami-normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'data/derived/pronunciations_heami/v0');

function readRaw(file) {
    const rows = new Map();
    const unknown = new Map();
    for (const line of fs.readFileSync(path.join(DIR, file), 'utf8').split('\n')) {
        if (!line) continue;
        const { lang, word, events } = parseRawLine(line);
        const result = normalizeHeamiEvents(events);
        for (const symbol of result.unknown) unknown.set(symbol, (unknown.get(symbol) || 0) + 1);
        rows.set(`${lang}\t${word}`, result.phonemes);
    }
    return { rows, unknown };
}

function koreanReading(word, phonemes, stats) {
    const result = restoreCodas(word, phonemes);
    if (result.aligned) stats.aligned += 1; else stats.unaligned += 1;
    stats.codas_restored += result.restored;
    return result.phonemes;
}

// V1 dictionary words plus lyric-corpus words (both result targets, 2026-09-27).
const dictionaryWords = readRaw('heami_raw.tsv');
const corpusWords = readRaw('heami_raw_corpus.tsv');
const words = { rows: new Map([...dictionaryWords.rows, ...corpusWords.rows]),
    unknown: new Map([...dictionaryWords.unknown, ...corpusWords.unknown]) };
const forms = readRaw('loanword_forms_raw.tsv');
const loanwords = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source/loanword_overrides.json'), 'utf8'));
const stats = { ko: 0, en: 0, en_from_loanword: 0, aligned: 0, unaligned: 0, codas_restored: 0, empty: 0 };
const table = { ko: {}, en: {} };

for (const [key, phonemes] of words.rows) {
    const [lang, word] = key.split('\t');
    if (lang === 'ko') {
        const reading = koreanReading(word, phonemes, stats);
        if (!reading.length) { stats.empty += 1; continue; }
        table.ko[word] = reading.join(' ');
        stats.ko += 1;
        continue;
    }
    const form = loanwords[word]?.[0];
    const formPhonemes = form && forms.rows.get(`ko\t${form}`);
    const reading = formPhonemes?.length ? koreanReading(form, formPhonemes, stats) : phonemes;
    if (!reading.length) { stats.empty += 1; continue; }
    if (formPhonemes?.length) stats.en_from_loanword += 1;
    table.en[word] = reading.join(' ');
    stats.en += 1;
}

const unknown = Object.fromEntries([...words.unknown, ...forms.unknown]);
const output = {
    schema_version: 1,
    source: 'Microsoft Heami Desktop (Windows System.Speech PhonemeReached)',
    phoneme_separator: ' ',
    ko: table.ko,
    en_koreanized: table.en,
};
fs.writeFileSync(path.join(DIR, 'pronunciations.json'), JSON.stringify(output));
console.log(JSON.stringify({ ...stats, unknown_symbols: unknown }, null, 2));
