const KO_INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const KO_MEDIALS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const KO_FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const EMPTY_ONSET = 'ㅇ';
const STANDARD_PRONUNCIATION_CACHE = new Map();

const FINAL_REPRESENTATIVE = {
    'ㄱ': 'ㄱ', 'ㄲ': 'ㄱ', 'ㅋ': 'ㄱ', 'ㄳ': 'ㄱ', 'ㄺ': 'ㄱ',
    'ㄴ': 'ㄴ', 'ㄵ': 'ㄴ', 'ㄶ': 'ㄴ',
    'ㄷ': 'ㄷ', 'ㅅ': 'ㄷ', 'ㅆ': 'ㄷ', 'ㅈ': 'ㄷ', 'ㅊ': 'ㄷ', 'ㅌ': 'ㄷ', 'ㅎ': 'ㄷ',
    'ㄹ': 'ㄹ', 'ㄼ': 'ㄹ', 'ㄽ': 'ㄹ', 'ㄾ': 'ㄹ', 'ㅀ': 'ㄹ',
    'ㅁ': 'ㅁ', 'ㄻ': 'ㅁ',
    'ㅂ': 'ㅂ', 'ㅍ': 'ㅂ', 'ㄿ': 'ㅂ', 'ㅄ': 'ㅂ',
    'ㅇ': 'ㅇ'
};

const CLUSTER_LIAISON = {
    'ㄳ': ['ㄱ', 'ㅆ'],
    'ㄵ': ['ㄴ', 'ㅈ'],
    'ㄶ': ['ㄴ', ''],
    'ㄺ': ['ㄹ', 'ㄱ'],
    'ㄻ': ['ㄹ', 'ㅁ'],
    'ㄼ': ['ㄹ', 'ㅂ'],
    'ㄽ': ['ㄹ', 'ㅆ'],
    'ㄾ': ['ㄹ', 'ㅌ'],
    'ㄿ': ['ㄹ', 'ㅍ'],
    'ㅀ': ['ㄹ', ''],
    'ㅄ': ['ㅂ', 'ㅆ']
};

const TENSE_ONSETS = {
    'ㄱ': 'ㄲ',
    'ㄷ': 'ㄸ',
    'ㅂ': 'ㅃ',
    'ㅅ': 'ㅆ',
    'ㅈ': 'ㅉ'
};

const H_ASPIRATION_NEXT = {
    'ㄱ': 'ㅋ',
    'ㄷ': 'ㅌ',
    'ㅈ': 'ㅊ'
};

function isHangulSyllable(char) {
    const code = char.charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3;
}

function decomposeKoreanSyllable(char) {
    if (!isHangulSyllable(char)) return null;

    const offset = char.charCodeAt(0) - 0xac00;
    const finalIndex = offset % 28;
    const medialIndex = Math.floor(offset / 28) % 21;
    const initialIndex = Math.floor(offset / (28 * 21));
    return {
        initial: KO_INITIALS[initialIndex],
        medial: KO_MEDIALS[medialIndex],
        final: KO_FINALS[finalIndex],
        original: char
    };
}

function composeKoreanSyllable(syllable) {
    const initialIndex = KO_INITIALS.indexOf(syllable.initial || EMPTY_ONSET);
    const medialIndex = KO_MEDIALS.indexOf(syllable.medial);
    const finalIndex = KO_FINALS.indexOf(syllable.final || '');
    if (initialIndex < 0 || medialIndex < 0 || finalIndex < 0) return syllable.original || '';
    return String.fromCharCode(0xac00 + initialIndex * 21 * 28 + medialIndex * 28 + finalIndex);
}

function cloneSyllables(syllables) {
    return syllables.map(syllable => ({ ...syllable }));
}

function normalizeUiVowels(syllables) {
    syllables.forEach((syllable, index) => {
        if (syllable.medial === 'ㅢ' && syllable.initial !== EMPTY_ONSET) {
            syllable.medial = 'ㅣ';
        }
        if (syllable.medial === 'ㅖ' && syllable.initial !== EMPTY_ONSET && syllable.initial !== 'ㄹ') {
            syllable.medial = 'ㅔ';
        }
        if (index > 0 && syllable.initial === EMPTY_ONSET && syllable.medial === 'ㅢ') {
            syllable.medial = 'ㅣ';
        }
        if ((syllable.initial === 'ㅈ' || syllable.initial === 'ㅉ' || syllable.initial === 'ㅊ') && syllable.medial === 'ㅕ') {
            syllable.medial = 'ㅓ';
        }
    });
}

