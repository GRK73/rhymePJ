# 검색 제품 전환: 최초 기준선 및 P1 착수 결과

작성일: 2026-09-20. 상태: **P0/P1 진행 중**. 전체 개선이나 성능 목표 달성을 선언하는 보고서가 아니다.

## 1. 이번에 적용한 변경

1. 가사 생성 탭·입력·결과·이벤트·생성 API 요청과 미사용 가사 분석 CSS를 제품에서 제거했다. 한국어/영어 단어 및 연결 라임 검색 화면을 남겼다.
2. `npm start`를 Python API에서 Node.js 정적 미리보기로 전환했다. 기존 검색 자산을 `build/preview/assets/search/v0/`에 조립하며 `/rhymePJ/`에서 동작한다. Python API는 `start:research-api`로만 별도 실행한다.
3. 한국어 surface 연결 후보 순회를 `public/js/search/linked-core.js`의 의존성 주입 함수로 옮겼다. 순회와 점수식은 유지했다. 주입된 scorer들의 DOM 접근 및 영어 경로는 아직 분리하지 않았으며 연결 검색은 여전히 메인 스레드에서 계산한다.
4. 검색 기본 검사와 생성 연구 검사를 분리했다. 기본 검색 테스트에 torch/transformers가 필요한 연구 테스트를 포함하지 않는다. 검색 자산 빌드·Python 검증에는 Python 및 build/test 의존성이 필요하다.
5. 원본 스냅샷·400개 입력 fixture·실제 브라우저 캡처·결과 비교 도구를 추가했다. 대형 사전/코퍼스는 중복 저장하지 않는다.

기존 미커밋 V2 작업과 연구 모델은 보존했다. GitHub에 push하거나 Pages에 배포하지 않았다. 로컬 미리보기는 공개 배포 검토를 통과한 artifact가 아니다.

## 2. 보존한 기준

| 항목 | 값 |
|---|---|
| GitHub V1 기준 커밋 | `5df2ae874c74fa94ae77ca497ca7a1ed3a7f6306` |
| V1 소스 | `tests/reference/v1/`의 원본 15파일 |
| 변경 전 로컬 V2 | `tests/reference/local-v2/`의 원본 19파일 |
| 고정 입력 | `tests/fixtures/search_product_v1.json`: 한국어/영어 단어 각 80, 한국어/영어 연결 각 80, 교차 40, 경계/OOV 40 |
| 입력 분리 | 개발 280 / 수용 120; 사람 라벨 및 OOV 기대 상태 보완 필요 |
| 실제 실행 | 원본 `handleSearch()` → 단어/연결 제품 경로 |
| 결과 보존 | 전체 결과의 단어·점수·순서·주요 메타데이터 SHA-256, Top-20, 결과 수, UI 비활성 상태 |
| 입력 보존 | 캡처 시 제공한 파일의 바이트 수·SHA-256; V1 데이터는 기준 Git 커밋에서 읽음 |

핵심 SHA-256:

```text
fixture:           84c013180c2a7007b4937f0fefec2e7ffbbcd02fd1c204e7a27d3d8bf347937f
V1 manifest:       62cef067feadea4596d0a4dc00b700873256293e8eafc31ddc1587cc2a9c4eb5
local-V2 manifest: 45b6990c649b0ee0c302e2bf3ca9127185fc7f8e4405faa2b6df656e3940ab53
```

## 3. 최초 브라우저 관측

환경: Windows 10.0.26200 x64, Intel Core 5 120U, 논리 CPU 12개, 메모리 약 16GB, Node 24.13.1, Chrome 153.0.8010.48. Headless Chrome 1600×1000, loopback HTTP, 동일 페이지에서 아래 순서로 실행했다. 결과 렌더링 후 두 번의 animation frame까지 측정했다.

외부 요청은 차단하고 hangul-js만 로컬 패키지 바이트로 대체했다. 각 시점의 캐시·OS 상태와 초기 자산 준비가 다르며 측정 서버의 해시 검사 비용도 포함된다. **아래는 반복 측정이나 p95가 아니고 이번 코드 변경의 가속 효과도 아니다.**

| 모드 / 입력 / 결과 언어 | V1 결과 수 | V1 표시까지 ms | 변경 전 로컬 V2 결과 수 | 로컬 V2 표시까지 ms |
|---|---:|---:|---:|---:|
| 단어 / 사랑 / 한국어 | 64,248 | 7,281 | 50 | 3,680 |
| 단어 / time / 영어 | 137,770 | 36,317 | 50 | 876 |
| 연결 / 가커 / 한국어 | 4,415 | 5,762 | 4,415 | 6,457 |
| 연결 / time / 영어 | 874 | 4,224 | 874 | 3,254 |
| 단어 / 사랑 / 한영 전체 | 152,975 | 16,218 | 50 | 941 |
| 단어 / time / 한영 전체 | 239,347 | 43,442 | 50 | 1,987 |
| 빈 입력 | 0 | 21 | 0 | 18 |
| 단어 / flowzzzz / 한영 전체 | 76,190 | 32,030 | 0 | 59 |

V1과 기존 V2는 이미 후보 정책·점수식·반환 범위가 다르다. 50개만 반환하는 V2와 V1의 시간을 나누어 동일 품질의 가속 배수로 해석하면 안 된다. 특히 `flowzzzz`의 결과 차이는 향후 OOV 정책과 후보 회수 평가의 대상이다. 초기 로딩 완료를 기다린 뒤 측정하므로 페이지 진입부터의 cold 시간을 뜻하지 않는다.

