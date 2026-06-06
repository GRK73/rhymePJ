function isVowelPhoneme(phoneme) {
    return Boolean(ipaFeatures[phoneme]);
}

function getItemPhonemes(item) {
    return item.phonemes || item.vowels || [];
}

function getItemPhonemeCandidates(item) {
    if (!item) return [];

    if (item.lang === 'ko' && typeof getStoredKoreanPronunciationCandidates === 'function') {
        const storedCandidates = getStoredKoreanPronunciationCandidates(item);
        if (storedCandidates.length > 0) {
            return storedCandidates.map(candidate => candidate.phonemes);
        }
    }

    const phonemes = getItemPhonemes(item);
    return phonemes.length > 0 ? [phonemes] : [];
}

function getBoundaryScore(targetPhonemes, queryPhonemes, side, detailMultipliers = []) {
    if (!targetPhonemes || !queryPhonemes || queryPhonemes.length === 0) return { score: 0, matchIndices: [] };
    if (targetPhonemes.length < queryPhonemes.length) return { score: 0, matchIndices: [] };

    const start = side === 'end' ? targetPhonemes.length - queryPhonemes.length : 0;
    const segment = targetPhonemes.slice(start, start + queryPhonemes.length);
    const result = calculateScore(segment, queryPhonemes, detailMultipliers);
    return {
        score: result.score,
        matchIndices: (result.matchIndices || []).map(index => index + start)
    };
}

function getBestBoundaryScore(targetPhonemeCandidates, queryPhonemes, side, detailMultipliers = []) {
    const candidates = Array.isArray(targetPhonemeCandidates)
        ? targetPhonemeCandidates
        : [];
    if (candidates.length === 0) return { score: 0, matchIndices: [] };

    return candidates.reduce((best, candidate) => {
        const phonemes = Array.isArray(candidate) ? candidate : candidate.phonemes;
        const result = getBoundaryScore(phonemes, queryPhonemes, side, detailMultipliers);
        return result.score > best.score ? result : best;
    }, { score: 0, matchIndices: [] });
}

function normalizeZipf(zipf) {
    const value = Number.isFinite(zipf) ? zipf : 1.0;
    return Math.max(0, Math.min(100, ((value - 1) / 6) * 100));
}

function getPairFrequencyScore(first, second) {
    return (normalizeZipf(first.zipf) + normalizeZipf(second.zipf)) / 2;
}

function parseSurfaceFollowerRow(row) {
    if (!Array.isArray(row)) return null;
    return {
        surface: String(row[0] || ''),
        count: Number(row[1]) || 0,
        score: Number(row[2]) || 0,
        normalized: String(row[3] || '')
    };
}

function getBoundarySurfaceMatch(surface, queryText, side) {
    const surfaceChars = Array.from(surface || '');
    const queryChars = Array.from(queryText || '');
    if (surfaceChars.length === 0 || queryChars.length === 0) {
        return { score: 0, exact: false, overlap: 0 };
    }

    const maxOverlap = Math.min(surfaceChars.length, queryChars.length);
    for (let size = maxOverlap; size > 0; size--) {
        const surfaceSegment = side === 'end'
            ? surfaceChars.slice(surfaceChars.length - size).join('')
            : surfaceChars.slice(0, size).join('');
        const querySegment = side === 'end'
            ? queryChars.slice(queryChars.length - size).join('')
            : queryChars.slice(0, size).join('');
        if (surfaceSegment === querySegment) {
            const exact = size === queryChars.length;
            const ratio = size / queryChars.length;
            return {
                score: exact ? 100 : 60 + ratio * 25,
                exact,
                overlap: size
            };
        }
    }

    return { score: 0, exact: false, overlap: 0 };
}

function sumDetailImportance(detailMultipliers) {
    if (!Array.isArray(detailMultipliers) || detailMultipliers.length === 0) return 1;
    return detailMultipliers.reduce((sum, value) => sum + (Number.isFinite(value) ? Math.max(0, value) : 1), 0) || 1;
}

