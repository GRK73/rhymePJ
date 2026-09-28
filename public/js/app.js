let isReady = false;


const statusEl = document.getElementById('status');
const searchInput = document.getElementById('searchInput');
const topicInput = document.getElementById('topicInput');
const searchBtn = document.getElementById('searchBtn');
const resultsList = document.getElementById('resultsList');
const langRadios = document.getElementsByName('lang');
const pronunciationModeRadios = document.getElementsByName('pronunciationMode');
const searchModeButtons = document.querySelectorAll('.mode-toggle-btn');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const linkedSurfaceOptions = document.getElementById('linkedSurfaceOptions');
const firstParticleOption = document.getElementById('firstParticleOption');
const allowFirstParticleKo = document.getElementById('allowFirstParticleKo');
const principleInfoBtn = document.getElementById('principleInfoBtn');
const principleInfoDialog = document.getElementById('principleInfoDialog');
const principleInfoCloseBtn = document.getElementById('principleInfoCloseBtn');
const principleInfoPanel = principleInfoDialog?.querySelector('.principle-info-panel');

const consoWeightInput = document.getElementById('consoWeight');
const vowelWeightInput = document.getElementById('vowelWeight');
const freqWeightInput = document.getElementById('freqWeight');
const topicWeightInput = document.getElementById('topicWeight');
const pronunciationFilterGroup = document.getElementById('pronunciationFilterGroup');

const consoVal = document.getElementById('consoVal');
const vowelVal = document.getElementById('vowelVal');
const freqVal = document.getElementById('freqVal');
const topicVal = document.getElementById('topicVal');
const globalPhonemeWeightContainers = document.querySelectorAll('.global-phoneme-weight');

const excludeInput = document.getElementById('excludeInput');

const useDetailWeights = document.getElementById('useDetailWeights');
const detailGroup = document.getElementById('detailGroup');
const detailSlidersContainer = document.getElementById('detailSlidersContainer');
const searchProgress = document.getElementById('searchProgress');
const searchProgressBar = document.getElementById('searchProgressBar');
const searchProgressLabel = document.getElementById('searchProgressLabel');
const searchProgressTitle = document.getElementById('searchProgressTitle');
const searchProgressPercent = document.getElementById('searchProgressPercent');
const cancelSearchBtn = document.getElementById('cancelSearchBtn');

let currentQueryPhonemeData = { phonemes: [], charMap: [] };
let lastQueryWord = '';
let currentSearchMode = 'word';
// Shared UI operation token for word and linked searches; stale replies cannot render.
let activeWordSearch = null;

const reSearchBtn = document.getElementById('reSearchBtn');
reSearchBtn.addEventListener('click', handleSearch);

function setWordSearchBusy(isBusy) {
    searchBtn.disabled = isBusy || !isReady;
    reSearchBtn.disabled = isBusy || !isReady;
    cancelSearchBtn.disabled = !isBusy;
    if (!isBusy) searchProgress.hidden = true;
}

function renderSearchLoading(label, completed, total, title = '검색기 로딩중...') {
    searchProgress.hidden = false;
    searchProgressTitle.textContent = title;
    searchProgressLabel.textContent = label;
    if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
        const done = Math.max(0,Math.min(completed,total));
        searchProgressBar.value = done / total * 100;
        searchProgressBar.setAttribute('aria-valuetext',`${total}개 중 ${done}개 완료`);
        searchProgressPercent.textContent = `${done.toLocaleString()} / ${total.toLocaleString()}`;
    } else {
        searchProgressBar.removeAttribute('value');
        searchProgressBar.removeAttribute('aria-valuetext');
        searchProgressPercent.textContent = '';
    }
}

