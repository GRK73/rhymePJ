// Linked-search data for the V2 engine (public/js/search/linked-engine.js).
//   Korean: every bigram surface (사랑을) with its Heami pronunciation, normalized form
//           (사랑), zipf, topic vector row, and the surfaces seen after it.
// The bigrams only say which pairs exist; their counts are not part of the score.
//   English: bigram heads and followers as word-lexicon ids; their pronunciations are
//           the lexicon's native and Korean-style layers.
// Phoneme ids are the word lexicon's, so both engines share one kernel.
//
// Inputs: public/assets/lexicon/v1, public/assets/topic/v1/topic.json,
//         data/derived/linked/v1/{surfaces.tsv, zipf.json} (build_linked_surfaces.mjs,
//         build_linked_frequencies.py), data/derived/semantic_labse/v0-linked/words.tsv,
//         data/source/{bigram_surface_ko.json, bigram_next_en.json}
// Output: public/assets/linked/v2/{linked.json, linked.bin.gz}
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ZIPF_SCALE = 10000, ZIPF_MISSING = -2147483648;

const context = { TextEncoder, TextDecoder };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(read('public/js/search/word-engine.js').toString('utf8'), context);
const Engine = context.RhymeWordEngine;
const lexiconManifest = JSON.parse(read('public/assets/lexicon/v1/lexicon.json'));
const lexiconBytes = zlib.gunzipSync(read(`public/assets/lexicon/v1/${lexiconManifest.bin.file}`));
const lexicon = Engine.deserializeLexicon(lexiconManifest, lexiconBytes.buffer.slice(lexiconBytes.byteOffset, lexiconBytes.byteOffset + lexiconBytes.length));
const wordIndex = new Map();
lexicon.words.forEach((word, w) => {
    const key = `${lexicon.lang[w]}\t${word.toLowerCase()}`;
    if (!wordIndex.has(key)) wordIndex.set(key, w);
});

// ---- Korean surfaces ---------------------------------------------------------------
const rows = read('data/derived/linked/v1/surfaces.tsv').toString('utf8').split('\n').filter(Boolean).map(line => line.split('\t'));
const surfaces = rows.map(row => row[0]);
const surfaceId = new Map(surfaces.map((surface, id) => [surface, id]));
const zipfTable = JSON.parse(read('data/derived/linked/v1/zipf.json'));
const pronOffsets = new Uint32Array(surfaces.length + 1);
const pronData = [];
const norm = new Int32Array(surfaces.length).fill(-1);
const zipf = new Int32Array(surfaces.length);
rows.forEach(([surface, phonemes, normalized], id) => {
    for (const phoneme of phonemes.split(' ')) {
        const index = lexicon.phonemeIndex.get(phoneme);
        if (index === undefined) throw new Error(`phoneme ${phoneme} of ${surface} is not in the lexicon inventory`);
        pronData.push(index);
    }
    pronOffsets[id + 1] = pronData.length;
    if (normalized) norm[id] = surfaceId.get(normalized);
    const value = zipfTable[surface];
    zipf[id] = value === null || value === undefined ? ZIPF_MISSING : Math.round(value * ZIPF_SCALE);
});

// Topic rows: the meaning word (normalized form, else the surface) in the lexicon, else in
// the linked extra vectors (rows after the lexicon's).
const topicManifest = JSON.parse(read('public/assets/topic/v1/topic.json'));
if (topicManifest.lexicon_sha256 !== lexiconManifest.bin.sha256) throw new Error('topic vectors were built for another lexicon');
const extraText = read('data/derived/semantic_labse/v0-linked/words.tsv').toString('utf8');
const extraWords = extraText.split('\n').filter(Boolean).map(line => line.split('\t').slice(0, 2));
if (!topicManifest.linked || topicManifest.linked.words_sha256 !== sha256(extraWords.map(w => w.join('\t')).join('\n'))) {
    throw new Error('topic.json has no linked vectors for these words; run build_topic_vectors.py --extra');
}
const extraRow = new Map(extraWords.map(([, word], k) => [word, topicManifest.count + k]));
const topicRow = Int32Array.from(surfaces, (surface, id) => {
    const meaning = norm[id] >= 0 ? surfaces[norm[id]] : surface;
    return wordIndex.get(`${Engine.LANG.ko}\t${meaning}`) ?? extraRow.get(meaning) ?? -1;
});
const collator = new Intl.Collator('ko');
const order = new Uint32Array(surfaces.length);
Array.from(surfaces.keys()).sort((a, b) => collator.compare(surfaces[a], surfaces[b])).forEach((id, rank) => { order[id] = rank; });

