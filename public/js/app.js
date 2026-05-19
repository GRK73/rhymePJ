let dictionary = [];
let loanwordOverrides = {};
let compoundPronunciationsKo = {};
let semanticVectorStores = { ko: {}, en: {} };
let bigramStores = { ko: null, en: null };
let surfaceBigramStoreKo = null;
let topicTranslations = {};
let semanticResourcesLoaded = false;
let semanticResourcesLoadingPromise = null;
let bigramResourcesLoadingPromises = {};
let surfaceBigramResourceLoadingPromise = null;
let isReady = false;

if (typeof window !== 'undefined') {
    window.compoundPronunciationsKo = compoundPronunciationsKo;
}

const statusEl = document.getElementById('status');
const appLayout = document.querySelector('.app-layout');
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
const useSurfaceKoBigram = document.getElementById('useSurfaceKoBigram');
const allowFirstParticleKo = document.getElementById('allowFirstParticleKo');
const searchBox = document.querySelector('.search-box');
const topicBox = document.querySelector('.topic-box');
const resultsContainer = document.querySelector('.results-container');
const lyricsAnalysisPanel = document.getElementById('lyricsAnalysisPanel');
const lyricsSections = document.getElementById('lyricsSections');
const addLyricsSectionBtn = document.getElementById('addLyricsSectionBtn');
const lyricsSectionTypeMenu = document.getElementById('lyricsSectionTypeMenu');
const lyricsAnalyzeBtn = document.getElementById('lyricsAnalyzeBtn');
const lyricsAnalysisResults = document.getElementById('lyricsAnalysisResults');

const consoWeightInput = document.getElementById('consoWeight');
const vowelWeightInput = document.getElementById('vowelWeight');
const freqWeightInput = document.getElementById('freqWeight');
const topicWeightInput = document.getElementById('topicWeight');

const consoVal = document.getElementById('consoVal');
const vowelVal = document.getElementById('vowelVal');
const freqVal = document.getElementById('freqVal');
const topicVal = document.getElementById('topicVal');
const globalPhonemeWeightContainers = document.querySelectorAll('.global-phoneme-weight');

const excludeInput = document.getElementById('excludeInput');

const useDetailWeights = document.getElementById('useDetailWeights');
const detailGroup = document.getElementById('detailGroup');
const detailSlidersContainer = document.getElementById('detailSlidersContainer');

let currentQueryPhonemeData = { phonemes: [], charMap: [] };
let lastQueryWord = '';
let currentSearchMode = 'word';
const surfacePronunciationCache = new Map();

const reSearchBtn = document.getElementById('reSearchBtn');
reSearchBtn.addEventListener('click', handleSearch);

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
    const isLyricsMode = currentSearchMode === 'lyrics';
    appLayout?.classList.toggle('lyrics-mode', isLyricsMode);
    if (!isLyricsMode) {
        appLayout?.classList.remove('lyrics-results');
        lyricsAnalysisPanel?.classList.remove('has-results');
    }
    if (searchBox) searchBox.hidden = isLyricsMode;
    if (topicBox) topicBox.hidden = isLyricsMode;
    if (resultsContainer) resultsContainer.hidden = isLyricsMode;
    if (lyricsAnalysisPanel) lyricsAnalysisPanel.hidden = !isLyricsMode;
    if (detailGroup) detailGroup.hidden = isLyricsMode;
    if (linkedSurfaceOptions) {
        linkedSurfaceOptions.hidden = !isLinkedMode || isLyricsMode;
    }
    if (firstParticleOption) {
        const showFirstParticleOption = isLinkedMode && Boolean(useSurfaceKoBigram?.checked);
        firstParticleOption.hidden = !showFirstParticleOption;
        if (!showFirstParticleOption && allowFirstParticleKo) {
            allowFirstParticleKo.checked = false;
        }
    }
}

useSurfaceKoBigram?.addEventListener('change', syncSearchModeControls);

