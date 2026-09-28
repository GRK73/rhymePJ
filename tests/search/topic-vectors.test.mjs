import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
    const ctx = vm.createContext({});
    ctx.globalThis = ctx;
    vm.runInContext(fs.readFileSync('public/js/search/topic-vectors.js', 'utf8'), ctx);
    return ctx.RhymeTopicVectors;
}

// Packs rows of signed 4-bit values (-7..7) two per byte, as build_topic_vectors.py does.
const pack = rows => Uint8Array.from(rows.flatMap(row => {
    const bytes = [];
    for (let d = 0; d < row.length; d += 2) bytes.push(((row[d] + 8) << 4) | (row[d + 1] + 8));
    return bytes;
}));
const manifest = count => ({ schema_version: 2, bits: 4, dims: 4, count });
const round = values => Array.from(values, value => Math.round(value * 1000) / 1000);

test('topic similarity is the cosine of the packed 4-bit rows, whatever their per-row scale', () => {
    const { TopicVectors } = load();
    // w0 and w1 point the same way at different scales, w2 is orthogonal, w3 opposite, w4 at 60 degrees.
    const rows = [[7, 0, 0, 0], [3, 0, 0, 0], [0, 7, 0, 0], [-7, 0, 0, 0], [4, 7, 0, 0]];
    const vectors = new TopicVectors(manifest(5), pack(rows).buffer);
    assert.deepEqual(round(vectors.similarities(0)), [1, 1, 0, -1, 0.496]);
    assert.equal(Math.round(vectors.cosine(2, 4) * 1000) / 1000, 0.868);
});

test('linked rows extend the numbering; bad sizes and old formats are refused', () => {
    const { TopicVectors } = load();
    const vectors = new TopicVectors(manifest(1), pack([[7, 0, 0, 0]]).buffer);
    vectors.extend(1, pack([[0, 0, -7, 7]]).buffer);
    assert.equal(vectors.count, 2);
    assert.deepEqual(round(vectors.similarities(1)), [0, 1]);
    assert.throws(() => new TopicVectors(manifest(2), new Uint8Array(3).buffer));
    assert.throws(() => new TopicVectors({ schema_version: 1, dims: 2, count: 1 }, new Int8Array(2).buffer));
});
