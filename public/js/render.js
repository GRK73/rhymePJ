function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
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
        if (res.resultType === 'linked') {
            li.classList.add('linked-result-item');
            li.innerHTML = `
                <div class="result-score">환산 유사도 : ${res.score.toFixed(1)}%</div>
                ${res.topicSimilarity !== null && res.topicSimilarity !== undefined ? `<div class="semantic-score">주제 유사도: ${(((res.topicSimilarity + 1) / 2) * 100).toFixed(1)}%</div>` : ''}
                <div class="result-word linked-result-word">
                    <span>${escapeHtml(res.surfaceDisplay || `${res.first.display} + ${res.second.display}`)}</span>
                </div>
                <div class="result-meta linked-result-meta">
                    <span>분할: ${escapeHtml(res.splitLabel)}</span>
                    <div class="badge-container">
                        <span class="lang-badge ${res.lang}">${res.lang === 'ko' ? '한국어' : '영어'}</span>
                        <span class="layer-badge">연결</span>
                        ${res.matchTypeLabel ? `<span class="layer-badge">${escapeHtml(res.matchTypeLabel)}</span>` : ''}
                    </div>
                </div>
                <div class="linked-score-breakdown">
                    <span>앞끝 ${res.leftScore.toFixed(1)}</span>
                    <span>뒤앞 ${res.rightScore.toFixed(1)}</span>
                    ${res.surfaceExactScore !== undefined ? `<span>표면 ${res.surfaceExactScore.toFixed(1)}</span>` : ''}
                    <span>bigram ${res.bigramScore.toFixed(1)}</span>
                    ${res.spokenSurfaceScore ? `<span>구어 ${res.spokenSurfaceScore.toFixed(1)}</span>` : ''}
                    ${res.hiphopSurfaceScore ? `<span>힙합 ${res.hiphopSurfaceScore.toFixed(1)}</span>` : ''}
                    ${res.corpusScore ? `<span>corpus ${res.corpusScore.toFixed(1)}</span>` : ''}
                    <span>빈도 ${res.frequencyScore.toFixed(1)}</span>
                </div>
            `;
            resultsList.appendChild(li);
            return;
        }

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

        const corpusHtml = res.corpusAffinity
            ? `<div class="semantic-score">corpus affinity: ${(res.corpusAffinity * 100).toFixed(1)}%</div>`
            : '';

        li.innerHTML = `
            <div class="result-score">환산 유사도 : ${res.score.toFixed(1)}%</div>
            ${semanticHtml}
            ${corpusHtml}
            <div class="result-word">
                <span>${res.display}</span>
                <img src="assets/sound_icon.png" class="tts-icon" onclick="playTTS('${res.word.replace(/'/g, "\\'")}', '${res.lang}')" alt="Listen" title="발음 듣기"/>
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