searchModeButtons.forEach(button => {
    button.addEventListener('click', () => {
        currentSearchMode = button.dataset.searchMode || 'word';
        searchModeButtons.forEach(item => {
            const isActive = item === button;
            item.classList.toggle('active', isActive);
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        syncSearchModeControls();
        if (currentSearchMode === 'linked') {
            statusEl.textContent = '연결 라임 검색은 두 단어 조합을 계산하므로 검색이 느릴 수 있습니다.';
        } else if (currentSearchMode === 'lyrics') {
            statusEl.textContent = '섹션별 가사를 입력한 뒤 세부 분석을 실행하세요.';
        } else if (isReady) {
            lyricsAnalysisPanel?.classList.remove('has-results');
            statusEl.textContent = `사전 로드 완료! (총 ${dictionary.length.toLocaleString()} 단어, 외래어 ${Object.keys(loanwordOverrides).length.toLocaleString()}개, 의미 벡터는 주제 입력 시 로드)`;
        }
    });
});
syncSearchModeControls();

let currentFilteredResults = [];
let resultsShown = 0;
const PAGE_SIZE = 99;

// Intersection Observer for lazy loading meanings
const meaningObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const el = entry.target;
            const word = el.dataset.word;
            const lang = el.dataset.lang;
            const meaningEl = el.querySelector('.result-meaning');
            
            if (meaningEl && !meaningEl.dataset.loaded) {
                meaningEl.dataset.loaded = 'true';
                
                if (lang === 'en') {
                    fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&dt=bd&q=${encodeURIComponent(word)}`)
                        .then(res => res.json())
                        .then(data => {
                            let meaningText = '';
                            if (data && data[1]) {
                                // Extract all dictionary meanings across different parts of speech
                                let meanings = [];
                                data[1].forEach(pos => {
                                    if (pos[1] && Array.isArray(pos[1])) {
                                        meanings = meanings.concat(pos[1]);
                                    }
                                });
                                // Remove duplicates and limit to top 8 meanings
                                meanings = [...new Set(meanings)];
                                meaningText = meanings.slice(0, 8).join(', ');
                            } else if (data && data[0] && data[0][0]) {
                                // Fallback to simple translation if no dictionary data
                                meaningText = data[0][0][0];
                            } else {
                                meaningText = '뜻 정보 없음';
                            }
                            meaningEl.textContent = meaningText;
                        })
                        .catch(() => {
                            meaningEl.textContent = '뜻을 불러올 수 없음';
                        });
                } else {
                    // Korean: Try Wikipedia
                    fetch(`https://ko.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&exsentences=1&titles=${encodeURIComponent(word)}&format=json&origin=*`)
                        .then(res => res.json())
                        .then(data => {
                            const pages = data.query.pages;
                            const pageId = Object.keys(pages)[0];
                            if (pageId !== '-1' && pages[pageId].extract) {
                                const extract = pages[pageId].extract;
                                // 동음이의어 문서(Disambiguation page)인지 판별
                                if (extract.includes('다음을 가리') || extract.includes('뜻으로 쓰인') || extract.includes('다음을 의미') || extract.includes('동음이의') || extract.includes('다른 뜻') || extract.includes('다음과 같')) {
                                    meaningEl.innerHTML = `<a href="https://ko.dict.naver.com/#/search?query=${encodeURIComponent(word)}" target="_blank" class="dict-link">사전 검색 ↗</a>`;
                                } else {
                                    meaningEl.textContent = extract;
                                }
                            } else {
                                // Fallback for Korean words: link to dict
                                meaningEl.innerHTML = `<a href="https://ko.dict.naver.com/#/search?query=${encodeURIComponent(word)}" target="_blank" class="dict-link">사전 검색 ↗</a>`;
                            }
                        })
                        .catch(() => {
                            meaningEl.innerHTML = `<a href="https://ko.dict.naver.com/#/search?query=${encodeURIComponent(word)}" target="_blank" class="dict-link">사전 검색 ↗</a>`;
                        });
                }
            }
            observer.unobserve(el);
        }
    });
}, { rootMargin: '100px' });


function setSemanticStore(lang, data) {
    const store = extractSemanticVectorStore(data);
    if (Object.keys(store).length > 0) {
        semanticVectorStores[lang] = store;
    }
}

async function ensureSemanticResourcesLoaded() {
    if (semanticResourcesLoaded) return getSemanticVectorCount();
    if (semanticResourcesLoadingPromise) return semanticResourcesLoadingPromise;

    semanticResourcesLoadingPromise = (async () => {
        const [koVectors, enVectors] = await Promise.all([
            loadOptionalJson(dataPath('semantic_vectors_ko.json')),
            loadOptionalJson(dataPath('semantic_vectors_en.json'))
        ]);

        if (koVectors) setSemanticStore('ko', koVectors);
        if (enVectors) setSemanticStore('en', enVectors);

        if (getSemanticVectorCount() === 0) {
            const legacyVectors = await loadOptionalJson(dataPath('semantic_vectors.json'));
            setSemanticStore('ko', legacyVectors);
            setSemanticStore('en', legacyVectors);
        }

        semanticResourcesLoaded = true;
        return getSemanticVectorCount();
    })();

    return semanticResourcesLoadingPromise;
}


