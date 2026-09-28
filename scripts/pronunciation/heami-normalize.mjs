// Convert raw Heami (Windows ko-KR voice) phoneme events into the project's
// Korean phoneme inventory (the one produced by koreanPronunciation.js):
// tense = "*" suffix, aspirated = "ʰ", affricates without tie bar, glide+vowel
// merged into one diphthong, onset ㄹ = "ɾ", coda ㄹ = "l".

const SIMPLE_VOWELS = new Set(['a', 'ɛ', 'ʌ', 'e', 'o', 'u', 'ɯ', 'i']);
const DIPHTHONGS = new Map([
    ['j', new Map([['a', 'ja'], ['ɛ', 'jɛ'], ['ʌ', 'jʌ'], ['e', 'je'], ['o', 'jo'], ['u', 'ju']])],
    ['w', new Map([['a', 'wa'], ['ɛ', 'wɛ'], ['e', 'we'], ['ʌ', 'wʌ'], ['i', 'wi']])],
    ['ɰ', new Map([['i', 'ɰi']])],
]);
// Allophones Heami distinguishes but the project inventory does not.
const CONSONANT_MAP = new Map([
    ['b', 'p'], ['d', 't'], ['g', 'k'], ['ɡ', 'k'],
    ['ɦ', 'h'], ['ç', 'h'], ['x', 'h'], ['ɸ', 'h'],
    ['ɕ', 's'], ['ɕ*', 's*'],
    ['ɲ', 'n'], ['ʎ', 'l'],
    ['t͡ɕ', 'tɕ'], ['d͡ʑ', 'tɕ'], ['t͡ɕʰ', 'tɕʰ'], ['t͡ɕ*', 'tɕ*'],
]);
const VOWEL_MAP = new Map([['ø', 'we'], ['y', 'wi']]);
const IGNORED = new Set(['\u0004', '', '̚']);

export const PROJECT_KOREAN_PHONEMES = new Set([
    'k', 'k*', 'kʰ', 'n', 't', 't*', 'tʰ', 'ɾ', 'l', 'm', 'p', 'p*', 'pʰ', 's', 's*',
    'tɕ', 'tɕ*', 'tɕʰ', 'h', 'ŋ',
    'a', 'ɛ', 'ʌ', 'e', 'o', 'u', 'ɯ', 'i',
    'ja', 'jɛ', 'jʌ', 'je', 'jo', 'ju', 'wa', 'wɛ', 'we', 'wʌ', 'wi', 'ɰi',
]);

const VOWELS = new Set([...SIMPLE_VOWELS, ...[...DIPHTHONGS.values()].flatMap(map => [...map.values()])]);

function isVowel(phoneme) {
    return VOWELS.has(phoneme);
}

// Raw events are single characters; modifiers attach to the previous token and
// the tie bar joins the previous and next characters.
function tokenize(events) {
    const tokens = [];
    let joinNext = false;
    for (const event of events) {
        for (const char of event) {
            if (IGNORED.has(char)) continue;
            if (char === '͡') { joinNext = true; continue; }
            if (char === 'ʰ' && tokens.length) { tokens[tokens.length - 1] += 'ʰ'; continue; }
            if (char === 'ʼ' && tokens.length) { tokens[tokens.length - 1] += '*'; continue; }
            if (joinNext && tokens.length) { tokens[tokens.length - 1] += '͡' + char; joinNext = false; continue; }
            tokens.push(char);
        }
    }
    return tokens;
}

export function normalizeHeamiEvents(events) {
    const mapped = tokenize(events).map(token => VOWEL_MAP.get(token) || CONSONANT_MAP.get(token) || token);
    const merged = [];
    for (let index = 0; index < mapped.length; index += 1) {
        const glide = DIPHTHONGS.get(mapped[index]);
        const vowel = glide?.get(mapped[index + 1]);
        if (vowel) { merged.push(vowel); index += 1; continue; }
        // A glide the inventory cannot combine (e.g. "j i") is absorbed by its vowel.
        if (glide && SIMPLE_VOWELS.has(mapped[index + 1])) continue;
        merged.push(mapped[index]);
    }
    const phonemes = merged.map((phoneme, index) => {
        if (phoneme !== 'l' && phoneme !== 'ɾ') return phoneme;
        return isVowel(merged[index + 1]) ? 'ɾ' : 'l';
    });
    const unknown = [...new Set(phonemes.filter(phoneme => !PROJECT_KOREAN_PHONEMES.has(phoneme)))];
    return { phonemes, unknown };
}

export function parseRawLine(line) {
    const [lang, word, events = ''] = line.split('\t');
    return { lang, word, events: events ? events.split('|') : [] };
}

// Heami merges an obstruent coda into a following tense onset (국가 → k u k* a).
// Restore it from the spelling so syllable structure matches the rule output.
// Representative coda of each final consonant (jongseong index 1..27) after neutralization.
const OBSTRUENT_CODA = ['', 'k', 'k', 'k', '', '', '', 't', '', 'k', '', '', '', '', '', '',
    '', 'p', 'p', 't', 't', '', 't', 't', 'k', 't', 'p', 't'];

function finalConsonants(word) {
    const finals = [];
    for (const char of word) {
        const code = char.codePointAt(0) - 0xac00;
        if (code < 0 || code > 11171) return null;
        finals.push(code % 28);
    }
    return finals;
}

export function restoreCodas(word, phonemes) {
    const finals = finalConsonants(word);
    const vowelIndices = phonemes.flatMap((phoneme, index) => VOWELS.has(phoneme) ? [index] : []);
    if (!finals || vowelIndices.length !== finals.length) return { phonemes, restored: 0, aligned: false };
    const output = [];
    let restored = 0;
    for (let syllable = 0; syllable < vowelIndices.length; syllable += 1) {
        const start = syllable === 0 ? 0 : vowelIndices[syllable - 1] + 1;
        const between = phonemes.slice(start, vowelIndices[syllable]);
        const coda = syllable > 0 ? OBSTRUENT_CODA[finals[syllable - 1]] : '';
        if (coda && between.length === 1 && between[0].endsWith('*')) {
            output.push(coda);
            restored += 1;
        }
        output.push(...between, phonemes[vowelIndices[syllable]]);
    }
    output.push(...phonemes.slice(vowelIndices[vowelIndices.length - 1] + 1));
    return { phonemes: output, restored, aligned: true };
}
