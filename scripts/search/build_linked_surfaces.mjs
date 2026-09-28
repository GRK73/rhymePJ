// Korean surface forms of the linked-search bigrams with their Heami pronunciations.
// Every surface (a bigram head or follower as written, e.g. 사랑을) and every normalized
// form (사랑) is read by Heami the same way as lexicon words (heami-normalize.mjs,
// codas restored), so linked and word search compare the same pronunciations.
//
// Input : data/source/bigram_surface_ko.json, Heami raw TSVs in
//         data/derived/pronunciations_heami/v0/ (words, corpus, linked surfaces).
// Output: data/derived/linked/v1/surfaces.tsv  (surface, phonemes, normalized form)
//         data/derived/linked/v1/topic_words.tsv (words whose meaning vector is not in the lexicon)
// Usage : node scripts/search/build_linked_surfaces.mjs LEXICON_WORDS.tsv
//         (LEXICON_WORDS.tsv from scripts/semantic/export_lexicon_words.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeHeamiEvents, parseRawLine, restoreCodas } from '../pronunciation/heami-normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEAMI = path.join(ROOT, 'data/derived/pronunciations_heami/v0');
const OUT = path.join(ROOT, 'data/derived/linked/v1');
const lexiconWords = process.argv[2];
if (!lexiconWords) throw new Error('usage: build_linked_surfaces.mjs LEXICON_WORDS.tsv');

const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source/bigram_surface_ko.json'), 'utf8'));
const entries = source.entries || source;
const normalized = new Map();
const surfaces = new Set();
const note = (surface, form) => {
    if (!surface) return;
    surfaces.add(surface);
    if (form && form !== surface) { surfaces.add(form); normalized.set(surface, form); }
};
for (const [head, payload] of Object.entries(entries)) {
    note(head, Array.isArray(payload) ? String(payload[0] || '') : '');
    for (const row of Array.isArray(payload?.[1]) ? payload[1] : []) note(String(row[0] || ''), String(row[3] || ''));
}

const readings = new Map();
for (const file of ['heami_raw.tsv', 'heami_raw_corpus.tsv', 'heami_raw_linked.tsv']) {
    for (const line of fs.readFileSync(path.join(HEAMI, file), 'utf8').split('\n')) {
        if (!line.startsWith('ko\t')) continue;
        const { word, events } = parseRawLine(line);
        if (!surfaces.has(word) || readings.has(word)) continue;
        const reading = restoreCodas(word, normalizeHeamiEvents(events).phonemes).phonemes;
        if (reading.length) readings.set(word, reading.join(' '));
    }
}

const inLexicon = new Set(fs.readFileSync(lexiconWords, 'utf8').split('\n')
    .filter(line => line.startsWith('ko\t')).map(line => line.split('\t')[1]));
const sorted = [...surfaces].sort();
const missing = sorted.filter(surface => !readings.has(surface));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'surfaces.tsv'),
    sorted.filter(surface => readings.has(surface))
        .map(surface => `${surface}\t${readings.get(surface)}\t${normalized.get(surface) || ''}`).join('\n') + '\n');
// Meaning comes from the normalized form (사랑을 -> 사랑), as in V1.
const topicWords = [...new Set(sorted.map(surface => normalized.get(surface) || surface))].filter(word => !inLexicon.has(word));
fs.writeFileSync(path.join(OUT, 'topic_words.tsv'), topicWords.map(word => `ko\t${word}\t`).join('\n') + '\n');
console.log(JSON.stringify({ surfaces: surfaces.size, with_reading: readings.size, missing: missing.length,
    missing_examples: missing.slice(0, 10), topic_words_outside_lexicon: topicWords.length }));