async function ensureBigramResourceLoaded(lang) {
    if (bigramStores[lang]) return bigramStores[lang];
    if (bigramResourcesLoadingPromises[lang]) return bigramResourcesLoadingPromises[lang];

    bigramResourcesLoadingPromises[lang] = (async () => {
        const data = await loadOptionalJson(dataPath(`bigram_next_${lang}.json`));
        const entries = extractBigramEntries(data);
        bigramStores[lang] = entries;
        return entries;
    })();

    return bigramResourcesLoadingPromises[lang];
}

async function ensureSurfaceBigramKoLoaded() {
    if (surfaceBigramStoreKo) return surfaceBigramStoreKo;
    if (surfaceBigramResourceLoadingPromise) return surfaceBigramResourceLoadingPromise;

    surfaceBigramResourceLoadingPromise = (async () => {
        const data = await loadOptionalJson(dataPath('bigram_surface_ko.json'));
        surfaceBigramStoreKo = extractBigramEntries(data);
        return surfaceBigramStoreKo;
    })();

    return surfaceBigramResourceLoadingPromise;
}

function getSurfacePronunciationCandidates(surface) {
    const key = String(surface || '');
    if (surfacePronunciationCache.has(key)) return surfacePronunciationCache.get(key);

    const compoundCandidates = typeof getKoreanCompoundPronunciationCandidates === 'function'
        ? getKoreanCompoundPronunciationCandidates(key)
        : [];
    const standardCandidates = typeof getKoreanStandardPronunciationCandidates === 'function'
        ? getKoreanStandardPronunciationCandidates(key)
        : [];
    let candidates = [...compoundCandidates, ...standardCandidates];
    if (typeof dedupeKoreanPronunciationCandidates === 'function') {
        candidates = dedupeKoreanPronunciationCandidates(candidates);
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
        candidates = [{ phonemes: getKoreanIpaPhonemes(key).phonemes || [], label: '표기' }];
    }
    const phonemeCandidates = candidates
        .map(candidate => candidate.phonemes || [])
        .filter(phonemes => phonemes.length > 0);
    surfacePronunciationCache.set(key, phonemeCandidates);
    return phonemeCandidates;
}

