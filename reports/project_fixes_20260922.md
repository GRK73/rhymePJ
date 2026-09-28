# 전체 검토 후 수정 — 2026-09-22

## 수정 결과

| 검토 항목 | 처리 |
|---|---|
| 단어 검색 Worker 오류 후 무한 대기 | 오류·응답 decode 실패·시간 초과 시 Worker와 초기화 상태 정리. 다음 요청에서 새 Worker 생성. 180초 timeout 추가 |
| 초기화 중 취소·재검색 충돌 | 초기화는 공유하되 취소한 호출자의 대기와 진행 이벤트만 해제. 새 검색은 초기화와 진행 상태를 이어받음 |
| 단어 검색 제외어 순서 | UI가 제외어를 Worker에 전달. 후보 수 제한과 Top-K 제한 전에 필터링하고 동일 단어의 제외 판정 재사용 |
| 효과 없는 연결 발음 모드 | 선택지를 숨기고 비활성화. 현재 영어 원어·한국어 표준 발음 정책을 안내. 효과 없는 모드 변경 때문에 후보 캐시가 무효화되던 경로 제거 |
| 외부 실행 스크립트 | hangul-js 0.2.6과 MIT LICENSE를 로컬 vendor에 포함. 설치 패키지와 byte 동등성 검사 |
| Actions 자산 공급 누락 | 같은 저장소의 Release ZIP을 지정 SHA-256으로 내려받고 검증 후 자산 경로만 복원하는 과정 추가 |
| Actions Python 검사 환경 누락 | Python 3.12와 `.[build,test]` 설치 단계 추가 |
| 원본 코퍼스 때문에 배포가 항상 차단됨 | 원본은 보존하고 실제 `build/pages` artifact에 제한 코퍼스가 들어갔는지 검사. 기존 파일 허용 목록·용량·금지 파일 검사는 유지 |
| 연결 자산 staging 누락 위험 | 양쪽 manifest SHA-256을 허용 목록에 고정. gzip 전체 해시·바이트 수·필수 키·원본 버전 일치를 검사하고 manifest 파일 목록으로 staging 확장 |
| 오래된 opt2 비교가 의도된 변경을 실패로 판정 | 무손실 로딩 비교에서는 주제·제외어를 끄고, 변경된 주제·제외어 정책은 전용 회귀 검사로 분리 |

발음 모드 항목은 **선택 기능을 완성한 것이 아니다**. 기존 인덱스에 없는 발음 경로를 급히 추가해 검색 속도와 후보 품질을 바꾸지 않고, 현재 가능한 기능을 정확히 표시하도록 고쳤다. 모드별 발음·인덱스 구현은 후속 기능 작업이다.

## 배포 검토 산출물과 남은 조건

- `build/pages-review/deployment-allowlist.draft.json`: 현재 필요한 앱 파일·압축 자산 439개를 열거한 초안. 단어 검색 자산은 manifest에 따라 추가된다.
- `build/pages-review/source-inventory.json`: 연결 자산의 원본 해시, 정적 검색 원본 정보, 앱 파일 해시.
- `build/pages-review/payload-files.json`: ZIP에 넣을 생성 자산과 검증 증명서 목록.
- `build/rhyme-search-assets.zip`: 로컬 검토용 ZIP. 공개되지 않았다.
- `scripts/search/prepare_pages_review.mjs`, `scripts/search/pages_asset_bundle.py`: 재생성·복원 도구.

기존 `reports/claude_says_review_2026-08-03.md`의 파일별 출처·재배포 권리 미확정 기록과 `configs/deployment-allowlist.example.json`의 검토 조건은 자동으로 해결할 수 있는 코드 오류가 아니다. 원본 데이터의 공개 가능 여부를 추정해 `reviewed:true`로 바꾸지 않았다. **기술적인 공급·검사 경로는 추가했지만, 공개 가능한 데이터의 허용 목록 확정과 실제 Release 업로드·Pages 실행은 남아 있다.**

검토가 끝나면 승인된 목록을 `--policy`로 넘겨 ZIP을 다시 만든다. ZIP 생성 명령이 출력하는 해시와 Release tag를 workflow 입력으로 사용한다. 다운로드 ZIP은 앱 JS·workflow·임의 파일을 덮어쓸 수 없으며, 초안·잘못된 해시·상위 경로 이동·중복 항목은 복원 전에 거절한다. 최종 staging에서도 정적 자산 attestation과 연결 자산 해시를 별도로 대조한다.

## 검증

- Node 검색 회귀: 37개 통과. Worker 실패·timeout·취소·stale 응답, 제외어 후보 보충, 연결 release 무결성 검사를 포함한다.
- Python 검색 회귀: 전용 `build/review-test-venv`에서 build/test 의존성을 설치하고 20개 모두 통과. SQLite oracle과 정적 Worker의 기본 검색 parity도 포함한다.
- 실제 Chrome 단어 검색: Worker 오류 유도 후 새 Worker로 복구. 상위 5개 단어를 제외하고 50개 결과 유지. 모음·세부 가중치 검색과 취소 통과.
- 프리로딩 Chrome 검사: PC·모바일 크기, 키보드 초점, reduced motion, 로딩 0/5~5/5, 실패 후 재시도 통과. 연결 영어 결과 874개 유지.
- 프로젝트 검사와 배포 bundle의 정상 복원·잘못된 입력 차단 검사 통과.
- 음소·연결 라임 검증 각각 3회 연속 통과. 실제 Chrome 한국어 연결 검색 4,415개와 취소·최신 요청·오류 복구 유지.
- 실제 연결 자산 408개 고유 파일의 manifest pin·byte·SHA-256·원본 버전 검사 통과.
- `check_loading_modes.mjs`: 주제·제외어를 끈 14개 시나리오에서 opt2와 현재 결과 수·전체 결과 해시 일치. `reports/generated/loading-modes-1790071105622.json`에 기록.

이번 UI 측정 시간은 기능 확인용이며 속도 전후 비교가 아니다. 모델 비교, 단어 검색의 45MB 최초 로딩 최적화, 연결 후보 200개 제한 확장은 이번 버그 수정 범위에 넣지 않았다. 공개 배포를 실행한 결과로 해석하면 안 된다.
