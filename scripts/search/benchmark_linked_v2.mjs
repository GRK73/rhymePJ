// Linked-search engine on the real assets in Node: timing and top results.
// Usage: node scripts/search/benchmark_linked_v2.mjs [query:lang:mode ...]
//   default: 사랑해:ko:hybrid whatever:en:hybrid 사랑해:all:hybrid time:all:koreanized
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const context = { TextEncoder, TextDecoder, Float32Array, Math, Map, Array, Object, URL, Error, JSON };
context.globalThis = context;
vm.createContext(context);
for (const file of ['word-engine.js', 'word-query.js', 'g2p-heami.js', 'linked-engine.js', 'topic-vectors.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js/search', file), 'utf8'), context, { filename: file });
}
const { RhymeWordEngine: Engine, RhymeWordQuery: Query, RhymeHeamiG2P: G2P, RhymeLinkedEngine: Linked, RhymeTopicVectors: Topic } = context;
const asset = (dir, name) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets', dir, name), 'utf8'));
    const file = manifest.bin || manifest.weights;
    const bytes = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'public/assets', dir, file.file)));
    return { manifest, buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
};
let t = performance.now();
const lex = asset('lexicon/v1', 'lexicon.json');
const lexicon = Engine.deserializeLexicon(lex.manifest, lex.buffer);
const lk = asset('linked/v2', 'linked.json');
const linked = Linked.deserializeLinked(lk.manifest, lk.buffer);
console.log(`load ${Math.round(performance.now() - t)} ms`);
const resolver = new Query.QueryResolver(lexicon, {
    loadModel: async lang => { const m = asset(`g2p/v1/${lang}`, 'model.json'); return new G2P.HeamiG2P(m.manifest, m.buffer); },
    jamoPhonemes: () => { throw new Error('jamo input not supported here'); },
});
const topicWord = process.env.TOPIC;
let topic = null;
if (topicWord) {
    const tp = asset('topic/v1', 'topic.json');
    const vectors = new Topic.TopicVectors(tp.manifest, tp.buffer);
    const extra = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'public/assets/topic/v1', tp.manifest.linked.bin.file)));
    vectors.extend(tp.manifest.linked.count, extra.buffer.slice(extra.byteOffset, extra.byteOffset + extra.length));
    const w = resolver.lookup(/[가-힣]/.test(topicWord) ? 0 : 1, topicWord);
    topic = { weight: Number(process.env.TOPIC_WEIGHT || 5), similarity: vectors.similarities(w), cosine: (a, b) => vectors.cosine(a, b) };
}
const cases = process.argv.slice(2).length ? process.argv.slice(2) : ['사랑해:ko:hybrid', 'whatever:en:hybrid', '사랑해:all:hybrid', 'time:all:koreanized'];
for (const spec of cases) {
    const [query, lang, mode] = spec.split(':');
    const resolved = await resolver.resolve(query);
    const syllables = resolved.koreanPronunciationCandidates && resolved.charMap.length
        ? { chars: resolved.charMap.map(c => c.char), starts: resolved.charMap.map(c => c.startIndex) } : null;
    const request = { languages: lang === 'all' ? ['ko', 'en'] : [lang], mode, queryPhonemes: Query.toEngineQuery(resolved),
        detail: new Array(resolved.phonemes.length).fill(1), syllables, vowelWeight: 2.5, consonantWeight: 1, frequencyWeight: 1,
        excludeWords: [], allowFirstParticle: false, isVowel: () => false, topic };
    t = performance.now();
    Linked.collect(lexicon, linked, request);
    const cold = performance.now() - t;
    t = performance.now();
    const raw = Linked.collect(lexicon, linked, request);
    const collected = performance.now() - t;
    t = performance.now();
    const ranked = Linked.rank(lexicon, linked, raw, request);
    const ranking = performance.now() - t;
    const top = Array.from({ length: Math.min(12, ranked.length) }, (_, i) => Linked.describe(lexicon, linked, raw, ranked, i));
    console.log(`\n${spec} [${resolved.phonemes.join(' ')}] splits=${raw.splits.length} pairs=${raw.length} collect=${Math.round(collected)}ms (first ${Math.round(cold)}ms) rank=${Math.round(ranking)}ms`);
    for (const item of top) console.log(`  ${item.score.toFixed(1)}  ${item.surfaceDisplay}  (${item.splitLabel}) L${item.leftScore.toFixed(0)} R${item.rightScore.toFixed(0)} p${item.pronunciationScore.toFixed(0)} z${item.zipf.toFixed(1)}${item.topicSimilarity === null ? '' : ` t${item.topicSimilarity.toFixed(2)}`}`);
}