function renderWordSearchProgress(progress) {
    if (['lexicon', 'topic', 'linked', 'model'].includes(progress.phase) && progress.total) {
        // Byte progress, shown in MB.
        const mb = bytes => Math.round(bytes / 1e5) / 10;
        const label = {lexicon:'검색 사전 내려받는 중 (MB)', topic:'주제 자료 내려받는 중 (MB)',
            linked:'연결 검색 자료 내려받는 중 (MB)', model:'발음 모델 내려받는 중 (MB)'}[progress.phase];
        renderSearchLoading(label, mb(progress.completed), mb(progress.total), '검색기 로딩중...');
        return;
    }
    const labels = {resolve:'검색어 발음 확인 중', topic:'주제 자료 불러오는 중', compute:'라임 점수 계산 중'};
    renderSearchLoading(labels[progress.phase] || '검색 준비 중', undefined, undefined,
        progress.phase === 'compute' ? '라임 검색중...' : '검색기 로딩중...');
}

function abandonActiveWordSearch() {
    if (!activeWordSearch) return;
    const operation = activeWordSearch;
    activeWordSearch = null;
    operation.controller.abort();
    setWordSearchBusy(false);
}

function cancelActiveWordSearch() {
    if (!activeWordSearch) return;
    activeWordSearch.cancelledByUser = true;
    activeWordSearch.controller.abort();
    cancelSearchBtn.disabled = true;
    statusEl.textContent = '검색을 취소하는 중입니다...';
}

cancelSearchBtn.addEventListener('click', cancelActiveWordSearch);
setWordSearchBusy(false);

function openPrincipleInfoDialog() {
    if (!principleInfoDialog) return;
    principleInfoDialog.hidden = false;
    principleInfoBtn?.setAttribute('aria-expanded', 'true');
    principleInfoPanel?.focus();
}

function closePrincipleInfoDialog() {
    if (!principleInfoDialog || principleInfoDialog.hidden) return;
    principleInfoDialog.hidden = true;
    principleInfoBtn?.setAttribute('aria-expanded', 'false');
    principleInfoBtn?.focus();
}

principleInfoBtn?.addEventListener('click', openPrincipleInfoDialog);
principleInfoCloseBtn?.addEventListener('click', closePrincipleInfoDialog);
principleInfoDialog?.addEventListener('click', event => {
    if (event.target && typeof event.target.hasAttribute === 'function' && event.target.hasAttribute('data-principle-close')) {
        closePrincipleInfoDialog();
    }
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && principleInfoDialog && !principleInfoDialog.hidden) {
        closePrincipleInfoDialog();
    }
});

// No auto-render on toggle since there's a research button, but we can toggle visibility of sliders
// If detail weights is checked, we just leave it. If they uncheck it, they can also click re-search.

function updateSliderVals() {
    consoVal.textContent = parseFloat(consoWeightInput.value).toFixed(1);
    vowelVal.textContent = parseFloat(vowelWeightInput.value).toFixed(1);
    freqVal.textContent = parseFloat(freqWeightInput.value).toFixed(1);
    topicVal.textContent = parseFloat(topicWeightInput.value).toFixed(1);
}

[consoWeightInput, vowelWeightInput, freqWeightInput, topicWeightInput].forEach(el => {
    el.addEventListener('input', () => {
        updateSliderVals();
    });
});

function syncDetailWeightControls() {
    const isDetailActive = useDetailWeights.checked;
    consoWeightInput.disabled = isDetailActive;
    vowelWeightInput.disabled = isDetailActive;
    globalPhonemeWeightContainers.forEach(container => {
        container.classList.toggle('disabled', isDetailActive);
    });
}

useDetailWeights.addEventListener('change', syncDetailWeightControls);
syncDetailWeightControls();

