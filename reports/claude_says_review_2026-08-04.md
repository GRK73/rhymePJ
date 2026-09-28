# `Claude_Says.md` 3차 재검토 판단 및 반영

- 검토일: 2026-08-04
- 대상: `Claude_Says.md` §14~17
- 원칙: 로컬 파일, 실제 Chrome smoke, parity 재실행과 배포 경로에서 재현되는 주장만 반영

## 결론

3차 검토의 성과 판정은 정확하고, 새 문제 3건도 모두 재현된다. 가장 중요한 문제는 V2 runtime URL이 `public/assets/search/v0/`를 가리키지만 실제 자산은 `indexes/phoneme/v0/static/`에만 있어 FastAPI mount 없이 Pages에서 404가 난다는 점이다. 두 번째는 parity 보고서가 현재 manifest와 연결되지 않아 오래된 통과 기록을 재사용할 수 있다는 점이다.

두 문제를 수용하되 검색 자산을 소스 `public/`에 다시 복제하지는 않았다. 검토된 파일만 별도 `build/pages`에 조립하는 staging 방식으로 수정했다.

## 항목별 판단

| 지적 | 판단 | 반영 |
| --- | --- | --- |
| §15.1 Pages에 정적 검색 자산을 배치하지 않음 | 수용 | allowlist app 파일과 manifest 검색 자산을 `build/pages`에 조립하고 workflow가 이 디렉터리만 업로드 |
| `public/` 354MiB만 예산으로 기재 | 수용 | 검색 자산을 단순 합산하면 약 420.5MiB임을 상태판에 기록. 실제 최소 staging 크기는 allowlist 전까지 미측정 |
| §15.2 parity/UI 검증이 release gate 밖 | 수용·변형 | full benchmark를 CI에 강제하지 않고, benchmark 재실행이 생성한 manifest-hash attestation을 staging hard gate로 사용 |
| §15.3 generation smoke 포인터 없음 | 수용 | 원 측정값과 `result`는 보존하고 `current_verdict`, `superseded_by` metadata 추가 |
| §15.3 linked 검증이 exact surface뿐 | 수용 | 실제 V1 phonetic scorer의 fallback 순위 `exact > near > far`를 surface 20건과 별도로 검사 |
| 모든 `http(s)://` literal 차단 권고 | 부분 수용 | 사용자 클릭 Naver 사전 링크는 허용. 외부 executable, 자동 external fetch와 서버 전용 generation API만 차단 |
| 원격 저장소·Pages 상태 확인 | 이번 범위 밖 | 원격 조회·커밋·push·이력 재작성은 수행하지 않음 |

## 구현한 release 연결

```text
SQLite ↔ Static Worker parity 16×3 재실행
  → reports/static_search_parity_attestation_v0.json
  → manifest SHA-256 + source SQLite SHA-256 + release 판정 고정
  → 66개 정적 데이터 파일 byte/SHA-256 전수 검사
  → 검토 allowlist app 파일과 함께 build/pages 조립
  → artifact runtime·용량·파일 allowlist 검사
  → build/pages만 Pages upload
```

현재 attested manifest SHA-256은 `8ac3adeb28d541ad304a2df134c3871c0ed27380183c25e978a995a116d1a3f5`이며, manifest가 가리키는 데이터는 66개 파일, 69,756,809 bytes다. manifest나 파일 하나라도 바뀌면 이전 attestation으로 staging할 수 없다.

## 검증과 현재 차단

- parity 16개 시나리오 × 3회 재실행: 전체 판정 통과, 최대 점수 오차 0
- release checker: 실제 66개 파일의 size/hash 전수 통과
- staging fixture: 미허용 파일 제외, manifest URL 위치 생성, 변조 asset과 stale attestation 거부
- artifact guard: 서버 generation API, 외부 executable, 자동 external fetch 거부
- linked fallback: exact 100.0, near 97.5, far 31.1 순위 통과

공개 배포는 계속 차단한다. 실제 allowlist가 없고 제한 코퍼스가 Git 이력에 있으며, 무시된 검색 자산을 Actions workspace에 공급할 경로도 아직 없다. 또한 현재 HTML의 unpkg executable과 `app.js`의 서버 generation API는 새 runtime guard에 걸린다. 이는 미완성 정적 앱이 우연히 배포되지 않도록 의도한 실패다.
