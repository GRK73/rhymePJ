const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Hangul = require('hangul-js');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUTPUT_FILE = path.join(PUBLIC_DIR, 'rhyme_dict.json');

// Vowel mapping from ARPAbet to IPA vowels
const arpaToIpaVowels = {
    'AA': ['ɑ'], 'AE': ['æ'], 'AH': ['ʌ'], 'AO': ['ɔ'], 'AW': ['aʊ'],
    'AY': ['aɪ'], 'EH': ['ɛ'], 'ER': ['ɚ'], 'EY': ['eɪ'], 'IH': ['ɪ'],
    'IY': ['i'], 'OW': ['oʊ'], 'OY': ['ɔɪ'], 'UH': ['ʊ'], 'UW': ['u']
};

// Consonant mapping from ARPAbet to IPA
const arpaToIpaConso = {
    'B': ['b'], 'CH': ['tʃ'], 'D': ['d'], 'DH': ['ð'], 'F': ['f'], 'G': ['ɡ'],
    'HH': ['h'], 'JH': ['dʒ'], 'K': ['k'], 'L': ['l'], 'M': ['m'], 'N': ['n'],
    'NG': ['ŋ'], 'P': ['p'], 'R': ['ɹ'], 'S': ['s'], 'SH': ['ʃ'], 'T': ['t'],
    'TH': ['θ'], 'V': ['v'], 'W': ['w'], 'Y': ['j'], 'Z': ['z'], 'ZH': ['ʒ']
};

function getEnglishPhonemes(arpaPhonemes) {
    const phonemes = [];
    const parts = arpaPhonemes.split(' ');
    for (let p of parts) {
        const basePhoneme = p.replace(/[0-9]/g, '');
        if (arpaToIpaVowels[basePhoneme]) {
            phonemes.push(...arpaToIpaVowels[basePhoneme]);
        } else if (arpaToIpaConso[basePhoneme]) {
            phonemes.push(...arpaToIpaConso[basePhoneme]);
        }
    }
    return phonemes;
}

// For IPA-dict, extract all relevant phonemes (vowels + consonants)
const allowedIpaRegex = /tʃ|dʒ|aɪ|eɪ|ɔɪ|aʊ|oʊ|ju|jʌ|jo|jɛ|ja|je|wi|wʌ|wɛ|wa|we|ɰi|tɕʰ|tɕ\*|tɕ|dʑ|pʰ|p\*|tʰ|t\*|kʰ|k\*|s\*|i|ɯ|u|ɛ|ʌ|o|a|ɑ|æ|e|ɔ|ɪ|ʊ|ə|ɚ|b|d|f|ɡ|h|k|l|m|n|ŋ|p|ɹ|s|ʃ|t|θ|ð|v|w|j|z|ʒ|ɾ/g;

function getEnglishPhonemesFromIpa(ipaString) {
    const phonemes = [];
    let match;
    while ((match = allowedIpaRegex.exec(ipaString)) !== null) {
        phonemes.push(match[0]);
    }
    return phonemes;
}

// Korean
const KOREAN_CHO = ['k', 'k*', 'n', 't', 't*', 'ɾ', 'm', 'p', 'p*', 's', 's*', '', 'tɕ', 'tɕ*', 'tɕʰ', 'kʰ', 'tʰ', 'pʰ', 'h'];
const KOREAN_JUNG = ['a', 'ɛ', 'ja', 'jɛ', 'ʌ', 'e', 'jʌ', 'je', 'o', 'wa', 'wɛ', 'we', 'jo', 'u', 'wʌ', 'we', 'wi', 'ju', 'ɯ', 'ɰi', 'i'];
const KOREAN_JONG_MAPPED = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ŋ', 't', 't', 'k', 't', 'p', 't'];

function getKoreanPhonemes(word) {
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
        } else if (code >= 12593 && code <= 12622) { // Standalone consonants
            // Skipping standalone consonants for simplicity
        } else if (code >= 12623 && code <= 12643) { // Standalone vowels
            const jungIdx = code - 12623;
            if (KOREAN_JUNG[jungIdx]) phonemes.push(KOREAN_JUNG[jungIdx]);
        }
    }
    return phonemes;
}