function syncSearchModeControls() {
    const isLinkedMode = currentSearchMode === 'linked';
    const selectedLang = getSelectedLang();
    const isKoreanLinkedSurfaceMode = isLinkedMode && selectedLang !== 'en';
    // Pronunciation mode applies to both searches.
    const pronunciationOptions = document.getElementById('pronunciationModeOptions');
    if (pronunciationOptions) pronunciationOptions.hidden = false;
    const pronunciationNotice = '영어 단어를 실제 영어 발음, 한국식 발음, 또는 둘 다(혼합)로 비교합니다.';
    pronunciationFilterGroup?.setAttribute('title', pronunciationNotice);
    const pronunciationNoticeEl = document.getElementById('pronunciationModeNotice');
    if (pronunciationNoticeEl) pronunciationNoticeEl.textContent = pronunciationNotice;
    if (linkedSurfaceOptions) {
        linkedSurfaceOptions.hidden = !isKoreanLinkedSurfaceMode;
    }
    if (firstParticleOption) {
        firstParticleOption.hidden = !isKoreanLinkedSurfaceMode;
        if (!isKoreanLinkedSurfaceMode && allowFirstParticleKo) {
            allowFirstParticleKo.checked = false;
        }
    }
}

Array.from(langRadios).forEach(radio => {
    radio.addEventListener('change', () => {
        abandonActiveWordSearch();
        clearSearchResults();
        syncSearchModeControls();
        statusEl.textContent = '검색 조건이 변경되었습니다. 다시 검색하세요.';
    });
});

searchModeButtons.forEach(button => {
    button.addEventListener('click', () => {
        const nextMode = button.dataset.searchMode || 'word';
        if (nextMode !== currentSearchMode) {
            abandonActiveWordSearch();
            clearSearchResults();
        }
        currentSearchMode = nextMode;
        searchModeButtons.forEach(item => {
            const isActive = item === button;
            item.classList.toggle('active', isActive);
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        syncSearchModeControls();
        if (currentSearchMode === 'linked') {
            statusEl.textContent = '연결 라임 검색은 두 단어 조합을 계산하므로 검색이 느릴 수 있습니다.';
        } else {
            statusEl.textContent = '단어 라임 검색: 사전 전체를 설정한 가중치로 비교합니다.';
            prefetchWordSearch();
        }
    });
});
syncSearchModeControls();

let currentFilteredResults = [];
let resultsShown = 0;
const PAGE_SIZE = 99;

function renderExternalDictionaryLink(element, word, lang) {
    const baseUrl = lang === 'en'
        ? 'https://en.dict.naver.com/#/search?query='
        : 'https://ko.dict.naver.com/#/search?query=';
    element.innerHTML = `<a href="${baseUrl}${encodeURIComponent(word)}" target="_blank" rel="noopener noreferrer" class="dict-link">사전 검색 ↗</a>`;
}

// Meanings under word-search results, as in V1: loaded when a result scrolls into view.
// English: Korean glosses from Google Translate's dictionary data; Korean: the first
// sentence of the Korean Wikipedia article. When neither has one, a dictionary link.
const KO_DISAMBIGUATION = ['다음을 가리', '뜻으로 쓰인', '다음을 의미', '동음이의', '다른 뜻', '다음과 같'];

async function lookupMeaning(word, lang) {
    if (lang === 'en') {
        const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&dt=bd&q=${encodeURIComponent(word)}`);
        const data = await response.json();
        const meanings = [...new Set((data?.[1] || []).flatMap(pos => (Array.isArray(pos?.[1]) ? pos[1] : [])))];
        if (meanings.length) return meanings.slice(0, 8).join(', ');
        const translation = data?.[0]?.[0]?.[0];
        return translation && translation.toLowerCase() !== word.toLowerCase() ? translation : null;
    }
    const response = await fetch(`https://ko.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&exsentences=1&redirects=1&titles=${encodeURIComponent(word)}&format=json&origin=*`);
    const pages = (await response.json())?.query?.pages || {};
    const extract = Object.values(pages)[0]?.extract?.trim();
    // Disambiguation pages and raw wiki templates ({{노래 정보 ...) are not meanings.
    return extract && !extract.includes('{{') && !KO_DISAMBIGUATION.some(marker => extract.includes(marker)) ? extract : null;
}

const meaningObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const meaningEl = el.querySelector('.result-meaning');
        observer.unobserve(el);
        if (!meaningEl || meaningEl.dataset.loaded) return;
        meaningEl.dataset.loaded = 'true';
        const { word, lang } = el.dataset;
        lookupMeaning(word, lang)
            .then(meaning => {
                if (meaning) meaningEl.textContent = meaning;
                else renderExternalDictionaryLink(meaningEl, word, lang);
            })
            .catch(() => renderExternalDictionaryLink(meaningEl, word, lang));
    });
}, { rootMargin: '100px' });


