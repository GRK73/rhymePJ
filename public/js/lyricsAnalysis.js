let lyricsAnalysisModels = null;
let lyricsAnalysisLoadingPromise = null;
let lyricsEnglishPhonemeLookup = null;
const lyricsPhonemeCache = new Map();

const LYRIC_TOKEN_RE = /[\uAC00-\uD7A3]+|[A-Za-z][A-Za-z']*/g;
const LYRIC_KO_RE = /^[\uAC00-\uD7A3]+$/;
const LYRIC_EN_RE = /^[a-z][a-z']*$/;
const LYRIC_HANGUL_RE = /[\uAC00-\uD7A3]/;
const LYRIC_CLEANUP_PUNCT_RE = /["“”‘’'.,!?;:()[\]{}<>…·]/g;
const LYRIC_SLIDING_RHYME_WEIGHTS = [
    { id: 'consonant', label: '자음 중심', vowel: 0, consonant: 1, threshold: 82 },
    { id: 'vowel', label: '모음 중심', vowel: 1, consonant: 0, threshold: 92 },
    { id: 'balanced', label: '모음 강조', vowel: 3, consonant: 1, threshold: 78 }
];
const LYRIC_ENGLISH_VOWEL_PHONEMES = new Set([
    'i', 'ɪ', 'u', 'ʊ', 'e', 'ɛ', 'æ', 'a', 'ɑ', 'ʌ', 'ə', 'ɚ', 'ɔ', 'o',
    'aɪ', 'eɪ', 'ɔɪ', 'aʊ', 'oʊ'
]);
const LYRIC_STRUCTURAL_RHYME_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const KOREAN_RHYME_VOWEL_CLASS = {
    0: 'a',
    1: 'e',
    2: 'ja',
    3: 'e',
    4: 'eo',
    5: 'e',
    6: 'jeo',
    7: 'e',
    8: 'o',
    9: 'wa',
    10: 'we',
    11: 'we',
    12: 'jo',
    13: 'u',
    14: 'wo',
    15: 'we',
    16: 'wi',
    17: 'ju',
    18: 'eu',
    19: 'i',
    20: 'i'
};
const LYRIC_STOPWORDS = new Set([
    '나', '난', '너', '넌', '우리', '내가', '네가', '그', '이', '저', '것', '수',
    '나는', '나를', '내', '네', '니', '너는', '너를', '너의', '더', '또', '다시',
    '아직', '위에', '아래', '까지', '속에', '처럼', '그리고', '하지만', '그래서',
    '하는', '하고', '해서', '있어', '없어', '이제', '이젠', '그냥', '정말', '너무',
    '어떤', '같은', '위해', '위한', '해야', '그렇게', '그래', '모두', '하나', '가지',
    '시간', '계속', '좋아요', '보면', '대한', '대해선',
    'a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for',
    'i', 'me', 'my', 'you', 'your', 'we', 'our', 'it', 'is', 'are', 'was',
    'im', "i'm", 'dont', "don't", 'ya', 'yeah', 'hey', 'oh', 'uh', 'ah', 'baby',
    'bout', 'something', 'one', 'more', 'just', 'little', 'go', 'way', 'up', 'now', 'no'
]);

function updateLyricsProgress(progress, label) {
    const progressEl = document.getElementById('lyricsProgress');
    const barEl = document.getElementById('lyricsProgressBar');
    const labelEl = document.getElementById('lyricsProgressLabel');
    const valueEl = document.getElementById('lyricsProgressValue');
    const resultLabelEl = document.getElementById('lyricsResultLoadingLabel');
    const resultValueEl = document.getElementById('lyricsResultLoadingValue');

    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    if (progressEl) progressEl.hidden = false;
    if (barEl) barEl.style.width = `${clamped}%`;
    if (labelEl) labelEl.textContent = label || '분석 중';
    if (valueEl) valueEl.textContent = `${clamped}%`;
    if (resultLabelEl) resultLabelEl.textContent = label || '분석 중';
    if (resultValueEl) resultValueEl.textContent = `${clamped}%`;
}

function yieldLyricsFrame() {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 0);
        }
    });
}

