import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
    const ctx = vm.createContext({});
    ctx.globalThis = ctx;
    vm.runInContext(fs.readFileSync('public/js/search/word-query.js', 'utf8'), ctx);
    return ctx.RhymeWordQuery;
}

const split = (word, phonemes) => {
    const list = phonemes.split(' ');
    return load().syllableMap(word, list, 0).map(item => `${item.char}:${list.slice(item.startIndex, item.endIndex).join('')}`).join(' ');
};

test('Korean detail sliders keep each sound with the written syllable it comes from', () => {
    // 연음: the final consonant moves to the next syllable in speech but stays with its syllable.
    assert.equal(split('맛있다', 'm a t i t t* a'), '맛:mat 있:it 다:t*a');
    assert.equal(split('사람이', 's a ɾ a m i'), '사:sa 람:ɾam 이:i');
    assert.equal(split('괜찮아', 'k wɛ n tɕʰ a n a'), '괜:kwɛn 찮:tɕʰan 아:a');
    assert.equal(split('없어', 'ʌ p s* ʌ'), '없:ʌps* 어:ʌ');
    // Assimilation, tensing and liquids: final stays, onset goes to the next syllable.
    assert.equal(split('국가', 'k u k k* a'), '국:kuk 가:k*a');
    assert.equal(split('신라', 's i l ɾ a'), '신:sil 라:ɾa');
    assert.equal(split('읽는', 'i ŋ n ɯ n'), '읽:iŋ 는:nɯn');
    // Merged sounds belong to the syllable they are pronounced with.
    assert.equal(split('좋다', 'tɕ o tʰ a'), '좋:tɕo 다:tʰa');
});

test('without a vowel-per-syllable alignment the sounds are spread over the written syllables', () => {
    assert.equal(split('가나다', 'k a n a t a t a'), '가:ka 나:nat 다:ata');
});

test('numbers outside the lexicon are left out and reported, never guessed', async () => {
    const lexicon = { words: ['y2k'], lang: new Uint8Array([1]) };
    const lexiconLayer = { native: [['w', 'aɪ', 't', 'u', 'k', 'eɪ']], koreanized: [['w', 'a', 'i', 'tʰ', 'u', 'kʰ', 'e', 'i']] };
    const resolver = new (load().QueryResolver)(lexicon, {
        loadModel: async () => ({ predict: word => word.split('').map(() => 'a') }),
        jamoPhonemes: () => ({ phonemes: [], charMap: [] }),
    });
    resolver.layer = (name, w) => [lexiconLayer[name][w]];
    const only = await resolver.resolve('123');
    assert.deepEqual([only.phonemes.length, [...only.skipped]], [0, ['123']]);
    const mixed = await resolver.resolve('love 2 you');
    assert.deepEqual([[...mixed.tokens], [...mixed.skipped]], [['love', 'you'], ['2']]);
    const known = await resolver.resolve('y2k');
    assert.deepEqual([[...known.sources], [...known.skipped]], [['lexicon'], []]);
});