// Everything the search needs lives in the Worker and loads on demand, so the page is
// ready at once; the lexicon (used by both modes) starts downloading in the background.
async function loadDictionary() {
    window.RhymePreloader?.update(1,1);
    if (await window.RhymePreloader?.finish() === false) return;
    isReady = true;
    setWordSearchBusy(false);
    statusEl.textContent = '검색 준비 완료. 찾고 싶은 라임을 입력해 주세요.';
    prefetchWordSearch();
}

// Start downloading the lexicon in the background; a search joins the same load.
function prefetchWordSearch() {
    window.wordSearchRuntime?.init().catch(error => console.warn('Lexicon prefetch failed:', error));
}

function getSelectedPronunciationMode() {
    for (const radio of pronunciationModeRadios) {
        if (radio.checked) return radio.value;
    }
    return 'hybrid';
}

function getPronunciationModeLabel(mode) {
    if (mode === 'native') return '실제 영어';
    if (mode === 'koreanized') return '한국식 영어';
    return '혼합 추천';
}


function getSelectedLang() {
    let selectedLang = 'all';
    for (const radio of langRadios) {
        if (radio.checked) selectedLang = radio.value;
    }
    return selectedLang;
}

function getTargetLanguages() {
    const selected = getSelectedLang();
    return selected === 'all' ? ['ko', 'en'] : [selected];
}

// Per-phoneme multipliers from the detail sliders (1.0 each when detail weights are off).
function getDetailMultipliers(length) {
    const multipliers = new Array(length).fill(1.0);
    if (useDetailWeights.checked && currentQueryPhonemeData.charMap.length > 0) {
        currentQueryPhonemeData.charMap.forEach((item, index) => {
            const slider = document.getElementById(`detailWeight_${index}`);
            const mult = slider ? parseFloat(slider.value) : 1.0;
            for (let i = item.startIndex; i < item.endIndex; i++) multipliers[i] = mult;
        });
    }
    return multipliers;
}

function getExcludeWords() {
    const excludeStr = excludeInput.value.trim();
    if (!excludeStr) return [];
    return excludeStr.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
}

loadMoreBtn.addEventListener('click', showMoreResults);

async function handleSearch() {
    if (!isReady) return;
    if (currentSearchMode === 'linked') await handleLinkedRhymeSearch();
    else await handleWordSearch();
}

const PRONUNCIATION_SOURCE_NOTES = {
    model: '사전에 없는 말이라 발음을 추정했습니다',
    jamo: '자모 입력은 낱소리로 비교합니다',
};

// Numbers outside the lexicon are left out rather than read one of several ways.
function skippedNumbersNote(skipped) {
    return skipped?.length ? `숫자(${skipped.join(', ')})는 읽는 법이 여러 가지라 뺐습니다` : '';
}

function noPronunciationMessage() {
    const note = skippedNumbersNote(currentQueryPhonemeData?.skipped);
    return note ? `검색어의 발음을 분석할 수 없습니다. ${note}. 한글이나 영어로 입력해 주세요.` : '검색어의 발음을 분석할 수 없습니다.';
}