function getWeightedLinkedBoundaryScore({
    leftSurfaceMatch,
    rightSurfaceMatch,
    leftPhoneticScore,
    rightPhoneticScore,
    leftDetailMultipliers,
    rightDetailMultipliers
}) {
    const leftImportance = sumDetailImportance(leftDetailMultipliers);
    const rightImportance = sumDetailImportance(rightDetailMultipliers);
    const totalImportance = leftImportance + rightImportance;
    const exactBoundaryScore = totalImportance > 0
        ? ((leftSurfaceMatch.score * leftImportance) + (rightSurfaceMatch.score * rightImportance)) / totalImportance
        : (leftSurfaceMatch.score + rightSurfaceMatch.score) / 2;
    const phoneticBoundaryScore = totalImportance > 0
        ? ((leftPhoneticScore * leftImportance) + (rightPhoneticScore * rightImportance)) / totalImportance
        : (leftPhoneticScore + rightPhoneticScore) / 2;
    const score = exactBoundaryScore > 0
        ? exactBoundaryScore * 0.85 + phoneticBoundaryScore * 0.15
        : phoneticBoundaryScore;

    return {
        score,
        exactBoundaryScore,
        phoneticBoundaryScore
    };
}

function getSurfaceMatchType(leftSurfaceMatch, rightSurfaceMatch) {
    if (leftSurfaceMatch.exact && rightSurfaceMatch.exact) {
        return { type: 'exact-surface', label: '정확 연결' };
    }
    if (leftSurfaceMatch.score > 0 || rightSurfaceMatch.score > 0) {
        return { type: 'partial-surface', label: '부분 연결' };
    }
    return { type: 'phonetic-fallback', label: '발음 유사' };
}

function formatSurfaceLinkedDisplay(firstSurface, secondSurface, leftText = '', rightText = '') {
    const firstChars = Array.from(firstSurface || '');
    const secondChars = Array.from(secondSurface || '');
    if (firstChars.length === 0 || secondChars.length === 0) {
        return `${firstSurface || ''} ${secondSurface || ''}`.trim();
    }

    const leftLength = Math.max(1, Math.min(firstChars.length, Array.from(leftText || '').length || 1));
    const rightLength = Math.max(1, Math.min(secondChars.length, Array.from(rightText || '').length || 1));
    const firstPrefix = firstChars.slice(0, firstChars.length - leftLength).join('');
    const firstBoundary = firstChars.slice(firstChars.length - leftLength).join('');
    const secondBoundary = secondChars.slice(0, rightLength).join('');
    const secondSuffix = secondChars.slice(rightLength).join('');
    return `${firstPrefix}[${firstBoundary} ${secondBoundary}]${secondSuffix}`;
}

function getSplitDetailMultipliers(detailMultipliers, startIndex, endIndex, targetLength) {
    if (!Array.isArray(detailMultipliers) || targetLength <= 0) return [];

    const sourceSlice = detailMultipliers.slice(startIndex, endIndex);
    if (sourceSlice.length > 0) {
        return remapDetailMultipliers(sourceSlice, sourceSlice.length, targetLength);
    }

    return remapDetailMultipliers(detailMultipliers, detailMultipliers.length, targetLength);
}

function normalizeBigramScore(value) {
    const numeric = Number(value) || 0;
    return Math.max(0, Math.min(100, Math.log1p(Math.max(0, numeric)) / Math.log1p(24) * 100));
}

function normalizeLinkedBigramCount(count) {
    const numeric = Number(count) || 0;
    return Math.max(0, Math.min(100, Math.log1p(Math.max(0, numeric)) / Math.log1p(200000) * 100));
}

function getCountAwareBigramScore(score, count) {
    const associationScore = normalizeBigramScore(score);
    const countScore = normalizeLinkedBigramCount(count);
    return associationScore * 0.40 + countScore * 0.60;
}

function averageVectors(a, b) {
    if (!a || !b || a.length !== b.length) return null;
    return a.map((value, index) => (value + b[index]) / 2);
}

function getPhraseTopicSimilarity(first, second, lang, semanticContext) {
    if (!semanticContext.active) return { matched: true, similarity: null, topicScore: null };

    const topicVectors = lang === 'ko'
        ? semanticContext.koTopicVector ? [semanticContext.koTopicVector] : []
        : semanticContext.enTopicVectors;
    if (topicVectors.length === 0) return { matched: false, similarity: null, topicScore: null };

    const firstVector = getSemanticVector(first.semanticWord || first.word, lang) || getSemanticVector(first.display, lang);
    const secondVector = getSemanticVector(second.semanticWord || second.word, lang) || getSemanticVector(second.display, lang);
    const phraseVector = averageVectors(firstVector, secondVector);
    if (!phraseVector) return { matched: false, similarity: null, topicScore: null };

    let best = null;
    topicVectors.forEach(topicVector => {
        const similarity = cosineSimilarity(topicVector, phraseVector);
        if (similarity !== null && (best === null || similarity > best)) {
            best = similarity;
        }
    });

    if (best === null) return { matched: false, similarity: null, topicScore: null };
    return {
        matched: true,
        similarity: best,
        topicScore: Math.max(0, Math.min(100, ((best + 1) / 2) * 100))
    };
}

