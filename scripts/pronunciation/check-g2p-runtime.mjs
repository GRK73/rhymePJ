// Check the browser G2P runtime against PyTorch greedy predictions and time it.
// Usage: node scripts/pronunciation/check-g2p-runtime.mjs <model-dir> <preds.json>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [modelDir, predsPath] = process.argv.slice(2);
const context = { Float32Array, Math, Map, Array, Object, URL, Error, JSON };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js/search/g2p-heami.js'), 'utf8'), context);

const manifest = JSON.parse(fs.readFileSync(path.join(modelDir, 'manifest.json'), 'utf8'));
const bytes = fs.readFileSync(path.join(modelDir, 'weights.bin'));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const model = new context.RhymeHeamiG2P.HeamiG2P(manifest, buffer);
const expected = JSON.parse(fs.readFileSync(predsPath, 'utf8'));

let same = 0;
const mismatches = [];
const started = process.hrtime.bigint();
for (const row of expected) {
    const actual = model.predict(row.word);
    if (actual.join(' ') === row.phonemes.join(' ')) same += 1;
    else if (mismatches.length < 10) mismatches.push({ word: row.word, torch: row.phonemes.join(' '), js: actual.join(' ') });
}
const ms = Number(process.hrtime.bigint() - started) / 1e6;
console.log(JSON.stringify({ count: expected.length, identical: same, rate: same / expected.length,
    ms_per_word: ms / expected.length, mismatches }, null, 2));
if (same !== expected.length) process.exitCode = 1;