function wordCompletionMessage(response, request) {
    const parts = [`결과 ${response.total.toLocaleString()}개`, `${Math.round(response.timings.total_ms).toLocaleString()}ms`];
    if (getTargetLanguages().includes('en')) parts.push(getPronunciationModeLabel(request.mode));
    const notes = [...new Set(response.resolved.sources)].map(source => PRONUNCIATION_SOURCE_NOTES[source]).filter(Boolean);
    parts.push(...notes);
    const skipped = skippedNumbersNote(response.resolved.skipped);
    if (skipped) parts.push(skipped);
    if (response.topic.requested) {
        parts.push(response.topic.active
            ? `주제: ${response.topic.word}`
            : `주제어가 사전에 없어 주제 없이 검색: ${request.topicWord}`);
    }
    if (response.rerankOnly) parts.push('발음 점수 재사용');
    return `"${request.query}" ${parts.join(' · ')}`;
}

async function handleWordSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    abandonActiveWordSearch();
    const operation = {controller: new AbortController(), cancelledByUser: false, kind: 'word'};
    activeWordSearch = operation;
    setWordSearchBusy(true);
    statusEl.style.color = '';
    statusEl.textContent = `"${query}" 라임을 찾는 중...`;
    renderSearchLoading('검색 준비 중', undefined, undefined, '라임 검색중...');
    const options = {
        signal: operation.controller.signal,
        onProgress(progress) {
            if (activeWordSearch === operation) renderWordSearchProgress(progress);
        }
    };
    try {
        // Detail sliders follow the query pronunciation the Worker uses (lexicon or model).
        const queryKey = `word\u0000${query}`;
        if (queryKey !== lastQueryWord) {
            const resolved = await window.wordSearchRuntime.resolve(query, options);
            if (activeWordSearch !== operation) return;
            currentQueryPhonemeData = resolved;
            lastQueryWord = queryKey;
            renderDetailSliders();
        }
        const phonemes = currentQueryPhonemeData.phonemes || [];
        if (!phonemes.length) {
            displayResults([]);
            statusEl.textContent = noPronunciationMessage();
            return;
        }
        const request = {
            query, languages: getTargetLanguages(), mode: getSelectedPronunciationMode(),
            vowelWeight: Number(vowelWeightInput.value), consonantWeight: Number(consoWeightInput.value),
            useDetailWeights: useDetailWeights.checked, detail: getDetailMultipliers(phonemes.length),
            frequencyWeight: Number(freqWeightInput.value),
            topicWord: topicInput.value.trim(), topicWeight: Number(topicWeightInput.value),
            excludeWords: getExcludeWords()
        };
        const response = await window.wordSearchRuntime.search(request, options);
        if (activeWordSearch !== operation) return;
        displayResults(response.items, {
            total: response.total,
            loadPage: offset => window.wordSearchRuntime.page(response.searchId, offset, PAGE_SIZE)
        });
        statusEl.textContent = wordCompletionMessage(response, request);
    } catch (error) {
        if (activeWordSearch !== operation) return;
        if (error?.code === 'search_cancelled') {
            statusEl.textContent = operation.cancelledByUser ? '검색을 취소했습니다.' : '이전 검색을 중단했습니다.';
        } else if (error?.code === 'no_pronunciation') {
            displayResults([]);
            statusEl.textContent = noPronunciationMessage();
        } else {
            console.error('Word search failed:', error);
            statusEl.textContent = '단어 검색 자료를 준비하거나 계산하는 데 실패했습니다. 다시 검색해 주세요.';
            statusEl.style.color = 'red';
        }
    } finally {
        if (activeWordSearch === operation) {
            activeWordSearch = null;
            setWordSearchBusy(false);
        }
    }
}

