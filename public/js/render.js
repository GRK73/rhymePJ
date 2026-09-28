function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

// Results may arrive in pages: resultTotal is the full count and resultPageLoader(offset)
// fetches the next page (word search keeps its result list in the Worker).
let resultTotal = 0;
let resultPageLoader = null;

function clearSearchResults() {
    meaningObserver.disconnect();
    currentFilteredResults = [];
    resultsShown = 0;
    resultTotal = 0;
    resultPageLoader = null;
    resultsList.replaceChildren();
    loadMoreBtn.style.display = 'none';
}

function displayResults(results, { total = results.length, loadPage = null } = {}) {
    clearSearchResults();
    currentFilteredResults = results;
    resultTotal = total;
    resultPageLoader = loadPage;
    
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
                        <span class="lang-badge ${escapeHtml(res.lang)}">${res.lang === 'ko' ? '한국어' : '영어'}</span>
                        <span class="layer-badge">연결</span>
                    </div>
                </div>
                <div class="linked-score-breakdown">
                    <span>앞끝 ${res.leftScore.toFixed(1)}</span>
                    <span>뒤앞 ${res.rightScore.toFixed(1)}</span>
                    <span>발음 ${res.pronunciationScore.toFixed(1)}</span>
                    <span>빈도(zipf) ${res.zipf.toFixed(1)}</span>
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
                return `<span style="color: #3498db; font-weight: bold;">${escapeHtml(p)}</span>`;
            }
            return escapeHtml(p);
        }).join(', ');
        const matchLayerBadge = res.matchLayerLabel ? `<span class="layer-badge">${escapeHtml(res.matchLayerLabel)}</span>` : '';
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
                <span>${escapeHtml(res.display)}</span>
                <img src="assets/sound_icon.png" class="tts-icon" alt="Listen" title="발음 듣기"/>
            </div>
            <div class="result-meta">
                <span>[${phonemesHtml}]</span>
                <div class="badge-container">
                    <span class="lang-badge ${escapeHtml(res.lang)}">${res.lang === 'ko' ? '한국어' : '영어'}</span>
                    ${matchLayerBadge}
                </div>
            </div>
            <div class="result-meaning">
                <div class="meaning-spinner"></div>
            </div>
        `;
        li.querySelector('.tts-icon').addEventListener('click', () => playTTS(res.word, res.lang));
        resultsList.appendChild(li);
        meaningObserver.observe(li);
    });

    resultsShown += chunk.length;
    loadMoreBtn.style.display = resultsShown >= resultTotal ? 'none' : 'block';
}

async function showMoreResults() {
    const loader = resultPageLoader;
    if (loader && resultsShown >= currentFilteredResults.length && currentFilteredResults.length < resultTotal) {
        loadMoreBtn.disabled = true;
        try {
            const items = await loader(currentFilteredResults.length);
            if (resultPageLoader !== loader) return;
            currentFilteredResults.push(...items);
        } catch (error) {
            if (resultPageLoader === loader) statusEl.textContent = '다음 결과를 불러오지 못했습니다. 다시 검색해 주세요.';
            console.error('Result page failed:', error);
            return;
        } finally {
            loadMoreBtn.disabled = false;
        }
    }
    renderMoreResults();
}