function getLinkedSearchLangs(selectedLang) {
    if (selectedLang === 'ko') return ['ko'];
    if (selectedLang === 'en') return ['en'];
    return ['ko', 'en'];
}

function buildKoreanLinkedSplits(query, targetLang = 'ko') {
    const chars = Array.from(query);
    if (chars.length < 2 || !hasKoreanPhoneticInput(query)) return [];

    const splits = [];
    for (let index = 1; index < chars.length; index++) {
        const leftText = chars.slice(0, index).join('');
        const rightText = chars.slice(index).join('');
        const leftPhonemes = getKoreanPhoneticInputPhonemes(leftText).phonemes;
        const rightPhonemes = getKoreanPhoneticInputPhonemes(rightText).phonemes;
        if (leftPhonemes.length === 0 || rightPhonemes.length === 0) continue;

        splits.push({
            lang: targetLang,
            sourceLang: 'ko',
            leftText,
            rightText,
            leftPhonemes,
            rightPhonemes,
            leftSourceStart: 0,
            leftSourceEnd: leftPhonemes.length,
            rightSourceStart: leftPhonemes.length,
            rightSourceEnd: leftPhonemes.length + rightPhonemes.length,
            label: `${leftText} / ${rightText}`,
            balance: Math.min(leftPhonemes.length, rightPhonemes.length) / Math.max(leftPhonemes.length, rightPhonemes.length)
        });
    }

    return splits;
}

function buildEnglishLinkedSplits(query, targetLang = 'en') {
    const phonemeData = getQueryPhonemes(query);
    const phonemes = phonemeData.phonemes || [];
    if (phonemes.length < 2) return [];

    const minSideLength = phonemes.length <= 4 ? 1 : 2;
    const splits = [];
    for (let index = 1; index < phonemes.length; index++) {
        const leftPhonemes = phonemes.slice(0, index);
        const rightPhonemes = phonemes.slice(index);
        if (leftPhonemes.length < minSideLength || rightPhonemes.length < minSideLength) continue;
        if (!isVowelPhoneme(phonemes[index - 1]) && !isVowelPhoneme(phonemes[index])) continue;

        const leftHasVowel = leftPhonemes.some(isVowelPhoneme);
        const rightHasVowel = rightPhonemes.some(isVowelPhoneme);
        const vowelPenalty = leftHasVowel && rightHasVowel ? 1 : 0.86;
        const balance = Math.min(leftPhonemes.length, rightPhonemes.length) / Math.max(leftPhonemes.length, rightPhonemes.length);

        splits.push({
            lang: targetLang,
            sourceLang: 'en',
            leftText: leftPhonemes.join(' '),
            rightText: rightPhonemes.join(' '),
            leftPhonemes,
            rightPhonemes,
            leftSourceStart: 0,
            leftSourceEnd: leftPhonemes.length,
            rightSourceStart: leftPhonemes.length,
            rightSourceEnd: leftPhonemes.length + rightPhonemes.length,
            label: `${leftPhonemes.join(' ')} / ${rightPhonemes.join(' ')}`,
            balance: balance * vowelPenalty
        });
    }

    return splits;
}

function buildLinkedSplits(query, targetLang) {
    return hasKoreanPhoneticInput(query)
        ? buildKoreanLinkedSplits(query, targetLang)
        : buildEnglishLinkedSplits(query, targetLang);
}

function dedupeLinkedResults(results) {
    const bestByKey = new Map();
    results.forEach(result => {
        const key = `${result.lang}:${result.first.word}+${result.second.word}`;
        const current = bestByKey.get(key);
        if (!current || result.score > current.score) {
            bestByKey.set(key, result);
        }
    });
    return Array.from(bestByKey.values());
}
