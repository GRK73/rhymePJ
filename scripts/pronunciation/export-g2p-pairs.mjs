// Export (word, phonemes) training pairs for the Heami imitation model.
//   ko: final table form (normalized Heami reading + coda restoration).
//   en: Heami's reading of the English spelling itself. The loanword substitution
//       used by the lookup table is not learned; a word without a table entry has
//       no loanword spelling either.
// Split is deterministic by word hash: 90% train / 5% dev / 5% test.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeHeamiEvents, parseRawLine, restoreCodas } from './heami-normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = path.join(ROOT, 'data/derived/pronunciations_heami/v0');
const OUTPUT = path.join(ROOT, 'data/derived/g2p_heami/v1');
const RAW_FILES = ['heami_raw.tsv', 'heami_raw_corpus.tsv'];
const MAX_WORD_LENGTH = 32;

function split(word) {
    const bucket = crypto.createHash('sha1').update(word).digest().readUInt16BE(0) % 100;
    return bucket < 90 ? 'train' : bucket < 95 ? 'dev' : 'test';
}

fs.mkdirSync(OUTPUT, { recursive: true });
const writers = {};
const counts = {};
const seen = new Set();
let skipped = 0;
for (const file of RAW_FILES) {
    const full = path.join(SOURCE, file);
    if (!fs.existsSync(full)) { console.warn(`missing ${file}`); continue; }
    for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
        if (!line) continue;
        const { lang, word, events } = parseRawLine(line);
        const key = `${lang}\t${word}`;
        if (seen.has(key) || (lang !== 'ko' && lang !== 'en')) continue;
        seen.add(key);
        const normalized = normalizeHeamiEvents(events);
        const phonemes = lang === 'ko' ? restoreCodas(word, normalized.phonemes).phonemes : normalized.phonemes;
        if (!phonemes.length || normalized.unknown.length || [...word].length > MAX_WORD_LENGTH
            || /[\t\s]/.test(word)) { skipped += 1; continue; }
        const part = split(word);
        const name = `${lang}.${part}.tsv`;
        writers[name] ||= [];
        writers[name].push(`${word}\t${phonemes.join(' ')}`);
        counts[name] = (counts[name] || 0) + 1;
    }
}
for (const [name, lines] of Object.entries(writers)) fs.writeFileSync(path.join(OUTPUT, name), lines.join('\n') + '\n');
console.log(JSON.stringify({ counts, skipped }, null, 2));
