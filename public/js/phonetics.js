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

const KOREANIZED_CHUNKS = [
    ['tion', ['s', 'ʌ', 'n']],
    ['sion', ['s', 'ʌ', 'n']],
    ['ture', ['tɕ', 'ʌ']],
    ['sure', ['s', 'ʌ']],
    ['ch', ['tɕʰ']],
    ['sh', ['s']],
    ['th', ['s']],
    ['ph', ['p']],
    ['ck', ['k']],
    ['qu', ['k', 'w']],
    ['x', ['k', 's']]
];

const KOREANIZED_SINGLE = {
    a: ['a'], b: ['p'], c: ['k'], d: ['t'], e: ['e'], f: ['p'], g: ['k'],
    h: ['h'], i: ['i'], j: ['tɕ'], k: ['k'], l: ['ɾ'], m: ['m'], n: ['n'],
    o: ['o'], p: ['p'], q: ['k'], r: ['ɾ'], s: ['s'], t: ['t'], u: ['u'],
    v: ['p'], w: ['w'], y: ['i'], z: ['tɕ']
};

const KOREANIZED_VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const KOREANIZED_STOPS = new Set(['p', 't', 'k', 'm', 'n', 'l', 'tɕ', 'tɕʰ', 's']);

function isKoreanizedVowelLetter(char) {
    return KOREANIZED_VOWELS.has(char);
}

function getKoreanizedEnglishPhonemes(word) {
    const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');
    const phonemes = [];

    for (let i = 0; i < cleanWord.length; i++) {
        const char = cleanWord[i];
        const prev = cleanWord[i - 1] || '';
        const next = cleanWord[i + 1] || '';

        if (char === 'e' && i === cleanWord.length - 1 && cleanWord.length > 2) {
            continue;
        }

        let matched = false;
        for (const [chunk, mapped] of KOREANIZED_CHUNKS) {
            if (cleanWord.startsWith(chunk, i)) {
                phonemes.push(...mapped);
                i += chunk.length - 1;
                matched = true;
                break;
            }
        }
        if (matched) continue;

        if (char === 'l' && isKoreanizedVowelLetter(prev) && isKoreanizedVowelLetter(next)) {
            phonemes.push('l', 'ɾ');
            continue;
        }

        if (char === 'r' && !isKoreanizedVowelLetter(next)) {
            continue;
        }

        const mapped = KOREANIZED_SINGLE[char];
        if (!mapped) continue;

        phonemes.push(...mapped);

        if (!isKoreanizedVowelLetter(char) && next && !isKoreanizedVowelLetter(next)) {
            const last = mapped[mapped.length - 1];
            if (KOREANIZED_STOPS.has(last)) phonemes.push('ɯ');
        }
    }

    const last = phonemes[phonemes.length - 1];
    if (KOREANIZED_STOPS.has(last)) phonemes.push('ɯ');

    return phonemes;
}

function getLoanwordForms(word) {
    const key = word.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(loanwordOverrides, key)) return [];

    const forms = loanwordOverrides[key];
    return Array.isArray(forms) ? forms : [];
}

function uniquePhonemeCandidates(candidates) {
    const seen = new Set();
    return candidates.filter(candidate => {
        if (!candidate.phonemes || candidate.phonemes.length === 0) return false;

        const key = candidate.phonemes.join('|');
        if (seen.has(key)) return false;

        seen.add(key);
        return true;
    });
}

function getKoreanizedEnglishCandidates(word) {
    const candidates = [];

    getLoanwordForms(word).forEach(form => {
        candidates.push({
            phonemes: getKoreanIpaPhonemes(form).phonemes,
            label: '외래어',
            form
        });
    });

    candidates.push({
        phonemes: getKoreanizedEnglishPhonemes(word),
        label: '한국식',
        form: ''
    });

    return uniquePhonemeCandidates(candidates);
}

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

