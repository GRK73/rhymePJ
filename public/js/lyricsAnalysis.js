let lyricsAnalysisModels = null;
let lyricsAnalysisLoadingPromise = null;
let lyricsEnglishPhonemeLookup = null;
const lyricsPhonemeCache = new Map();

const LYRIC_TOKEN_RE = /[\uAC00-\uD7A3]+|[A-Za-z][A-Za-z']*/g;
const LYRIC_KO_RE = /^[\uAC00-\uD7A3]+$/;
const LYRIC_EN_RE = /^[a-z][a-z']*$/;
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
    if (!progressEl || !barEl || !labelEl || !valueEl) return;

    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    progressEl.hidden = false;
    barEl.style.width = `${clamped}%`;
    labelEl.textContent = label || '분석 중';
    valueEl.textContent = `${clamped}%`;
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
    return String(text || '')
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

function getKoreanSyllableRhymeSignature(word) {
    const clean = normalizeLyricToken(word);
    if (!LYRIC_KO_RE.test(clean)) return '';
    const chars = Array.from(clean);
    const width = isWeakKoreanSentenceEnding(clean) && chars.length >= 2 ? 2 : 1;
    const signatures = chars.slice(-width).map(char => {
        const code = char.charCodeAt(0) - 0xAC00;
        if (code < 0 || code > 11171) return '';
        const vowelIndex = Math.floor((code % 588) / 28);
        const finalIndex = code % 28;
        return `${vowelIndex}:${finalIndex}`;
    }).filter(Boolean);
    if (!signatures.length) return '';
    return `ko:${signatures.join('+')}`;
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

    const phonemes = getLyricWordPhonemes(word);
    if (phonemes.length > 0) {
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
            englishFlow: 'english_hiphop_flow_shape_stats.json'
        };

        const loaded = {};
        const entries = Object.entries(files);
        for (let index = 0; index < entries.length; index += 1) {
            const [key, filename] = entries[index];
            onProgress(10 + index / entries.length * 45, `${filename} 로드 중`);
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
                ngrams: buildPhonemeNgramModel(loaded.hiphopPhonemeNgrams)
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
        const endingPhonemes = tokenPhonemeRowsWithStops.at(-1)?.phonemes || getLyricWordPhonemes(endingWord);
        const phonemeRhymeSignature = getPhonemeSignature(endingPhonemes, 2);
        const rhymeSignature = getRhymeSignature(endingWord) || phonemeRhymeSignature;
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
    const rhymedLineIds = new Set(repeatedRhymeGroups.flatMap(group => group.rows.map(row => `${row.section.id}:${row.index}`)));

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

    const report = {
        overview: {
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
        },
        sections: sectionReports,
        rhymeGroups: repeatedRhymeGroups,
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
            const words = [...new Set(group.rows.map(row => row.endingWord).filter(Boolean))].slice(0, 8);
            const fit = average(group.rows.map(row => row.endingModelScore));
            return `<div class="lyrics-note">R${index + 1}: ${escapeLyricsHtml(words.join(' / '))} (${group.rows.length}라인, 모델 ${percent(fit)})</div>`;
        }).join('')
        : '<div class="lyrics-note">반복되는 끝 라임 그룹이 아직 뚜렷하지 않습니다.</div>';

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

    container.innerHTML = `
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
            <div class="lyrics-note-list">${rhymeHtml}</div>
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