function simplifyFinal(final) {
    return FINAL_REPRESENTATIVE[final] || final || '';
}

function splitClusterForLiaison(final) {
    return CLUSTER_LIAISON[final] || null;
}

function aspirateFinalWithH(final) {
    const simplified = simplifyFinal(final);
    if (simplified === 'ㄱ') return 'ㅋ';
    if (simplified === 'ㄷ') return 'ㅌ';
    if (simplified === 'ㅂ') return 'ㅍ';
    if (final === 'ㅈ' || final === 'ㄵ') return 'ㅊ';
    return null;
}

function applyLiaisonAndHRules(syllables) {
    for (let index = 0; index < syllables.length - 1; index++) {
        const current = syllables[index];
        const next = syllables[index + 1];
        if (!current.final) continue;

        if (current.final === 'ㅎ' && H_ASPIRATION_NEXT[next.initial]) {
            current.final = '';
            next.initial = H_ASPIRATION_NEXT[next.initial];
            continue;
        }

        if ((current.final === 'ㄶ' || current.final === 'ㅀ') && H_ASPIRATION_NEXT[next.initial]) {
            current.final = current.final === 'ㄶ' ? 'ㄴ' : 'ㄹ';
            next.initial = H_ASPIRATION_NEXT[next.initial];
            continue;
        }

        if ((current.final === 'ㅎ' || current.final === 'ㄶ' || current.final === 'ㅀ') && next.initial === 'ㅅ') {
            current.final = current.final === 'ㅎ' ? '' : current.final === 'ㄶ' ? 'ㄴ' : 'ㄹ';
            next.initial = 'ㅆ';
            continue;
        }

        if (current.final === 'ㅎ' && next.initial === 'ㄴ') {
            current.final = 'ㄴ';
            continue;
        }

        if ((current.final === 'ㄶ' || current.final === 'ㅀ') && next.initial === 'ㄴ') {
            current.final = current.final === 'ㄶ' ? 'ㄴ' : 'ㄹ';
            continue;
        }

        if (next.initial === 'ㅎ') {
            const aspirated = aspirateFinalWithH(current.final);
            if (aspirated) {
                current.final = '';
                next.initial = aspirated;
                continue;
            }
        }

        if (next.initial === EMPTY_ONSET) {
            if (current.final === 'ㅇ') continue;

            if (current.final === 'ㅎ') {
                current.final = '';
                continue;
            }

            if (current.final === 'ㄷ' && next.medial === 'ㅣ') {
                current.final = '';
                next.initial = 'ㅈ';
                continue;
            }

            if ((current.final === 'ㅌ' || current.final === 'ㄾ') && next.medial === 'ㅣ') {
                current.final = current.final === 'ㄾ' ? 'ㄹ' : '';
                next.initial = 'ㅊ';
                continue;
            }

            const cluster = splitClusterForLiaison(current.final);
            if (cluster) {
                current.final = cluster[0];
                if (cluster[1]) next.initial = cluster[1];
                continue;
            }

            const movedFinal = current.final;
            current.final = '';
            next.initial = KO_INITIALS.includes(movedFinal) ? movedFinal : simplifyFinal(movedFinal);
        } else {
            current.final = simplifyFinal(current.final);
        }
    }

    const last = syllables[syllables.length - 1];
    if (last && last.final) {
        last.final = simplifyFinal(last.final);
    }
}

function applyPalatalHRule(syllables) {
    for (let index = 0; index < syllables.length - 1; index++) {
        const current = syllables[index];
        const next = syllables[index + 1];
        if (!current.final || next.initial !== 'ㅎ' || next.medial !== 'ㅣ') continue;

        const simplified = simplifyFinal(current.final);
        if (simplified === 'ㄷ') {
            current.final = '';
            next.initial = 'ㅊ';
        }
    }
}

function applyAssimilationRules(syllables) {
    for (let pass = 0; pass < 3; pass++) {
        let changed = false;

        for (let index = 0; index < syllables.length - 1; index++) {
            const current = syllables[index];
            const next = syllables[index + 1];
            if (!current.final) continue;

            if ((current.final === 'ㄱ' || current.final === 'ㅂ') && next.initial === 'ㄹ') {
                next.initial = 'ㄴ';
                changed = true;
            }

            if ((current.final === 'ㅁ' || current.final === 'ㅇ') && next.initial === 'ㄹ') {
                next.initial = 'ㄴ';
                changed = true;
            }

            if (current.final === 'ㄴ' && next.initial === 'ㄹ') {
                current.final = 'ㄹ';
                next.initial = 'ㄹ';
                changed = true;
            }

            if (current.final === 'ㄹ' && next.initial === 'ㄴ') {
                next.initial = 'ㄹ';
                changed = true;
            }

            if ((next.initial === 'ㄴ' || next.initial === 'ㅁ') && (current.final === 'ㄱ' || current.final === 'ㄷ' || current.final === 'ㅂ')) {
                current.final = current.final === 'ㄱ' ? 'ㅇ' : current.final === 'ㄷ' ? 'ㄴ' : 'ㅁ';
                changed = true;
            }
        }

        if (!changed) break;
    }
}