async function buildDict() {
    console.log('Starting dictionary build...');
    if (!fs.existsSync(PUBLIC_DIR)) {
        fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    }

    const dict = [];
    const processedEnWords = new Set();

    // 1. Fetch and process English Dictionary (CMU)
    console.log('Fetching English dictionary (CMU)...');
    try {
        const cmuRes = await axios.get('https://raw.githubusercontent.com/Alexir/CMUdict/master/cmudict-0.7b', { responseType: 'text' });
        const lines = cmuRes.data.split('\n');
        
        let count = 0;
        for (const line of lines) {
            if (line.startsWith(';;;') || line.trim() === '') continue;
            
            const parts = line.trim().split('  ');
            if (parts.length === 2) {
                const wordRaw = parts[0];
                const phonemesRaw = parts[1];
                
                if (/[^A-Za-z\(\)0-9]/.test(wordRaw)) continue;
                const word = wordRaw.replace(/\([0-9]+\)/, '').toLowerCase(); 
                
                const phonemes = getEnglishPhonemes(phonemesRaw);
                if (phonemes.length > 0) {
                    dict.push({ word: word, lang: 'en', phonemes: phonemes, display: word });
                    processedEnWords.add(word);
                    count++;
                }
            }
        }
        console.log(`Processed ${count} English words from CMU.`);
    } catch (err) {
        console.error('Failed to fetch English dictionary:', err.message);
    }

    // 1-2. Fetch and process English Dictionary (ipa-dict)
    console.log('Fetching English dictionary (ipa-dict)...');
    try {
        const ipaRes = await axios.get('https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt', { responseType: 'text' });
        const lines = ipaRes.data.split('\n');
        
        let countIpa = 0;
        for (const line of lines) {
            if (line.trim() === '') continue;
            const parts = line.trim().split('\t');
            if (parts.length >= 2) {
                const word = parts[0].toLowerCase();
                if (processedEnWords.has(word)) continue; 
                if (/[^a-z]/.test(word)) continue; 
                
                const ipaString = parts[1];
                const phonemes = getEnglishPhonemesFromIpa(ipaString);
                
                if (phonemes.length > 0) {
                    dict.push({ word: word, lang: 'en', phonemes: phonemes, display: word });
                    processedEnWords.add(word);
                    countIpa++;
                }
            }
        }
        console.log(`Processed ${countIpa} additional English words from ipa-dict.`);
    } catch (err) {
        console.error('Failed to fetch ipa-dict:', err.message);
    }

    // 1-3. Fetch and process English Dictionary (rhymez rap.phonemes)
    console.log('Fetching English dictionary (rhymez rap.phonemes)...');
    try {
        const rhymezPath = path.join(__dirname, '..', 'node_modules', 'rhymez', 'lib', 'data', 'rap.phonemes');
        if (fs.existsSync(rhymezPath)) {
            const lines = fs.readFileSync(rhymezPath, 'utf8').split('\n');
            let countRhymez = 0;
            for (const line of lines) {
                if (line.trim() === '') continue;
                
                const spaceIndex = line.indexOf(' ');
                if (spaceIndex !== -1) {
                    const wordRaw = line.substring(0, spaceIndex);
                    const phonemesRaw = line.substring(spaceIndex + 1).trim();
                    
                    if (/[^a-zA-Z\']/.test(wordRaw)) continue; 
                    const word = wordRaw.toLowerCase();
                    if (processedEnWords.has(word)) continue; 
                    
                    const phonemes = getEnglishPhonemes(phonemesRaw);
                    if (phonemes.length > 0) {
                        dict.push({ word: word, lang: 'en', phonemes: phonemes, display: word });
                        processedEnWords.add(word);
                        countRhymez++;
                    }
                }
            }
            console.log(`Processed ${countRhymez} additional English words from rhymez.`);
        } else {
            console.log('rhymez rap.phonemes not found, skipping.');
        }
    } catch (err) {
        console.error('Failed to fetch rhymez dictionary:', err.message);
    }

    // 2. Fetch and process Korean Dictionary
    console.log('Fetching Korean dictionary...');
    try {
        let items = [];
        let countKo = 0;
        const niklFile = path.join(__dirname, '..', 'public', 'nikl_words.json');
        
        if (fs.existsSync(niklFile)) {
            console.log('Found nikl_words.json! Using NIKL Standard Dictionary words.');
            items = JSON.parse(fs.readFileSync(niklFile, 'utf8'));
        } else {
            console.log('nikl_words.json not found. Falling back to default list.');
            const koRes = await axios.get('https://raw.githubusercontent.com/vbvss199/Language-Learning-decks/refs/heads/main/korean/korean.json');
            items = koRes.data;
        }
        const processedKoWords = new Set();
        
        for (const item of items) {
            let koWord = '';
            if (typeof item === 'string') koWord = item;
            else if (item.korean) koWord = item.korean;
            else if (item.word) koWord = item.word;
            else if (item.vocab) koWord = item.vocab;
            
            if (koWord && !processedKoWords.has(koWord)) {
                if (/^[가-힣]+$/.test(koWord)) {
                    const phonemes = getKoreanPhonemes(koWord);
                    if (phonemes.length > 0) {
                        dict.push({ word: koWord, lang: 'ko', phonemes: phonemes, display: koWord });
                        countKo++;
                        processedKoWords.add(koWord);
                    }
                }
            }
        }
        console.log(`Processed ${countKo} Korean words.`);
    } catch (err) {
        console.error('Failed to fetch Korean dictionary:', err.message);
        console.log('Generating fallback Korean words...');
        const fallbacks = ['사과', '바나나', '기차', '나비', '고양이', '슈퍼', '바라보기', '학교', '사랑', '바다', '아침', '점심'];
        for (const w of fallbacks) {
            dict.push({ word: w, lang: 'ko', phonemes: getKoreanPhonemes(w), display: w });
        }
    }

    console.log(`Total dictionary size: ${dict.length} words.`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dict));
    console.log(`Saved dictionary to ${OUTPUT_FILE}`);
}

buildDict();