const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Hangul = require('hangul-js');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUTPUT_FILE = path.join(PUBLIC_DIR, 'rhyme_dict.json');

// Vowel mapping from ARPAbet to IPA vowels
const arpaToIpa = {
    'AA': ['ɑ'], 'AE': ['æ'], 'AH': ['ʌ'], 'AO': ['ɔ'], 'AW': ['aʊ'],
    'AY': ['aɪ'], 'EH': ['ɛ'], 'ER': ['ɚ'], 'EY': ['eɪ'], 'IH': ['ɪ'],
    'IY': ['i'], 'OW': ['oʊ'], 'OY': ['ɔɪ'], 'UH': ['ʊ'], 'UW': ['u']
};

function getEnglishVowels(arpaPhonemes) {
    const vowels = [];
    const phonemes = arpaPhonemes.split(' ');
    for (let p of phonemes) {
        // Remove stress numbers (0, 1, 2)
        const basePhoneme = p.replace(/[0-9]/g, '');
        if (arpaToIpa[basePhoneme]) {
            vowels.push(...arpaToIpa[basePhoneme]);
        }
    }
    return vowels;
}

// Allowed IPA vowels matching our feature set
const allowedIpa = {
    'i': ['i'], 'ɯ': ['ɯ'], 'u': ['u'], 'ɛ': ['ɛ'], 'ʌ': ['ʌ'], 'o': ['o'],
    'a': ['a'], 'ɑ': ['ɑ'], 'æ': ['æ'], 'e': ['e'], 'ɔ': ['ɔ'], 'ɪ': ['ɪ'], 'ʊ': ['ʊ'],
    'ə': ['ə'], 'ɚ': ['ɚ'], 'aɪ': ['aɪ'], 'eɪ': ['eɪ'], 'ɔɪ': ['ɔɪ'], 'aʊ': ['aʊ'], 'oʊ': ['oʊ'],
    'ju': ['ju'], 'jʌ': ['jʌ'], 'jo': ['jo'], 'jɛ': ['jɛ'], 'ja': ['ja'], 'je': ['je'],
    'wi': ['wi'], 'wʌ': ['wʌ'], 'wɛ': ['wɛ'], 'wa': ['wa'], 'we': ['we'], 'ɰi': ['ɰi']
};

function getEnglishVowelsFromIpa(ipaString) {
    const vowels = [];
    // Match two-character vowels first, then single characters
    const regex = /aɪ|eɪ|ɔɪ|aʊ|oʊ|ju|jʌ|jo|jɛ|ja|je|wi|wʌ|wɛ|wa|we|ɰi|i|ɯ|u|ɛ|ʌ|o|a|ɑ|æ|e|ɔ|ɪ|ʊ|ə|ɚ/g;
    let match;
    while ((match = regex.exec(ipaString)) !== null) {
        if (allowedIpa[match[0]]) {
            vowels.push(...allowedIpa[match[0]]);
        }
    }
    return vowels;
}

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

function getKoreanVowels(word) {
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
        } else if (koreanToIpa[word[i]]) { // standalone vowel
            vowels.push(...koreanToIpa[word[i]]);
        }
    }
    return vowels;
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
            
            // Format: WORD  PHONEME1 PHONEME2 ...
            const parts = line.trim().split('  ');
            if (parts.length === 2) {
                const wordRaw = parts[0];
                const phonemes = parts[1];
                
                // Skip words with symbols (like ! or .)
                if (/[^A-Za-z\(\)0-9]/.test(wordRaw)) continue;
                
                const word = wordRaw.replace(/\([0-9]+\)/, '').toLowerCase(); // Remove alternate pronunciation markers like (1)
                
                const vowels = getEnglishVowels(phonemes);
                if (vowels.length > 0) {
                    dict.push({
                        word: word,
                        lang: 'en',
                        vowels: vowels,
                        display: word
                    });
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
            
            // Format: word\t/IPA/, /IPA2/
            const parts = line.trim().split('\t');
            if (parts.length >= 2) {
                const word = parts[0].toLowerCase();
                if (processedEnWords.has(word)) continue; // Skip if already in CMUdict
                if (/[^a-z]/.test(word)) continue; // Skip words with symbols/numbers/spaces
                
                const ipaString = parts[1];
                const vowels = getEnglishVowelsFromIpa(ipaString);
                
                if (vowels.length > 0) {
                    dict.push({
                        word: word,
                        lang: 'en',
                        vowels: vowels,
                        display: word
                    });
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
                    const phonemes = line.substring(spaceIndex + 1).trim();
                    
                    // skip if it has numbers/symbols other than apostrophe
                    if (/[^a-zA-Z\']/.test(wordRaw)) continue; 
                    const word = wordRaw.toLowerCase();
                    if (processedEnWords.has(word)) continue; // Skip if already in CMUdict/ipa-dict
                    
                    const vowels = getEnglishVowels(phonemes);
                    if (vowels.length > 0) {
                        dict.push({
                            word: word,
                            lang: 'en',
                            vowels: vowels,
                            display: word
                        });
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
                // Ensure it's purely korean characters
                if (/^[가-힣]+$/.test(koWord)) {
                    const vowels = getKoreanVowels(koWord);
                    if (vowels.length > 0) {
                        dict.push({
                            word: koWord,
                            lang: 'ko',
                            vowels: vowels,
                            display: koWord
                        });
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
        const fallbacks = ['사과', '바나나', '기차', '나비', '파이팅', '와이퍼', '드라이기', '학교', '사랑', '바다', '아침', '저녁'];
        for (const w of fallbacks) {
            dict.push({
                word: w,
                lang: 'ko',
                vowels: getKoreanVowels(w),
                display: w
            });
        }
    }

    console.log(`Total dictionary size: ${dict.length} words.`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dict));
    console.log(`Saved dictionary to ${OUTPUT_FILE}`);
}

buildDict();