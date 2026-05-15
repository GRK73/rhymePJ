let dictionary = [];
let loanwordOverrides = {};
let semanticVectorStores = { ko: {}, en: {} };
let topicTranslations = {};
let semanticResourcesLoaded = false;
let semanticResourcesLoadingPromise = null;
let isReady = false;
const TOPIC_TRANSLATION_CACHE_KEY = 'rhymeFinderTopicTranslations';

const statusEl = document.getElementById('status');
const searchInput = document.getElementById('searchInput');
const topicInput = document.getElementById('topicInput');
const searchBtn = document.getElementById('searchBtn');
const resultsList = document.getElementById('resultsList');
const langRadios = document.getElementsByName('lang');
const pronunciationModeRadios = document.getElementsByName('pronunciationMode');
const loadMoreBtn = document.getElementById('loadMoreBtn');

const consoWeightInput = document.getElementById('consoWeight');
const vowelWeightInput = document.getElementById('vowelWeight');
const freqWeightInput = document.getElementById('freqWeight');
const topicWeightInput = document.getElementById('topicWeight');

const consoVal = document.getElementById('consoVal');
const vowelVal = document.getElementById('vowelVal');
const freqVal = document.getElementById('freqVal');
const topicVal = document.getElementById('topicVal');

const excludeInput = document.getElementById('excludeInput');

const useDetailWeights = document.getElementById('useDetailWeights');
const detailGroup = document.getElementById('detailGroup');
const detailSlidersContainer = document.getElementById('detailSlidersContainer');

let currentQueryPhonemeData = { phonemes: [], charMap: [] };
let lastQueryWord = '';

const reSearchBtn = document.getElementById('reSearchBtn');
reSearchBtn.addEventListener('click', handleSearch);

// No auto-render on toggle since there's a research button, but we can toggle visibility of sliders
// If detail weights is checked, we just leave it. If they uncheck it, they can also click re-search.

function updateSliderVals() {
    consoVal.textContent = parseFloat(consoWeightInput.value).toFixed(1);
    vowelVal.textContent = parseFloat(vowelWeightInput.value).toFixed(1);
    freqVal.textContent = parseFloat(freqWeightInput.value).toFixed(1);
    topicVal.textContent = parseFloat(topicWeightInput.value).toFixed(1);
}

[consoWeightInput, vowelWeightInput, freqWeightInput, topicWeightInput].forEach(el => {
    el.addEventListener('input', () => {
        updateSliderVals();
    });
});

let currentFilteredResults = [];
let resultsShown = 0;
const PAGE_SIZE = 99;

// Intersection Observer for lazy loading meanings
const meaningObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const el = entry.target;
            const word = el.dataset.word;
            const lang = el.dataset.lang;
            const meaningEl = el.querySelector('.result-meaning');
            
            if (meaningEl && !meaningEl.dataset.loaded) {
                meaningEl.dataset.loaded = 'true';
                
                if (lang === 'en') {
                    fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&dt=bd&q=${encodeURIComponent(word)}`)
                        .then(res => res.json())
                        .then(data => {
                            let meaningText = '';
                            if (data && data[1]) {
                                // Extract all dictionary meanings across different parts of speech
                                let meanings = [];
                                data[1].forEach(pos => {
                                    if (pos[1] && Array.isArray(pos[1])) {
                                        meanings = meanings.concat(pos[1]);
                                    }
                                });
                                // Remove duplicates and limit to top 8 meanings
                                meanings = [...new Set(meanings)];
                                meaningText = meanings.slice(0, 8).join(', ');
                            } else if (data && data[0] && data[0][0]) {
                                // Fallback to simple translation if no dictionary data
                                meaningText = data[0][0][0];
                            } else {
                                meaningText = '뜻 정보 없음';
                            }
                            meaningEl.textContent = meaningText;
                        })
                        .catch(() => {
                            meaningEl.textContent = '뜻을 불러올 수 없음';
                        });
                } else {
                    // Korean: Try Wikipedia
                    fetch(`https://ko.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&exsentences=1&titles=${encodeURIComponent(word)}&format=json&origin=*`)
                        .then(res => res.json())
                        .then(data => {
                            const pages = data.query.pages;
                            const pageId = Object.keys(pages)[0];
                            if (pageId !== '-1' && pages[pageId].extract) {
                                const extract = pages[pageId].extract;
                                // 동음이의어 문서(Disambiguation page)인지 판별
                                if (extract.includes('다음을 가리') || extract.includes('뜻으로 쓰인') || extract.includes('다음을 의미') || extract.includes('동음이의') || extract.includes('다른 뜻') || extract.includes('다음과 같')) {
                                    meaningEl.innerHTML = `<a href="https://ko.dict.naver.com/#/search?query=${encodeURIComponent(word)}" target="_blank" class="dict-link">사전 검색 ↗</a>`;
                                } else {
                                    meaningEl.textContent = extract;
                                }
                            } else {
                                // Fallback for Korean words: link to dict
                                meaningEl.innerHTML = `<a href="https://ko.dict.naver.com/#/search?query=${encodeURIComponent(word)}" target="_blank" class="dict-link">사전 검색 ↗</a>`;
                            }
                        })
                        .catch(() => {
                            meaningEl.innerHTML = `<a href="https://ko.dict.naver.com/#/search?query=${encodeURIComponent(word)}" target="_blank" class="dict-link">사전 검색 ↗</a>`;
                        });
                }
            }
            observer.unobserve(el);
        }
    });
}, { rootMargin: '100px' });

