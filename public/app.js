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
        const response = await fetch('rhyme_dict_practical.json');
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

function getKoreanIpaPhonemes(word) {
    const phonemes = [];
    for (let i = 0; i < word.length; i++) {
        const code = word.charCodeAt(i);
        if (code >= 44032 && code <= 55203) {
            const charCode = code - 44032;
            const jong = charCode % 28;
            const jung = ((charCode - jong) / 28) % 21;
            const cho = Math.floor(charCode / (28 * 21));
            
            if (KOREAN_CHO[cho] !== '') phonemes.push(KOREAN_CHO[cho]);
            phonemes.push(KOREAN_JUNG[jung]);
            if (KOREAN_JONG_MAPPED[jong] !== '') phonemes.push(KOREAN_JONG_MAPPED[jong]);
        }
    }
    return phonemes;
}

function getQueryPhonemes(query) {
    const isKorean = /[가-힣]/.test(query);
    if (isKorean) {
        return getKoreanIpaPhonemes(query);
    } else {
        const lowerQuery = query.toLowerCase();
        const found = dictionary.find(d => d.word === lowerQuery && d.lang === 'en');
        if (found) {
            return found.phonemes;
        }
        return [];
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

function calculateScore(targetPhonemes, queryPhonemes) {
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
    for (let i = 0; i <= targetPhonemes.length; i++) dpMatrix[i][0] = i;
    for (let j = 0; j <= queryPhonemes.length; j++) dpMatrix[0][j] = j;

    for (let i = 1; i <= targetPhonemes.length; i++) {
        for (let j = 1; j <= queryPhonemes.length; j++) {
            let insertions = dpMatrix[i][j - 1] + 1;
            let deletions = dpMatrix[i - 1][j] + 1;
            let substitutions = dpMatrix[i - 1][j - 1] + (1 - get_score_1d(targetPhonemes[i - 1], queryPhonemes[j - 1]));
            dpMatrix[i][j] = Math.min(insertions, deletions, substitutions);
        }
    }
    
    let dist = dpMatrix[targetPhonemes.length][queryPhonemes.length];
    let maxLen = Math.max(targetPhonemes.length, queryPhonemes.length);
    let dpScore = Math.max(1 - (dist / maxLen), 0) * 80;

    // Backtrack to find matched indices
    let dpIndices = [];
    let i = targetPhonemes.length;
    let j = queryPhonemes.length;
    while (i > 0 && j > 0) {
        let current = dpMatrix[i][j];
        let sub = dpMatrix[i-1][j-1];
        let ins = dpMatrix[i][j-1];
        let rm = dpMatrix[i-1][j];
        
        let cost = 1 - get_score_1d(targetPhonemes[i-1], queryPhonemes[j-1]);
        // Javascript floating point comparison workaround
        if (Math.abs(current - (sub + cost)) < 0.001) {
            if (cost < 0.6) { // If similarity is > 0.4
                dpIndices.push(i-1);
            }
            i--; j--;
        } else if (current === rm + 1) {
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
            let currentIndices = [];
            for (let j = 0; j < queryPhonemes.length; j++) {
                let s = get_score_1d(targetPhonemes[i+j], queryPhonemes[j]);
                currentScore += s;
                if (s > 0.4) {
                    currentIndices.push(i + j);
                }
            }
            let percentage = (currentScore / queryPhonemes.length) * 80; 
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

function displayResults(results) {
    resultsList.innerHTML = '';
    
    if (results.length === 0) {
        resultsList.innerHTML = '<li>검색 결과가 없습니다.</li>';
        return;
    }

    results.forEach(res => {
        const li = document.createElement('li');
        li.className = 'result-item';
        // 'phonemes' array is displayed
        const displayPhonemes = res.phonemes || res.vowels || [];
        const phonemesHtml = displayPhonemes.map((p, idx) => {
            if (res.matchIndices && res.matchIndices.includes(idx)) {
                return `<span style="color: #3498db; font-weight: bold;">${p}</span>`;
            }
            return p;
        }).join(', ');

        li.innerHTML = `
            <div class="result-word">${res.display}</div>
            <div class="result-meta">
                <span>[${phonemesHtml}]</span>
                <div class="badge-container">
                    <img src="sound_icon.png" class="tts-icon" onclick="playTTS('${res.word.replace(/'/g, "\\'")}', '${res.lang}')" alt="Listen" title="발음 듣기"/>
                    <span class="lang-badge ${res.lang}">${res.lang === 'ko' ? '한국어' : '영어'}</span>
                </div>
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

    const queryPhonemes = getQueryPhonemes(query);
    if (queryPhonemes.length === 0) {
        statusEl.textContent = '해당 단어의 발음을 분석할 수 없습니다.';
        return;
    }

    statusEl.textContent = `"${query}"의 발음 [${queryPhonemes.join(', ')}]와 비슷한 단어를 찾습니다...`;

    // Filter and score
    let results = [];
    for (const item of dictionary) {
        if (selectedLang !== 'all' && item.lang !== selectedLang) continue;
        
        // Skip exact same word
        if (item.word.toLowerCase() === query.toLowerCase()) continue;

        const phonemes = item.phonemes || item.vowels || []; // Backwards compatibility just in case
        const result = calculateScore(phonemes, queryPhonemes);
        if (result.score > 50) { // Only high confidence matches
            results.push({ ...item, score: result.score, matchIndices: result.matchIndices });
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

// TTS Function
window.playTTS = function(word, lang) {
    if (!window.speechSynthesis) {
        alert("이 브라우저는 TTS(음성 합성)를 지원하지 않습니다.");
        return;
    }
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = lang === 'ko' ? 'ko-KR' : 'en-US';
    window.speechSynthesis.cancel(); // Stop any currently playing TTS
    window.speechSynthesis.speak(utterance);
}

// Init
loadDictionary();