// ---- Korean bigrams (CSR over surfaces) -------------------------------------------
const surfaceSource = JSON.parse(read('data/source/bigram_surface_ko.json'));
const koEntries = surfaceSource.entries || surfaceSource;
const koLists = Array.from({ length: surfaces.length }, () => null);
for (const [head, payload] of Object.entries(koEntries)) {
    const followers = Array.isArray(payload?.[1]) ? payload[1] : [];
    koLists[surfaceId.get(head)] = followers.map(row => surfaceId.get(String(row[0])));
}
const koOffsets = new Uint32Array(surfaces.length + 1);
const koTarget = [];
koLists.forEach((list, id) => {
    for (const target of list || []) koTarget.push(target);
    koOffsets[id + 1] = koTarget.length;
});

// ---- English bigrams (CSR over lexicon words) --------------------------------------
const englishSource = JSON.parse(read('data/source/bigram_next_en.json'));
const enEntries = englishSource.entries || englishSource;
const enHeads = [], enOffsets = [0], enTarget = [];
let enSkipped = 0;
for (const [head, followers] of Object.entries(enEntries)) {
    const w = wordIndex.get(`${Engine.LANG.en}\t${head.toLowerCase()}`);
    if (w === undefined) { enSkipped += 1; continue; }
    for (const row of followers) {
        const t = wordIndex.get(`${Engine.LANG.en}\t${String(row[0]).toLowerCase()}`);
        if (t === undefined) { enSkipped += 1; continue; }
        enTarget.push(t);
    }
    if (enTarget.length > enOffsets.at(-1)) { enHeads.push(w); enOffsets.push(enTarget.length); }
}

// ---- Serialize ---------------------------------------------------------------------
const sections = [
    ['surfaces', new TextEncoder().encode(surfaces.join('\n'))],
    ['pron.offsets', pronOffsets], ['pron.data', Uint8Array.from(pronData)], ['norm', norm], ['zipf', zipf],
    ['topicRow', topicRow], ['order', order],
    ['ko.offsets', koOffsets], ['ko.target', Uint32Array.from(koTarget)],
    ['en.heads', Int32Array.from(enHeads)], ['en.offsets', Uint32Array.from(enOffsets)], ['en.target', Int32Array.from(enTarget)],
];
let size = 0;
const layout = sections.map(([name, array]) => {
    const entry = { name, type: array.constructor.name, offset: size, length: array.length };
    size += Math.ceil(array.byteLength / 8) * 8;
    return entry;
});
const buffer = Buffer.alloc(size);
sections.forEach(([, array], index) => Buffer.from(array.buffer, array.byteOffset, array.byteLength).copy(buffer, layout[index].offset));
const packed = zlib.gzipSync(buffer, { level: 9 });
const out = path.join(ROOT, 'public/assets/linked/v2');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'linked.bin.gz'), packed);
const manifest = {
    schema_version: 1, zipf_scale: ZIPF_SCALE, lexicon_sha256: lexiconManifest.bin.sha256,
    topic_linked_sha256: topicManifest.linked.bin.sha256,
    counts: { surfaces: surfaces.length, ko_heads: koLists.filter(list => list?.length).length, ko_rows: koTarget.length,
        en_heads: enHeads.length, en_rows: enTarget.length, en_skipped: enSkipped,
        topic_rows_missing: topicRow.filter(row => row < 0).length },
    sections: layout,
    bin: { file: 'linked.bin.gz', gzip_bytes: packed.length, gzip_sha256: sha256(packed), bytes: buffer.length, sha256: sha256(buffer) },
};
fs.writeFileSync(path.join(out, 'linked.json'), `${JSON.stringify(manifest)}\n`);
console.log(JSON.stringify({ counts: manifest.counts, gzip_mb: +(packed.length / 1e6).toFixed(1), raw_mb: +(buffer.length / 1e6).toFixed(1) }));