function getQueryPhonemes(query) {
    if (hasKoreanPhoneticInput(query)) {
        const phoneticInput = getKoreanPhoneticInputPhonemes(query);
        if (/[가-힣]/.test(query) && typeof getKoreanStandardPronunciationCandidates === 'function') {
            const candidates = getKoreanStandardPronunciationCandidates(query);
            const primary = candidates[0] || phoneticInput;
            return {
                phonemes: primary.phonemes || phoneticInput.phonemes,
                charMap: primary.charMap || phoneticInput.charMap,
                koreanPronunciationCandidates: candidates.length > 0 ? candidates : [phoneticInput]
            };
        }
        return phoneticInput;
    } else {
        const lowerQuery = query.toLowerCase();
        const found = dictionary.find(d => d.word === lowerQuery && d.lang === 'en');
        const koreanizedCandidates = getKoreanizedEnglishCandidates(lowerQuery);
        const koreanizedPhonemes = koreanizedCandidates[0]?.phonemes || [];
        if (found) {
            const phonemes = found.phonemes || found.vowels || [];
            // Map each phoneme individually for English
            const charMap = phonemes.map((p, idx) => ({ char: p, startIndex: idx, endIndex: idx + 1 }));
            return { phonemes, koreanizedPhonemes, koreanizedCandidates, charMap };
        }
        const charMap = koreanizedPhonemes.map((p, idx) => ({ char: p, startIndex: idx, endIndex: idx + 1 }));
        return { phonemes: koreanizedPhonemes, koreanizedPhonemes, koreanizedCandidates, charMap };
    }
}

function get_score_1d(ipa1, ipa2) {
    if (ipa1 === ipa2) return 1.0;
    
    // Both vowels
    if (ipaFeatures[ipa1] && ipaFeatures[ipa2]) {
        const v1 = ipaFeatures[ipa1];
        const v2 = ipaFeatures[ipa2];
        let score = 1.0;
        score *= 1 - Math.abs(v1[0] - v2[0]);
        score *= 1 - Math.abs(v1[1] - v2[1]);
        score *= 1 - Math.abs(v1[2] - v2[2]);
        return Math.max(0, score);
    } 
    // Both consonants
    else if (ipaConsoFeatures[ipa1] && ipaConsoFeatures[ipa2]) {
        const c1 = ipaConsoFeatures[ipa1];
        const c2 = ipaConsoFeatures[ipa2];
        if (c1[0] !== c2[0] || c1[1] !== c2[1]) {
            return 0; // If position or manner are different, score 0
        }
        let score = 1.0;
        score *= 1 - Math.abs(c1[2] - c2[2]); // strength
        score *= 1 - Math.abs(c1[3] - c2[3]); // voice
        return Math.max(0, score);
    } 
    
    return 0;
}

