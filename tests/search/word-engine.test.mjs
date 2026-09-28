import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
    const ctx = vm.createContext({ TextEncoder, TextDecoder });
    ctx.globalThis = ctx;
    vm.runInContext(fs.readFileSync('public/js/search/word-engine.js', 'utf8'), ctx);
    return ctx.RhymeWordEngine;
}

const VOWELS = new Set(['a', 'i', 'o', 'ʌ']);
const isVowel = p => VOWELS.has(p);
// Toy phoneme model: same class 0.5, identical 1, vowel vs consonant 0.
const similarity = (a, b) => (isVowel(a) === isVowel(b) ? 0.5 : 0);

function toyLexicon(Engine) {
    return Engine.buildLexicon([
        { word: '가나', lang: 'ko', zipf: 5, ko: [['k', 'a', 'n', 'a']] },
        { word: '다나', lang: 'ko', zipf: 2, ko: [['t', 'a', 'n', 'a']] },
        { word: '기니', lang: 'ko', zipf: null, ko: [['k', 'i', 'n', 'i']] },
        { word: 'canna', lang: 'en', zipf: 3, native: [['k', 'a', 'n', 'ʌ']], koreanized: [['k', 'a', 'n', 'a']] },
        { word: 'tuna', lang: 'en', zipf: 4, native: [['t', 'o', 'n', 'ʌ']], koreanized: [['t', 'o', 'n', 'a']] },
    ], similarity, isVowel);
}

const baseRequest = { query: '카나', languages: ['ko', 'en'], mode: 'hybrid', vowelWeight: 2.5, consonantWeight: 1,
    frequencyWeight: 1, queryPhonemes: { native: ['k', 'a', 'n', 'a'], korean: [['k', 'a', 'n', 'a']] }, isVowel };
const rows = (lexicon, results) => Array.from(results.words, (w, i) => [lexicon.words[w], results.scores[i]]);

test('re-ranking cached phonetic scores equals a fresh search for any frequency/topic', () => {
    const Engine = load();
    const lexicon = toyLexicon(Engine);
    const raw = Engine.scoreRaw(lexicon, baseRequest);
    for (const frequencyWeight of [0, 5, 10]) {
        for (const topic of [null, { weight: 7, similarity: w => (w === 1 ? null : w / 10) }]) {
            const request = { ...baseRequest, frequencyWeight, topic };
            assert.deepEqual(rows(lexicon, Engine.rank(lexicon, raw, request)), rows(lexicon, Engine.search(lexicon, request)));
        }
    }
    const withTopic = Engine.search(lexicon, { ...baseRequest, topic: { weight: 5, similarity: w => (w === 1 ? null : 0) } });
    assert.ok(!rows(lexicon, withTopic).some(([word]) => word === '다나'), 'a word without a topic vector is excluded (V1)');
});

test('explain reports the winning pronunciation with the same score the search used', () => {
    const Engine = load();
    const lexicon = toyLexicon(Engine);
    for (const mode of ['hybrid', 'native', 'koreanized']) {
        const request = { ...baseRequest, mode };
        const results = Engine.search(lexicon, request);
        for (let i = 0; i < results.length; i += 1) {
            const explained = Engine.explain(lexicon, results.words[i], request);
            assert.equal(explained.score, results.raws[i], `${mode} ${lexicon.words[results.words[i]]}`);
        }
    }
    const canna = lexicon.words.indexOf('canna');
    assert.equal(Engine.explain(lexicon, canna, { ...baseRequest, mode: 'native' }).label, 'native');
    assert.equal(Engine.explain(lexicon, canna, { ...baseRequest, mode: 'koreanized' }).label, 'koreanized');
    assert.equal(Engine.explain(lexicon, canna, baseRequest).target.join(' '), 'k a n a', 'hybrid picks the exact Korean-style match');
});

test('vowel-only, exclusions, the query itself and the language filter', () => {
    const Engine = load();
    const lexicon = toyLexicon(Engine);
    const vowelOnly = rows(lexicon, Engine.search(lexicon, { ...baseRequest, languages: ['ko'], vowelsOnly: true, frequencyWeight: 0 }));
    assert.deepEqual(vowelOnly.slice(0, 2), [['가나', 100], ['다나', 100]], 'consonants are ignored');
    const excluded = rows(lexicon, Engine.search(lexicon, { ...baseRequest, excludeWords: ['나'] })).map(([word]) => word);
    assert.ok(!excluded.includes('가나') && !excluded.includes('다나'));
    const self = rows(lexicon, Engine.search(lexicon, { ...baseRequest, query: '가나' })).map(([word]) => word);
    assert.ok(!self.includes('가나'), 'the query word itself is skipped');
    const english = rows(lexicon, Engine.search(lexicon, { ...baseRequest, languages: ['en'] })).map(([word]) => word);
    assert.deepEqual(english.sort(), ['canna', 'tuna']);
});

test('the serialized lexicon searches identically', () => {
    const Engine = load();
    const lexicon = toyLexicon(Engine);
    const { manifest, buffer } = Engine.serializeLexicon(lexicon);
    const restored = Engine.deserializeLexicon(JSON.parse(JSON.stringify(manifest)), buffer.slice(0));
    for (const mode of ['hybrid', 'native', 'koreanized']) {
        const request = { ...baseRequest, mode, frequencyWeight: 7 };
        assert.deepEqual(rows(restored, Engine.search(restored, request)), rows(lexicon, Engine.search(lexicon, request)));
    }
});

test('detail weights move to the Korean-style reading by pairing similar sounds', () => {
    const Engine = load();
    const vowels = new Set(['ʌ', 'aɪ', 'oʊ', 'a', 'i', 'o', 'ɯ']);
    const liquids = new Set(['l', 'ɾ']);
    // Identical 1, the two liquids 1, other consonant pairs 0.46, vowels 0.5, vowel vs consonant 0.
    const similarity = (a, b) => (vowels.has(a) !== vowels.has(b) ? 0
        : liquids.has(a) && liquids.has(b) ? 1 : vowels.has(a) ? 0.5 : 0.46);
    const lexicon = Engine.buildLexicon([
        { word: 'love', lang: 'en', native: [['l', 'ʌ', 'v']], koreanized: [['ɾ', 'ʌ', 'p', 'ɯ']] },
        { word: 'time', lang: 'en', native: [['t', 'aɪ', 'm']], koreanized: [['tʰ', 'a', 'i', 'm']] },
        { word: 'flow', lang: 'en', native: [['f', 'l', 'oʊ']], koreanized: [['pʰ', 'ɯ', 'l', 'ɾ', 'o']] },
    ], similarity, p => vowels.has(p));
    const transfer = Engine.alignedTransfer(lexicon);
    const move = (detail, source, target) => transfer(detail, source.split(' '), target.split(' ')).join(',');
    assert.equal(move([1, 10, 1], 'l ʌ v', 'ɾ ʌ p ɯ'), '1,10,1,1', 'the vowel weight stays on the vowel (V1 put it on p)');
    assert.equal(move([1, 1, 10], 'l ʌ v', 'ɾ ʌ p ɯ'), '1,1,10,10', 'the added ㅡ follows the consonant before it');
    assert.equal(move([1, 10, 1], 't aɪ m', 'tʰ a i m'), '1,10,10,1', 'a split vowel gives both halves the weight');
    assert.equal(move([10, 5, 1], 'f l oʊ', 'pʰ ɯ l ɾ o'), '10,10,5,5,1', 'both ㄹ of 플로 follow l');
    assert.equal(move([3, 1, 7], 'l ʌ v', 'l ʌ v'), '3,1,7', 'identical readings keep the weights');
});
