// Phoneme model shared by the V2 engines (loaded by workers/word-worker.js and the
// lexicon build): V1 articulatory features and similarity (get_score_1d, constants from
// js/v2/phoneme-similarity-config.js), V1 calculateScore with matched indices (result
// highlighting), and jamo input (ㅋㅋ, ㅏㅏ) read letter by letter.
// The V1 candidate rules, rime/stress/syllable boosts and query helpers were retired on
// 2026-09-28 (Git history at 5df2ae8 and the archive keep them).

const ipaFeatures = {
    'i':  [1, 0, -0.5], 'ɯ':  [1, 1, -0.5], 'u':  [1, 1, 0.5],
    'ɛ':  [0.5, 0, -0.5], 'ʌ':  [0.5, 1, -0.5], 'o':  [0.5, 1, 0.5],
    'a':  [0, 1, -0.5], 'ɑ':  [0, 1, -0.5], 'æ':  [0.1, 0.1, -0.5],
    'e':  [0.7, 0, -0.5], 'ɔ':  [0.2, 1, 0.5], 'ɪ':  [0.9, 0.1, -0.5],
    'ʊ':  [0.9, 0.9, 0.5], 'ə':  [0.5, 0.5, -0.5], 'ɚ':  [0.5, 0.5, -0.5],
    'aɪ': [0.45, 0.55, -0.5], 'eɪ': [0.8, 0.05, -0.5], 'ɔɪ': [0.55, 0.55, 0],
    'aʊ': [0.45, 0.95, 0], 'oʊ': [0.7, 0.95, 0.5],
    'ju': [1, 0.67, 0.5], 'jʌ': [0.7, 0.67, -0.5], 'jo': [0.7, 0.67, 0.5],
    'jɛ': [0.7, 0.67, -0.5], 'ja': [0.4, 0.67, -0.5], 'je': [0.85, 0.33, -0.5],
    'wi': [1, 0.33, -0.17], 'wʌ': [0.7, 1, -0.17], 'wɛ': [0.7, 0.33, -0.17],
    'wa': [0.2, 1, -0.17], 'we': [0.85, 0.33, -0.17], 'ɰi': [1, 0.33, 0.17]
};

const ipaConsoFeatures = {
    // Korean
    'p': [0, 1, 0, 0], 'pʰ': [0, 1, 0.5, 0], 'p*': [0, 1, 1, 0], 'b': [0, 1, 0, 0.5],
    'm': [0, 0.25, 0, 0.5],
    't': [0.25, 1, 0, 0], 'tʰ': [0.25, 1, 0.5, 0], 't*': [0.25, 1, 1, 0], 'd': [0.25, 1, 0, 0.5],
    's': [0.25, 0.5, 0.5, 0], 's*': [0.25, 0.5, 1, 0],
    'n': [0.25, 0.25, 0, 0.5], 'ɾ': [0.25, 0, 0, 0.5], 'l': [0.25, 0, 0, 0.5],
    'tɕ': [0.5, 0.75, 0, 0], 'tɕʰ': [0.5, 0.75, 0.5, 0], 'tɕ*': [0.5, 0.75, 1, 0], 'dʑ': [0.5, 0.75, 0, 0.5],
    'k': [0.75, 1, 0, 0], 'kʰ': [0.75, 1, 0.5, 0], 'k*': [0.75, 1, 1, 0], 'ɡ': [0.75, 1, 0, 0.5],
    'ŋ': [0.75, 0.25, 0, 0.5],
    'h': [1, 0.5, 0.5, 0],
    // English extras
    'f': [0.1, 0.5, 0, 0], 'v': [0.1, 0.5, 0, 0.5],
    'θ': [0.2, 0.5, 0, 0], 'ð': [0.2, 0.5, 0, 0.5],
    'ʃ': [0.5, 0.5, 0, 0], 'ʒ': [0.5, 0.5, 0, 0.5],
    'tʃ': [0.5, 0.75, 0.5, 0], 'dʒ': [0.5, 0.75, 0, 0.5],
    'ɹ': [0.25, 0, 0, 0.5], 'w': [0, 0.1, 0, 0.5], 'j': [0.6, 0.1, 0, 0.5], 'z': [0.25, 0.5, 0, 0.5]
};

const KOREAN_CHO = ['k', 'k*', 'n', 't', 't*', 'ɾ', 'm', 'p', 'p*', 's', 's*', '', 'tɕ', 'tɕ*', 'tɕʰ', 'kʰ', 'tʰ', 'pʰ', 'h'];

const KOREAN_JUNG = ['a', 'ɛ', 'ja', 'jɛ', 'ʌ', 'e', 'jʌ', 'je', 'o', 'wa', 'wɛ', 'we', 'jo', 'u', 'wʌ', 'we', 'wi', 'ju', 'ɯ', 'ɰi', 'i'];

const KOREAN_JONG_MAPPED = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ŋ', 't', 't', 'k', 't', 'p', 't'];

const KOREAN_CHO_JAMO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', '', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const KOREAN_JUNG_JAMO = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];