function calculateScore(targetPhonemes, queryPhonemes, detailMultipliers = []) {
    if (queryPhonemes.length === 0 || targetPhonemes.length === 0) return { score: 0, matchIndices: [] };
    
    const targetStr = targetPhonemes.join('');
    const queryStr = queryPhonemes.join('');

    if (targetStr === queryStr) return { score: 100, matchIndices: targetPhonemes.map((_, i) => i) };

    if (targetStr.includes(queryStr)) {
        let startIndex = targetStr.indexOf(queryStr) / (targetStr.length / targetPhonemes.length); // Rough approx, better to recalculate
        // Let sliding window handle substring exact matches perfectly with max score
    }

    // Phonetic DP algorithm based on PronunciationEvaluator
    let dpMatrix = Array.from({length: targetPhonemes.length + 1}, () => Array(queryPhonemes.length + 1).fill(0));
    
    let isDetailActive = document.getElementById('useDetailWeights').checked;
    
    // If detail is active, ignore global vowel/conso weights completely (use 1.0)
    let baseVowelWeight = isDetailActive ? 1.0 : parseFloat(vowelWeightInput.value);
    let baseConsoWeight = isDetailActive ? 1.0 : parseFloat(consoWeightInput.value);

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

function scoreCandidate(targetPhonemes, queryPhonemes, detailMultipliers, matchLayer, matchLayerLabel, penalty = 1) {
    const result = calculateScore(targetPhonemes, queryPhonemes, detailMultipliers);
    return {
        ...result,
        score: result.score * penalty,
        matchPhonemes: targetPhonemes,
        matchLayer,
        matchLayerLabel
    };
}

function remapDetailMultipliers(detailMultipliers, sourceLength, targetLength) {
    if (!Array.isArray(detailMultipliers) || targetLength <= 0) return [];
    if (sourceLength === targetLength) return detailMultipliers.slice();
    if (sourceLength <= 0) return new Array(targetLength).fill(1.0);

    return Array.from({ length: targetLength }, (_, index) => {
        const sourceIndex = Math.min(sourceLength - 1, Math.floor(index * sourceLength / targetLength));
        return detailMultipliers[sourceIndex] ?? 1.0;
    });
}

function getKoreanCompoundPronunciationCandidates(word) {
    const store = typeof window !== 'undefined' ? window.compoundPronunciationsKo : null;
    if (!store || typeof store !== 'object') return [];

    const key = String(word || '');
    const rows = store[key] || store[key.toLowerCase()];
    if (!Array.isArray(rows) || rows.length === 0) return [];

    return rows
        .map(row => {
            if (!Array.isArray(row)) return null;
            return {
                label: row[0] || '합성어',
                reading: row[1] || '',
                phonemes: Array.isArray(row[2]) ? row[2] : [],
                layer: row[3] || 'compound'
            };
        })
        .filter(candidate => candidate.phonemes.length > 0);
}

function dedupeKoreanPronunciationCandidates(candidates) {
    const seen = new Set();
    return candidates.filter(candidate => {
        const key = Array.isArray(candidate.phonemes) ? candidate.phonemes.join('|') : '';
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getStoredKoreanPronunciationCandidates(item) {
    const compoundCandidates = getKoreanCompoundPronunciationCandidates(item.word);
    if (compoundCandidates.length > 0) {
        const storedCandidates = Array.isArray(item.pronunciations)
            ? item.pronunciations
                .map(row => {
                    if (!Array.isArray(row)) return null;
                    return {
                        label: row[0] || 'standard',
                        reading: row[1] || '',
                        phonemes: Array.isArray(row[2]) ? row[2] : [],
                        layer: row[3] || 'standard'
                    };
                })
                .filter(candidate => candidate && candidate.phonemes.length > 0)
            : [];
        const baseCandidate = Array.isArray(item.phonemes) && item.phonemes.length > 0
            ? [{ label: item.reading ? 'standard' : 'written', reading: item.reading || item.word, phonemes: item.phonemes, layer: item.reading ? 'standard' : 'written' }]
            : [];
        return dedupeKoreanPronunciationCandidates([...compoundCandidates, ...storedCandidates, ...baseCandidate]);
    }

    if (Array.isArray(item.pronunciations) && item.pronunciations.length > 0) {
        return item.pronunciations
            .map(row => {
                if (!Array.isArray(row)) return null;
                return {
                    label: row[0] || '표준발음',
                    reading: row[1] || '',
                    phonemes: Array.isArray(row[2]) ? row[2] : [],
                    layer: row[0] === '표기' ? 'written' : 'standard'
                };
            })
            .filter(candidate => candidate.phonemes.length > 0);
    }

    if (Array.isArray(item.phonemes) && item.phonemes.length > 0) {
        return [{
            label: item.reading ? '표준발음' : '표기',
            reading: item.reading || item.word,
            phonemes: item.phonemes,
            layer: item.reading ? 'standard' : 'written'
        }];
    }

    return [];
}

function calculatePronunciationScore(item, queryPhonemeData, detailMultipliers, mode) {
    const nativePhonemes = item.phonemes || item.vowels || [];
    const queryNative = queryPhonemeData.phonemes || [];
    const queryKoreanizedCandidates = queryPhonemeData.koreanizedCandidates || [
        { phonemes: queryPhonemeData.koreanizedPhonemes || queryNative, label: '한국식' }
    ];

    if (item.lang === 'ko') {
        const queryCandidates = queryPhonemeData.koreanPronunciationCandidates || [
            { phonemes: queryNative, label: '표준발음' }
        ];
        const storedCandidates = getStoredKoreanPronunciationCandidates(item);
        const targetCandidates = storedCandidates.length > 0
            ? storedCandidates
            : typeof getKoreanStandardPronunciationCandidates === 'function'
                ? getKoreanStandardPronunciationCandidates(item.word)
                : [];
        const koCandidates = [];
        (targetCandidates.length > 0 ? targetCandidates : [{ phonemes: nativePhonemes, label: '표기', layer: 'written' }]).forEach(targetCandidate => {
            queryCandidates.forEach(queryCandidate => {
                const candidateDetailMultipliers = remapDetailMultipliers(detailMultipliers, queryNative.length, queryCandidate.phonemes.length);
                koCandidates.push(scoreCandidate(
                    targetCandidate.phonemes,
                    queryCandidate.phonemes,
                    candidateDetailMultipliers,
                    targetCandidate.layer || 'standard',
                    targetCandidate.label || ''
                ));
            });
        });
        return koCandidates.reduce((best, current) => current.score > best.score ? current : best, koCandidates[0]);
    }

    if (item.lang !== 'en') {
        return scoreCandidate(nativePhonemes, queryNative, detailMultipliers, 'native', '');
    }

    const koreanizedCandidates = item.koreanizedCandidates || getKoreanizedEnglishCandidates(item.word);
    item.koreanizedCandidates = koreanizedCandidates;

    const candidates = [];

    if (mode === 'native') {
        candidates.push(scoreCandidate(nativePhonemes, queryNative, detailMultipliers, 'native', '실제'));
    } else if (mode === 'koreanized') {
        koreanizedCandidates.forEach(targetCandidate => {
            queryKoreanizedCandidates.forEach(queryCandidate => {
                const candidateDetailMultipliers = remapDetailMultipliers(detailMultipliers, queryNative.length, queryCandidate.phonemes.length);
                candidates.push(scoreCandidate(targetCandidate.phonemes, queryCandidate.phonemes, candidateDetailMultipliers, 'koreanized', targetCandidate.label));
            });
        });
    } else {
        candidates.push(scoreCandidate(nativePhonemes, queryNative, detailMultipliers, 'native', '실제', 0.98));

        koreanizedCandidates.forEach(targetCandidate => {
            queryKoreanizedCandidates.forEach(queryCandidate => {
                const candidateDetailMultipliers = remapDetailMultipliers(detailMultipliers, queryNative.length, queryCandidate.phonemes.length);
                candidates.push(scoreCandidate(targetCandidate.phonemes, queryCandidate.phonemes, candidateDetailMultipliers, 'koreanized', targetCandidate.label));
                candidates.push(scoreCandidate(nativePhonemes, queryCandidate.phonemes, candidateDetailMultipliers, 'bridge', '교차', 0.92));
            });
        });
    }

    return candidates.reduce((best, current) => current.score > best.score ? current : best, candidates[0]);
}

function applyFrequencyWeight(score, zipf, freqWeight) {
    if (zipf >= 3.5) {
        // Positive Zone: Asymptotic gap closing for common words
        let zipfNorm = Math.min(1.0, (zipf - 3.5) / 4.5); // Normalize 3.5~8.0 to 0.0~1.0
        let boostFactor = zipfNorm * (freqWeight / 10) * 0.8; // Max 80% gap closing
        return score + (100 - score) * boostFactor;
    }

    // Penalty Zone: Exponential reduction for rare words
    let x = 3.5 - Math.max(0, zipf); // x goes from 0 (at 3.5) to 3.5 (at 0)
    let penaltyMultiplier = Math.pow(x / 3.5, 2.5);
    let penalty = penaltyMultiplier * (freqWeight / 10);
    return score * (1 - penalty);
}

window.ipaFeatures = ipaFeatures;
window.ipaConsoFeatures = ipaConsoFeatures;