async function handleLinkedRhymeSearch() {
    if (!isReady) return;
    const query = searchInput.value.trim();
    if (!query) return;
    abandonActiveWordSearch();
    const operation = {controller: new AbortController(), cancelledByUser: false, kind: 'linked'};
    activeWordSearch = operation;
    setWordSearchBusy(true);
    statusEl.style.color = '';
    statusEl.textContent = `"${query}" 연결 라임을 찾는 중...`;
    renderSearchLoading('검색 준비 중', undefined, undefined, '라임 검색중...');
    const options = {
        signal: operation.controller.signal,
        onProgress(progress) {
            if (activeWordSearch === operation) renderWordSearchProgress(progress);
        }
    };
    try {
        // Same query pronunciation and detail sliders as word search.
        const queryKey = `word\u0000${query}`;
        if (queryKey !== lastQueryWord) {
            const resolved = await window.wordSearchRuntime.resolve(query, options);
            if (activeWordSearch !== operation) return;
            currentQueryPhonemeData = resolved;
            lastQueryWord = queryKey;
            renderDetailSliders();
        }
        const phonemes = currentQueryPhonemeData.phonemes || [];
        if (!phonemes.length) {
            displayResults([]);
            statusEl.textContent = noPronunciationMessage();
            return;
        }
        const request = {
            query, languages: getTargetLanguages(), mode: getSelectedPronunciationMode(),
            vowelWeight: Number(vowelWeightInput.value), consonantWeight: Number(consoWeightInput.value),
            useDetailWeights: useDetailWeights.checked, detail: getDetailMultipliers(phonemes.length),
            frequencyWeight: Number(freqWeightInput.value),
            topicWord: topicInput.value.trim(), topicWeight: Number(topicWeightInput.value),
            excludeWords: getExcludeWords(), allowFirstParticle: Boolean(allowFirstParticleKo.checked)
        };
        const response = await window.wordSearchRuntime.linked(request, options);
        if (activeWordSearch !== operation) return;
        displayResults(response.items, {
            total: response.total,
            loadPage: offset => window.wordSearchRuntime.page(response.searchId, offset, PAGE_SIZE)
        });
        statusEl.textContent = wordCompletionMessage(response, request).replace(/^"[^"]*"/, `"${query}" 연결 라임`);
    } catch (error) {
        if (activeWordSearch !== operation) return;
        if (error?.code === 'search_cancelled') {
            statusEl.textContent = operation.cancelledByUser ? '검색을 취소했습니다.' : '이전 검색을 중단했습니다.';
        } else if (error?.code === 'no_pronunciation') {
            displayResults([]);
            statusEl.textContent = noPronunciationMessage();
        } else if (error?.code === 'no_splits') {
            displayResults([]);
            statusEl.textContent = '검색어를 두 부분으로 나눌 수 없습니다. 두 음절 이상 입력해 주세요.';
        } else {
            console.error('Linked search failed:', error);
            statusEl.textContent = '연결 검색 자료를 준비하거나 계산하는 데 실패했습니다. 다시 검색해 주세요.';
            statusEl.style.color = 'red';
        }
    } finally {
        if (activeWordSearch === operation) {
            activeWordSearch = null;
            setWordSearchBusy(false);
        }
    }
}

searchBtn.addEventListener('click', handleSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});
excludeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});
topicInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});

function renderDetailSliders() {
    detailSlidersContainer.innerHTML = '';
    reSearchBtn.style.display = 'block';
    
    if (currentQueryPhonemeData.charMap.length === 0) {
        detailSlidersContainer.innerHTML = '<div class="empty-detail-msg" style="color: #64748b; font-size: 0.9rem; text-align: center; margin-top: 2rem;">검색어의 발음을 분석할 수 없습니다.</div>';
        return;
    }
    
    currentQueryPhonemeData.charMap.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'slider-container detail-slider-container';
        div.innerHTML = `
            <label for="detailWeight_${index}">[ ${item.char} ] 가중치</label>
            <div class="slider-row">
                <input type="range" id="detailWeight_${index}" min="0" max="10" step="0.5" value="1.0">
                <span id="detailVal_${index}" class="slider-val">1.0</span>
            </div>
        `;
        detailSlidersContainer.appendChild(div);
        
        const input = document.getElementById(`detailWeight_${index}`);
        const valSpan = document.getElementById(`detailVal_${index}`);
        input.addEventListener('input', () => {
            valSpan.textContent = parseFloat(input.value).toFixed(1);
        });
    });
}


// Init
loadDictionary();