const KOREAN_JONG_JAMO = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const KOREAN_PHONETIC_INPUT_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣ]+$/;

function getKoreanIpaPhonemes(word) {
    const phonemes = [];
    const charMap = [];
    for (let i = 0; i < word.length; i++) {
        const code = word.charCodeAt(i);
        if (code >= 44032 && code <= 55203) {
            const charCode = code - 44032;
            const jong = charCode % 28;
            const jung = ((charCode - jong) / 28) % 21;
            const cho = Math.floor(charCode / (28 * 21));
            
            if (KOREAN_CHO[cho] !== '') {
                charMap.push({ char: KOREAN_CHO_JAMO[cho], startIndex: phonemes.length, endIndex: phonemes.length + 1 });
                phonemes.push(KOREAN_CHO[cho]);
            }
            charMap.push({ char: KOREAN_JUNG_JAMO[jung], startIndex: phonemes.length, endIndex: phonemes.length + 1 });
            phonemes.push(KOREAN_JUNG[jung]);
            if (KOREAN_JONG_MAPPED[jong] !== '') {
                charMap.push({ char: KOREAN_JONG_JAMO[jong], startIndex: phonemes.length, endIndex: phonemes.length + 1 });
                phonemes.push(KOREAN_JONG_MAPPED[jong]);
            }
        }
    }
    return { phonemes, charMap };
}

function hasKoreanPhoneticInput(text) {
    return KOREAN_PHONETIC_INPUT_RE.test(String(text || ''));
}

function getKoreanJamoPhoneme(char) {
    const vowelIndex = KOREAN_JUNG_JAMO.indexOf(char);
    if (vowelIndex >= 0) return KOREAN_JUNG[vowelIndex];

    const initialIndex = KOREAN_CHO_JAMO.indexOf(char);
    if (initialIndex >= 0 && KOREAN_CHO[initialIndex]) return KOREAN_CHO[initialIndex];

    const finalIndex = KOREAN_JONG_JAMO.indexOf(char);
    if (finalIndex >= 0 && KOREAN_JONG_MAPPED[finalIndex]) return KOREAN_JONG_MAPPED[finalIndex];

    return null;
}

