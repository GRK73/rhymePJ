const LYRIC_ANALYSIS_PATTERN_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function getLyricsMetricLineId(row) {
    return `${row?.section?.id || 'section'}:${row?.index ?? row?.lineIndex ?? 0}`;
}

function getLyricsMetricText(row) {
    return String(row?.endingRhymeText || row?.endingWord || row?.text || row?.line || '').trim();
}

function getLyricsMetricNormalizedText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function getLyricsMetricHangulCount(value) {
    return (String(value || '').match(/[\uAC00-\uD7A3]/g) || []).length;
}

function getLyricsMetricVowelCount(phonemes) {
    if (!Array.isArray(phonemes)) return 0;
    return phonemes.filter(phoneme => (
        typeof isLyricVowelPhoneme === 'function'
            ? isLyricVowelPhoneme(phoneme)
            : Boolean(globalThis.ipaFeatures?.[phoneme])
    )).length;
}

function estimateLyricsMetricSyllables(row) {
    const text = getLyricsMetricText(row);
    const hangulCount = getLyricsMetricHangulCount(text);
    if (hangulCount > 0) return hangulCount;
    const phonemeVowels = getLyricsMetricVowelCount(row?.phonemes || row?.endingPhonemes);
    if (phonemeVowels > 0) return phonemeVowels;
    const tokenCount = Number(row?.tokenCount || 0);
    if (tokenCount > 0) return tokenCount;
    return text ? 1 : 0;
}