원본 로컬 보고서(생성 산출물로 Git ignore):

- `reports/generated/search-reference-v1-smoke.json` — SHA-256 `1c1f66304fbe2299f2e34a8881f49a2675aae567c3a9a5275798cc8c44d6914d`
- `reports/generated/search-reference-local-v2-smoke.json` — SHA-256 `554d9c6058ca3a95401ab75ad836b6aa9cec2b2bf2ac29f686d6ccee81d40980`
- `search-reference-v1-initial.json`은 CRLF 입력 대조 오류가 있던 실패 실행이다. 기준선과 통과 근거에서 제외했다. 수정된 V1 transport는 Git 원본 바이트를 제공한다.

## 4. 전후 동등성 및 실행 검증

| 검사 | 결과 | 범위 |
|---|---|---|
| 기본 대표 입력 8건 | 8/8 동일 | 변경 전 로컬 V2 대 최종 검색 전용 코드, 전체 결과 순서/점수 해시 및 Top-20 |
| 연결 가중치 행렬 | 20/20 동일 | `가커` 한국어, `time` 영어 × 기본값 및 빈도/주제 0·5·10의 9조합 |
| Node 검색 검사 | 8건 통과 | fixture 분리, 스냅샷 변조 거부, 실제 dispatcher 캡처, 비교 실패 감지, 정적 서버/자산 경로 |
| 검색 Python 검사 | 18건 통과 | 데이터 ID·발음·검색·정적 자산·제품 탐색 |
| 기존 음소 검사 | 3회 통과 | 기존 golden/언어별 발음 비교 |
| 기존 연결 검사 | 60건 통과 | 3회×20건, 실제 전체 제품 경로의 대체 검증이 아닌 보조 검사 |
| 보존 연구 Python 검사 | 65건 통과 | API·생성 연구 포함 기존 회귀 |
| 정적 UI smoke | 통과 | 실제 Node 서버 `/rhymePJ/`, 검색 전용 2개 모드, 단어 검색·진행 표시·세부 가중치·모음 검색·취소 |
| 화면 확인 | 완료 | `reports/generated/search-only-p1.png`, 데스크톱 1600×1000 |

기본 8건과 연결 20회에는 기본 연결 2건이 겹친다. 28개 서로 다른 입력의 검증이 아니다. 캡처마다 데이터 해시와 검색 설정을 비교한 뒤 결과 동등성을 판정했다. 품질 평가 통과나 모든 질의의 동등성을 뜻하지 않는다.

비교 보고서:

- `reports/generated/search-p1-parity-final.json`
- `reports/generated/search-p1-parity-weights.json`
- 입력: `search-reference-local-v2-smoke.json`, `search-reference-current-p1-final.json`, `search-reference-local-v2-weights.json`, `search-reference-current-p1-weights.json`

각 비교 보고서는 입력 캡처 파일의 SHA-256도 보관한다. 재현 명령은 [기준선 안내](../tests/reference/README.md)에 있다.

실행한 주요 명령:

```bash
npm test
node --test tests/search/*.test.mjs
npm run test:research
npm run smoke:static-ui:v2
node scripts/search/compare_reference.mjs reports/generated/search-reference-local-v2-smoke.json reports/generated/search-reference-current-p1-final.json reports/generated/search-p1-parity-final.json
node scripts/search/compare_reference.mjs reports/generated/search-reference-local-v2-weights.json reports/generated/search-reference-current-p1-weights.json reports/generated/search-p1-parity-weights.json
```

## 5. 다음 구현에서 해결할 사항

- P0 전체 400개 입력 × 가중치 행렬과 별도 40개 확장 프로필은 미완료다. 현재 실행기는 기본 및 빈도/주제 행렬만 지원한다. 사람 정답·OOV 기대 발음/상태도 아직 확정하지 않았다.
- 이번 변경은 점수식과 후보를 보존한 제품 분리다. 속도 목표 달성은 아직 측정하지 않았다. 반복 cold/warm, 모바일, 메모리, 네트워크 및 main-thread long task 측정이 필요하다.
- 단어 검색의 빈도/주제/발음모드 컨트롤은 이전 로컬 V2처럼 여전히 비활성이다. 가중치 복원 전에는 가중치를 포함한 단어 검색이 빨라졌다고 주장할 수 없다.
- 연결 검색 주제 가중치는 기존처럼 `>0` 활성화 여부만 반영한다. 실제 캡처에서도 빈도를 고정했을 때 주제 5와 10의 결과 해시가 같았다. 후속 점수 버전에서 수치 반영을 수정하고 품질을 별도 비교해야 한다.
- P1 나머지는 DOM 없는 scorer 옵션화, 영어/한국어 공통 Worker 계약과 취소·오류 처리다. P2/P3/P4에서 발음 사전 계산·정수 인덱스·DP/정렬 최적화와 의미/빈도 재랭킹을 진행한다.
- 공개 Pages 배포는 allowlist, 검색 자산 공급, 외부 의존성 vendoring 등 기존 gate를 그대로 유지한다. 이번 정적 미리보기 통과가 배포 승인이나 배포 완료를 뜻하지 않는다.

진행 상황은 [검색기 개선 실행계획](../검색기_개선_실행계획.md)에 반영했다.
