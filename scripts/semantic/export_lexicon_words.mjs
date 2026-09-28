// Writes the word lexicon as `lang\tword\tzipf` lines in lexicon order (the input of
// embed_labse.py and the alignment check of build_topic_vectors.py).
// Usage: node scripts/semantic/export_lexicon_words.mjs OUT.tsv
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2];
if (!out) throw new Error('usage: export_lexicon_words.mjs OUT.tsv');
const context = { TextEncoder, TextDecoder };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js/search/word-engine.js'), 'utf8'), context);
const Engine = context.RhymeWordEngine;
const dir = path.join(ROOT, 'public/assets/lexicon/v1');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'lexicon.json'), 'utf8'));
const bytes = zlib.gunzipSync(fs.readFileSync(path.join(dir, manifest.bin.file)));
const lexicon = Engine.deserializeLexicon(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
const lines = lexicon.words.map((word, w) => `${lexicon.lang[w] === Engine.LANG.ko ? 'ko' : 'en'}\t${word}\t${Number.isNaN(lexicon.zipf[w]) ? '' : lexicon.zipf[w]}`);
fs.writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`${lines.length} words -> ${out}`);
