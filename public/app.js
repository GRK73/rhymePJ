let dictionary = [];
let isReady = false;

const statusEl = document.getElementById('status');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsList = document.getElementById('resultsList');
const langRadios = document.getElementsByName('lang');

// Load dictionary
async function loadDictionary() {
    try {
        const response = await fetch('rhyme_dict.json');
        if (!response.ok) throw new Error('Network response was not ok');
        dictionary = await response.json();
        isReady = true;
        statusEl.textContent = `사전 로드 완료! (총 ${dictionary.length.toLocaleString()} 단어)`;
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

const koreanToIpa = {
    'ㅏ': ['a'], 'ㅐ': ['ɛ'], 'ㅑ': ['ja'], 'ㅒ': ['jɛ'], 'ㅓ': ['ʌ'], 'ㅔ': ['e'],
    'ㅕ': ['jʌ'], 'ㅖ': ['je'], 'ㅗ': ['o'], 'ㅘ': ['wa'], 'ㅙ': ['wɛ'], 'ㅚ': ['we'],
    'ㅛ': ['jo'], 'ㅜ': ['u'], 'ㅝ': ['wʌ'], 'ㅞ': ['we'], 'ㅟ': ['wi'], 'ㅠ': ['ju'],
    'ㅡ': ['ɯ'], 'ㅢ': ['ɰi'], 'ㅣ': ['i']
};

const KOREAN_VOWELS = [
    'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 
    'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'
];

function getKoreanIpaVowels(word) {
    const vowels = [];
    for (let i = 0; i < word.length; i++) {
        const code = word.charCodeAt(i);
        if (code >= 44032 && code <= 55203) { // 가 ~ 힣
            const charCode = code - 44032;
            const jong = charCode % 28;
            const jung = ((charCode - jong) / 28) % 21;
            const jungChar = KOREAN_VOWELS[jung];
            if (koreanToIpa[jungChar]) {
                vowels.push(...koreanToIpa[jungChar]);
            }
        } else if (koreanToIpa[word[i]]) {
            vowels.push(...koreanToIpa[word[i]]);
        }
    }
    return vowels;
}

function getQueryVowels(query) {
    const isKorean = /[가-힣]/.test(query);
    if (isKorean) {
        return getKoreanIpaVowels(query);
    } else {
        const lowerQuery = query.toLowerCase();
        const found = dictionary.find(d => d.word === lowerQuery && d.lang === 'en');
        if (found) {
            return found.vowels;
        }
        return [];
    }
}

function get_score_1d(ipa1, ipa2) {
    if (ipa1 === ipa2) return 1.0;
    const v1 = ipaFeatures[ipa1];
    const v2 = ipaFeatures[ipa2];
    if (!v1 || !v2) return 0;
    
    let score = 1.0;
    score *= 1 - Math.abs(v1[0] - v2[0]);
    score *= 1 - Math.abs(v1[1] - v2[1]);
    score *= 1 - Math.abs(v1[2] - v2[2]);
    return Math.max(0, score);
}

function calculateScore(targetVowels, queryVowels) {
    if (queryVowels.length === 0 || targetVowels.length === 0) return 0;
    
    const targetStr = targetVowels.join('');
    const queryStr = queryVowels.join('');

    if (targetStr === queryStr) return 100;

    if (targetStr.includes(queryStr)) {
        return 80 - (targetVowels.length - queryVowels.length); 
    }

    // Phonetic DP algorithm based on PronunciationEvaluator
    let previousRow = Array.from({length: queryVowels.length + 1}, (_, i) => i);
    
    for (let i = 0; i < targetVowels.length; i++) {
        let currentRow = [i + 1];
        for (let j = 0; j < queryVowels.length; j++) {
            let insertions = previousRow[j + 1] + 1;
            let deletions = currentRow[j] + 1;
            let substitutions = previousRow[j] + (1 - get_score_1d(targetVowels[i], queryVowels[j]));
            currentRow.push(Math.min(insertions, deletions, substitutions));
        }
        previousRow = currentRow;
    }
    
    let dist = previousRow[queryVowels.length];
    let maxLen = Math.max(targetVowels.length, queryVowels.length);
    let dpScore = Math.max(1 - (dist / maxLen), 0) * 80;

    // Sliding window phonetic match for rhyme substring matching
    let maxSlidingScore = 0;
    if (targetVowels.length >= queryVowels.length) {
        for (let i = 0; i <= targetVowels.length - queryVowels.length; i++) {
            let currentScore = 0;
            for (let j = 0; j < queryVowels.length; j++) {
                currentScore += get_score_1d(targetVowels[i+j], queryVowels[j]);
            }
            let percentage = (currentScore / queryVowels.length) * 75; 
            if (percentage > maxSlidingScore) maxSlidingScore = percentage;
        }
    }
    
    return Math.max(dpScore, maxSlidingScore);
}

function displayResults(results) {
    resultsList.innerHTML = '';
    
    if (results.length === 0) {
        resultsList.innerHTML = '<li>검색 결과가 없습니다.</li>';
        return;
    }

    results.forEach(res => {
        const li = document.createElement('li');
        li.className = 'result-item';
        li.innerHTML = `
            <div class="result-word">${res.display}</div>
            <div class="result-meta">
                <span>[${res.vowels.join(', ')}]</span>
                <span class="lang-badge ${res.lang}">${res.lang === 'ko' ? '한국어' : '영어'}</span>
            </div>
        `;
        resultsList.appendChild(li);
    });
}

function handleSearch() {
    if (!isReady) return;
    const query = searchInput.value.trim();
    if (!query) return;

    let selectedLang = 'all';
    for (const radio of langRadios) {
        if (radio.checked) selectedLang = radio.value;
    }

    const queryVowels = getQueryVowels(query);
    if (queryVowels.length === 0) {
        statusEl.textContent = '해당 단어의 모음/발음을 분석할 수 없습니다.';
        return;
    }

    statusEl.textContent = `"${query}"의 모음 [${queryVowels.join(', ')}]와 비슷한 단어를 찾습니다...`;

    // Filter and score
    let results = [];
    for (const item of dictionary) {
        if (selectedLang !== 'all' && item.lang !== selectedLang) continue;
        
        // Skip exact same word
        if (item.word.toLowerCase() === query.toLowerCase()) continue;

        const score = calculateScore(item.vowels, queryVowels);
        if (score > 50) { // Only high confidence matches
            results.push({ ...item, score });
        }
    }

    // Sort by score (desc) and limit to top 100
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, 100);

    displayResults(topResults);
}

searchBtn.addEventListener('click', handleSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});

// Init
loadDictionary();