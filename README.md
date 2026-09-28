# Rhyme Finder

**한국어/영어 라임 검색기**

철자가 아니라 **발음**이 비슷한 한국어·영어 단어(단어 검색)와 두 단어 조합(연결 라임 검색)을 찾습니다. 모든 계산은 브라우저의 Worker에서 하며 서버가 필요 없습니다.

> V2 개발 중입니다. 공개 배포는 자료 공개 권리 검토가 끝날 때까지 막아 두었습니다. 설계는 [V2검색엔진설계.md](V2검색엔진설계.md), 진행 기록은 [V2 검색 엔진 보고서](reports/search_v2_engine_20260928.md)에 있습니다.

## 검색 원리 (요약)

- **발음:** 사전 38만 7천 단어를 Windows 한국어 음성(Heami)이 실제로 읽는 발음으로 바꿔 두었습니다. 영어 단어는 실제 영어 발음과 한국식 발음을 함께 가집니다. 사전에 없는 검색어는 Heami를 흉내 내도록 학습한 작은 발음 모델이 읽습니다.
- **비교:** 음소를 조음 특징(자음: 위치·방법·기식·유성, 모음: 높이·전후·원순)으로 비교하고, V1과 같은 가중 편집거리와 sliding window 중 높은 점수를 씁니다. 끝소리 우대 같은 숨은 보정은 없고, 사용자가 정한 모음·자음·세부 가중치만 반영합니다.
- **빈도·주제:** 빈도는 V1 식 그대로(한국어 위키백과, 영어 wordfreq). 주제는 LaBSE로 한국어·영어 단어를 같은 의미 공간에 두고 비교합니다(번역 없음).
- **연결 라임:** 검색어를 둘로 나눠 앞 단어의 끝소리·뒤 단어의 첫소리를 비교합니다. 후보는 실제 문장에서 이어 나온 단어 쌍입니다.

자세한 설명은 화면의 "검색 원리" 안내창에 있습니다.

## 실행

```bash
npm ci
npm start
```

`http://127.0.0.1:4173/rhymePJ/`에서 열립니다. `public/`을 `build/preview/`에 복사해 제공하므로(`public/data/`는 제외) 코드를 고친 뒤에는 다시 실행합니다. 포트는 `RHYME_APP_PORT`로 바꿉니다.

검색 자산(`public/assets/`)은 생성물이라 Git에서 제외했습니다. 없으면 아래 빌드를 먼저 실행해야 합니다.

## 검사

```bash
npm test
```

프로젝트 검사(`scripts/check_project.js`), Node 테스트(`tests/search/`), Python 테스트를 실행합니다. V1과의 동일성 검사는 오래 걸려 따로 실행합니다.

```bash
npm run check:v1-parity -- --extra --topic
```

기준값은 V1 엔진을 그대로 돌려 얻으므로 한 사례에 15초~2분이 걸립니다(전체 298개를 한 줄로 돌리면 약 6시간). 그래서 여러 스레드로 나눠 돌리고(`--jobs`, 기본 최대 6), 끝난 V1 결과는 `build/parity-cache/`에 바로 저장합니다. V1은 고정된 커밋이라 다음 실행부터는 V2 쪽만 계산해 몇 분이면 끝납니다. 기준 코드나 사례가 바뀌면 그 사례만 다시 계산하고, 캐시와 다르면 V1을 다시 돌려 실제로 비교합니다. 처음부터 다시 계산하려면 `--fresh`를 붙입니다.

## 자산 빌드

| 자산 | 만드는 방법 | 입력 |
|---|---|---|
| 발음 (Heami) | `scripts/pronunciation/extract_heami.ps1` → `build-heami-pronunciations.mjs` | Windows Heami 음성, `data/source/loanword_overrides.json` |
| 빈도 | `python scripts/pronunciation/build_word_frequencies.py` | kowikitext, wordfreq |
| 검색 사전 `assets/lexicon/v1` | `npm run build:lexicon` | 발음·빈도, `data/source/rhyme_dict_practical.json`(영어 원어 발음) |
| 발음 모델 `assets/g2p/v1` | `train_g2p.py` → `npm run build:g2p-assets` | Heami 발음 |
| 주제 벡터 `assets/topic/v1` | `scripts/semantic/`: `export_lexicon_words.mjs` → `embed_labse.py` → `build_topic_vectors.py` | LaBSE (Hugging Face) |
| 연결 자산 `assets/linked/v2` | `build_linked_surfaces.mjs` → `build_linked_frequencies.py` → (LaBSE, `build_topic_vectors.py --extra`) → `npm run build:linked` | `data/source/bigram_surface_ko.json`, `bigram_next_en.json` |

각 스크립트 머리말에 사용법이 있습니다. 음소 유사도 상수는 `configs/phoneme_similarity_v0.json` 하나에서 `npm run build:similarity-config`로 생성합니다.

## 구조

- `public/index.html`, `js/app.js`, `js/render.js`: 화면
- `public/workers/word-worker.js`: 사전·발음 모델·주제 벡터·연결 자료를 들고 단어·연결 검색을 계산
- `public/js/search/`: 엔진(`word-engine.js`, `linked-engine.js`), 검색어 발음(`word-query.js`, `g2p-heami.js`), 주제(`topic-vectors.js`), Worker 연결(`word-runtime.js`)
- `public/js/phonetics.js`: V1 음소 특징·유사도·`calculateScore`

## 배포 (GitHub Pages)

검색 자산은 생성물이라 Git에 없으므로, 검토를 거친 자산 묶음(Release zip)으로 배포합니다. 배포는 수동 실행만 됩니다.

1. `npm run prepare:pages-review` → `build/pages-review/`에 허용 목록 초안(`reviewed: false`), 자산 목록, 자료 출처 목록(`source-inventory.json`)을 만듭니다.
2. 출처 목록으로 공개·재배포 조건을 확인하고, 초안을 검토한 뒤 `reviewed: true`로 바꿔 저장합니다.
3. `python scripts/search/pages_asset_bundle.py create --policy <검토한 허용 목록>` → `build/rhyme-search-assets.zip`과 SHA-256을 얻습니다.
4. zip을 이 저장소의 Release에 올리고, Actions에서 "Manual GitHub Pages Deploy (gated)"를 Release 태그와 SHA-256으로 실행합니다.

workflow는 zip의 SHA-256 → 자산 무결성과 검토 목록의 고정값(`npm run check:search-assets`) → `npm test` → 허용 파일만 조립(`npm run stage:pages`) → 코퍼스·빌드 입력이 없는지 → 파일 목록·용량(`npm run check:deploy-artifact`) 순서로 확인하고 `build/pages/`만 올립니다. 빌드 입력(`data/source/`)과 제한 코퍼스는 사이트에 들어가지 않습니다.

## 보관한 것

가사 생성·분석 연구와 이전 기획 문서는 `../rhymePJ_archive_20260927/`에 있습니다. 2026-09-28에 V2 엔진으로 바꾸면서 은퇴한 이전 엔진(V2 정적 단어 검색, 규칙 발음 연결 검색, 이전 주제 벡터와 Google 번역, 힙합·구어 말뭉치 가산, V1 데이터 파이프라인)은 같은 폴더의 `v2_old_engines_20260928/`로 옮겼고, 목록은 그 안의 `MANIFEST.json`에 있습니다. V1 원본은 Git 커밋 `5df2ae8`에 있습니다.
