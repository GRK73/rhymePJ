let dictionary = [];
let loanwordOverrides = {};
let semanticVectorStores = { ko: {}, en: {} };
let bigramStores = { ko: null, en: null };
let topicTranslations = {};
let semanticResourcesLoaded = false;
let semanticResourcesLoadingPromise = null;
let bigramResourcesLoadingPromises = {};
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

searchModeButtons.forEach(button => {
    button.addEventListener('click', () => {
        currentSearchMode = button.dataset.searchMode || 'word';
        searchModeButtons.forEach(item => {
            const isActive = item === button;
            item.classList.toggle('active', isActive);
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        if (currentSearchMode === 'linked') {
            statusEl.textContent = '연결 라임 검색은 두 단어 조합을 계산하므로 검색이 느릴 수 있습니다.';
        } else if (isReady) {
            statusEl.textContent = `사전 로드 완료! (총 ${dictionary.length.toLocaleString()} 단어, 외래어 ${Object.keys(loanwordOverrides).length.toLocaleString()}개, 의미 벡터는 주제 입력 시 로드)`;
        }
    });
});

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
            loadOptionalJson('semantic_vectors_ko.json'),
            loadOptionalJson('semantic_vectors_en.json')
        ]);

        if (koVectors) setSemanticStore('ko', koVectors);
        if (enVectors) setSemanticStore('en', enVectors);

        if (getSemanticVectorCount() === 0) {
            const legacyVectors = await loadOptionalJson('semantic_vectors.json');
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
        const data = await loadOptionalJson(`bigram_next_${lang}.json`);
        const entries = extractBigramEntries(data);
        bigramStores[lang] = entries;
        return entries;
    })();

    return bigramResourcesLoadingPromises[lang];
}

// Load dictionary
async function loadDictionary() {
    try {
        const response = await fetch('rhyme_dict_practical.json');
        if (!response.ok) throw new Error('Network response was not ok');
        dictionary = await response.json();

        try {
            const loanwordResponse = await fetch('loanword_overrides.json');
            if (loanwordResponse.ok) {
                loanwordOverrides = await loanwordResponse.json();
            }
        } catch (error) {
            console.warn('Loanword overrides are not available:', error);
        }

        isReady = true;
        const loanwordCount = Object.keys(loanwordOverrides).length;
        statusEl.textContent = `사전 로드 완료! (총 ${dictionary.length.toLocaleString()} 단어, 외래어 ${loanwordCount.toLocaleString()}개, 의미 벡터는 주제 입력 시 로드)`;
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
    if (currentSearchMode === 'linked') {
        await handleLinkedRhymeSearch();
        return;
    }
    await handleWordSearch();
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

            results.push({
                ...item,
                score: totalScore,
                matchIndices: result.matchIndices,
                matchPhonemes: result.matchPhonemes,
                matchLayer: result.matchLayer,
                matchLayerLabel: result.matchLayerLabel,
                semanticSimilarity: semanticResult.similarity
            });
        }
    }

    results = dedupeResultsByWordLang(results);
    results.sort((a, b) => b.score - a.score);

    displayResults(results);
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

    const targetLangs = getLinkedSearchLangs(selectedLang);
    const splitsByLang = targetLangs.map(lang => ({ lang, splits: buildLinkedSplits(query, lang) }));
    const allSplits = splitsByLang.flatMap(entry => entry.splits);
    if (allSplits.length === 0) {
        statusEl.textContent = '연결 라임 검색을 위한 분할 후보를 만들 수 없습니다.';
        displayResults([]);
        return;
    }

    statusEl.textContent = '연결 라임 검색은 두 단어 조합을 계산하므로 검색이 느릴 수 있습니다. bigram 데이터를 불러오는 중입니다...';
    const bigramStoresByLang = {};
    await Promise.all(targetLangs.map(async lang => {
        bigramStoresByLang[lang] = await ensureBigramResourceLoaded(lang);
    }));
    const availableLangs = targetLangs.filter(lang => bigramStoresByLang[lang] && Object.keys(bigramStoresByLang[lang]).length > 0);
    if (availableLangs.length === 0) {
        statusEl.textContent = '연결 라임 bigram 데이터를 불러올 수 없습니다.';
        displayResults([]);
        return;
    }

    const topicWord = topicInput.value.trim();
    const topicWeight = parseFloat(topicWeightInput.value);
    let semanticContext = buildSemanticContext('', 0);
    if (topicWord && topicWeight > 0) {
        statusEl.textContent = '연결 라임 검색은 두 단어 조합을 계산하므로 검색이 느릴 수 있습니다. 주제 의미 벡터를 불러오는 중입니다...';
        await ensureSemanticResourcesLoaded();
        await translateTopicToEnglish(topicWord);
        semanticContext = buildSemanticContext(topicWord, topicWeight);
    }

    statusEl.textContent = `"${query}"의 연결 라임을 찾습니다... (${allSplits.map(split => `${split.lang}:${split.label}`).join(', ')})`;

    const freqWeight = parseFloat(freqWeightInput.value);
    const freqRatio = Math.max(0, Math.min(1, freqWeight / 10));
    const excludeWords = getExcludeWords();
    const results = [];
    const maxFirstCandidates = 200;

    for (const { lang, splits } of splitsByLang) {
        const bigramEntries = bigramStoresByLang[lang];
        if (!bigramEntries || Object.keys(bigramEntries).length === 0) continue;
        const dictByLang = dictionary.filter(item => item.lang === lang);
        const dictByWord = new Map(dictByLang.map(item => [item.word.toLowerCase(), item]));

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
                const phonemes = getItemPhonemes(item);
                const leftResult = getBoundaryScore(phonemes, split.leftPhonemes, 'end', leftDetailMultipliers);
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

                        const secondPhonemes = getItemPhonemes(second);
                        const rightResult = getBoundaryScore(secondPhonemes, split.rightPhonemes, 'start', rightDetailMultipliers);
                        if (rightResult.score <= 40) return;

                        const topicResult = getPhraseTopicSimilarity(firstCandidate.item, second, lang, semanticContext);
                        if (!topicResult.matched) return;

                        const boundaryScore = (firstCandidate.leftResult.score + rightResult.score) / 2;
                        const bigramScore = normalizeBigramScore(row[2]);
                        const frequencyScore = getPairFrequencyScore(firstCandidate.item, second);
                        const topicScore = topicResult.topicScore ?? 0;
                        const rawScore = semanticContext.active
                            ? boundaryScore * (0.62 - freqRatio * 0.12) + bigramScore * 0.20 + frequencyScore * (freqRatio * 0.15) + topicScore * 0.15
                            : boundaryScore * (0.70 - freqRatio * 0.15) + bigramScore * 0.25 + frequencyScore * (freqRatio * 0.20);
                        const balanceMultiplier = 0.85 + split.balance * 0.15;
                        const finalScore = Math.max(0, Math.min(100, rawScore * balanceMultiplier));

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