async function loadOptionalJson(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.warn(`${path} is not available:`, error);
        return null;
    }
}

function setSemanticStore(lang, data) {
    const store = extractSemanticVectorStore(data);
    if (Object.keys(store).length > 0) {
        semanticVectorStores[lang] = store;
    }
}

function loadTopicTranslationCache() {
    try {
        const raw = localStorage.getItem(TOPIC_TRANSLATION_CACHE_KEY);
        if (!raw) return {};
        const data = JSON.parse(raw);
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (error) {
        console.warn('Topic translation cache is not available:', error);
        return {};
    }
}

function saveTopicTranslationCache() {
    try {
        localStorage.setItem(TOPIC_TRANSLATION_CACHE_KEY, JSON.stringify(topicTranslations));
    } catch (error) {
        console.warn('Could not save topic translation cache:', error);
    }
}

function mergeTopicTranslations(translations) {
    if (!translations || typeof translations !== 'object' || Array.isArray(translations)) return;

    Object.entries(translations).forEach(([topic, values]) => {
        const key = normalizeSemanticKey(topic);
        if (!key) return;

        const nextValues = Array.isArray(values) ? values : [values];
        const currentValues = Array.isArray(topicTranslations[key]) ? topicTranslations[key] : [];
        const merged = [...currentValues, ...nextValues]
            .map(value => normalizeSemanticKey(value))
            .filter(Boolean);

        if (merged.length > 0) {
            topicTranslations[key] = [...new Set(merged)];
        }
    });
}

function shouldLoadLocalSemanticFiles() {
    return !(window.location.hostname || '').endsWith('github.io');
}

async function ensureSemanticResourcesLoaded() {
    if (semanticResourcesLoaded) return getSemanticVectorCount();
    if (semanticResourcesLoadingPromise) return semanticResourcesLoadingPromise;

    semanticResourcesLoadingPromise = (async () => {
        if (!shouldLoadLocalSemanticFiles()) {
            mergeTopicTranslations(loadTopicTranslationCache());
            semanticResourcesLoaded = true;
            return 0;
        }

        const [koVectors, enVectors, legacyVectors, translations] = await Promise.all([
            loadOptionalJson('semantic_vectors_ko.json'),
            loadOptionalJson('semantic_vectors_en.json'),
            loadOptionalJson('semantic_vectors.json'),
            loadOptionalJson('topic_translations.json')
        ]);

        if (koVectors) setSemanticStore('ko', koVectors);
        if (enVectors) setSemanticStore('en', enVectors);

        if (legacyVectors && getSemanticVectorCount() === 0) {
            setSemanticStore('ko', legacyVectors);
            setSemanticStore('en', legacyVectors);
        }

        mergeTopicTranslations(translations);
        mergeTopicTranslations(loadTopicTranslationCache());

        semanticResourcesLoaded = true;
        return getSemanticVectorCount();
    })();

    return semanticResourcesLoadingPromise;
}

// Load dictionary
async function loadDictionary() {
    try {
        const response = await fetch('rhyme_dict_practical.json');
        if (!response.ok) throw new Error('Network response was not ok');
        dictionary = await response.json();

        try {
            const loanwordResponse = await fetch('loanword_overrides.json');
            if (loanwordResponse.ok) {
                loanwordOverrides = await loanwordResponse.json();
            }
        } catch (error) {
            console.warn('Loanword overrides are not available:', error);
        }

        isReady = true;
        const loanwordCount = Object.keys(loanwordOverrides).length;
        statusEl.textContent = `사전 로드 완료! (총 ${dictionary.length.toLocaleString()} 단어, 외래어 ${loanwordCount.toLocaleString()}개, 의미 벡터는 주제 입력 시 로드)`;
    } catch (error) {
        console.error('Failed to load dictionary:', error);
        statusEl.textContent = '사전 데이터를 불러오는데 실패했습니다.';
        statusEl.style.color = 'red';
    }
}

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

function getQueryPhonemes(query) {
    const isKorean = /[가-힣]/.test(query);
    if (isKorean) {
        return getKoreanIpaPhonemes(query);
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

function getSelectedPronunciationMode() {
    for (const radio of pronunciationModeRadios) {
        if (radio.checked) return radio.value;
    }
    return 'hybrid';
}

function getPronunciationModeLabel(mode) {
    if (mode === 'native') return '실제 영어';
    if (mode === 'koreanized') return '한국식 영어';
    return '혼합 추천';
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

function calculatePronunciationScore(item, queryPhonemeData, detailMultipliers, mode) {
    const nativePhonemes = item.phonemes || item.vowels || [];
    const queryNative = queryPhonemeData.phonemes || [];
    const queryKoreanizedCandidates = queryPhonemeData.koreanizedCandidates || [
        { phonemes: queryPhonemeData.koreanizedPhonemes || queryNative, label: '한국식' }
    ];

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
                candidates.push(scoreCandidate(targetCandidate.phonemes, queryCandidate.phonemes, [], 'koreanized', targetCandidate.label));
            });
        });
    } else {
        candidates.push(scoreCandidate(nativePhonemes, queryNative, detailMultipliers, 'native', '실제', 0.98));

        koreanizedCandidates.forEach(targetCandidate => {
            queryKoreanizedCandidates.forEach(queryCandidate => {
                candidates.push(scoreCandidate(targetCandidate.phonemes, queryCandidate.phonemes, [], 'koreanized', targetCandidate.label));
                candidates.push(scoreCandidate(nativePhonemes, queryCandidate.phonemes, [], 'bridge', '교차', 0.92));
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

function extractSemanticVectorStore(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    if (data.words && typeof data.words === 'object' && !Array.isArray(data.words)) return data.words;
    if (data.vectors && typeof data.vectors === 'object' && !Array.isArray(data.vectors)) return data.vectors;
    return data;
}

function getSemanticVectorStore(lang) {
    return semanticVectorStores[lang] || {};
}

function getSemanticVectorCount(lang = null) {
    if (lang) return Object.keys(getSemanticVectorStore(lang)).length;
    return Object.keys(getSemanticVectorStore('ko')).length + Object.keys(getSemanticVectorStore('en')).length;
}

function normalizeSemanticKey(word) {
    return String(word || '')
        .trim()
        .toLowerCase()
        .replace(/[‘’]/g, "'")
        .replace(/^[\s"'([{]+|[\s"'\])}.!,?:;]+$/g, '');
}

function hasHangul(text) {
    return /[가-힣]/.test(String(text || ''));
}

function asVector(value) {
    return Array.isArray(value) ? value : null;
}

function getSemanticVector(word, lang) {
    const store = getSemanticVectorStore(lang);
    const key = normalizeSemanticKey(word);
    const vector = store[key] || store[word];
    return asVector(vector);
}

function getTranslatedTopics(topicWord) {
    const key = normalizeSemanticKey(topicWord);
    const direct = topicTranslations[key] || topicTranslations[topicWord];
    const values = Array.isArray(direct) ? direct : direct ? [direct] : [];
    return values
        .map(value => normalizeSemanticKey(value))
        .filter(Boolean);
}

async function translateTopicToEnglish(topicWord) {
    const key = normalizeSemanticKey(topicWord);
    if (!key || !hasHangul(key) || getTranslatedTopics(key).length > 0) {
        return getTranslatedTopics(key);
    }

    try {
        const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodeURIComponent(topicWord)}`);
        if (!response.ok) return [];

        const data = await response.json();
        const translated = data && data[0] && data[0][0] && data[0][0][0]
            ? normalizeSemanticKey(data[0][0][0])
            : '';
        if (!translated) return [];

        topicTranslations[key] = [translated];
        saveTopicTranslationCache();
        return topicTranslations[key];
    } catch (error) {
        console.warn('Topic translation failed:', error);
        return [];
    }
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return null;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return null;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildSemanticContext(topicWord, topicWeight) {
    const cleanTopic = String(topicWord || '').trim();
    if (!cleanTopic || topicWeight <= 0) {
        return { active: false, topicWord: cleanTopic, topicWeight: 0, koTopicVector: null, enTopicVectors: [], translatedTopics: [] };
    }

    const translatedTopics = getTranslatedTopics(cleanTopic);
    const englishTopicCandidates = hasHangul(cleanTopic)
        ? translatedTopics
        : [normalizeSemanticKey(cleanTopic), ...translatedTopics];
    const enTopicVectors = englishTopicCandidates
        .map(topic => getSemanticVector(topic, 'en'))
        .filter(Boolean);
    const koTopicVector = getSemanticVector(cleanTopic, 'ko');

    return {
        active: Boolean(koTopicVector || enTopicVectors.length > 0),
        topicWord: cleanTopic,
        topicWeight,
        koTopicVector,
        enTopicVectors,
        translatedTopics
    };
}

function getCandidateSemanticVectors(item) {
    const vectors = [];
    const lang = item.lang === 'ko' ? 'ko' : 'en';
    const directVector = getSemanticVector(item.word, lang) || getSemanticVector(item.display, lang);
    if (directVector) vectors.push({ lang, vector: directVector });

    if (item.lang === 'en') {
        getLoanwordForms(item.word).forEach(form => {
            const koVector = getSemanticVector(form, 'ko');
            if (koVector) vectors.push({ lang: 'ko', vector: koVector });
        });
    }

    return vectors;
}

function getBestSemanticSimilarity(item, semanticContext) {
    const candidates = getCandidateSemanticVectors(item);
    let best = null;

    candidates.forEach(candidate => {
        const topicVectors = candidate.lang === 'ko'
            ? semanticContext.koTopicVector ? [semanticContext.koTopicVector] : []
            : semanticContext.enTopicVectors;

        topicVectors.forEach(topicVector => {
            const similarity = cosineSimilarity(topicVector, candidate.vector);
            if (similarity !== null && (best === null || similarity > best)) {
                best = similarity;
            }
        });
    });

    return best;
}

function applySemanticWeight(score, item, semanticContext) {
    if (!semanticContext.active) return { score, similarity: null, matched: true };

    const similarity = getBestSemanticSimilarity(item, semanticContext);
    if (similarity === null) return { score, similarity: null, matched: false };

    const normalizedSimilarity = Math.max(0, Math.min(1, (similarity + 1) / 2));
    const maxPenalty = semanticContext.topicWeight / 10 * 0.7;
    const penalty = (1 - normalizedSimilarity) * maxPenalty;

    return {
        score: score * (1 - penalty),
        similarity,
        matched: true
    };
}

function displayResults(results) {
    currentFilteredResults = results;
    resultsShown = 0;
    resultsList.innerHTML = '';
    
    if (results.length === 0) {
        resultsList.innerHTML = '<li>검색 결과가 없습니다.</li>';
        loadMoreBtn.style.display = 'none';
        return;
    }

    renderMoreResults();
}

function renderMoreResults() {
    const chunk = currentFilteredResults.slice(resultsShown, resultsShown + PAGE_SIZE);

    chunk.forEach(res => {
        const li = document.createElement('li');
        li.className = 'result-item';
        li.dataset.word = res.word;
        li.dataset.lang = res.lang;
        
        // Display the pronunciation layer that actually won the match.
        const displayPhonemes = res.matchPhonemes || res.phonemes || res.vowels || [];
        const phonemesHtml = displayPhonemes.map((p, idx) => {
            if (res.matchIndices && res.matchIndices.includes(idx)) {
                return `<span style="color: #3498db; font-weight: bold;">${p}</span>`;
            }
            return p;
        }).join(', ');
        const matchLayerBadge = res.matchLayerLabel ? `<span class="layer-badge">${res.matchLayerLabel}</span>` : '';
        const semanticHtml = res.semanticSimilarity !== null && res.semanticSimilarity !== undefined
            ? `<div class="semantic-score">주제 유사도: ${(((res.semanticSimilarity + 1) / 2) * 100).toFixed(1)}%</div>`
            : '';

        li.innerHTML = `
            <div class="result-score">환산 유사도 : ${res.score.toFixed(1)}%</div>
            ${semanticHtml}
            <div class="result-word">
                <span>${res.display}</span>
                <img src="sound_icon.png" class="tts-icon" onclick="playTTS('${res.word.replace(/'/g, "\\'")}', '${res.lang}')" alt="Listen" title="발음 듣기"/>
            </div>
            <div class="result-meta">
                <span>[${phonemesHtml}]</span>
                <div class="badge-container">
                    <span class="lang-badge ${res.lang}">${res.lang === 'ko' ? '한국어' : '영어'}</span>
                    ${matchLayerBadge}
                </div>
            </div>
            <div class="result-meaning">
                <div class="meaning-spinner"></div>
            </div>
        `;
        resultsList.appendChild(li);
        meaningObserver.observe(li);
    });

    resultsShown += chunk.length;

    if (resultsShown >= currentFilteredResults.length) {
        loadMoreBtn.style.display = 'none';
    } else {
        loadMoreBtn.style.display = 'block';
    }
}

loadMoreBtn.addEventListener('click', renderMoreResults);

async function handleSearch() {
    if (!isReady) return;
    const query = searchInput.value.trim();
    if (!query) return;

    let selectedLang = 'all';
    for (const radio of langRadios) {
        if (radio.checked) selectedLang = radio.value;
    }
    const pronunciationMode = getSelectedPronunciationMode();
    const topicWord = topicInput.value.trim();
    const topicWeight = parseFloat(topicWeightInput.value);
    let semanticContext = buildSemanticContext('', 0);

    if (query !== lastQueryWord) {
        currentQueryPhonemeData = getQueryPhonemes(query);
        lastQueryWord = query;
        renderDetailSliders(); // Generate sliders for the new word
    }
    
    const queryPhonemes = currentQueryPhonemeData.phonemes;
    
    if (queryPhonemes.length === 0) {
        statusEl.textContent = '해당 단어의 발음을 분석할 수 없습니다.';
        return;
    }

    if (topicWord && topicWeight > 0) {
        statusEl.textContent = '주제 의미 벡터를 불러오는 중입니다...';
        await ensureSemanticResourcesLoaded();
        await translateTopicToEnglish(topicWord);
        semanticContext = buildSemanticContext(topicWord, topicWeight);
    }

    const translatedTopicText = semanticContext.translatedTopics && semanticContext.translatedTopics.length > 0
        ? ` → ${semanticContext.translatedTopics.slice(0, 2).join(', ')}`
        : '';
    const topicText = topicWord
        ? semanticContext.active
            ? ` / 주제: ${topicWord}${translatedTopicText}`
            : ` / 주제 벡터 없음: ${topicWord}`
        : '';
    statusEl.textContent = `"${query}"의 발음 [${queryPhonemes.join(', ')}]와 비슷한 단어를 찾습니다... (${getPronunciationModeLabel(pronunciationMode)}${topicText})`;

    let freqWeight = parseFloat(freqWeightInput.value);

    // Build detail multipliers array
    let detailMultipliers = new Array(queryPhonemes.length).fill(1.0);
    if (useDetailWeights.checked && currentQueryPhonemeData.charMap.length > 0) {
        currentQueryPhonemeData.charMap.forEach((item, index) => {
            const slider = document.getElementById(`detailWeight_${index}`);
            let mult = slider ? parseFloat(slider.value) : 1.0;
            for (let i = item.startIndex; i < item.endIndex; i++) {
                detailMultipliers[i] = mult;
            }
        });
    }

    // Get excluded words
    const excludeStr = excludeInput.value.trim();
    let excludeWords = [];
    if (excludeStr) {
        excludeWords = excludeStr.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    }

    // Filter and score
    let results = [];
    for (const item of dictionary) {
        if (selectedLang !== 'all' && item.lang !== selectedLang) continue;
        
        // Skip exact same word
        if (item.word.toLowerCase() === query.toLowerCase()) continue;

        // Skip excluded words
        if (excludeWords.length > 0) {
            const lowerWord = item.word.toLowerCase();
            let isExcluded = false;
            for (const exWord of excludeWords) {
                if (lowerWord.includes(exWord)) {
                    isExcluded = true;
                    break;
                }
            }
            if (isExcluded) continue;
        }

        const result = calculatePronunciationScore(item, currentQueryPhonemeData, detailMultipliers, pronunciationMode);
        if (!result || typeof result.score !== 'number' || !Number.isFinite(result.score)) continue;
        
        // Base score threshold to filter out completely irrelevant words
        if (result.score > 40) { 
            let zipf = item.zipf !== undefined ? item.zipf : 1.0; // Default 1.0 if not found
            let totalScore = applyFrequencyWeight(result.score, zipf, freqWeight);
            let semanticResult = { score: totalScore, similarity: null, matched: true };
            if (semanticContext.active) {
                semanticResult = applySemanticWeight(totalScore, item, semanticContext);
                if (!semanticResult.matched) continue;
                totalScore = semanticResult.score;
            }

            results.push({
                ...item,
                score: totalScore,
                matchIndices: result.matchIndices,
                matchPhonemes: result.matchPhonemes,
                matchLayer: result.matchLayer,
                matchLayerLabel: result.matchLayerLabel,
                semanticSimilarity: semanticResult.similarity
            });
        }
    }

    // Sort by score (desc)
    results.sort((a, b) => b.score - a.score);

    displayResults(results);
}

searchBtn.addEventListener('click', handleSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});
excludeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});
topicInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});

function renderDetailSliders() {
    detailSlidersContainer.innerHTML = '';
    reSearchBtn.style.display = 'block';
    
    if (currentQueryPhonemeData.charMap.length === 0) {
        detailSlidersContainer.innerHTML = '<div class="empty-detail-msg" style="color: #64748b; font-size: 0.9rem; text-align: center; margin-top: 2rem;">검색어의 발음을 분석할 수 없습니다.</div>';
        return;
    }
    
    currentQueryPhonemeData.charMap.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'slider-container detail-slider-container';
        div.innerHTML = `
            <label for="detailWeight_${index}">[ ${item.char} ] 가중치</label>
            <div class="slider-row">
                <input type="range" id="detailWeight_${index}" min="0" max="10" step="0.5" value="1.0">
                <span id="detailVal_${index}" class="slider-val">1.0</span>
            </div>
        `;
        detailSlidersContainer.appendChild(div);
        
        const input = document.getElementById(`detailWeight_${index}`);
        const valSpan = document.getElementById(`detailVal_${index}`);
        input.addEventListener('input', () => {
            valSpan.textContent = parseFloat(input.value).toFixed(1);
        });
    });
}

// TTS Function
// Load voices in advance
let synthVoices = [];
if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {
        synthVoices = window.speechSynthesis.getVoices();
    };
}

window.playTTS = function(word, lang) {
    if (!window.speechSynthesis) {
        alert("이 브라우저는 TTS(음성 합성)를 지원하지 않습니다.");
        return;
    }

    // Ensure voices are loaded
    if (synthVoices.length === 0) {
        synthVoices = window.speechSynthesis.getVoices();
    }

    const utterance = new SpeechSynthesisUtterance(word);
    
    if (lang === 'ko') {
        utterance.lang = 'ko-KR';
        const koVoices = synthVoices.filter(v => v.lang.startsWith('ko'));
        // Prefer Google's high quality network voices if available
        const bestVoice = koVoices.find(v => v.name.includes('Google') || v.name.includes('Premium')) || koVoices[0];
        if (bestVoice) {
            utterance.voice = bestVoice;
        }
        // Adjust rate and pitch to make default Windows/Mac voices sound more natural
        utterance.rate = 0.85; 
        utterance.pitch = 1.0;
    } else {
        utterance.lang = 'en-US';
        const enVoices = synthVoices.filter(v => v.lang.startsWith('en'));
        const bestVoice = enVoices.find(v => v.name.includes('Google') || v.name.includes('Premium')) || enVoices[0];
        if (bestVoice) {
            utterance.voice = bestVoice;
        }
    }

    window.speechSynthesis.cancel(); // Stop any currently playing TTS
    window.speechSynthesis.speak(utterance);
}

// Init
loadDictionary();
