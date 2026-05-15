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