function getLyricsMetricAverage(rows, getter) {
    const values = rows.map(getter).filter(value => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function classifyLyricsRhymeGroup(group, source = '') {
    const rows = Array.isArray(group?.rows) ? group.rows : [];
    const texts = rows.map(getLyricsMetricText).filter(Boolean);
    const normalizedTexts = texts.map(getLyricsMetricNormalizedText).filter(Boolean);
    const uniqueTexts = [...new Set(normalizedTexts)];
    const score = Number.isFinite(Number(group?.score))
        ? Number(group.score)
        : Math.max(70, getLyricsMetricAverage(rows, row => Number(row?.endingModelScore || 0)) * 100);
    const avgUnits = getLyricsMetricAverage(rows, estimateLyricsMetricSyllables);
    const hasEndingFlags = rows.some(row => Object.prototype.hasOwnProperty.call(row, 'isEnding'));
    const endingRatio = rows.filter(row => row.isEnding).length / Math.max(1, rows.length);
    const typeSet = new Set();

    if (source === 'end' || (group?.source === 'ending' && (!hasEndingFlags || endingRatio >= 0.6))) {
        typeSet.add('end-rhyme');
    }
    if (source === 'sliding') typeSet.add('internal-rhyme');
    if (source === 'structural' && (group?.source !== 'ending' || (hasEndingFlags && endingRatio < 0.6))) {
        typeSet.add('structural-rhyme');
    }
    if (String(group?.signature || '').startsWith('en:') || rows.some(row => row.lang === 'en')) typeSet.add('english-rime');
    if (avgUnits >= 2) typeSet.add('multi-syllable');
    if (uniqueTexts.length === 1 && normalizedTexts.length >= 2) typeSet.add('repeat');
    if (String(group?.mode || '').toLowerCase().includes('vowel')) typeSet.add('assonance');
    if (String(group?.mode || '').toLowerCase().includes('consonant')) typeSet.add('consonance');
    if (score > 0 && score < 92) typeSet.add('slant');
    if (typeSet.size === 0) typeSet.add('rhyme');

    let confidenceScore = Math.min(100, Math.max(0, score));
    if (rows.length >= 4) confidenceScore += 4;
    if (typeSet.has('multi-syllable')) confidenceScore += 5;
    if (typeSet.has('repeat')) confidenceScore -= 18;
    confidenceScore = Math.min(100, Math.max(0, confidenceScore));

    const confidence = confidenceScore >= 82 ? 'strong' : confidenceScore >= 62 ? 'medium' : 'weak';
    const rhymeTypes = [...typeSet];
    const primaryType = rhymeTypes.includes('end-rhyme')
        ? 'end-rhyme'
        : rhymeTypes.includes('structural-rhyme')
            ? 'structural-rhyme'
            : rhymeTypes[0];

    return {
        ...group,
        rhymeType: primaryType,
        rhymeTypes,
        confidence,
        confidenceScore,
        reason: buildLyricsRhymeReason(rhymeTypes, confidence)
    };
}

function buildLyricsRhymeReason(rhymeTypes, confidence) {
    const labels = {
        'end-rhyme': '끝라임',
        'internal-rhyme': '내부라임',
        'structural-rhyme': '구조라임',
        'english-rime': '영어 끝소리',
        'multi-syllable': '다중음절',
        repeat: '반복어',
        assonance: '모음운',
        consonance: '자음운',
        slant: '유사라임',
        rhyme: '라임'
    };
    const confidenceLabel = confidence === 'strong' ? '강함' : confidence === 'medium' ? '보통' : '약함';
    return `${rhymeTypes.map(type => labels[type] || type).join(' · ')} · ${confidenceLabel}`;
}

function enrichLyricsRhymeGroups(groups, source = '') {
    return (groups || []).map(group => classifyLyricsRhymeGroup(group, source));
}

function buildLyricsSectionPattern(rows, rhymeGroupIndexByLineId) {
    const labelsByGroup = new Map();
    const labels = rows.map(row => {
        const groupIndex = rhymeGroupIndexByLineId?.get(getLyricsMetricLineId(row));
        if (!Number.isFinite(groupIndex)) return '-';
        if (!labelsByGroup.has(groupIndex)) {
            labelsByGroup.set(groupIndex, LYRIC_ANALYSIS_PATTERN_LABELS[labelsByGroup.size] || `G${labelsByGroup.size + 1}`);
        }
        return labelsByGroup.get(groupIndex);
    });
    return {
        labels,
        text: labels.join(' '),
        uniqueCount: new Set(labels.filter(label => label !== '-')).size
    };
}

function getLyricsRepeatRate(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return 0;
    const counts = new Map();
    tokens.forEach(token => {
        const key = getLyricsMetricNormalizedText(token);
        if (!key) return;
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    const repeated = [...counts.values()].filter(count => count > 1).reduce((sum, count) => sum + count, 0);
    return repeated / Math.max(1, tokens.length);
}

function getLyricsPatternRegularity(labels) {
    const active = labels.filter(label => label !== '-');
    if (labels.length === 0 || active.length < 2) return 0;
    const adjacentMatches = labels.slice(1).filter((label, index) => label !== '-' && label === labels[index]).length;
    const coverage = active.length / labels.length;
    const reuse = active.length ? 1 - new Set(active).size / active.length : 0;
    return Math.max(0, Math.min(1, coverage * 0.55 + reuse * 0.30 + adjacentMatches / Math.max(1, labels.length - 1) * 0.15));
}

function buildLyricsSectionTemplate(section, rows, rhymeGroupIndexByLineId) {
    const tokens = rows.flatMap(row => row.tokens || []);
    const pattern = buildLyricsSectionPattern(rows, rhymeGroupIndexByLineId);
    const avgSyllables = getLyricsMetricAverage(rows, row => {
        if (Array.isArray(row.linePhonemes) && row.linePhonemes.length) {
            const vowelCount = getLyricsMetricVowelCount(row.linePhonemes);
            if (vowelCount > 0) return vowelCount;
        }
        return getLyricsMetricHangulCount(row.line) || Number(row.wordCount || 0);
    });
    const repeatRate = getLyricsRepeatRate(tokens);
    const regularity = getLyricsPatternRegularity(pattern.labels);
    const sectionType = String(section?.type || '').toLowerCase();
    const role = /hook|chorus|refrain|후렴|훅/.test(sectionType)
        ? 'hook'
        : /intro|outro|bridge|브릿지/.test(sectionType)
            ? 'transition'
            : 'verse';

    return {
        role,
        pattern: pattern.text,
        patternLabels: pattern.labels,
        patternRegularity: regularity,
        repeatRate,
        avgSyllables,
        lineCount: rows.length,
        summary: buildLyricsSectionTemplateSummary(role, pattern.text, repeatRate, regularity)
    };
}

function buildLyricsSectionTemplateSummary(role, pattern, repeatRate, regularity) {
    const roleLabel = role === 'hook' ? 'Hook' : role === 'transition' ? '전환부' : 'Verse';
    const repeatLabel = repeatRate >= 0.28 ? '반복 강함' : repeatRate >= 0.12 ? '반복 보통' : '반복 약함';
    const regularityLabel = regularity >= 0.62 ? '패턴 안정' : regularity >= 0.34 ? '패턴 보통' : '패턴 느슨';
    return `${roleLabel} · ${pattern || '-'} · ${repeatLabel} · ${regularityLabel}`;
}
