// Build the V2 word-search lexicon (V2검색엔진설계.md §3).
//   words : V1 dictionary (its order) + lyric-corpus words not in it (lang, then word order)
//   ko    : one Heami reading per Korean word (codas restored)
//   en    : V1 dictionary IPA as the native layer (all of a word's V1 entries) and
//           one Heami Korean-style reading
//   zipf  : data/derived/lexicon/v1/frequencies.json (V1 method; null -> engine default 1.0)
// Output: public/assets/lexicon/v1/{lexicon.json, lexicon.bin.gz}
// The build is verified by deserializing it and comparing sample searches.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public/assets/lexicon/v1');
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

const phonetics = { Math, JSON, Number, String, Array, Object, Set, Map, console };
phonetics.globalThis = phonetics; phonetics.window = phonetics;
vm.createContext(phonetics);
for (const file of ['public/js/v2/phoneme-similarity-config.js', 'public/js/phonetics.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), phonetics, { filename: file });
}
const engineContext = { TextEncoder, TextDecoder };
engineContext.globalThis = engineContext;
vm.createContext(engineContext);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js/search/word-engine.js'), 'utf8'), engineContext);
const Engine = engineContext.RhymeWordEngine;

const table = readJson('data/derived/pronunciations_heami/v0/pronunciations.json');
const frequencies = readJson('data/derived/lexicon/v1/frequencies.json');
const dictionary = readJson('data/source/rhyme_dict_practical.json');
const split = text => text.split(' ');

const entries = [];
const byKey = new Map();
const entryFor = (lang, word) => {
    const key = `${lang}\t${word}`;
    if (!byKey.has(key)) {
        const zipf = frequencies[lang]?.[word];
        const entry = { word, lang, zipf: zipf ?? null, ko: [], native: [], koreanized: [] };
        if (lang === 'ko' && table.ko[word]) entry.ko.push(split(table.ko[word]));
        if (lang === 'en' && table.en_koreanized[word]) entry.koreanized.push(split(table.en_koreanized[word]));
        byKey.set(key, entry);
        entries.push(entry);
    }
    return byKey.get(key);
};
const missing = { ko: 0, en: 0 };
for (const item of dictionary) {
    const entry = entryFor(item.lang, item.word);
    const phonemes = item.phonemes || item.vowels || [];
    if (item.lang === 'en') entry.native.push(phonemes);
    else if (!entry.ko.length) { entry.native.push(phonemes); missing.ko += 1; }
    if (item.lang === 'en' && !entry.koreanized.length) missing.en += 1;
}
const v1Count = entries.length;
for (const lang of ['ko', 'en']) {
    const source = lang === 'ko' ? table.ko : table.en_koreanized;
    for (const word of Object.keys(source).sort()) entryFor(lang, word);
}

const started = Date.now();
const lexicon = Engine.buildLexicon(entries, (a, b) => phonetics.get_score_1d(a, b), p => Boolean(phonetics.ipaFeatures[p]),
    [...Object.keys(phonetics.ipaFeatures), ...Object.keys(phonetics.ipaConsoFeatures)], new Intl.Collator('ko').compare);
const { manifest, buffer } = Engine.serializeLexicon(lexicon);
const bytes = Buffer.from(buffer);
const gzipped = zlib.gzipSync(bytes, { level: 9 });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'lexicon.bin.gz'), gzipped);
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
fs.writeFileSync(path.join(OUT, 'lexicon.json'), JSON.stringify({
    ...manifest, source: 'Heami pronunciations + V1 native IPA + V1-method zipf',
    bin: { file: 'lexicon.bin.gz', gzip_bytes: gzipped.length, gzip_sha256: sha256(gzipped), bytes: bytes.length, sha256: sha256(bytes) },
}));

// Verify: the deserialized lexicon must search identically to the in-memory one.
const restoredBytes = zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'lexicon.bin.gz')));
const restored = Engine.deserializeLexicon(manifest, restoredBytes.buffer.slice(restoredBytes.byteOffset, restoredBytes.byteOffset + restoredBytes.byteLength));
const isVowel = p => Boolean(phonetics.ipaFeatures[p]);
const request = (query, lex, languages) => {
    const index = lex.words.indexOf(query);
    const pick = name => { const { offsets, ids } = lex.layers[name]; return [...ids.slice(offsets[index], offsets[index + 1])]
        .map(id => [...lex.seqData.slice(lex.seqOffset[id], lex.seqOffset[id + 1])].map(p => lex.phonemes[p])); };
    const isKorean = lex.lang[index] === 0;
    const native = isKorean ? pick('ko')[0] : (pick('native')[0] || pick('koreanized')[0]);
    return { query, languages, mode: 'hybrid', vowelWeight: 2.5, consonantWeight: 1, frequencyWeight: 1, isVowel,
        queryPhonemes: { native, korean: isKorean ? pick('ko') : undefined, koreanized: isKorean ? undefined : pick('koreanized') } };
};
const checks = [];
for (const [query, languages] of [['사랑', ['ko', 'en']], ['바람', ['ko']], ['time', ['ko', 'en']], ['love', ['en']]]) {
    const t0 = Date.now();
    const a = Engine.search(lexicon, request(query, lexicon, languages));
    const t1 = Date.now();
    const b = Engine.search(restored, request(query, restored, languages));
    const same = a.length === b.length && a.words.every((w, i) => w === b.words[i] && a.scores[i] === b.scores[i]);
    checks.push({ query, languages: languages.join('+'), results: a.length, same, ms: t1 - t0,
        top: [...a.words.slice(0, 8)].map((w, i) => `${lexicon.words[w]}(${a.scores[i].toFixed(1)})`).join(' ') });
}
console.log(JSON.stringify({
    words: lexicon.words.length, v1_words: v1Count, corpus_only_words: lexicon.words.length - v1Count,
    sequences: manifest.sequence_count, phonemes: manifest.phonemes.length,
    v1_ko_without_heami: missing.ko, v1_en_without_heami: missing.en,
    bytes: bytes.length, gzip_bytes: gzipped.length, build_ms: Date.now() - started, checks,
}, null, 2));
if (!checks.every(check => check.same)) process.exitCode = 1;