function applyTensificationRules(syllables) {
    for (let index = 0; index < syllables.length - 1; index++) {
        const current = syllables[index];
        const next = syllables[index + 1];
        if (!current.final) continue;
        if ((current.final === 'ㄱ' || current.final === 'ㄷ' || current.final === 'ㅂ') && TENSE_ONSETS[next.initial]) {
            next.initial = TENSE_ONSETS[next.initial];
        }
    }
}

function applyLgeokVerbVariant(syllables) {
    for (let index = 0; index < syllables.length - 1; index++) {
        const current = syllables[index];
        const next = syllables[index + 1];
        if (current.final === 'ㄺ' && next.initial === 'ㄱ') {
            current.final = 'ㄹ';
            next.initial = 'ㄲ';
        }
    }
}

function syllablesToText(syllables) {
    return syllables.map(composeKoreanSyllable).join('');
}

function applyCoreStandardRules(syllables) {
    normalizeUiVowels(syllables);
    applyPalatalHRule(syllables);
    applyLiaisonAndHRules(syllables);
    applyAssimilationRules(syllables);
    applyTensificationRules(syllables);
}

function getStandardKoreanReadingVariants(word) {
    const syllables = Array.from(String(word || '')).map(decomposeKoreanSyllable).filter(Boolean);
    if (syllables.length === 0) return [];

    const variants = [];
    const addVariant = (label, variantSyllables) => {
        const reading = syllablesToText(variantSyllables);
        if (reading && !variants.some(variant => variant.reading === reading)) {
            variants.push({ label, reading });
        }
    };

    const base = cloneSyllables(syllables);
    applyCoreStandardRules(base);
    addVariant('표준발음', base);

    const lgeokVerb = cloneSyllables(syllables);
    applyLgeokVerbVariant(lgeokVerb);
    applyCoreStandardRules(lgeokVerb);
    addVariant('표준발음 후보', lgeokVerb);

    if (word === '맛있다') {
        addVariant('허용 발음', Array.from('마싣따').map(decomposeKoreanSyllable));
        addVariant('원칙 발음', Array.from('마딛따').map(decomposeKoreanSyllable));
    } else if (word === '멋있다') {
        addVariant('허용 발음', Array.from('머싣따').map(decomposeKoreanSyllable));
        addVariant('원칙 발음', Array.from('머딛따').map(decomposeKoreanSyllable));
    }

    return variants;
}

function getStandardKoreanReading(word) {
    return getStandardKoreanReadingVariants(word)[0]?.reading || '';
}

function makeKoreanPronunciationCandidate(label, reading, layer = 'standard') {
    const phonemeData = getKoreanIpaPhonemes(reading);
    return {
        label,
        reading,
        phonemes: phonemeData.phonemes,
        charMap: phonemeData.charMap,
        layer
    };
}

function getKoreanStandardPronunciationCandidates(word) {
    const key = String(word || '');
    if (STANDARD_PRONUNCIATION_CACHE.has(key)) return STANDARD_PRONUNCIATION_CACHE.get(key);

    const candidates = [];
    const written = key.replace(/[^가-힣]/g, '');
    if (!written) {
        STANDARD_PRONUNCIATION_CACHE.set(key, candidates);
        return candidates;
    }

    getStandardKoreanReadingVariants(written).forEach(variant => {
        candidates.push(makeKoreanPronunciationCandidate(variant.label, variant.reading, 'standard'));
    });

    if (!candidates.some(candidate => candidate.reading === written)) {
        candidates.push(makeKoreanPronunciationCandidate('표기', written, 'written'));
    }

    const seen = new Set();
    const unique = candidates.filter(candidate => {
        const key = candidate.phonemes.join('|');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    STANDARD_PRONUNCIATION_CACHE.set(key, unique);
    return unique;
}

window.getStandardKoreanReading = getStandardKoreanReading;
window.getKoreanStandardPronunciationCandidates = getKoreanStandardPronunciationCandidates;