function normalizeLyricToken(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^[\s"'([{]+|[\s"'\])}.!,?:;]+$/g, '');
}

function normalizeLyricsInputForAnalysis(text) {
    return String(text || '')
        .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
        .replace(LYRIC_CLEANUP_PUNCT_RE, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .split(/\r?\n/)
        .map(line => line.replace(/[ \t]{2,}/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
}

function isUsefulLyricToken(token) {
    return token && token.length >= 2 && !LYRIC_STOPWORDS.has(token);
}

function tokenizeLyrics(text, keepStopwords = false) {
    const tokens = [];
    String(text || '').replace(LYRIC_TOKEN_RE, raw => {
        const token = normalizeLyricToken(raw);
        if (!token) return raw;
        if (!keepStopwords && !isUsefulLyricToken(token)) return raw;
        tokens.push(token);
        return raw;
    });
    return tokens;
}

function splitLyricsLines(text) {
    return normalizeLyricsInputForAnalysis(text)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function getLastLyricWord(line) {
    const tokens = tokenizeLyrics(line, true);
    return tokens[tokens.length - 1] || '';
}

function getLyricsEnglishPhonemeLookup() {
    if (lyricsEnglishPhonemeLookup) return lyricsEnglishPhonemeLookup;
    lyricsEnglishPhonemeLookup = new Map();
    if (Array.isArray(dictionary)) {
        dictionary.forEach(item => {
            if (item.lang !== 'en' || !Array.isArray(item.phonemes) || item.phonemes.length === 0) return;
            const word = normalizeLyricToken(item.word);
            if (!word || lyricsEnglishPhonemeLookup.has(word)) return;
            lyricsEnglishPhonemeLookup.set(word, item.phonemes);
        });
    }
    return lyricsEnglishPhonemeLookup;
}

function getLyricWordPhonemes(word) {
    const clean = normalizeLyricToken(word);
    if (!clean) return [];
    if (lyricsPhonemeCache.has(clean)) return lyricsPhonemeCache.get(clean);

    if (LYRIC_KO_RE.test(clean)) {
        if (typeof getKoreanStandardPronunciationCandidates === 'function') {
            const candidates = getKoreanStandardPronunciationCandidates(clean);
            if (candidates && candidates[0]?.phonemes?.length) {
                lyricsPhonemeCache.set(clean, candidates[0].phonemes);
                return candidates[0].phonemes;
            }
        }
        if (typeof getKoreanIpaPhonemes === 'function') {
            const phonemes = getKoreanIpaPhonemes(clean).phonemes || [];
            lyricsPhonemeCache.set(clean, phonemes);
            return phonemes;
        }
    }

    const exact = getLyricsEnglishPhonemeLookup().get(clean);
    if (exact?.length) {
        lyricsPhonemeCache.set(clean, exact);
        return exact;
    }

    if (typeof getQueryPhonemes === 'function') {
        const phonemes = getQueryPhonemes(clean).phonemes || [];
        lyricsPhonemeCache.set(clean, phonemes);
        return phonemes;
    }
    lyricsPhonemeCache.set(clean, []);
    return [];
}

function getKoreanRhymePart(char) {
    const code = char.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return '';
    const vowelIndex = Math.floor((code % 588) / 28);
    const finalIndex = code % 28;
    return `${KOREAN_RHYME_VOWEL_CLASS[vowelIndex] || vowelIndex}:${finalIndex}`;
}

function getKoreanBroadVowelClass(char) {
    const code = char.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return '';
    const vowelIndex = Math.floor((code % 588) / 28);
    const value = KOREAN_RHYME_VOWEL_CLASS[vowelIndex] || String(vowelIndex);
    if (['eo', 'jeo', 'jo', 'o', 'wo'].includes(value)) return 'open';
    if (['e', 'we'].includes(value)) return 'e';
    if (['i', 'wi'].includes(value)) return 'i';
    if (['u', 'ju'].includes(value)) return 'u';
    if (['a', 'ja', 'wa'].includes(value)) return 'a';
    return value;
}

function getKoreanBroadVowelPattern(value) {
    return Array.from(String(value || ''))
        .filter(char => LYRIC_HANGUL_RE.test(char))
        .map(getKoreanBroadVowelClass)
        .filter(Boolean);
}

function getKoreanBroadVowelSimilarity(leftValue, rightValue) {
    const left = getKoreanBroadVowelPattern(leftValue);
    const right = getKoreanBroadVowelPattern(rightValue);
    const width = Math.min(left.length, right.length);
    if (!width) return 0;
    let matches = 0;
    for (let index = 1; index <= width; index += 1) {
        if (left[left.length - index] === right[right.length - index]) matches += 1;
    }
    return matches;
}

function getKoreanSyllableRhymeSignature(word, preferredWidth = 0) {
    const clean = normalizeLyricToken(word);
    if (!LYRIC_KO_RE.test(clean)) return '';
    const chars = Array.from(clean);
    const width = Math.min(chars.length, preferredWidth || (chars.length >= 2 ? 2 : 1));
    const signatures = chars.slice(-width).map(char => {
        return getKoreanRhymePart(char);
    }).filter(Boolean);
    if (!signatures.length) return '';
    return `ko:${signatures.join('+')}`;
}

function getKoreanTailText(value, width = 2) {
    const text = String(value || '');
    const positions = [];
    Array.from(text).forEach((char, arrayIndex) => {
        if (LYRIC_HANGUL_RE.test(char)) {
            const offset = Array.from(text).slice(0, arrayIndex).join('').length;
            positions.push({ char, offset });
        }
    });
    if (positions.length === 0) return '';
    const selected = positions.slice(-Math.min(width, positions.length));
    const start = selected[0].offset;
    const last = selected[selected.length - 1];
    return text.slice(start, last.offset + last.char.length).trim();
}

function getKoreanTailSignature(value, width = 2) {
    const tail = getKoreanTailText(value, width);
    const chars = Array.from(tail).filter(char => LYRIC_HANGUL_RE.test(char));
    if (!chars.length) return '';
    return getKoreanSyllableRhymeSignature(chars.join(''), Math.min(width, chars.length));
}

function getKoreanRhymeWindowTexts(value, targetSignature, width = 2) {
    if (!targetSignature || !targetSignature.startsWith('ko:')) return [];
    const text = String(value || '');
    const hangul = [];
    Array.from(text).forEach((char, arrayIndex) => {
        if (!LYRIC_HANGUL_RE.test(char)) return;
        const offset = Array.from(text).slice(0, arrayIndex).join('').length;
        hangul.push({ char, offset });
    });
    if (hangul.length < width) return [];

    const matches = [];
    for (let index = 0; index <= hangul.length - width; index += 1) {
        const slice = hangul.slice(index, index + width);
        const signature = getKoreanSyllableRhymeSignature(slice.map(row => row.char).join(''), width);
        if (signature !== targetSignature) continue;
        const start = slice[0].offset;
        const last = slice[slice.length - 1];
        matches.push(text.slice(start, last.offset + last.char.length).trim());
    }
    return [...new Set(matches.filter(Boolean))];
}

function isLyricVowelPhoneme(phoneme) {
    return LYRIC_ENGLISH_VOWEL_PHONEMES.has(phoneme)
        || (typeof ipaFeatures !== 'undefined' && Boolean(ipaFeatures[phoneme]));
}

function getEnglishRhymeCore(phonemes) {
    if (!Array.isArray(phonemes) || phonemes.length === 0) return [];
    for (let index = phonemes.length - 1; index >= 0; index -= 1) {
        if (isLyricVowelPhoneme(phonemes[index])) {
            return phonemes.slice(index);
        }
    }
    return phonemes.slice(-Math.min(2, phonemes.length));
}

function getEnglishRhymeSignatureFromPhonemes(phonemes) {
    const core = getEnglishRhymeCore(phonemes);
    return core.length ? `en:${core.join('|')}` : '';
}

function getLineEndingRhymeData(line) {
    const endingWord = getLastLyricWord(line);
    if (LYRIC_EN_RE.test(normalizeLyricToken(endingWord))) {
        return {
            signature: getRhymeSignature(endingWord),
            text: endingWord
        };
    }

    const koreanTailText = getKoreanTailText(line, 2);
    const koreanSignature = getKoreanTailSignature(koreanTailText, 2);
    if (koreanSignature) {
        return {
            signature: koreanSignature,
            text: koreanTailText
        };
    }
    return {
        signature: getRhymeSignature(endingWord),
        text: endingWord
    };
}

function isWeakKoreanSentenceEnding(word) {
    const clean = normalizeLyricToken(word);
    if (!LYRIC_KO_RE.test(clean)) return false;
    if (clean.length <= 1) return false;
    return /(다|요|니다|습니다|였다|었다|했다|한다)$/.test(clean);
}

function isWeakRepeatedWordRhymeGroup(group) {
    const words = group.rows.map(row => row.endingWord).filter(Boolean);
    const uniqueWords = new Set(words);
    return words.length >= 4 && uniqueWords.size === 1;
}

function isWeakSentenceEndingRhymeGroup(group) {
    return group.rows.length < 3 && group.rows.every(row => isWeakKoreanSentenceEnding(row.endingWord));
}

function getKoreanSingleSyllableRhymeSignature(word) {
    const clean = normalizeLyricToken(word);
    if (!LYRIC_KO_RE.test(clean)) return '';
    const lastChar = Array.from(clean).at(-1);
    const code = lastChar.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return '';
    const vowelIndex = Math.floor((code % 588) / 28);
    const finalIndex = code % 28;
    return `ko:${vowelIndex}:${finalIndex}`;
}

function getRhymeSignature(word) {
    const koreanSignature = getKoreanSyllableRhymeSignature(word);
    if (koreanSignature) return koreanSignature;

    const clean = normalizeLyricToken(word);
    const phonemes = getLyricWordPhonemes(word);
    if (phonemes.length > 0) {
        if (LYRIC_EN_RE.test(clean)) {
            return getEnglishRhymeSignatureFromPhonemes(phonemes) || phonemes.slice(-2).join(' ');
        }
        return phonemes.slice(-2).join(' ');
    }
    return Array.from(word || '').slice(-2).join('');
}

function getPhonemeSignature(phonemes, width = 2) {
    if (!Array.isArray(phonemes) || phonemes.length < width) return '';
    return phonemes.slice(-width).join('|');
}

function buildPhonemeNgrams(phonemes, n) {
    const rows = [];
    if (!Array.isArray(phonemes) || phonemes.length < n) return rows;
    for (let index = 0; index <= phonemes.length - n; index += 1) {
        rows.push(phonemes.slice(index, index + n).join('|'));
    }
    return rows;
}

function getLyricsPhonemeWeight(phoneme, mode) {
    return ipaFeatures[phoneme] ? mode.vowel : mode.consonant;
}

function getWeightedPhonemeSimilarity(leftPhonemes, rightPhonemes, mode) {
    if (!Array.isArray(leftPhonemes) || !Array.isArray(rightPhonemes)) return 0;
    if (leftPhonemes.length === 0 || rightPhonemes.length === 0) return 0;

    const leftWeights = leftPhonemes.map(phoneme => getLyricsPhonemeWeight(phoneme, mode));
    const rightWeights = rightPhonemes.map(phoneme => getLyricsPhonemeWeight(phoneme, mode));
    const maxWeight = Math.max(
        leftWeights.reduce((sum, value) => sum + value, 0),
        rightWeights.reduce((sum, value) => sum + value, 0)
    );
    if (maxWeight <= 0) return 0;

    const matrix = Array.from({ length: leftPhonemes.length + 1 }, () => Array(rightPhonemes.length + 1).fill(0));
    for (let leftIndex = 1; leftIndex <= leftPhonemes.length; leftIndex += 1) {
        matrix[leftIndex][0] = matrix[leftIndex - 1][0] + leftWeights[leftIndex - 1];
    }
    for (let rightIndex = 1; rightIndex <= rightPhonemes.length; rightIndex += 1) {
        matrix[0][rightIndex] = matrix[0][rightIndex - 1] + rightWeights[rightIndex - 1];
    }

    for (let leftIndex = 1; leftIndex <= leftPhonemes.length; leftIndex += 1) {
        for (let rightIndex = 1; rightIndex <= rightPhonemes.length; rightIndex += 1) {
            const leftWeight = leftWeights[leftIndex - 1];
            const rightWeight = rightWeights[rightIndex - 1];
            const pairWeight = Math.max(leftWeight, rightWeight);
            const pairScore = get_score_1d(leftPhonemes[leftIndex - 1], rightPhonemes[rightIndex - 1]);
            matrix[leftIndex][rightIndex] = Math.min(
                matrix[leftIndex - 1][rightIndex] + leftWeight,
                matrix[leftIndex][rightIndex - 1] + rightWeight,
                matrix[leftIndex - 1][rightIndex - 1] + pairWeight * (1 - pairScore)
            );
        }
    }

    return Math.max(0, Math.min(100, (1 - matrix[leftPhonemes.length][rightPhonemes.length] / maxWeight) * 100));
}

function getBestSlidingRhymeSimilarity(leftPhonemes, rightPhonemes) {
    const modeScores = LYRIC_SLIDING_RHYME_WEIGHTS.map(mode => ({
        mode,
        score: getWeightedPhonemeSimilarity(leftPhonemes, rightPhonemes, mode)
    }));
    const best = modeScores.reduce((top, current) => current.score > top.score ? current : top, modeScores[0]);
    const consonantScore = modeScores.find(row => row.mode.id === 'consonant')?.score || 0;
    const vowelScore = modeScores.find(row => row.mode.id === 'vowel')?.score || 0;
    const balancedScore = modeScores.find(row => row.mode.id === 'balanced')?.score || 0;
    const passed = modeScores.filter(row => {
        if (row.mode.id === 'vowel') {
            return vowelScore >= row.mode.threshold && balancedScore >= 70;
        }
        return row.score >= row.mode.threshold;
    });
    return {
        score: best?.score || 0,
        mode: best?.mode || LYRIC_SLIDING_RHYME_WEIGHTS[0],
        passed,
        consonantScore,
        vowelScore,
        balancedScore
    };
}

function getStructuralRuleScore(models, phonemes, lang = '') {
    if (!Array.isArray(phonemes) || phonemes.length === 0) return 0;
    const rules = models?.phonemeModels?.structuralRules;
    if (!rules) return 0;
    const stores = lang === 'en'
        ? [rules.en]
        : lang === 'ko'
            ? [rules.ko]
            : [rules.ko, rules.en];
    let score = 0;
    stores.filter(Boolean).forEach(store => {
        Object.entries(store.combined || {}).forEach(([width, rows]) => {
            const size = Number(width);
            if (!size || phonemes.length < size) return;
            const signature = phonemes.slice(-size).join('|');
            score = Math.max(score, rows.map.get(signature) || 0);
        });
    });
    return score;
}

function isWeakKoreanStructuralCandidate(candidate) {
    if (!candidate || candidate.lang !== 'ko' || candidate.isEnding) return false;
    const text = candidate.normalizedText || '';
    if (text.length < 2) return false;
    return /[은는이가을를에의도만]$/.test(text);
}

function getHangulWindowsWithPhonemes(line, lineIndex, section, minWidth = 2, maxWidth = 4) {
    const text = normalizeLyricsInputForAnalysis(line);
    const hasEnglishToken = Array.from(text.matchAll(LYRIC_TOKEN_RE))
        .some(match => LYRIC_EN_RE.test(normalizeLyricToken(match[0])));
    if (hasEnglishToken) return [];

    const hangul = [];
    Array.from(text).forEach((char, arrayIndex) => {
        if (!LYRIC_HANGUL_RE.test(char)) return;
        const offset = Array.from(text).slice(0, arrayIndex).join('').length;
        hangul.push({ char, offset });
    });
    const windows = [];
    for (let width = minWidth; width <= maxWidth; width += 1) {
        if (hangul.length < width) continue;
        for (let index = 0; index <= hangul.length - width; index += 1) {
            const slice = hangul.slice(index, index + width);
            const start = slice[0].offset;
            const last = slice[slice.length - 1];
            const textSlice = text.slice(start, last.offset + last.char.length).trim();
            const normalizedText = Array.from(textSlice).filter(char => LYRIC_HANGUL_RE.test(char)).join('');
            const phonemes = getLyricWordPhonemes(normalizedText);
            if (phonemes.length === 0) continue;
            windows.push({
                id: `${section.id}:${lineIndex}:${width}:${index}`,
                section,
                lineIndex,
                lineId: `${section.id}:${lineIndex}`,
                width,
                syllableCount: width,
                text: textSlice,
                normalizedText,
                phonemes,
                start,
                end: last.offset + last.char.length,
                centerRatio: text.length ? (start + last.offset + last.char.length) / 2 / text.length : 0,
                isEnding: index + width >= hangul.length,
                lang: 'ko',
                source: 'sliding'
            });
        }
    }
    return windows;
}

function buildSlidingRhymeGroups(lineAnalyses) {
    const allWindows = lineAnalyses.flatMap(row => getHangulWindowsWithPhonemes(row.line, row.index, row.section));
    const windows = allWindows.length > 1400 ? allWindows.slice(-1400) : allWindows;
    if (windows.length < 2) return [];
    const minDistinctLines = Math.min(3, Math.max(2, lineAnalyses.length));

    const parent = new Map(windows.map(window => [window.id, window.id]));
    const bestScore = new Map();
    const bestMode = new Map();
    const find = id => {
        const current = parent.get(id);
        if (current === id) return id;
        const root = find(current);
        parent.set(id, root);
        return root;
    };
    const unite = (leftId, rightId, score, mode) => {
        const leftRoot = find(leftId);
        const rightRoot = find(rightId);
        if (leftRoot === rightRoot) {
            bestScore.set(leftRoot, Math.max(bestScore.get(leftRoot) || 0, score));
            if (!bestMode.has(leftRoot)) bestMode.set(leftRoot, mode);
            return;
        }
        parent.set(rightRoot, leftRoot);
        bestScore.set(leftRoot, Math.max(bestScore.get(leftRoot) || 0, bestScore.get(rightRoot) || 0, score));
        bestMode.set(leftRoot, bestMode.get(leftRoot) || bestMode.get(rightRoot) || mode);
    };

    for (let leftIndex = 0; leftIndex < windows.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < windows.length; rightIndex += 1) {
            const left = windows[leftIndex];
            const right = windows[rightIndex];
            if (left.lineIndex === right.lineIndex && left.section === right.section) continue;
            if (Math.abs(left.width - right.width) > 1) continue;
            const result = getBestSlidingRhymeSimilarity(left.phonemes, right.phonemes);
            if (!result.passed.length) continue;
            unite(left.id, right.id, result.score, result.mode);
        }
    }

    const grouped = new Map();
    windows.forEach(window => {
        const root = find(window.id);
        if (!grouped.has(root)) grouped.set(root, []);
        grouped.get(root).push(window);
    });

    return Array.from(grouped.entries())
        .map(([root, rows]) => ({
            signature: `sliding:${root}`,
            rows,
            score: bestScore.get(root) || 0,
            mode: bestMode.get(root)?.label || '혼합'
        }))
        .filter(group => new Set(group.rows.map(row => `${row.section.id}:${row.lineIndex}`)).size >= minDistinctLines)
        .sort((a, b) => {
            const lineDiff = new Set(b.rows.map(row => `${row.section.id}:${row.lineIndex}`)).size
                - new Set(a.rows.map(row => `${row.section.id}:${row.lineIndex}`)).size;
            return lineDiff || b.score - a.score;
        })
        .slice(0, 16);
}

function getLineRhymeSpanCandidates(row, minWidth = 1, maxWidth = 5) {
    const text = normalizeLyricsInputForAnalysis(row.line);
    const endingWord = normalizeLyricToken(getLastLyricWord(text));
    const lineEndsWithEnglish = LYRIC_EN_RE.test(endingWord);
    const hangul = [];
    const seen = new Set();
    const windows = [];
    const pushWindow = candidate => {
        const key = `${candidate.start}:${candidate.end}:${candidate.normalizedText}`;
        if (seen.has(key)) return;
        seen.add(key);
        windows.push(candidate);
    };

    Array.from(text).forEach((char, arrayIndex) => {
        if (!LYRIC_HANGUL_RE.test(char)) return;
        const offset = Array.from(text).slice(0, arrayIndex).join('').length;
        hangul.push({ char, offset });
    });

    for (let width = minWidth; width <= maxWidth; width += 1) {
        if (hangul.length < width) continue;
        for (let index = 0; index <= hangul.length - width; index += 1) {
            const slice = hangul.slice(index, index + width);
            const start = slice[0].offset;
            const last = slice[slice.length - 1];
            const end = last.offset + last.char.length;
            const textSlice = text.slice(start, end).trim();
            const normalizedText = Array.from(textSlice).filter(char => LYRIC_HANGUL_RE.test(char)).join('');
            if (!normalizedText) continue;
            const phonemes = getLyricWordPhonemes(normalizedText);
            if (phonemes.length === 0) continue;
            const startBoundary = start === 0 || /\s/.test(text[start - 1] || '');
            const endBoundary = end >= text.length || /\s/.test(text[end] || '');
            const firstSyllableEndBoundary = /\s/.test(text[start + slice[0].char.length] || '');
            pushWindow({
                id: `${row.section.id}:${row.index}:struct:${width}:${index}`,
                section: row.section,
                lineIndex: row.index,
                lineId: `${row.section.id}:${row.index}`,
                width,
                syllableCount: width,
                text: textSlice,
                normalizedText,
                phonemes,
                start,
                end,
                centerRatio: text.length ? (start + end) / 2 / text.length : 0,
                isEnding: !lineEndsWithEnglish && index + width >= hangul.length,
                boundaryScore: Number(startBoundary) + Number(endBoundary) + Number(firstSyllableEndBoundary) * 0.75,
                lang: 'ko',
                source: 'structural'
            });
        }
    }

    const tokenMatches = Array.from(text.matchAll(LYRIC_TOKEN_RE))
        .map(match => {
            const token = normalizeLyricToken(match[0]);
            const phonemes = getLyricWordPhonemes(token);
            const lang = LYRIC_KO_RE.test(token) ? 'ko' : LYRIC_EN_RE.test(token) ? 'en' : '';
            return {
                raw: match[0],
                token,
                phonemes,
                lang,
                start: match.index,
                end: match.index + match[0].length
            };
        })
        .filter(match => match.token && match.phonemes.length);
    for (let width = 1; width <= Math.min(3, maxWidth); width += 1) {
        if (tokenMatches.length < width) continue;
        for (let index = 0; index <= tokenMatches.length - width; index += 1) {
            const slice = tokenMatches.slice(index, index + width);
            const start = slice[0].start;
            const end = slice[slice.length - 1].end;
            const textSlice = text.slice(start, end).trim();
            const normalizedText = slice.map(item => item.token).join('');
            const phonemes = slice.flatMap(item => item.phonemes);
            const langs = new Set(slice.map(item => item.lang).filter(Boolean));
            if (langs.size > 1) continue;
            if (langs.size === 1 && langs.has('ko')) continue;
            const hangulCount = Array.from(normalizedText).filter(char => LYRIC_HANGUL_RE.test(char)).length;
            const unitWidth = Math.min(5, Math.max(1, hangulCount || width));
            const startBoundary = start === 0 || /\s/.test(text[start - 1] || '');
            const endBoundary = end >= text.length || /\s/.test(text[end] || '');
            pushWindow({
                id: `${row.section.id}:${row.index}:token:${width}:${index}`,
                section: row.section,
                lineIndex: row.index,
                lineId: `${row.section.id}:${row.index}`,
                width: unitWidth,
                syllableCount: unitWidth,
                tokenCount: width,
                text: textSlice,
                normalizedText,
                phonemes,
                start,
                end,
                centerRatio: text.length ? (start + end) / 2 / text.length : 0,
                isEnding: index + width >= tokenMatches.length,
                boundaryScore: Number(startBoundary) + Number(endBoundary),
                lang: langs.size === 1 ? [...langs][0] : 'mixed',
                source: 'token'
            });
        }
    }
    return windows;
}

function getStructuralPairResult(left, right, models = null) {
    if (left.lineId === right.lineId) return null;
    if ((left.lang === 'ko' && right.lang === 'en') || (left.lang === 'en' && right.lang === 'ko')) return null;
    if (Math.abs(left.width - right.width) > 1) return null;
    const positionDiff = Math.abs(left.centerRatio - right.centerRatio);
    const bothEnding = left.isEnding && right.isEnding;
    if (!bothEnding && positionDiff > 0.34) return null;

    const result = getBestSlidingRhymeSimilarity(left.phonemes, right.phonemes);
    const hasShortSpan = left.width <= 1 || right.width <= 1;
    const broadVowelMatches = getKoreanBroadVowelSimilarity(left.normalizedText, right.normalizedText);
    const englishCoreMatch = left.lang === 'en' && right.lang === 'en'
        ? getWeightedPhonemeSimilarity(
            getEnglishRhymeCore(left.phonemes),
            getEnglishRhymeCore(right.phonemes),
            { vowel: 3, consonant: 1 }
        )
        : 0;
    const englishCorePassed = englishCoreMatch >= 88;
    const bothEnglish = left.lang === 'en' && right.lang === 'en';
    const modelScore = Math.max(
        getStructuralRuleScore(models, left.phonemes, left.lang),
        getStructuralRuleScore(models, right.phonemes, right.lang)
    );
    const passed = bothEnglish
        ? englishCorePassed && (bothEnding || positionDiff <= 0.22)
        : hasShortSpan
        ? (result.vowelScore >= 94 || broadVowelMatches >= 1 || englishCorePassed) && positionDiff <= 0.26
        : result.passed.length > 0
            || (
                broadVowelMatches >= Math.min(2, left.width, right.width)
                && result.vowelScore >= 50
                && (bothEnding || positionDiff <= 0.18)
            )
            || (
                modelScore >= 0.55
                && result.score >= 68
                && (bothEnding || positionDiff <= 0.18)
            );
    if (!passed) return null;

    const score = hasShortSpan
        ? Math.max(result.vowelScore, englishCoreMatch, 70 + broadVowelMatches * 8, result.score * 0.75)
        : Math.max(result.score, englishCoreMatch, 68 + broadVowelMatches * 8, modelScore * 100);
    return {
        score,
        mode: hasShortSpan ? { id: 'short-vowel', label: '짧은 모음축' } : result.mode,
        positionDiff,
        modelScore,
        consonantScore: result.consonantScore,
        vowelScore: result.vowelScore,
        balancedScore: result.balancedScore
    };
}

function getLooseRhymeMatchResult(left, right, models = null) {
    const result = getBestSlidingRhymeSimilarity(left.phonemes, right.phonemes);
    const broadVowelMatches = getKoreanBroadVowelSimilarity(left.normalizedText, right.normalizedText);
    const modelScore = Math.max(
        getStructuralRuleScore(models, left.phonemes, left.lang),
        getStructuralRuleScore(models, right.phonemes, right.lang)
    );
    const passed = result.passed.length > 0
        || (broadVowelMatches >= Math.min(2, left.width, right.width) && result.vowelScore >= 50)
        || (modelScore >= 0.55 && result.score >= 68);
    if (!passed) return null;
    return {
        score: Math.max(result.score, 68 + broadVowelMatches * 8, modelScore * 100),
        mode: result.mode,
        consonantScore: result.consonantScore,
        balancedScore: result.balancedScore,
        modelScore
    };
}

function compactStructuralRows(rows) {
    const byLine = new Map();
    rows.forEach(row => {
        const list = byLine.get(row.lineId) || [];
        list.push(row);
        byLine.set(row.lineId, list);
    });

    return Array.from(byLine.values()).flatMap(list => {
        const selected = [];
        [...list].sort((a, b) => {
            const endingDiff = Number(b.isEnding) - Number(a.isEnding);
            const widthDiff = b.width - a.width;
            return endingDiff || widthDiff || a.start - b.start;
        }).forEach(row => {
            const overlaps = selected.some(item => row.start < item.end && row.end > item.start);
            if (!overlaps) selected.push(row);
        });
        return selected.sort((a, b) => a.start - b.start);
    });
}

function getStructuralGroupQuality(rows, score) {
    const distinctLines = new Set(rows.map(row => row.lineId)).size;
    const avgWidth = average(rows.map(row => row.width));
    const endingRatio = rows.filter(row => row.isEnding).length / Math.max(1, rows.length);
    const centers = rows.map(row => row.centerRatio);
    const meanCenter = average(centers);
    const positionVariance = average(centers.map(value => Math.abs(value - meanCenter)));
    return {
        distinctLines,
        avgWidth,
        endingRatio,
        positionVariance,
        value: distinctLines * 12 + avgWidth * 7 + endingRatio * 8 + score * 0.08 - positionVariance * 18
    };
}

function shouldKeepStructuralGroup(group, strongLinePairs) {
    const quality = group.quality;
    if (quality.distinctLines < 2) return false;
    if (quality.avgWidth >= 1.8 && (quality.endingRatio >= 0.45 || quality.positionVariance <= 0.22)) return true;
    if (quality.avgWidth >= 2.6 && group.score >= 76) return true;
    if (quality.avgWidth <= 1.35) {
        const lineIds = [...new Set(group.rows.map(row => row.lineId))];
        return lineIds.length === 2 && strongLinePairs.has(lineIds.sort().join('|'));
    }
    return false;
}

function buildStructuralRhymeGroups(lineAnalyses, models = null) {
    if (lineAnalyses.length < 2) return { groups: [], patterns: [], spansByLineId: new Map() };
    const longAnalysis = lineAnalyses.length >= 8;

    const endingCandidates = lineAnalyses
        .map(row => getLineRhymeSpanCandidates(row, 2, 2).find(candidate => candidate.isEnding))
        .filter(Boolean);
    const endingGroups = [];
    const usedEnding = new Set();
    endingCandidates.forEach((candidate, index) => {
        if (usedEnding.has(candidate.id)) return;
        const rows = [candidate];
        let score = 0;
        let modelScore = getStructuralRuleScore(models, candidate.phonemes, candidate.lang);
        let mode = '끝 라임';
        for (let nextIndex = index + 1; nextIndex < endingCandidates.length; nextIndex += 1) {
            const next = endingCandidates[nextIndex];
            const result = getStructuralPairResult(candidate, next, models);
            if (!result) continue;
            rows.push(next);
            usedEnding.add(next.id);
            score = Math.max(score, result.score);
            modelScore = Math.max(modelScore, result.modelScore || 0);
            mode = result.mode?.label || mode;
        }
        if (rows.length >= 2) {
            usedEnding.add(candidate.id);
            endingGroups.push({ signature: `ending:${candidate.id}`, rows, score, mode, modelScore, source: 'ending' });
        }
    });

    const expandedEndingGroups = endingGroups.map(group => {
        const rows = [...group.rows];
        const rowIds = new Set(rows.map(row => row.id));
        const anchorLineIds = new Set(group.rows.map(row => row.lineId));
        lineAnalyses.forEach(line => {
            const candidates = getLineRhymeSpanCandidates(line, 2, 2);
            candidates.forEach(candidate => {
                if (rowIds.has(candidate.id)) return;
                if (!candidate.isEnding && !anchorLineIds.has(candidate.lineId)) return;
                const anchorLangs = new Set(group.rows.map(row => row.lang).filter(Boolean));
                if (anchorLangs.size === 1 && !anchorLangs.has(candidate.lang)) return;
                const matched = group.rows.some(anchor => {
                    const result = getLooseRhymeMatchResult(anchor, candidate, models);
                    return result && result.score >= 82 && (result.consonantScore >= 40 || result.balancedScore >= 70);
                });
                if (!matched) return;
                rows.push(candidate);
                rowIds.add(candidate.id);
            });
        });
        const compactRows = compactStructuralRows(rows);
        return {
            ...group,
            rows: compactRows,
            quality: getStructuralGroupQuality(compactRows, group.score)
        };
    });

    const parallelGroups = [];
    for (let index = 0; index < lineAnalyses.length - 1; index += 1) {
        const leftLine = lineAnalyses[index];
        const rightLine = lineAnalyses[index + 1];
        if (leftLine.section !== rightLine.section) continue;
        const leftCandidates = getLineRhymeSpanCandidates(leftLine, longAnalysis ? 2 : 1, 3)
            .filter(candidate => !candidate.isEnding)
            .filter(candidate => !longAnalysis || !isWeakKoreanStructuralCandidate(candidate));
        const rightCandidates = getLineRhymeSpanCandidates(rightLine, longAnalysis ? 2 : 1, 3)
            .filter(candidate => !candidate.isEnding)
            .filter(candidate => !longAnalysis || !isWeakKoreanStructuralCandidate(candidate));
        const pairs = [];
        leftCandidates.forEach(left => {
            rightCandidates.forEach(right => {
                const resultWithRules = getStructuralPairResult(left, right, models);
                if (!resultWithRules) return;
                const shortPair = left.width <= 1 || right.width <= 1;
                if (longAnalysis && shortPair) return;
                const strongPhoneticPair = resultWithRules.balancedScore >= 86
                    || resultWithRules.consonantScore >= 58
                    || resultWithRules.modelScore >= 0.68;
                if (longAnalysis && !strongPhoneticPair) return;
                const positionDiff = Math.abs(left.centerRatio - right.centerRatio);
                if (shortPair && positionDiff > 0.22) return;
                if (!shortPair && positionDiff > 0.18) return;
                const boundaryScore = ((left.boundaryScore || 0) + (right.boundaryScore || 0)) / 2;
                pairs.push({
                    left,
                    right,
                    result: resultWithRules,
                    shortPair,
                    boundaryScore,
                    phraseLike: (left.text.includes(' ') && right.text.includes(' ')) || boundaryScore >= 1.5,
                    rank: resultWithRules.score
                        + Math.min(left.width, right.width) * 2
                        - Math.max(left.width, right.width) * 5
                        + boundaryScore * 8
                        + (resultWithRules.modelScore || 0) * 16
                        - positionDiff * 20
                });
            });
        });

        const selected = [];
        const overlapsSelected = pair => selected.some(item => (
            (pair.left.start < item.left.end && pair.left.end > item.left.start)
            || (pair.right.start < item.right.end && pair.right.end > item.right.start)
        ));
        pairs
            .filter(pair => !pair.shortPair && pair.result.score >= 95 && pair.phraseLike)
            .sort((a, b) => b.rank - a.rank)
            .forEach(pair => {
                if (selected.length >= 2 || overlapsSelected(pair)) return;
                selected.push(pair);
            });
        pairs
            .filter(pair => pair.shortPair)
            .sort((a, b) => b.rank - a.rank)
            .forEach(pair => {
                if (selected.length >= 3 || overlapsSelected(pair)) return;
                if (!selected.length) return;
                selected.push(pair);
            });
        pairs
            .filter(pair => !pair.shortPair && pair.result.score >= 84 && pair.phraseLike && pair.boundaryScore >= 1.5)
            .sort((a, b) => b.rank - a.rank)
            .forEach(pair => {
                if (selected.length >= 3 || overlapsSelected(pair)) return;
                if (!selected.length) return;
                selected.push(pair);
            });

        if (selected.length < 2) continue;

        selected.forEach((pair, pairIndex) => {
            const rows = compactStructuralRows([pair.left, pair.right]);
            parallelGroups.push({
                signature: `parallel:${leftLine.section.id}:${index}:${pairIndex}`,
                rows,
                score: pair.result.score,
                mode: pair.result.mode?.label || '위치 반복',
                modelScore: pair.result.modelScore || 0,
                source: 'parallel',
                quality: getStructuralGroupQuality(rows, pair.result.score)
            });
        });
    }

    const endingRowsByLineId = new Map();
    expandedEndingGroups.forEach(group => {
        group.rows.forEach(row => {
            const list = endingRowsByLineId.get(row.lineId) || [];
            list.push(row);
            endingRowsByLineId.set(row.lineId, list);
        });
    });

    const groups = [...expandedEndingGroups, ...parallelGroups]
        .filter(group => group.quality.distinctLines >= 2)
        .filter(group => {
            if (!longAnalysis || group.source !== 'parallel') return true;
            return group.quality.avgWidth >= 2.5 && group.score >= 96 && group.modelScore >= 0.55;
        })
        .filter(group => {
            if (group.source !== 'parallel' || group.quality.avgWidth > 1.35) return true;
            return !group.rows.every(row => {
                const endingRows = endingRowsByLineId.get(row.lineId) || [];
                return endingRows.some(ending => row.start < ending.end && row.end > ending.start);
            });
        })
        .sort((a, b) => {
            if (a.source !== b.source) return a.source === 'ending' ? -1 : 1;
            const leftLine = Math.min(...a.rows.map(row => row.lineIndex));
            const rightLine = Math.min(...b.rows.map(row => row.lineIndex));
            if (leftLine !== rightLine) return leftLine - rightLine;
            const leftCenter = average(a.rows.map(row => row.centerRatio));
            const rightCenter = average(b.rows.map(row => row.centerRatio));
            return leftCenter - rightCenter;
        })
        .slice(0, 12)
        .map((group, index) => ({
            ...group,
            label: LYRIC_STRUCTURAL_RHYME_LABELS[index] || `G${index + 1}`,
            groupIndex: index
        }));

    const spansByLineId = new Map();
    groups.forEach(group => {
        group.rows.forEach(row => {
            const list = spansByLineId.get(row.lineId) || [];
            list.push({
                start: row.start,
                end: row.end,
                text: row.text,
                label: group.label,
                groupIndex: group.groupIndex,
                score: group.score,
                mode: group.mode,
                isEnding: row.isEnding
            });
            spansByLineId.set(row.lineId, list);
        });
    });
    spansByLineId.forEach((list, lineId) => {
        spansByLineId.set(lineId, list.sort((a, b) => a.start - b.start || b.end - a.end));
    });

    const lineSequences = lineAnalyses.map(row => {
        const lineId = `${row.section.id}:${row.index}`;
        const spans = spansByLineId.get(lineId) || [];
        const labels = [];
        spans.forEach(span => {
            if (!labels.includes(span.label)) labels.push(span.label);
        });
        return { lineId, section: row.section, lineIndex: row.index, labels, spans };
    });
    const patterns = [];
    for (let index = 0; index < lineSequences.length - 1; index += 1) {
        const current = lineSequences[index];
        const next = lineSequences[index + 1];
        if (current.section !== next.section) continue;
        const common = current.labels.filter(label => next.labels.includes(label));
        if (common.length >= 2) {
            patterns.push({
                type: 'parallel',
                lines: [current.lineIndex, next.lineIndex],
                labels: common,
                text: `${current.lineIndex + 1}-${next.lineIndex + 1}행: ${common.join(' ... ')} 반복`
            });
        } else if (common.length === 1 && current.spans.some(span => span.label === common[0] && span.isEnding) && next.spans.some(span => span.label === common[0] && span.isEnding)) {
            patterns.push({
                type: 'ending-chain',
                lines: [current.lineIndex, next.lineIndex],
                labels: common,
                text: `${current.lineIndex + 1}-${next.lineIndex + 1}행: ${common[0]} 끝 라임 유지`
            });
        }
    }

    return { groups, patterns: patterns.slice(0, 8), spansByLineId };
}

function buildVocabMap(data) {
    const map = new Map();
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    entries.forEach((row, index) => {
        const word = normalizeLyricToken(row?.word || row?.[0]);
        if (!isUsefulLyricToken(word)) return;
        const rank = entries.length > 1 ? 1 - index / (entries.length - 1) : 1;
        const zipf = Number(row?.zipfLocal);
        const zipfScore = Number.isFinite(zipf) ? Math.max(0, Math.min(1, (zipf - 4) / 3.2)) : 0;
        map.set(word, Math.max(map.get(word) || 0, rank * 0.85, zipfScore));
    });
    return map;
}

function buildNgramMap(data) {
    const map = new Map();
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    let maxCount = 0;
    entries.forEach(row => {
        const phrase = normalizeLyricPhrase(Array.isArray(row) ? row[0] : row?.phrase);
        const count = Number(Array.isArray(row) ? row[1] : row?.count) || 0;
        if (!phrase || count <= 0) return;
        map.set(phrase, Math.max(map.get(phrase) || 0, count));
        maxCount = Math.max(maxCount, count);
    });
    return { map, maxCount };
}

function buildTopicMap(data) {
    const map = new Map();
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    let maxScore = 0;
    entries.forEach(row => {
        const term = normalizeLyricToken(row?.term || row?.word || row?.[0]);
        const score = Number(row?.score || row?.count || row?.[1]) || 0;
        if (!isUsefulLyricToken(term) || score <= 0) return;
        map.set(term, Math.max(map.get(term) || 0, score));
        maxScore = Math.max(maxScore, score);
    });
    return { map, maxScore };
}

function buildEndingSet(data) {
    const map = new Map();
    const rows = Array.isArray(data?.lineEndings) ? data.lineEndings : [];
    let maxCount = 0;
    rows.forEach(row => {
        const ending = normalizeLyricToken(row?.[0]);
        const count = Number(row?.[1]) || 0;
        if (!ending || count <= 0) return;
        map.set(ending, Math.max(map.get(ending) || 0, count));
        maxCount = Math.max(maxCount, count);
    });
    return { map, maxCount };
}

function buildCountMap(rows, getKey, getCount) {
    const map = new Map();
    let maxCount = 0;
    if (!Array.isArray(rows)) return { map, maxCount };

    rows.forEach(row => {
        const key = getKey(row);
        const count = Number(getCount(row)) || 0;
        if (!key || count <= 0) return;
        map.set(key, Math.max(map.get(key) || 0, count));
        maxCount = Math.max(maxCount, count);
    });
    return { map, maxCount };
}

function buildScoreMap(rows, getKey, getScore) {
    const map = new Map();
    let maxScore = 0;
    if (!Array.isArray(rows)) return { map, maxScore };

    rows.forEach(row => {
        const key = getKey(row);
        const score = Number(getScore(row)) || 0;
        if (!key || score <= 0) return;
        map.set(key, Math.max(map.get(key) || 0, score));
        maxScore = Math.max(maxScore, score);
    });
    return { map, maxScore };
}

function buildPhonemeRhymeModel(data) {
    const signatures = {};
    const source = data?.rhymeSignatures && typeof data.rhymeSignatures === 'object'
        ? data.rhymeSignatures
        : {};
    Object.entries(source).forEach(([width, rows]) => {
        signatures[width] = buildCountMap(rows, row => row?.[0], row => row?.[1]);
    });

    return {
        lineEndings: buildCountMap(data?.lineEndings, row => row?.[0], row => row?.[1]),
        signatures
    };
}

function buildInternalPhonemeModel(data) {
    const signatures = {};
    const source = data?.signatures && typeof data.signatures === 'object'
        ? data.signatures
        : {};
    Object.entries(source).forEach(([width, rows]) => {
        signatures[width] = buildCountMap(rows, row => row?.signature, row => row?.lineCount || row?.repeatCount);
    });
    return { signatures };
}

function buildPhonemeNgramModel(data) {
    const ngrams = {};
    const source = data?.ngrams && typeof data.ngrams === 'object'
        ? data.ngrams
        : {};
    Object.entries(source).forEach(([size, rows]) => {
        ngrams[size] = buildCountMap(rows, row => row?.[0], row => row?.[1]);
    });
    return { ngrams };
}

function buildStructuralRhymeRuleModel(data) {
    const combined = {};
    const source = data?.combined && typeof data.combined === 'object'
        ? data.combined
        : {};
    Object.entries(source).forEach(([width, rows]) => {
        combined[width] = buildScoreMap(rows, row => row?.signature, row => row?.score);
    });
    return { combined, metadata: data?.metadata || {} };
}

function getLyricsModelLoadingLabel(key, index, total) {
    const labels = {
        hiphopVocab: '힙합에서 자주 쓰이는 표현을 확인하는 중',
        hiphop2: '두 단어 연결감을 살펴보는 중',
        hiphop3: '세 단어 흐름을 맞춰보는 중',
        hiphopEndings: '끝 라임 패턴을 불러오는 중',
        hiphopInternalRhymes: '내부 라임 단서를 찾는 중',
        hiphopPhonemeNgrams: '발음 흐름 모델을 준비하는 중',
        translatedVocab: '번역 코퍼스 표현을 대조하는 중',
        translatedBigram: '의미 연결 표현을 정리하는 중',
        translatedTopics: '주제어 후보를 추리는 중',
        translatedClusters: '테마 묶음을 준비하는 중',
        spokenVocab: '구어체 표현 감각을 확인하는 중',
        spoken2: '자연스러운 말 흐름을 맞춰보는 중',
        spoken3: '긴 구어체 연결감을 살펴보는 중',
        spokenEndings: '일상 문장 끝맺음을 비교하는 중',
        spokenTopics: '대화체 주제 단서를 찾는 중',
        spokenClusters: '대화체 테마를 정리하는 중',
        englishEndings: '영어 라임 끝소리를 확인하는 중',
        englishInternal: '영어 내부 라임 단서를 찾는 중',
        englishFlow: '영어 플로우 패턴을 준비하는 중',
        structuralRulesKo: '한국어 구조 라임 규칙을 불러오는 중',
        structuralRulesEn: '영어 구조 라임 규칙을 불러오는 중'
    };
    return labels[key] || `분석 자료 준비 중 (${index + 1}/${total})`;
}

function normalizeLyricPhrase(value) {
    const tokens = String(value || '')
        .split(/\s+/)
        .map(normalizeLyricToken)
        .filter(isUsefulLyricToken);
    return tokens.join(' ');
}

function normalizeCountScore(count, maxCount) {
    if (!count || !maxCount) return 0;
    return Math.max(0, Math.min(1, Math.log1p(count) / Math.log1p(maxCount)));
}

function parseClusters(data) {
    const clusters = data?.clusters && typeof data.clusters === 'object' ? data.clusters : {};
    return Object.entries(clusters).map(([name, rows]) => ({
        name,
        terms: Array.isArray(rows)
            ? rows.map(row => normalizeLyricToken(row?.[0] || row?.term || row)).filter(Boolean)
            : []
    })).filter(cluster => cluster.terms.length > 0);
}

async function ensureLyricsAnalysisModelsLoaded(onProgress = updateLyricsProgress) {
    if (lyricsAnalysisModels) return lyricsAnalysisModels;
    if (lyricsAnalysisLoadingPromise) return lyricsAnalysisLoadingPromise;

    lyricsAnalysisLoadingPromise = (async () => {
        onProgress(8, '분석 모델 목록 준비 중');
        await yieldLyricsFrame();

        const files = {
            hiphopVocab: 'hiphop_vocab_stats_ko.json',
            hiphop2: 'hiphop_2gram_ko.json',
            hiphop3: 'hiphop_3gram_ko.json',
            hiphopEndings: 'hiphop_rhyme_patterns_ko.json',
            hiphopInternalRhymes: 'hiphop_internal_rhyme_patterns_ko.json',
            hiphopPhonemeNgrams: 'hiphop_phoneme_ngram_ko.json',
            translatedVocab: 'translated_hiphop_vocab_ko.json',
            translatedBigram: 'translated_hiphop_bigram_ko.json',
            translatedTopics: 'translated_hiphop_topic_terms_ko.json',
            translatedClusters: 'translated_hiphop_theme_clusters_ko.json',
            spokenVocab: 'spoken_korean_vocab_ko.json',
            spoken2: 'spoken_korean_2gram_ko.json',
            spoken3: 'spoken_korean_3gram_ko.json',
            spokenEndings: 'spoken_korean_line_endings_ko.json',
            spokenTopics: 'spoken_korean_topic_terms_ko.json',
            spokenClusters: 'spoken_korean_source_clusters_ko.json',
            englishEndings: 'english_hiphop_ending_phoneme_patterns.json',
            englishInternal: 'english_hiphop_internal_rhyme_patterns.json',
            englishFlow: 'english_hiphop_flow_shape_stats.json',
            structuralRulesKo: 'structural_rhyme_rules_ko.json',
            structuralRulesEn: 'structural_rhyme_rules_en.json'
        };

        const loaded = {};
        const entries = Object.entries(files);
        for (let index = 0; index < entries.length; index += 1) {
            const [key, filename] = entries[index];
            onProgress(10 + index / entries.length * 45, getLyricsModelLoadingLabel(key, index, entries.length));
            loaded[key] = await loadOptionalJson(dataPath(filename));
            await yieldLyricsFrame();
        }

        onProgress(60, '모델 인덱스 구성 중');
        lyricsAnalysisModels = {
            vocab: {
                hiphop: buildVocabMap(loaded.hiphopVocab),
                translated: buildVocabMap(loaded.translatedVocab),
                spoken: buildVocabMap(loaded.spokenVocab)
            },
            ngrams: {
                hiphop2: buildNgramMap(loaded.hiphop2),
                hiphop3: buildNgramMap(loaded.hiphop3),
                translatedBigram: buildNgramMap(loaded.translatedBigram),
                spoken2: buildNgramMap(loaded.spoken2),
                spoken3: buildNgramMap(loaded.spoken3)
            },
            topics: {
                translated: buildTopicMap(loaded.translatedTopics),
                spoken: buildTopicMap(loaded.spokenTopics)
            },
            endings: {
                hiphop: buildEndingSet(loaded.hiphopEndings),
                spoken: buildEndingSet(loaded.spokenEndings)
            },
            phonemeModels: {
                rhyme: buildPhonemeRhymeModel(loaded.hiphopEndings),
                internal: buildInternalPhonemeModel(loaded.hiphopInternalRhymes),
                ngrams: buildPhonemeNgramModel(loaded.hiphopPhonemeNgrams),
                structuralRules: {
                    ko: buildStructuralRhymeRuleModel(loaded.structuralRulesKo),
                    en: buildStructuralRhymeRuleModel(loaded.structuralRulesEn)
                }
            },
            clusters: [
                ...parseClusters(loaded.translatedClusters),
                ...parseClusters(loaded.spokenClusters)
            ],
            english: {
                endings: loaded.englishEndings || {},
                internal: loaded.englishInternal || {},
                flow: loaded.englishFlow || {}
            }
        };

        onProgress(68, '모델 준비 완료');
        await yieldLyricsFrame();
        return lyricsAnalysisModels;
    })();

    return lyricsAnalysisLoadingPromise;
}

function buildLyricNgrams(tokens, n) {
    const rows = [];
    for (let index = 0; index <= tokens.length - n; index += 1) {
        rows.push(tokens.slice(index, index + n).join(' '));
    }
    return rows;
}

function getBestVocabScore(models, token) {
    return Math.max(
        models.vocab.hiphop.get(token) || 0,
        models.vocab.translated.get(token) || 0,
        models.vocab.spoken.get(token) || 0
    );
}

function getTopicScore(topicStore, token) {
    const raw = topicStore.map.get(token) || 0;
    return topicStore.maxScore ? raw / topicStore.maxScore : 0;
}

function getNgramScore(store, phrase) {
    return normalizeCountScore(store.map.get(phrase) || 0, store.maxCount);
}

function getCountModelScore(store, key) {
    if (!store || !key) return 0;
    return normalizeCountScore(store.map?.get(key) || 0, store.maxCount || 0);
}

function getPhonemeRhymeModelScore(models, endingPhonemes, endingWord = '') {
    if (!Array.isArray(endingPhonemes) || endingPhonemes.length === 0) return 0;
    const rhymeModel = models.phonemeModels?.rhyme;
    if (!rhymeModel) return 0;

    const fullEnding = endingPhonemes.join('|');
    const scores = [getCountModelScore(rhymeModel.lineEndings, fullEnding)];
    ['1', '2', '3'].forEach(width => {
        scores.push(getCountModelScore(rhymeModel.signatures[width], getPhonemeSignature(endingPhonemes, Number(width))));
    });
    const score = Math.max(...scores);
    return isWeakKoreanSentenceEnding(endingWord) ? Math.min(score, 0.45) : score;
}

function getInternalPhonemeModelScore(models, signature) {
    const internalModel = models.phonemeModels?.internal;
    if (!internalModel || !signature) return 0;
    const width = String(signature.split('|').length);
    return getCountModelScore(internalModel.signatures[width], signature);
}

function getPhonemeFlowScore(models, phonemes) {
    const ngramModel = models.phonemeModels?.ngrams;
    if (!ngramModel || !Array.isArray(phonemes) || phonemes.length < 2) return 0;
    const scores = [];
    [2, 3, 4, 5].forEach(size => {
        const store = ngramModel.ngrams[String(size)];
        if (!store) return;
        buildPhonemeNgrams(phonemes, size).forEach(ngram => {
            scores.push(getCountModelScore(store, ngram));
        });
    });
    return average(scores);
}

function average(values) {
    const usable = values.filter(value => Number.isFinite(value));
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
}

function getTopicTermStrength(row) {
    if (!row || !row.count) return 0;
    return Math.max(0, Math.min(1, row.score / row.count));
}

function percent(value) {
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function getSectionFeedbackVerdict(section) {
    if (section.rhymeDensity >= 0.6 && section.internalDensity >= 0.18) {
        return '라임 밀도와 내부 반복이 모두 잘 잡힌 구간입니다.';
    }
    if (section.rhymeDensity >= 0.55) {
        return '끝 라임 반복은 강하지만 라인 안쪽 반복음은 더 보강할 수 있습니다.';
    }
    if (section.rhymeDensity < 0.3) {
        return '끝 라임 연결이 약해서 메시지는 보여도 랩 구조가 흐려질 수 있습니다.';
    }
    return '기본 연결은 있지만 핵심 라임 그룹을 한두 개 더 선명하게 만들면 좋습니다.';
}

function getSectionFeedbackSuggestion(section) {
    if (section.avgWords >= 10) {
        return '긴 라인을 먼저 호흡 단위로 나누고, 나눈 라인의 끝소리를 같은 계열로 맞춰보세요.';
    }
    if (section.internalDensity < 0.15) {
        return '줄 끝만 맞추기보다 한 줄 안에 같은 모음/받침 단어를 한 번 더 배치해보세요.';
    }
    if (section.naturalness < 0.18) {
        return '문장을 설명하듯 쓰는 부분이 있다면 더 짧은 구어체 표현으로 바꾸는 편이 좋습니다.';
    }
    return '현재 라임 그룹 색이 이어지는 구간은 유지하고, 색이 끊기는 라인만 우선 다듬어보세요.';
}

function buildLyricsFeedback({
    overview,
    sections,
    weakRhymeLines,
    longLines,
    repeatedWords,
    rhymeGroups,
    topTerms
}) {
    const strongest = [...sections].sort((a, b) => b.rhymeDensity - a.rhymeDensity)[0];
    const weakest = [...sections].filter(section => section.lineCount >= 2).sort((a, b) => a.rhymeDensity - b.rhymeDensity)[0];
    const repeated = repeatedWords[0];
    const priorities = [];

    let summary = '전체적으로 라임 구조를 확인할 수 있습니다. 색이 이어지는 라인은 유지하고, 끊기는 라인을 먼저 다듬는 흐름이 좋습니다.';
    if (weakest && strongest && strongest !== weakest && weakest.rhymeDensity < 0.35) {
        summary = `${strongest.type}의 라임감은 비교적 선명하지만, ${weakest.type}에서 끝 라임 연결이 약해 전체 응집력이 떨어질 수 있습니다.`;
    } else if (overview.rhymeDensity >= 0.55) {
        summary = '끝 라임 반복은 충분히 잡혀 있습니다. 다음 단계는 내부 라임과 호흡 길이를 정리하는 쪽입니다.';
    } else if (overview.rhymeDensity < 0.3) {
        summary = '메시지에 비해 끝 라임 구조가 아직 약합니다. 먼저 주요 섹션마다 반복될 끝소리 축을 정하는 게 좋습니다.';
    }

    if (weakRhymeLines.length > 0) {
        const line = weakRhymeLines[0];
        priorities.push({
            title: '라임이 끊기는 라인부터 보강',
            target: `${line.section.type} ${line.index + 1}번째 줄`,
            body: `이 라인은 현재 반복 라임 그룹에 묶이지 않습니다. 앞뒤 라인의 끝 모음/받침과 가까운 단어로 끝내면 연결감이 좋아집니다.`
        });
    }
    if (longLines.length > 0) {
        const line = longLines[0];
        priorities.push({
            title: '긴 라인 호흡 나누기',
            target: `${line.section.type} ${line.index + 1}번째 줄`,
            body: `단어 수가 많아 박자 안에서 밀릴 가능성이 있습니다. 의미가 바뀌는 지점에서 2줄로 나누고 각 줄 끝을 맞춰보세요.`
        });
    }
    if (overview.internalDensity < 0.18 && overview.lineCount >= 8) {
        priorities.push({
            title: '내부 라임 추가',
            target: 'Verse 중심',
            body: '줄 끝 라임만 있으면 단조롭게 들릴 수 있습니다. 같은 라인 안쪽에 같은 끝소리 단어를 한 번 더 넣어보세요.'
        });
    }
    if (repeated && repeated[1] >= Math.max(4, overview.lineCount * 0.18)) {
        priorities.push({
            title: '반복어 의도 확인',
            target: repeated[0],
            body: 'Hook 장치라면 유지해도 되지만, Verse에서 습관적으로 반복된 단어라면 일부를 다른 표현으로 바꾸는 편이 좋습니다.'
        });
    }
    if (priorities.length === 0) {
        priorities.push({
            title: '라임 색이 끊기는 곳만 정리',
            target: '전체',
            body: '큰 구조 문제는 적습니다. 색이 이어지는 라인은 유지하고, 회색으로 남은 라인을 중심으로 끝소리만 다듬어보세요.'
        });
    }

    const sectionFeedback = sections.map(section => ({
        type: section.type,
        verdict: getSectionFeedbackVerdict(section),
        suggestion: getSectionFeedbackSuggestion(section),
        stats: `끝 라임 ${percent(section.rhymeDensity)} · 내부 라임 ${percent(section.internalDensity)} · 평균 ${section.avgWords.toFixed(1)}단어`
    }));

    const lineCandidates = [
        ...weakRhymeLines.slice(0, 4).map(line => ({
            section: line.section.type,
            line: line.index + 1,
            text: line.line,
            reason: '반복 라임 그룹에 묶이지 않음',
            suggestion: '앞뒤 라인의 끝소리와 같은 모음 계열로 마무리해보세요.'
        })),
        ...longLines.slice(0, 3).map(line => ({
            section: line.section.type,
            line: line.index + 1,
            text: line.line,
            reason: '호흡이 긴 라인',
            suggestion: '의미 단위로 줄을 나누고 각 줄 끝에 라임 포인트를 배치해보세요.'
        }))
    ].slice(0, 6);

    return {
        summary,
        priorities: priorities.slice(0, 4),
        sectionFeedback,
        lineCandidates,
        focusTerms: topTerms.slice(0, 5).map(row => row.term),
        rhymeGroupCount: rhymeGroups.length
    };
}

function collectLyricsSections() {
    return Array.from(document.querySelectorAll('.lyrics-section')).map((section, index) => {
        const type = section.querySelector('.lyrics-section-type')?.value || `Section ${index + 1}`;
        const text = section.querySelector('.lyrics-section-text')?.value || '';
        return {
            id: section.dataset.sectionId || String(index + 1),
            type,
            text,
            lines: splitLyricsLines(text)
        };
    }).filter(section => section.lines.length > 0);
}

async function analyzeLyricsSections(sections, onProgress = updateLyricsProgress) {
    onProgress(3, '입력 가사 정리 중');
    await yieldLyricsFrame();

    const models = await ensureLyricsAnalysisModelsLoaded(onProgress);
    const allLines = sections.flatMap(section => section.lines.map((line, index) => ({ section, line, index })));
    const allText = allLines.map(row => row.line).join('\n');
    const allTokens = tokenizeLyrics(allText);
    const allTokensWithStops = tokenizeLyrics(allText, true);
    const koCount = allTokensWithStops.filter(token => LYRIC_KO_RE.test(token)).length;
    const enCount = allTokensWithStops.filter(token => LYRIC_EN_RE.test(token)).length;

    onProgress(72, '라인별 라임 계산 중');
    await yieldLyricsFrame();

    const lineAnalyses = allLines.map(row => {
        const tokens = tokenizeLyrics(row.line);
        const tokensWithStops = tokenizeLyrics(row.line, true);
        const tokenPhonemeRows = tokens.map(token => ({
            token,
            phonemes: getLyricWordPhonemes(token)
        })).filter(row => row.phonemes.length > 0);
        const tokenPhonemeRowsWithStops = tokensWithStops.map(token => ({
            token,
            phonemes: getLyricWordPhonemes(token)
        })).filter(row => row.phonemes.length > 0);
        const linePhonemes = tokenPhonemeRows.flatMap(row => row.phonemes);
        const endingWord = getLastLyricWord(row.line);
        const endingRhymeData = getLineEndingRhymeData(row.line);
        const endingPhonemes = tokenPhonemeRowsWithStops.at(-1)?.phonemes || getLyricWordPhonemes(endingWord);
        const phonemeRhymeSignature = getPhonemeSignature(endingPhonemes, 2);
        const rhymeSignature = endingRhymeData.signature || getRhymeSignature(endingWord) || phonemeRhymeSignature;
        const endingModelScore = getPhonemeRhymeModelScore(models, endingPhonemes, endingWord);
        const internalGroups = new Map();
        tokens.forEach(token => {
            const signature = getRhymeSignature(token);
            if (!signature) return;
            if (!internalGroups.has(signature)) internalGroups.set(signature, []);
            internalGroups.get(signature).push(token);
        });
        const internalPhonemeGroups = new Map();
        tokenPhonemeRows.forEach(({ token, phonemes }) => {
            const signature = getPhonemeSignature(phonemes, 2);
            if (!signature) return;
            if (!internalPhonemeGroups.has(signature)) internalPhonemeGroups.set(signature, []);
            internalPhonemeGroups.get(signature).push(token);
        });
        const internalRhymes = Array.from(internalGroups.values())
            .map(words => [...new Set(words)])
            .filter(words => words.length >= 2);
        const internalModelScore = average(Array.from(internalPhonemeGroups.entries())
            .filter(([, words]) => new Set(words).size >= 2)
            .map(([signature]) => getInternalPhonemeModelScore(models, signature)));
        const phonemeFlowScore = getPhonemeFlowScore(models, linePhonemes);
        return {
            ...row,
            tokens,
            tokensWithStops,
            tokenPhonemeRows,
            endingPhonemes,
            endingWord,
            endingRhymeText: endingRhymeData.text || endingWord,
            rhymeSignature,
            phonemeRhymeSignature,
            internalRhymes,
            endingModelScore,
            internalModelScore,
            phonemeFlowScore,
            linePhonemes,
            wordCount: tokensWithStops.length
        };
    });

    const rhymeGroups = new Map();
    lineAnalyses.forEach(line => {
        if (!line.rhymeSignature) return;
        if (!rhymeGroups.has(line.rhymeSignature)) rhymeGroups.set(line.rhymeSignature, []);
        rhymeGroups.get(line.rhymeSignature).push(line);
    });
    const repeatedRhymeGroups = Array.from(rhymeGroups.entries())
        .map(([signature, rows]) => ({ signature, rows }))
        .filter(group => group.rows.length >= 2)
        .filter(group => !isWeakSentenceEndingRhymeGroup(group))
        .sort((a, b) => b.rows.length - a.rows.length)
        .slice(0, 12);
    const slidingRhymeGroups = buildSlidingRhymeGroups(lineAnalyses);
    const structuralRhymeResult = buildStructuralRhymeGroups(lineAnalyses, models);
    const structuralRhymeGroups = structuralRhymeResult.groups;
    const structuralRhymePatterns = structuralRhymeResult.patterns;
    const structuralSpansByLineId = structuralRhymeResult.spansByLineId;
    const rhymedLineIds = new Set([
        ...repeatedRhymeGroups.flatMap(group => group.rows.map(row => `${row.section.id}:${row.index}`)),
        ...structuralRhymeGroups.flatMap(group => group.rows.map(row => row.lineId))
    ]);
    const rhymeGroupIndexByLineId = new Map();
    repeatedRhymeGroups.forEach((group, groupIndex) => {
        group.rows.forEach(row => {
            rhymeGroupIndexByLineId.set(`${row.section.id}:${row.index}`, groupIndex);
        });
    });
    const slidingHighlightsByLineId = new Map();
    slidingRhymeGroups.forEach((group, groupIndex) => {
        group.rows.forEach(row => {
            const lineId = `${row.section.id}:${row.lineIndex}`;
            const current = slidingHighlightsByLineId.get(lineId) || { groupIndex: repeatedRhymeGroups.length + groupIndex, texts: [] };
            current.groupIndex = Math.min(current.groupIndex, repeatedRhymeGroups.length + groupIndex);
            current.texts.push(row.text);
            slidingHighlightsByLineId.set(lineId, current);
        });
    });

    onProgress(80, '주제와 표현 점수 계산 중');
    await yieldLyricsFrame();

    const bigrams = buildLyricNgrams(allTokens, 2);
    const trigrams = buildLyricNgrams(allTokens, 3);
    const allPhonemes = lineAnalyses.flatMap(row => row.linePhonemes);
    const hiphopWordScores = allTokens.map(token => Math.max(models.vocab.hiphop.get(token) || 0, models.vocab.translated.get(token) || 0));
    const spokenWordScores = allTokens.map(token => models.vocab.spoken.get(token) || 0);
    const rhymeDensityScore = allLines.length ? rhymedLineIds.size / allLines.length : 0;
    const internalDensityScore = allLines.length ? lineAnalyses.filter(row => row.internalRhymes.length > 0).length / allLines.length : 0;
    const phonemeFlowScore = getPhonemeFlowScore(models, allPhonemes);
    const phonemeRhymeModelScore = average(lineAnalyses.map(row => row.endingModelScore));
    const internalRhymeModelScore = average(lineAnalyses.map(row => row.internalModelScore));
    const hiphopNgramScore = average([
        ...bigrams.map(phrase => Math.max(getNgramScore(models.ngrams.hiphop2, phrase), getNgramScore(models.ngrams.translatedBigram, phrase))),
        ...trigrams.map(phrase => getNgramScore(models.ngrams.hiphop3, phrase))
    ]);
    const spokenNgramScore = average([
        ...bigrams.map(phrase => getNgramScore(models.ngrams.spoken2, phrase)),
        ...trigrams.map(phrase => getNgramScore(models.ngrams.spoken3, phrase))
    ]);
    const naturalnessScore = average([...spokenWordScores, spokenNgramScore]);
    const hiphopLexicalScore = average(hiphopWordScores);
    const hiphopAffinityScore = (
        hiphopLexicalScore * 0.42
        + hiphopNgramScore * 0.18
        + phonemeFlowScore * 0.16
        + phonemeRhymeModelScore * 0.12
        + rhymeDensityScore * 0.12
    );

    const topicCounter = new Map();
    allTokens.forEach(token => {
        const topicScore = Math.max(0, Math.min(1, Math.max(
            getTopicScore(models.topics.translated, token),
            getTopicScore(models.topics.spoken, token),
            getBestVocabScore(models, token) * 0.35
        )));
        if (topicScore > 0) {
            const row = topicCounter.get(token) || { term: token, count: 0, score: 0 };
            row.count += 1;
            row.score += topicScore;
            topicCounter.set(token, row);
        }
    });
    const topTerms = Array.from(topicCounter.values())
        .sort((a, b) => (
            getTopicTermStrength(b) * Math.log1p(b.count)
        ) - (
            getTopicTermStrength(a) * Math.log1p(a.count)
        ))
        .slice(0, 16);

    const clusterMatches = models.clusters.map(cluster => {
        const matchedTerms = cluster.terms.filter(term => topicCounter.has(term)).slice(0, 8);
        return { name: cluster.name, matchedTerms, score: matchedTerms.length / Math.max(1, cluster.terms.length) };
    }).filter(row => row.matchedTerms.length >= 2)
        .sort((a, b) => b.matchedTerms.length - a.matchedTerms.length)
        .slice(0, 6);

    const sectionReports = sections.map(section => {
        const rows = lineAnalyses.filter(row => row.section === section);
        const tokens = rows.flatMap(row => row.tokens);
        const sectionBigrams = buildLyricNgrams(tokens, 2);
        const sectionTrigrams = buildLyricNgrams(tokens, 3);
        const rhymedRows = rows.filter(row => rhymedLineIds.has(`${row.section.id}:${row.index}`));
        const sectionPhonemes = rows.flatMap(row => row.linePhonemes);
        const sectionRhymeDensity = rows.length ? rhymedRows.length / rows.length : 0;
        const sectionPhonemeRhymeFit = average(rows.map(row => row.endingModelScore));
        const sectionPhonemeFlow = getPhonemeFlowScore(models, sectionPhonemes);
        const sectionHiphopLexical = average(tokens.map(token => Math.max(models.vocab.hiphop.get(token) || 0, models.vocab.translated.get(token) || 0)));
        const sectionHiphopNgram = average([
            ...sectionBigrams.map(phrase => Math.max(getNgramScore(models.ngrams.hiphop2, phrase), getNgramScore(models.ngrams.translatedBigram, phrase))),
            ...sectionTrigrams.map(phrase => getNgramScore(models.ngrams.hiphop3, phrase))
        ]);
        return {
            type: section.type,
            lineCount: rows.length,
            avgWords: average(rows.map(row => row.wordCount)),
            rhymeDensity: sectionRhymeDensity,
            internalDensity: rows.length ? rows.filter(row => row.internalRhymes.length > 0).length / rows.length : 0,
            phonemeRhymeFit: sectionPhonemeRhymeFit,
            phonemeFlow: sectionPhonemeFlow,
            hiphopAffinity: (
                sectionHiphopLexical * 0.42
                + sectionHiphopNgram * 0.18
                + sectionPhonemeFlow * 0.16
                + sectionPhonemeRhymeFit * 0.12
                + sectionRhymeDensity * 0.12
            ),
            naturalness: average([
                ...tokens.map(token => models.vocab.spoken.get(token) || 0),
                ...sectionBigrams.map(phrase => getNgramScore(models.ngrams.spoken2, phrase)),
                ...sectionTrigrams.map(phrase => getNgramScore(models.ngrams.spoken3, phrase))
            ]),
            topWords: Object.entries(tokens.reduce((acc, token) => {
                acc[token] = (acc[token] || 0) + 1;
                return acc;
            }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5)
        };
    });

    onProgress(90, '개선 포인트 정리 중');
    await yieldLyricsFrame();

    const repeatedWords = Object.entries(allTokens.reduce((acc, token) => {
        acc[token] = (acc[token] || 0) + 1;
        return acc;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const weakRhymeLines = lineAnalyses
        .filter(row => !rhymedLineIds.has(`${row.section.id}:${row.index}`))
        .slice(0, 5);
    const longLines = lineAnalyses
        .filter(row => row.wordCount >= 18)
        .sort((a, b) => b.wordCount - a.wordCount)
        .slice(0, 4);

    const notes = [];
    if (weakRhymeLines.length > 0) {
        notes.push(`${weakRhymeLines[0].section.type}의 일부 라인은 반복 라임 그룹에 아직 묶이지 않습니다.`);
    }
    if (longLines.length > 0) {
        notes.push(`${longLines[0].section.type}에 단어 수가 긴 라인이 있습니다. 호흡 단위 분리를 검토할 수 있습니다.`);
    }
    if (repeatedWords[0] && repeatedWords[0][1] >= Math.max(4, allLines.length * 0.22)) {
        notes.push(`"${repeatedWords[0][0]}" 반복이 두드러집니다. Hook 의도인지 Verse 습관인지 확인하는 게 좋습니다.`);
    }
    if (naturalnessScore < 0.20 && allTokens.length >= 10) {
        notes.push('구어체 n-gram 매칭이 낮습니다. 일부 표현이 문어체나 번역투처럼 느껴질 수 있습니다.');
    }
    if (hiphopAffinityScore < 0.18 && allTokens.length >= 10) {
        notes.push('힙합 n-gram 매칭이 낮습니다. 라임은 유지하되 장르 어휘나 연결 표현을 더 강하게 잡을 수 있습니다.');
    }
    if (phonemeRhymeModelScore < 0.18 && allLines.length >= 6) {
        notes.push('발음 기반 힙합 라임 모델 매칭이 낮습니다. 끝 음소 반복을 더 의도적으로 배치해볼 수 있습니다.');
    }
    if (phonemeFlowScore < 0.08 && allTokens.length >= 10) {
        notes.push('발음 n-gram 흐름이 코퍼스와 많이 다릅니다. 강세가 필요한 구간의 음절 수와 반복음을 점검할 수 있습니다.');
    }
    if (notes.length === 0) {
        notes.push('큰 구조적 약점은 보이지 않습니다. 라임 그룹과 Hook 반복성을 중심으로 다듬으면 됩니다.');
    }

    const annotatedSections = sections.map(section => ({
        id: section.id,
        type: section.type,
        lines: lineAnalyses
            .filter(row => row.section === section)
            .map(row => {
                const lineId = `${row.section.id}:${row.index}`;
                const groupIndex = rhymeGroupIndexByLineId.has(lineId)
                    ? rhymeGroupIndexByLineId.get(lineId)
                    : -1;
                const slidingHighlight = slidingHighlightsByLineId.get(lineId);
                const structuralSpans = structuralSpansByLineId.get(lineId) || [];
                return {
                    index: row.index,
                    text: row.line,
                    endingWord: row.endingWord,
                    endingRhymeText: row.endingRhymeText,
                    rhymeHighlightTexts: [
                        row.endingRhymeText,
                        ...getKoreanRhymeWindowTexts(row.line, row.rhymeSignature, 2),
                        ...row.tokens
                            .filter(token => row.rhymeSignature && getRhymeSignature(token) === row.rhymeSignature)
                            .map(token => getKoreanTailText(token, 2) || token),
                        ...(slidingHighlight?.texts || [])
                    ].filter(Boolean),
                    rhymeSpans: structuralSpans,
                    groupIndex: groupIndex >= 0
                        ? groupIndex
                        : (slidingHighlight?.groupIndex ?? (structuralSpans[0]?.groupIndex ?? -1)),
                    endingModelScore: row.endingModelScore,
                    internalRhymes: row.internalRhymes.slice(0, 3)
                };
            })
    }));
    const overview = {
        sectionCount: sections.length,
        lineCount: allLines.length,
        tokenCount: allTokensWithStops.length,
        koRatio: (koCount + enCount) ? koCount / (koCount + enCount) : 0,
        enRatio: (koCount + enCount) ? enCount / (koCount + enCount) : 0,
        rhymeDensity: rhymeDensityScore,
        internalDensity: internalDensityScore,
        phonemeRhymeFit: phonemeRhymeModelScore,
        internalRhymeFit: internalRhymeModelScore,
        phonemeFlow: phonemeFlowScore,
        naturalness: naturalnessScore,
        hiphopAffinity: hiphopAffinityScore,
        topicFocus: topTerms.length ? average(topTerms.slice(0, 8).map(getTopicTermStrength)) : 0
    };
    const feedback = buildLyricsFeedback({
        overview,
        sections: sectionReports,
        weakRhymeLines,
        longLines,
        repeatedWords,
        rhymeGroups: repeatedRhymeGroups,
        topTerms
    });

    const report = {
        overview,
        feedback,
        sections: sectionReports,
        rhymeGroups: repeatedRhymeGroups,
        slidingRhymeGroups,
        structuralRhymeGroups,
        structuralRhymePatterns,
        annotatedSections,
        internalRhymes: lineAnalyses.filter(row => row.internalRhymes.length > 0).slice(0, 10),
        topTerms,
        clusterMatches,
        repeatedWords,
        notes
    };

    onProgress(100, '분석 완료');
    return report;
}

function escapeLyricsHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function renderHighlightedLyricLine(line) {
    const rawLine = String(line.text || '');
    if (Array.isArray(line.rhymeSpans) && line.rhymeSpans.length) {
        const ranges = [];
        [...line.rhymeSpans]
            .filter(span => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
            .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
            .forEach(span => {
                const overlaps = ranges.some(range => span.start < range.end && span.end > range.start);
                if (!overlaps) ranges.push({
                    start: Math.max(0, Math.min(rawLine.length, span.start)),
                    end: Math.max(0, Math.min(rawLine.length, span.end)),
                    groupIndex: span.groupIndex || 0,
                    label: span.label || `G${(span.groupIndex || 0) + 1}`
                });
            });
        if (ranges.length) {
            ranges.sort((a, b) => a.start - b.start || b.end - a.end);
            const parts = [];
            let cursor = 0;
            ranges.forEach(range => {
                if (cursor < range.start) parts.push(escapeLyricsHtml(rawLine.slice(cursor, range.start)));
                const className = `rhyme-color-${range.groupIndex % 8}`;
                parts.push(`<span class="lyrics-rhyme-token ${className}" title="${escapeLyricsHtml(range.label)} 구조 라임">${escapeLyricsHtml(rawLine.slice(range.start, range.end))}</span>`);
                cursor = range.end;
            });
            if (cursor < rawLine.length) parts.push(escapeLyricsHtml(rawLine.slice(cursor)));
            return parts.join('');
        }
    }

    if (line.groupIndex < 0) {
        return escapeLyricsHtml(rawLine);
    }

    const className = `rhyme-color-${line.groupIndex % 8}`;
    const label = `R${line.groupIndex + 1}`;
    const highlightTexts = [...new Set(line.rhymeHighlightTexts || [line.endingRhymeText, line.endingWord].filter(Boolean))]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    const ranges = [];

    highlightTexts.forEach(text => {
        const needle = String(text || '');
        if (!needle) return;
        let searchFrom = 0;
        const lowerLine = rawLine.toLowerCase();
        const lowerNeedle = needle.toLowerCase();
        while (searchFrom < rawLine.length) {
            const index = lowerLine.indexOf(lowerNeedle, searchFrom);
            if (index < 0) break;
            const end = index + needle.length;
            const overlaps = ranges.some(range => index < range.end && end > range.start);
            if (!overlaps) ranges.push({ start: index, end });
            searchFrom = end;
        }
    });

    if (!ranges.length) {
        return `${escapeLyricsHtml(rawLine)} <span class="lyrics-rhyme-token ${className}">${label}</span>`;
    }

    ranges.sort((a, b) => a.start - b.start);
    const parts = [];
    let cursor = 0;
    ranges.forEach(range => {
        if (cursor < range.start) parts.push(escapeLyricsHtml(rawLine.slice(cursor, range.start)));
        parts.push(`<span class="lyrics-rhyme-token ${className}" title="${label} 라임 그룹">${escapeLyricsHtml(rawLine.slice(range.start, range.end))}</span>`);
        cursor = range.end;
    });
    if (cursor < rawLine.length) parts.push(escapeLyricsHtml(rawLine.slice(cursor)));
    return parts.join('');
}

function getLyricsInsightCards(report) {
    const cards = [];
    const overview = report.overview || {};
    const strongestSection = [...(report.sections || [])]
        .sort((a, b) => b.rhymeDensity - a.rhymeDensity)[0];
    const weakestSection = [...(report.sections || [])]
        .filter(section => section.lineCount >= 2)
        .sort((a, b) => a.rhymeDensity - b.rhymeDensity)[0];
    const repeated = report.repeatedWords?.[0];

    if (strongestSection && strongestSection.rhymeDensity >= 0.55) {
        cards.push({
            title: '라임 중심축',
            body: `${strongestSection.type}에서 끝 라임이 가장 촘촘합니다. Hook이나 클라이맥스라면 이 구간의 반복감을 살리는 편이 좋습니다.`
        });
    }
    if (weakestSection && weakestSection.rhymeDensity < 0.35) {
        cards.push({
            title: '보강할 구간',
            body: `${weakestSection.type}은 끝 라임 연결이 비교적 약합니다. 같은 모음/받침으로 끝나는 라인을 2~3개 더 배치하면 구조가 선명해집니다.`
        });
    }
    if (overview.internalDensity < 0.18 && overview.lineCount >= 8) {
        cards.push({
            title: '내부 라임',
            body: '라인 안쪽 반복음이 아직 적은 편입니다. 한 줄 안에 같은 끝소리 단어를 두 번 배치하면 플로우가 더 랩처럼 들립니다.'
        });
    }
    if (overview.phonemeFlow < 0.45 && overview.tokenCount >= 20) {
        cards.push({
            title: '발음 흐름',
            body: '발음 n-gram 흐름이 낮게 잡혔습니다. 긴 문장은 호흡 단위로 나누고, 강세가 필요한 단어를 줄 끝이나 박자 앞에 두는 편이 좋습니다.'
        });
    }
    if (repeated && repeated[1] >= Math.max(4, overview.lineCount * 0.18)) {
        cards.push({
            title: '반복어 점검',
            body: `"${repeated[0]}" 반복이 두드러집니다. 의도한 Hook이면 유지하고, Verse 습관이면 일부를 비슷한 의미의 다른 표현으로 바꿔보세요.`
        });
    }
    if (cards.length === 0) {
        cards.push({
            title: '다듬는 순서',
            body: '먼저 라임 그룹 색이 끊기는 라인을 확인한 뒤, 주제어와 Hook 반복을 마지막에 정리하는 흐름이 가장 효율적입니다.'
        });
    }
    return cards.slice(0, 4);
}

function renderLyricsFeedbackPanel(feedback) {
    const priorities = feedback?.priorities?.length
        ? feedback.priorities.map((item, index) => `
            <article class="lyrics-priority-card">
                <span class="lyrics-priority-rank">${index + 1}</span>
                <div>
                    <strong>${escapeLyricsHtml(item.title)}</strong>
                    <em>${escapeLyricsHtml(item.target)}</em>
                    <p>${escapeLyricsHtml(item.body)}</p>
                </div>
            </article>
        `).join('')
        : '<div class="lyrics-note">우선 수정할 항목이 뚜렷하지 않습니다.</div>';

    const sectionFeedback = feedback?.sectionFeedback?.length
        ? feedback.sectionFeedback.map(section => `
            <article class="lyrics-section-feedback-card">
                <strong>${escapeLyricsHtml(section.type)}</strong>
                <span>${escapeLyricsHtml(section.stats)}</span>
                <p>${escapeLyricsHtml(section.verdict)}</p>
                <p>${escapeLyricsHtml(section.suggestion)}</p>
            </article>
        `).join('')
        : '<div class="lyrics-note">섹션별 피드백을 만들 수 없습니다.</div>';

    const lineCandidates = feedback?.lineCandidates?.length
        ? feedback.lineCandidates.map(item => `
            <article class="lyrics-line-feedback-card">
                <strong>${escapeLyricsHtml(item.section)} ${item.line}번째 줄</strong>
                <blockquote>${escapeLyricsHtml(item.text)}</blockquote>
                <span>${escapeLyricsHtml(item.reason)}</span>
                <p>${escapeLyricsHtml(item.suggestion)}</p>
            </article>
        `).join('')
        : '<div class="lyrics-note">라인별로 급하게 고칠 후보는 적습니다. 라임 색이 없는 라인을 직접 확인해보세요.</div>';

    const focusTerms = feedback?.focusTerms?.length
        ? `<div class="lyrics-focus-terms">${feedback.focusTerms.map(term => `<span>${escapeLyricsHtml(term)}</span>`).join('')}</div>`
        : '';

    return `
        <section class="lyrics-report-section lyrics-feedback-summary">
            <h3>전체 총평</h3>
            <p>${escapeLyricsHtml(feedback?.summary || '분석 결과를 바탕으로 라임과 호흡을 정리해보세요.')}</p>
            ${focusTerms}
        </section>

        <section class="lyrics-report-section">
            <h3>우선 수정할 것</h3>
            <div class="lyrics-priority-list">${priorities}</div>
        </section>

        <section class="lyrics-report-section">
            <h3>섹션별 피드백</h3>
            <div class="lyrics-section-feedback-grid">${sectionFeedback}</div>
        </section>

        <section class="lyrics-report-section">
            <h3>라인별 보강 후보</h3>
            <div class="lyrics-line-feedback-list">${lineCandidates}</div>
        </section>
    `;
}

function renderLyricsAnalysisReport(report, container) {
    if (!container) return;
    const metric = (label, value) => `
        <div class="lyrics-metric">
            <span class="lyrics-metric-label">${escapeLyricsHtml(label)}</span>
            <span class="lyrics-metric-value">${escapeLyricsHtml(value)}</span>
        </div>
    `;
    const chips = rows => `<div class="lyrics-chip-list">${rows.map(row => `<span class="lyrics-chip">${escapeLyricsHtml(row)}</span>`).join('')}</div>`;

    const rhymeHtml = report.rhymeGroups.length
        ? report.rhymeGroups.map((group, index) => {
            const words = [...new Set(group.rows.map(row => row.endingRhymeText || row.endingWord).filter(Boolean))].slice(0, 8);
            const fit = average(group.rows.map(row => row.endingModelScore));
            return `<div class="lyrics-note">R${index + 1}: ${escapeLyricsHtml(words.join(' / '))} (${group.rows.length}라인, 모델 ${percent(fit)})</div>`;
        }).join('')
        : '<div class="lyrics-note">반복되는 끝 라임 그룹이 아직 뚜렷하지 않습니다.</div>';
    const slidingRhymeHtml = report.slidingRhymeGroups?.length
        ? report.slidingRhymeGroups.slice(0, 8).map((group, index) => {
            const words = [...new Set(group.rows.map(row => row.text).filter(Boolean))].slice(0, 10);
            return `<div class="lyrics-note">S${index + 1}: ${escapeLyricsHtml(words.join(' / '))} (${group.mode}, 유사도 ${percent(group.score / 100)})</div>`;
        }).join('')
        : '';
    const structuralRhymeHtml = report.structuralRhymeGroups?.length
        ? report.structuralRhymeGroups.slice(0, 8).map(group => {
            const words = [...new Set(group.rows.map(row => row.text).filter(Boolean))].slice(0, 10);
            const className = `rhyme-color-${group.groupIndex % 8}`;
            return `
                <div class="lyrics-structure-card">
                    <span class="lyrics-structure-label ${className}">${escapeLyricsHtml(group.label)}</span>
                    <div>
                        <strong>${escapeLyricsHtml(words.join(' / '))}</strong>
                        <p>${escapeLyricsHtml(group.mode)} · ${group.quality.distinctLines}행 연결 · 유사도 ${percent(group.score / 100)} · 규칙 ${percent(group.modelScore || 0)}</p>
                    </div>
                </div>
            `;
        }).join('')
        : '<div class="lyrics-note">구조적으로 반복되는 내부 라임은 아직 뚜렷하게 잡히지 않았습니다.</div>';
    const structuralPatternHtml = report.structuralRhymePatterns?.length
        ? report.structuralRhymePatterns.map(pattern => `<span class="lyrics-structure-pattern">${escapeLyricsHtml(pattern.text)}</span>`).join('')
        : '<span class="lyrics-structure-pattern is-muted">반복 패턴이 생기면 A ... B ... C 형태로 표시됩니다.</span>';

    const sectionRows = report.sections.map(section => `
        <tr>
            <td>${escapeLyricsHtml(section.type)}</td>
            <td>${section.lineCount}</td>
            <td>${section.avgWords.toFixed(1)}</td>
            <td>${percent(section.rhymeDensity)}</td>
            <td>${percent(section.internalDensity)}</td>
            <td>${percent(section.phonemeRhymeFit)}</td>
            <td>${percent(section.phonemeFlow)}</td>
            <td>${percent(section.hiphopAffinity)}</td>
            <td>${percent(section.naturalness)}</td>
        </tr>
    `).join('');

    const topicChips = report.topTerms.slice(0, 12).map(row => `${row.term} ${row.count}`);
    const clusterChips = report.clusterMatches.map(row => `${row.name}: ${row.matchedTerms.slice(0, 4).join(', ')}`);
    const repeatedChips = report.repeatedWords.map(([word, count]) => `${word} ${count}`);
    const annotatedLyricsHtml = (report.annotatedSections || []).map(section => `
        <div class="lyrics-annotated-section">
            <h4>${escapeLyricsHtml(section.type)}</h4>
            <div class="lyrics-line-list">
                ${section.lines.map(line => {
                    const structuralLabels = [...new Set((line.rhymeSpans || []).map(span => span.label).filter(Boolean))];
                    const groupLabel = structuralLabels.length
                        ? structuralLabels.join(' ')
                        : (line.groupIndex >= 0 ? `R${line.groupIndex + 1}` : '');
                    const groupClass = line.groupIndex >= 0 ? `rhyme-color-${line.groupIndex % 8}` : '';
                    const fit = line.groupIndex >= 0 ? percent(line.endingModelScore) : '';
                    return `
                        <div class="lyrics-line-row ${line.groupIndex >= 0 ? 'is-rhymed' : ''}">
                            <span class="lyrics-line-number">${line.index + 1}</span>
                            <span class="lyrics-line-text">${renderHighlightedLyricLine(line)}</span>
                            ${groupLabel ? `<span class="lyrics-rhyme-badge ${groupClass}" title="발음 모델 적합도 ${fit}">${groupLabel}</span>` : '<span class="lyrics-rhyme-badge is-empty">-</span>'}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        ${renderLyricsFeedbackPanel(report.feedback)}

        <section class="lyrics-report-section lyrics-annotated-report">
            <h3>가사 라임 표시</h3>
            <div class="lyrics-legend">
                <span><i class="lyrics-legend-swatch rhyme-color-0"></i>같은 색은 같은 구조 라임 그룹입니다.</span>
                <span>한 줄 안에 여러 색이 있으면 내부 라임이 여러 층으로 겹친 구간입니다.</span>
            </div>
            ${annotatedLyricsHtml || '<div class="lyrics-note">표시할 가사 라인이 없습니다.</div>'}
        </section>

        <section class="lyrics-report-section">
            <h3>구조적 라임 패턴</h3>
            <div class="lyrics-structure-patterns">${structuralPatternHtml}</div>
            <div class="lyrics-structure-grid">${structuralRhymeHtml}</div>
        </section>

        <section class="lyrics-report-section">
            <h3>전체 요약</h3>
            <div class="lyrics-metric-grid">
                ${metric('섹션', report.overview.sectionCount)}
                ${metric('라인', report.overview.lineCount)}
                ${metric('단어', report.overview.tokenCount)}
                ${metric('한국어', percent(report.overview.koRatio))}
                ${metric('끝 라임 밀도', percent(report.overview.rhymeDensity))}
                ${metric('내부 라임 밀도', percent(report.overview.internalDensity))}
                ${metric('발음 라임 적합도', percent(report.overview.phonemeRhymeFit))}
                ${metric('발음 플로우', percent(report.overview.phonemeFlow))}
                ${metric('구어체 자연도', percent(report.overview.naturalness))}
                ${metric('힙합 친화도', percent(report.overview.hiphopAffinity))}
            </div>
        </section>

        <section class="lyrics-report-section">
            <h3>섹션별 분석</h3>
            <table class="lyrics-section-table">
                <thead>
                    <tr>
                        <th>섹션</th><th>라인</th><th>평균 단어</th><th>끝 라임</th><th>내부 라임</th><th>발음 라임</th><th>발음 플로우</th><th>힙합</th><th>자연도</th>
                    </tr>
                </thead>
                <tbody>${sectionRows}</tbody>
            </table>
        </section>

        <section class="lyrics-report-section">
            <h3>라임 구조</h3>
            <div class="lyrics-note-list">${rhymeHtml}${slidingRhymeHtml}</div>
        </section>

        <section class="lyrics-report-section">
            <h3>주제/테마</h3>
            ${topicChips.length ? chips(topicChips) : '<div class="lyrics-note">강하게 잡힌 주제어가 아직 없습니다.</div>'}
            ${clusterChips.length ? `<div style="margin-top:0.75rem">${chips(clusterChips)}</div>` : ''}
        </section>

        <section class="lyrics-report-section">
            <h3>반복과 개선 포인트</h3>
            ${repeatedChips.length ? chips(repeatedChips) : ''}
            <div class="lyrics-note-list" style="margin-top:0.75rem">
                ${report.notes.map(note => `<div class="lyrics-note">${escapeLyricsHtml(note)}</div>`).join('')}
            </div>
        </section>
    `;
}
