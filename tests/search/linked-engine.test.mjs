import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
    const ctx = vm.createContext({ TextEncoder, TextDecoder });
    ctx.globalThis = ctx;
    vm.runInContext(fs.readFileSync('public/js/search/word-engine.js', 'utf8'), ctx);
    vm.runInContext(fs.readFileSync('public/js/search/linked-engine.js', 'utf8'), ctx);
    return { Engine: ctx.RhymeWordEngine, Linked: ctx.RhymeLinkedEngine };
}

const VOWELS = new Set(['a', 'i', 'o']);
const similarity = (a, b) => (VOWELS.has(a) === VOWELS.has(b) ? 0.5 : 0);

// Korean surfaces with pronunciations; bigram rows head -> [follower, count, score] (only followers are used).
function fixture(Engine) {
    const lexicon = Engine.buildLexicon([
        { word: '가', lang: 'ko', zipf: 5, ko: [['k', 'a']] },
        { word: '나', lang: 'ko', zipf: 5, ko: [['n', 'a']] },
    ], similarity, p => VOWELS.has(p), ['k', 'a', 'n', 'm', 'i', 's', 'o', 't', 'p', 'l']);
    const surfaces = ['사가', '나비', '마니', '가을', '사가는', '소금'];
    const pron = { 사가: 's a k a', 나비: 'n a p i', 마니: 'm a n i', 가을: 'k a i l', 사가는: 's a k a n i n', 소금: 's o k i m' };
    const inventory = lexicon.phonemeIndex;
    for (const p of 'p l'.split(' ')) if (!inventory.has(p)) throw new Error(`fixture phoneme ${p} missing`);
    const ids = surfaces.map(s => pron[s].split(' ').map(p => inventory.get(p)));
    const offsets = [0];
    ids.forEach(list => offsets.push(offsets.at(-1) + list.length));
    const rows = { 0: [[1, 100, 1], [2, 10, 0.1], [3, 5, 0.1]], 4: [[1, 50, 0.5]], 5: [[1, 1, 0.01]] };
    const koOffsets = [0], target = [], count = [], score = [];
    surfaces.forEach((_, h) => {
        for (const [t, c, s] of rows[h] || []) { target.push(t); count.push(c); score.push(s); }
        koOffsets.push(target.length);
    });
    const linked = {
        surfaces, pronOffsets: Uint32Array.from(offsets), pronData: Uint8Array.from(ids.flat()),
        norm: Int32Array.from([-1, -1, -1, -1, 0, -1]), zipf: Float64Array.from([4, 4, 3, 4, 3, 2]),
        topicRow: Int32Array.from([0, 1, 2, 3, 0, 4]), order: Uint32Array.from([3, 1, 0, 2, 4, 5]),
        ko: { offsets: Uint32Array.from(koOffsets), target: Uint32Array.from(target), count: Uint32Array.from(count), score: Float32Array.from(score) },
        en: { heads: new Int32Array(0), offsets: Uint32Array.from([0]), target: new Int32Array(0), count: new Uint32Array(0), score: new Float32Array(0) },
    };
    return { lexicon, linked };
}

const request = (extra = {}) => ({
    languages: ['ko'], mode: 'hybrid', queryPhonemes: { native: ['k', 'a', 'n', 'a'], korean: [['k', 'a', 'n', 'a']] },
    syllables: { chars: ['가', '나'], starts: [0, 2] }, vowelWeight: 2.5, consonantWeight: 1, frequencyWeight: 0,
    excludeWords: [], allowFirstParticle: false, isVowel: p => VOWELS.has(p), ...extra,
});

test('a Korean query splits between syllables and pairs need both sides above 40', () => {
    const { Engine, Linked } = load();
    const { lexicon, linked } = fixture(Engine);
    const raw = Linked.collect(lexicon, linked, request());
    assert.deepEqual(Array.from(raw.splits, split => split.label), ['가 / 나']);
    const pairs = Array.from({ length: raw.length }, (_, i) => `${linked.surfaces[raw.first[i]]}+${linked.surfaces[raw.second[i]]}`);
    // 사가+나비: [가 나] exact; 사가+마니 also sounds close; 사가는 is skipped (first word has a particle).
    assert.ok(pairs.includes('사가+나비'));
    assert.ok(!pairs.some(pair => pair.startsWith('사가는')));
    const i = pairs.indexOf('사가+나비');
    assert.equal(raw.left[i], 100);
    assert.equal(raw.right[i], 100);
    // Boundary is the sound-count weighted mean; no balance or letter-match factor.
    assert.equal(raw.boundary[i], 100);
    const allowed = Linked.collect(lexicon, linked, request({ allowFirstParticle: true }));
    assert.ok(Array.from({ length: allowed.length }, (_, k) => linked.surfaces[allowed.first[k]]).includes('사가는') === false,
        '사가는 ends in n i n, so its end does not match 가');
});

test('the score is pronunciation, then V1 frequency on the pair\'s mean zipf (none at slider 0)', () => {
    const { Engine, Linked } = load();
    const { lexicon, linked } = fixture(Engine);
    const raw = Linked.collect(lexicon, linked, request());
    const ranked = Linked.rank(lexicon, linked, raw, request());
    const top = Linked.describe(lexicon, linked, raw, ranked, 0);
    assert.equal(top.word, '사가 나비');
    assert.equal(top.surfaceDisplay, '사[가 나]비');
    assert.equal(top.score, 100);
    assert.equal(top.zipf, 4);
    // Slider 10: 사가(4) + 나비(4) -> zipf 4 lifts, 마니 pairs (3) drop, exactly as word search.
    const weighted = Linked.rank(lexicon, linked, raw, request({ frequencyWeight: 10 }));
    for (const i of weighted.ids) assert.equal(weighted.scores[i], Engine.applyFrequencyWeight(raw.boundary[i], raw.zipf[i], 10));
});

test('excluded words drop the pair; a topic re-ranks without re-scoring sounds', () => {
    const { Engine, Linked } = load();
    const { lexicon, linked } = fixture(Engine);
    const excluded = Linked.collect(lexicon, linked, request({ excludeWords: ['나비'] }));
    assert.ok(!Array.from(excluded.second).includes(1));
    const raw = Linked.collect(lexicon, linked, request());
    // Topic rows: 0 사가, 1 나비, 2 마니, 3 가을; make 마니 on topic and 나비 off topic.
    const topic = { weight: 10, similarity: Float32Array.from([0, -1, 1, 0, 0]), cosine: () => 0 };
    const ranked = Linked.rank(lexicon, linked, raw, request({ topic }));
    const words = Array.from(ranked.ids, i => `${linked.surfaces[raw.first[i]]}+${linked.surfaces[raw.second[i]]}`);
    assert.ok(words.indexOf('사가+마니') < words.indexOf('사가+나비'));
});