// Load dictionary
async function loadDictionary() {
    try {
        const response = await fetch(dataPath('rhyme_dict_practical.json'));
        if (!response.ok) throw new Error('Network response was not ok');
        dictionary = await response.json();

        try {
            const loanwordResponse = await fetch(dataPath('loanword_overrides.json'));
            if (loanwordResponse.ok) {
                loanwordOverrides = await loanwordResponse.json();
            }
        } catch (error) {
            console.warn('Loanword overrides are not available:', error);
        }

        const compoundData = await loadOptionalJson(dataPath('compound_pronunciations_ko.json'));
        compoundPronunciationsKo = compoundData && typeof compoundData === 'object' && !Array.isArray(compoundData)
            ? compoundData
            : {};
        if (typeof window !== 'undefined') {
            window.compoundPronunciationsKo = compoundPronunciationsKo;
        }

        isReady = true;
        const loanwordCount = Object.keys(loanwordOverrides).length;
        if (currentSearchMode === 'lyrics') {
            statusEl.textContent = '섹션별 가사를 입력한 뒤 세부 분석을 실행하세요.';
        } else {
            statusEl.textContent = `사전 로드 완료! (총 ${dictionary.length.toLocaleString()} 단어, 외래어 ${loanwordCount.toLocaleString()}개, 의미 벡터는 주제 입력 시 로드)`;
        }
    } catch (error) {
        console.error('Failed to load dictionary:', error);
        statusEl.textContent = '사전 데이터를 불러오는데 실패했습니다.';
        statusEl.style.color = 'red';
    }
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

function getExcludeWords() {
    const excludeStr = excludeInput.value.trim();
    if (!excludeStr) return [];
    return excludeStr.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
}

function isExcludedWord(word, excludeWords) {
    if (excludeWords.length === 0) return false;
    const lowerWord = String(word || '').toLowerCase();
    return excludeWords.some(exWord => lowerWord.includes(exWord));
}


function dedupeResultsByWordLang(results) {
    const bestByKey = new Map();

    results.forEach(result => {
        const key = `${result.lang}:${result.word}`;
        const current = bestByKey.get(key);
        if (!current || result.score > current.score) {
            bestByKey.set(key, result);
        }
    });

    return Array.from(bestByKey.values());
}


loadMoreBtn.addEventListener('click', renderMoreResults);

async function handleSearch() {
    if (currentSearchMode === 'lyrics') {
        await handleLyricsAnalysis();
        return;
    }
    if (currentSearchMode === 'linked') {
        await handleLinkedRhymeSearch();
        return;
    }
    await handleWordSearch();
}

function getNextLyricsSectionLabel() {
    const count = document.querySelectorAll('.lyrics-section').length + 1;
    if (count === 1) return 'Verse 1';
    if (count === 2) return 'Hook';
    return `Verse ${count}`;
}

function addLyricsSection(type = getNextLyricsSectionLabel(), text = '') {
    if (!lyricsSections) return;
    const id = String(Date.now() + Math.floor(Math.random() * 1000));
    const section = document.createElement('div');
    section.className = 'lyrics-section';
    section.dataset.sectionId = id;
    const options = ['Intro', 'Verse 1', 'Hook', 'Verse 2', 'Bridge', 'Outro', 'Free'];
    const selectedType = options.includes(type) ? type : 'Free';
    section.innerHTML = `
        <div class="lyrics-section-header">
            <select class="lyrics-section-type" aria-label="섹션 종류">
                ${options.map(option => `<option value="${option}" ${option === selectedType ? 'selected' : ''}>${option}</option>`).join('')}
            </select>
            <button type="button" class="lyrics-section-remove" aria-label="섹션 삭제">×</button>
        </div>
        <textarea class="lyrics-section-text" rows="8" placeholder="가사를 입력하세요"></textarea>
    `;
    section.querySelector('.lyrics-section-text').value = text;
    lyricsSections.appendChild(section);
}

function removeLyricsSection(section) {
    if (!section || !lyricsSections) return;
    if (lyricsSections.querySelectorAll('.lyrics-section').length <= 1) {
        const textarea = section.querySelector('.lyrics-section-text');
        if (textarea) textarea.value = '';
        return;
    }
    section.remove();
}

function setLyricsSectionTypeMenuOpen(open) {
    if (!lyricsSectionTypeMenu || !addLyricsSectionBtn) return;
    lyricsSectionTypeMenu.hidden = !open;
    addLyricsSectionBtn.setAttribute('aria-expanded', String(open));
}

addLyricsSectionBtn?.addEventListener('click', event => {
    event.stopPropagation();
    setLyricsSectionTypeMenuOpen(lyricsSectionTypeMenu?.hidden !== false);
});

lyricsSectionTypeMenu?.addEventListener('click', event => {
    const button = event.target.closest('[data-section-type]');
    if (!button) return;
    addLyricsSection(button.dataset.sectionType || getNextLyricsSectionLabel());
    setLyricsSectionTypeMenuOpen(false);
});

document.addEventListener('click', event => {
    if (lyricsSectionTypeMenu?.hidden !== false) return;
    if (event.target.closest('.lyrics-section-add')) return;
    setLyricsSectionTypeMenuOpen(false);
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setLyricsSectionTypeMenuOpen(false);
});

lyricsAnalyzeBtn?.addEventListener('click', handleLyricsAnalysis);
lyricsSections?.addEventListener('click', event => {
    const button = event.target.closest('.lyrics-section-remove');
    if (button) removeLyricsSection(button.closest('.lyrics-section'));
});

function renderLyricsAnalysisLoading() {
    if (!lyricsAnalysisResults) return;
    lyricsAnalysisResults.innerHTML = `
        <section class="lyrics-report-section lyrics-loading-panel">
            <div class="lyrics-loading-spinner" aria-hidden="true"></div>
            <h3>가사를 분석하는 중</h3>
            <p id="lyricsResultLoadingLabel">입력한 라인을 정리하는 중</p>
            <strong id="lyricsResultLoadingValue">0%</strong>
        </section>
    `;
}

async function handleLyricsAnalysis() {
    const sections = collectLyricsSections();
    if (sections.length === 0) {
        statusEl.textContent = '분석할 가사를 한 줄 이상 입력하세요.';
        if (lyricsAnalysisResults) {
            lyricsAnalysisResults.innerHTML = '<section class="lyrics-report-section"><div class="lyrics-note">분석할 가사를 한 줄 이상 입력하세요.</div></section>';
        }
        return;
    }

    lyricsAnalyzeBtn.disabled = true;
    appLayout?.classList.add('lyrics-results');
    lyricsAnalysisPanel?.classList.add('has-results');
    statusEl.textContent = '가사 세부 분석을 실행 중입니다.';
    renderLyricsAnalysisLoading();
    try {
        const report = await analyzeLyricsSections(sections, updateLyricsProgress);
        renderLyricsAnalysisReport(report, lyricsAnalysisResults);
        statusEl.textContent = `가사 세부 분석 완료: ${report.overview.lineCount.toLocaleString()}라인`;
    } catch (error) {
        console.error('Lyrics analysis failed:', error);
        statusEl.textContent = '가사 분석 중 오류가 발생했습니다.';
        if (lyricsAnalysisResults) {
            lyricsAnalysisResults.innerHTML = '<section class="lyrics-report-section"><div class="lyrics-note">가사 분석 중 오류가 발생했습니다. 콘솔 로그를 확인하세요.</div></section>';
        }
    } finally {
        lyricsAnalyzeBtn.disabled = false;
    }
}

async function handleWordSearch() {
    if (!isReady) return;
    const query = searchInput.value.trim();
    if (!query) return;

    const selectedLang = getSelectedLang();
    const pronunciationMode = getSelectedPronunciationMode();
    const topicWord = topicInput.value.trim();
    const topicWeight = parseFloat(topicWeightInput.value);
    let semanticContext = buildSemanticContext('', 0);

    if (query !== lastQueryWord) {
        currentQueryPhonemeData = getQueryPhonemes(query);
        lastQueryWord = query;
        renderDetailSliders(); // Generate sliders for the new word
    }
    
    const queryPhonemes = currentQueryPhonemeData.phonemes;
    
    if (queryPhonemes.length === 0) {
        statusEl.textContent = '해당 단어의 발음을 분석할 수 없습니다.';
        return;
    }

    if (topicWord && topicWeight > 0) {
        statusEl.textContent = '주제 의미 벡터를 불러오는 중입니다...';
        await ensureSemanticResourcesLoaded();
        await translateTopicToEnglish(topicWord);
        semanticContext = buildSemanticContext(topicWord, topicWeight);
    }

    const useKoCorpusBoost = selectedLang !== 'en';
    if (useKoCorpusBoost) {
        await ensureCorpusAffinityResourcesLoaded();
    }

    const topicLabels = [topicWord, ...(semanticContext.translatedTopics || []).slice(0, 2)].filter(Boolean);
    const topicText = topicWord
        ? semanticContext.active
            ? ` / 주제 : ${topicLabels.join(', ')}`
            : ` / 주제 벡터 없음: ${topicWord}`
        : '';
    statusEl.textContent = `"${query}"의 발음 [${queryPhonemes.join(', ')}]와 비슷한 단어를 찾습니다... (${getPronunciationModeLabel(pronunciationMode)}${topicText})`;

    let freqWeight = parseFloat(freqWeightInput.value);

    // Build detail multipliers array
    let detailMultipliers = new Array(queryPhonemes.length).fill(1.0);
    if (useDetailWeights.checked && currentQueryPhonemeData.charMap.length > 0) {
        currentQueryPhonemeData.charMap.forEach((item, index) => {
            const slider = document.getElementById(`detailWeight_${index}`);
            let mult = slider ? parseFloat(slider.value) : 1.0;
            for (let i = item.startIndex; i < item.endIndex; i++) {
                detailMultipliers[i] = mult;
            }
        });
    }

    const excludeWords = getExcludeWords();

    // Filter and score
    let results = [];
    for (const item of dictionary) {
        if (selectedLang !== 'all' && item.lang !== selectedLang) continue;
        
        // Skip exact same word
        if (item.word.toLowerCase() === query.toLowerCase()) continue;

        // Skip excluded words
        if (isExcludedWord(item.word, excludeWords)) continue;

        const result = calculatePronunciationScore(item, currentQueryPhonemeData, detailMultipliers, pronunciationMode);
        if (!result || typeof result.score !== 'number' || !Number.isFinite(result.score)) continue;
        
        // Base score threshold to filter out completely irrelevant words
        if (result.score > 40) { 
            let zipf = item.zipf !== undefined ? item.zipf : 1.0; // Default 1.0 if not found
            let totalScore = applyFrequencyWeight(result.score, zipf, freqWeight);
            let semanticResult = { score: totalScore, similarity: null, matched: true };
            if (semanticContext.active) {
                semanticResult = applySemanticWeight(totalScore, item, semanticContext);
                if (!semanticResult.matched) continue;
                totalScore = semanticResult.score;
            }
            let corpusAffinity = { score: 0 };
            if (useKoCorpusBoost && item.lang === 'ko') {
                const corpusResult = applyCorpusAffinityWeight(totalScore, item);
                totalScore = corpusResult.score;
                corpusAffinity = corpusResult.affinity;
            }

            results.push({
                ...item,
                score: totalScore,
                matchIndices: result.matchIndices,
                matchPhonemes: result.matchPhonemes,
                matchLayer: result.matchLayer,
                matchLayerLabel: result.matchLayerLabel,
                semanticSimilarity: semanticResult.similarity,
                corpusAffinity: corpusAffinity.score
            });
        }
    }

    results = dedupeResultsByWordLang(results);
    results.sort((a, b) => b.score - a.score);

    displayResults(results);
}

function appendSurfaceLinkedResults({
    results,
    surfaceEntries,
    splits,
    dictByWord,
    detailMultipliers,
    semanticContext,
    freqRatio,
    excludeWords,
    maxFirstCandidates,
    allowFirstParticle
}) {
    if (!surfaceEntries || Object.keys(surfaceEntries).length === 0) return;

    for (const split of splits) {
        const leftDetailMultipliers = getSplitDetailMultipliers(
            detailMultipliers,
            split.leftSourceStart,
            split.leftSourceEnd,
            split.leftPhonemes.length
        );
        const rightDetailMultipliers = getSplitDetailMultipliers(
            detailMultipliers,
            split.rightSourceStart,
            split.rightSourceEnd,
            split.rightPhonemes.length
        );

        const firstCandidates = [];
        for (const [surfaceHead, payload] of Object.entries(surfaceEntries)) {
            if (isExcludedWord(surfaceHead, excludeWords)) continue;
            const normalizedHead = Array.isArray(payload) ? String(payload[0] || '') : '';
            if (normalizedHead && isExcludedWord(normalizedHead, excludeWords)) continue;
            if (!allowFirstParticle && normalizedHead && normalizedHead !== surfaceHead) continue;

            const leftResult = getBestBoundaryScore(getSurfacePronunciationCandidates(surfaceHead), split.leftPhonemes, 'end', leftDetailMultipliers);
            if (leftResult.score > 40) {
                firstCandidates.push({ surfaceHead, normalizedHead, payload, leftResult });
            }
        }

        firstCandidates
            .sort((a, b) => b.leftResult.score - a.leftResult.score)
            .slice(0, maxFirstCandidates)
            .forEach(firstCandidate => {
                const followers = Array.isArray(firstCandidate.payload) ? firstCandidate.payload[1] : [];
                if (!Array.isArray(followers)) return;

                followers.forEach(row => {
                    const follower = parseSurfaceFollowerRow(row);
                    if (!follower || !follower.surface) return;
                    if (isExcludedWord(follower.surface, excludeWords)) return;
                    if (follower.normalized && isExcludedWord(follower.normalized, excludeWords)) return;

                    const rightResult = getBestBoundaryScore(getSurfacePronunciationCandidates(follower.surface), split.rightPhonemes, 'start', rightDetailMultipliers);
                    if (rightResult.score <= 40) return;

                    const headDict = dictByWord.get(firstCandidate.normalizedHead) || dictByWord.get(firstCandidate.surfaceHead);
                    const nextDict = dictByWord.get(follower.normalized) || dictByWord.get(follower.surface);
                    const first = {
                        word: firstCandidate.surfaceHead,
                        display: firstCandidate.surfaceHead,
                        semanticWord: firstCandidate.normalizedHead || firstCandidate.surfaceHead,
                        zipf: headDict?.zipf
                    };
                    const second = {
                        word: follower.surface,
                        display: follower.surface,
                        semanticWord: follower.normalized || follower.surface,
                        zipf: nextDict?.zipf
                    };

                    const topicResult = getPhraseTopicSimilarity(first, second, 'ko', semanticContext);
                    if (!topicResult.matched) return;

                    const boundaryScore = (firstCandidate.leftResult.score + rightResult.score) / 2;
                    const bigramScore = normalizeBigramScore(follower.score);
                    const frequencyScore = getPairFrequencyScore(first, second);
                    const topicScore = topicResult.topicScore ?? 0;
                    const corpusScore = getLinkedCorpusScore(first, second, 'ko');
                    const rawScore = semanticContext.active
                        ? boundaryScore * (0.62 - freqRatio * 0.12) + bigramScore * 0.20 + frequencyScore * (freqRatio * 0.15) + topicScore * 0.15
                        : boundaryScore * (0.70 - freqRatio * 0.15) + bigramScore * 0.25 + frequencyScore * (freqRatio * 0.20);
                    const balanceMultiplier = 0.85 + split.balance * 0.15;
                    const finalScore = Math.max(0, Math.min(100, blendLinkedCorpusScore(rawScore, corpusScore) * balanceMultiplier));
                    const surfaceDisplay = formatSurfaceLinkedDisplay(firstCandidate.surfaceHead, follower.surface);

                    results.push({
                        resultType: 'linked',
                        surfaceMode: true,
                        lang: 'ko',
                        first,
                        second,
                        word: `${firstCandidate.surfaceHead} ${follower.surface}`,
                        display: surfaceDisplay,
                        surfaceDisplay,
                        score: finalScore,
                        splitLabel: split.label,
                        leftScore: firstCandidate.leftResult.score,
                        rightScore: rightResult.score,
                        bigramScore,
                        corpusScore,
                        frequencyScore,
                        topicSimilarity: topicResult.similarity
                    });
                });
            });
    }
}

async function handleLinkedRhymeSearch() {
    if (!isReady) return;
    const query = searchInput.value.trim();
    if (!query) return;

    const selectedLang = getSelectedLang();
    if (query !== lastQueryWord) {
        currentQueryPhonemeData = getQueryPhonemes(query);
        lastQueryWord = query;
        renderDetailSliders();
    }

    const queryPhonemes = currentQueryPhonemeData.phonemes || [];
    if (queryPhonemes.length === 0) {
        statusEl.textContent = '검색어의 발음을 분석할 수 없습니다.';
        displayResults([]);
        return;
    }

    let detailMultipliers = new Array(queryPhonemes.length).fill(1.0);
    if (useDetailWeights.checked && currentQueryPhonemeData.charMap.length > 0) {
        currentQueryPhonemeData.charMap.forEach((item, index) => {
            const slider = document.getElementById(`detailWeight_${index}`);
            const mult = slider ? parseFloat(slider.value) : 1.0;
            for (let i = item.startIndex; i < item.endIndex; i++) {
                detailMultipliers[i] = mult;
            }
        });
    }

    const useSurfaceKo = Boolean(useSurfaceKoBigram?.checked);
    const allowFirstParticle = Boolean(useSurfaceKo && allowFirstParticleKo?.checked);
    const targetLangs = getLinkedSearchLangs(selectedLang);
    const splitsByLang = targetLangs.map(lang => ({ lang, splits: buildLinkedSplits(query, lang) }));
    const allSplits = splitsByLang.flatMap(entry => entry.splits);
    if (allSplits.length === 0) {
        statusEl.textContent = '연결 라임 검색을 위한 분할 후보를 만들 수 없습니다.';
        displayResults([]);
        return;
    }

    statusEl.textContent = '연결 라임 검색은 두 단어 조합을 계산하므로 검색이 느릴 수 있습니다. 문맥 조정 중...';
    const bigramStoresByLang = {};
    let surfaceEntriesKo = null;
    await Promise.all(targetLangs.map(async lang => {
        if (lang === 'ko' && useSurfaceKo) {
            surfaceEntriesKo = await ensureSurfaceBigramKoLoaded();
        } else {
            bigramStoresByLang[lang] = await ensureBigramResourceLoaded(lang);
        }
    }));
    if (targetLangs.includes('ko')) {
        await ensureLinkedCorpusResourcesLoaded();
    }
    const availableLangs = targetLangs.filter(lang => {
        if (lang === 'ko' && useSurfaceKo) return surfaceEntriesKo && Object.keys(surfaceEntriesKo).length > 0;
        return bigramStoresByLang[lang] && Object.keys(bigramStoresByLang[lang]).length > 0;
    });
    if (availableLangs.length === 0) {
        statusEl.textContent = '연결 라임 문맥 데이터를 불러올 수 없습니다.';
        displayResults([]);
        return;
    }

    const topicWord = topicInput.value.trim();
    const topicWeight = parseFloat(topicWeightInput.value);
    let semanticContext = buildSemanticContext('', 0);
    if (topicWord && topicWeight > 0) {
        statusEl.textContent = '연결 라임 검색은 두 단어 조합을 계산하므로 검색이 느릴 수 있습니다. 주제 점수 추가 중...';
        await ensureSemanticResourcesLoaded();
        await translateTopicToEnglish(topicWord);
        semanticContext = buildSemanticContext(topicWord, topicWeight);
    }

    const surfaceModeText = useSurfaceKo && targetLangs.includes('ko')
        ? ` / 한국어 조사 포함${allowFirstParticle ? ' / 첫 단어 조사 허용' : ''}`
        : '';
    statusEl.textContent = `"${query}"의 연결 라임을 찾습니다... (${allSplits.map(split => `${split.lang}:${split.label}`).join(', ')}${surfaceModeText})`;

    const freqWeight = parseFloat(freqWeightInput.value);
    const freqRatio = Math.max(0, Math.min(1, freqWeight / 10));
    const excludeWords = getExcludeWords();
    const results = [];
    const maxFirstCandidates = 200;

    for (const { lang, splits } of splitsByLang) {
        const dictByLang = dictionary.filter(item => item.lang === lang);
        const dictByWord = new Map(dictByLang.map(item => [item.word.toLowerCase(), item]));

        if (lang === 'ko' && useSurfaceKo) {
            appendSurfaceLinkedResults({
                results,
                surfaceEntries: surfaceEntriesKo,
                splits,
                dictByWord,
                detailMultipliers,
                semanticContext,
                freqRatio,
                excludeWords,
                maxFirstCandidates,
                allowFirstParticle
            });
            continue;
        }

        const bigramEntries = bigramStoresByLang[lang];
        if (!bigramEntries || Object.keys(bigramEntries).length === 0) continue;

        for (const split of splits) {
            const leftDetailMultipliers = getSplitDetailMultipliers(
                detailMultipliers,
                split.leftSourceStart,
                split.leftSourceEnd,
                split.leftPhonemes.length
            );
            const rightDetailMultipliers = getSplitDetailMultipliers(
                detailMultipliers,
                split.rightSourceStart,
                split.rightSourceEnd,
                split.rightPhonemes.length
            );
            const firstCandidates = [];
            for (const item of dictByLang) {
                if (isExcludedWord(item.word, excludeWords)) continue;
                const leftResult = getBestBoundaryScore(getItemPhonemeCandidates(item), split.leftPhonemes, 'end', leftDetailMultipliers);
                if (leftResult.score > 40) {
                    firstCandidates.push({ item, leftResult });
                }
            }

            firstCandidates
                .sort((a, b) => b.leftResult.score - a.leftResult.score)
                .slice(0, maxFirstCandidates)
                .forEach(firstCandidate => {
                    const followers = bigramEntries[firstCandidate.item.word.toLowerCase()];
                    if (!Array.isArray(followers)) return;

                    followers.forEach(row => {
                        const secondWord = String(row[0] || '').toLowerCase();
                        if (isExcludedWord(secondWord, excludeWords)) return;
                        const second = dictByWord.get(secondWord);
                        if (!second) return;

                        const rightResult = getBestBoundaryScore(getItemPhonemeCandidates(second), split.rightPhonemes, 'start', rightDetailMultipliers);
                        if (rightResult.score <= 40) return;

                        const topicResult = getPhraseTopicSimilarity(firstCandidate.item, second, lang, semanticContext);
                        if (!topicResult.matched) return;

                        const boundaryScore = (firstCandidate.leftResult.score + rightResult.score) / 2;
                        const bigramScore = normalizeBigramScore(row[2]);
                        const frequencyScore = getPairFrequencyScore(firstCandidate.item, second);
                        const topicScore = topicResult.topicScore ?? 0;
                        const corpusScore = getLinkedCorpusScore(firstCandidate.item, second, lang);
                        const rawScore = semanticContext.active
                            ? boundaryScore * (0.62 - freqRatio * 0.12) + bigramScore * 0.20 + frequencyScore * (freqRatio * 0.15) + topicScore * 0.15
                            : boundaryScore * (0.70 - freqRatio * 0.15) + bigramScore * 0.25 + frequencyScore * (freqRatio * 0.20);
                        const balanceMultiplier = 0.85 + split.balance * 0.15;
                        const finalScore = Math.max(0, Math.min(100, blendLinkedCorpusScore(rawScore, corpusScore) * balanceMultiplier));

                        results.push({
                            resultType: 'linked',
                            lang,
                            first: firstCandidate.item,
                            second,
                            word: `${firstCandidate.item.word} ${second.word}`,
                            display: `${firstCandidate.item.display} + ${second.display}`,
                            score: finalScore,
                            splitLabel: split.label,
                            leftScore: firstCandidate.leftResult.score,
                            rightScore: rightResult.score,
                            bigramScore,
                            corpusScore,
                            frequencyScore,
                            topicSimilarity: topicResult.similarity
                        });
                    });
                });
        }
    }

    const deduped = dedupeLinkedResults(results).sort((a, b) => b.score - a.score);
    displayResults(deduped);
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