function getKoreanPhoneticInputPhonemes(input) {
    const phonemes = [];
    const charMap = [];

    Array.from(String(input || '')).forEach(char => {
        if (/[가-힣]/.test(char)) {
            const syllableData = getKoreanIpaPhonemes(char);
            syllableData.charMap.forEach(entry => {
                charMap.push({
                    char: entry.char,
                    startIndex: entry.startIndex + phonemes.length,
                    endIndex: entry.endIndex + phonemes.length
                });
            });
            phonemes.push(...syllableData.phonemes);
            return;
        }

        const phoneme = getKoreanJamoPhoneme(char);
        if (phoneme) {
            charMap.push({ char, startIndex: phonemes.length, endIndex: phonemes.length + 1 });
            phonemes.push(phoneme);
        }
    });

    return { phonemes, charMap };
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

// Missing config is a hard error: a silently different formula would change every
// ranking without failing loudly.
function getSharedSimilarityFormula() {
    const shared = (typeof globalThis !== 'undefined' ? globalThis : this).PHONEME_SIMILARITY;
    if (!shared || typeof shared.vowelSimilarity !== 'function') {
        throw new Error('phoneme-similarity-config.js must be loaded before phonetics.js');
    }
    return shared;
}

function getVowelFeatureSimilarity(ipa1, ipa2) {
    const v1 = ipaFeatures[ipa1];
    const v2 = ipaFeatures[ipa2];
    if (!v1 || !v2) return 0;

    return getSharedSimilarityFormula().vowelSimilarity(
        clamp01(1 - Math.abs(v1[0] - v2[0])),
        clamp01(1 - Math.abs(v1[1] - v2[1])),
        clamp01(1 - Math.abs(v1[2] - v2[2]))
    );
}

function getConsonantFeatureSimilarity(ipa1, ipa2) {
    const c1 = ipaConsoFeatures[ipa1];
    const c2 = ipaConsoFeatures[ipa2];
    if (!c1 || !c2) return 0;

    return getSharedSimilarityFormula().consonantSimilarity(
        Math.abs(c1[0] - c2[0]),
        Math.abs(c1[1] - c2[1]),
        Math.abs(c1[2] - c2[2]),
        Math.abs(c1[3] - c2[3])
    );
}

function get_score_1d(ipa1, ipa2) {
    if (ipa1 === ipa2) return 1.0;
    
    if (ipaFeatures[ipa1] && ipaFeatures[ipa2]) {
        return getVowelFeatureSimilarity(ipa1, ipa2);
    } else if (ipaConsoFeatures[ipa1] && ipaConsoFeatures[ipa2]) {
        return getConsonantFeatureSimilarity(ipa1, ipa2);
    } 
    
    return 0;
}

function calculateScore(targetPhonemes, queryPhonemes, detailMultipliers = [], options = {}) {
    if (queryPhonemes.length === 0 || targetPhonemes.length === 0) return { score: 0, matchIndices: [] };
    
    const targetStr = targetPhonemes.join('');
    const queryStr = queryPhonemes.join('');

    if (targetStr === queryStr) return { score: 100, matchIndices: targetPhonemes.map((_, i) => i) };


    // Phonetic DP algorithm based on PronunciationEvaluator
    let dpMatrix = Array.from({length: targetPhonemes.length + 1}, () => Array(queryPhonemes.length + 1).fill(0));
    
    let isDetailActive = Boolean(options.useDetailWeights);
    
    // If detail is active, ignore global vowel/conso weights completely (use 1.0)
    let baseVowelWeight = isDetailActive ? 1.0 : (options.vowelWeight ?? 1.0);
    let baseConsoWeight = isDetailActive ? 1.0 : (options.consonantWeight ?? 1.0);

    let targetWeights = targetPhonemes.map(p => ipaFeatures[p] ? baseVowelWeight : baseConsoWeight);
    let queryWeights = queryPhonemes.map((p, idx) => {
        let baseWeight = ipaFeatures[p] ? baseVowelWeight : baseConsoWeight;
        let detailMult = detailMultipliers[idx] !== undefined ? detailMultipliers[idx] : 1.0;
        return baseWeight * detailMult;
    });

    for (let i = 1; i <= targetPhonemes.length; i++) dpMatrix[i][0] = dpMatrix[i-1][0] + targetWeights[i-1];
    for (let j = 1; j <= queryPhonemes.length; j++) dpMatrix[0][j] = dpMatrix[0][j-1] + queryWeights[j-1];

    for (let i = 1; i <= targetPhonemes.length; i++) {
        for (let j = 1; j <= queryPhonemes.length; j++) {
            let wT = targetWeights[i-1];
            let wQ = queryWeights[j-1];
            let maxW = Math.max(wT, wQ);
            
            let insertions = dpMatrix[i][j - 1] + wQ;
            let deletions = dpMatrix[i - 1][j] + wT;
            let substitutions = dpMatrix[i - 1][j - 1] + maxW * (1 - get_score_1d(targetPhonemes[i - 1], queryPhonemes[j - 1]));
            dpMatrix[i][j] = Math.min(insertions, deletions, substitutions);
        }
    }
    
    let dist = dpMatrix[targetPhonemes.length][queryPhonemes.length];
    let targetWeightSum = targetWeights.reduce((a,b)=>a+b, 0);
    let queryWeightSum = queryWeights.reduce((a,b)=>a+b, 0);
    let maxDist = Math.max(targetWeightSum, queryWeightSum);
    let dpScore = Math.max(1 - (dist / maxDist), 0) * 100;

    // Backtrack to find matched indices
    let dpIndices = [];
    let i = targetPhonemes.length;
    let j = queryPhonemes.length;
    while (i > 0 && j > 0) {
        let current = dpMatrix[i][j];
        let sub = dpMatrix[i-1][j-1];
        let ins = dpMatrix[i][j-1];
        let rm = dpMatrix[i-1][j];
        
        let wT = targetWeights[i-1];
        let wQ = queryWeights[j-1];
        let maxW = Math.max(wT, wQ);
        let cost = maxW * (1 - get_score_1d(targetPhonemes[i-1], queryPhonemes[j-1]));
        
        if (Math.abs(current - (sub + cost)) < 0.001) {
            if (get_score_1d(targetPhonemes[i-1], queryPhonemes[j-1]) > 0.4 && wQ > 0) {
                dpIndices.push(i-1);
            }
            i--; j--;
        } else if (Math.abs(current - (rm + wT)) < 0.001) {
            i--;
        } else {
            j--;
        }
    }

    // Sliding window phonetic match for substring matching (rhymes, partial words)
    let maxSlidingScore = 0;
    let bestSlidingIndices = [];
    if (targetPhonemes.length >= queryPhonemes.length) {
        for (let i = 0; i <= targetPhonemes.length - queryPhonemes.length; i++) {
            let currentScore = 0;
            let maxPossibleScore = 0;
            let currentIndices = [];
            for (let j = 0; j < queryPhonemes.length; j++) {
                let weight = queryWeights[j];
                maxPossibleScore += weight;
                let s = get_score_1d(targetPhonemes[i+j], queryPhonemes[j]);
                currentScore += s * weight;
                if (s > 0.4 && weight > 0) {
                    currentIndices.push(i + j);
                }
            }
            let percentage = maxPossibleScore > 0 ? (currentScore / maxPossibleScore) * 100 : 0; 
            if (percentage > maxSlidingScore) {
                maxSlidingScore = percentage;
                bestSlidingIndices = currentIndices;
            }
        }
    }
    
    if (dpScore > maxSlidingScore) {
        return { score: dpScore, matchIndices: dpIndices };
    } else {
        return { score: maxSlidingScore, matchIndices: bestSlidingIndices };
    }
}

globalThis.ipaFeatures = ipaFeatures;
globalThis.ipaConsoFeatures = ipaConsoFeatures;
