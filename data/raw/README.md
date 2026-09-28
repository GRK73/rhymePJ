# Raw data boundary

V2 원본 데이터는 이 디렉터리에서 출처별 namespace로 관리한다. 원본 파일은 수정하지 않으며, 라이선스·취득 위치·취득일·원본 해시를 함께 기록한다.

현재 `public/data/corpus/hiphop_corpus.jsonl`은 V1 호환을 위해 기존 위치에 유지한다. `configs/corpus_v0.json`의 importer가 이 파일을 V2 canonical schema로 변환한다.

현재 파일에는 `title`과 `lyrics`만 있어 아티스트 단위 분할이 불가능하다. v0은 곡 단위 분할을 사용하고, 해당 한계를 manifest와 품질 보고서에 기록한다.

## Transformer v0 외부 원천

`configs/transformer_corpus_v0.json`은 다음 공개 원천을 고정 revision과 SHA-256으로 잠근다.

- `AKS-DHLAB/KPoEM`: 한국 근대시 행·감정 주석, MIT
- `yoonholee/poetry-greats-public-domain`: 영문 퍼블릭 도메인 시, CC0-1.0

취득과 빌드는 분리한다.

```powershell
python scripts/v2/fetch_transformer_sources.py
python scripts/v2/build_transformer_corpus.py
```

다운로드한 원본과 생성된 학습 Parquet은 Git에 넣지 않는다. `source_manifest.json`과 최종 `manifest.json`이 입력·출력 해시를 기록한다. 기존 가사 원천은 권리 검토가 끝나지 않았으므로, 공개 라이선스 자료와 결합한 결과도 외부 배포하거나 모델 가중치 공개에 사용해서는 안 된다.
