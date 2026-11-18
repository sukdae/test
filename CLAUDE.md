# CLAUDE.md — 폼 체크 (운동 자세 분석 웹 프로토타입)

사용자와 한국어로 소통. 빌드 단계 없음(정적 ES 모듈). 이 파일로 구조를 먼저 파악하고, 필요한 파일만 여세요.

## 실행·테스트
- 서버: `python3 -m http.server 8640`. `file://` 불가.
- 테스트: `http://localhost:8640/tests/` (브라우저에서 실행, `#sum`에 통과/실패). Node 없음.
- 브라우저는 ES 모듈을 캐시함 → 수정 후 `fetch(path,{cache:'reload'})`로 갱신하고 새로고침.
- 실제 영상 테스트: 영상을 `.local-test/`에 심볼릭 링크 → `fetch` 로 Blob → 끝나면 링크 삭제. 원본·영상은 앱에 저장 금지.

## 구조
- `src/core/` — DOM 없는 순수 로직(네이티브 포팅 대상)
  - `analyze.js` 측면 파이프라인: 관절점→각도 시계열→`reps.js` 반복 분할→지표→`compare.js` DTW 비교→`feedback.js`→`muscles.js`
  - `front.js` 정면 분석(무릎 안쪽 이동, 골반 기울기, 엉덩이 쏠림, 스탠스, 상체 옆 기울기·흔들림, 체중 분배, 한쪽 발 뜸) + 정면 피드백. 정면 근육은 `muscles.js`의 `estimateFrontMuscles`
  - `feedback.js` 규칙·임계값(`THRESHOLDS`, 근거 주석 `[논문 n]`/`[초깃값]`), `coach.js` 행동 문장 3개(`buildCoaching`, `mergeCoaching`)
  - `exercises.js` 종목·기준 자세(스쿼트 = 논문 기반 `ideal`, 데드리프트 = `keys` 키프레임 3단계 + 초깃값), `idealFront(exId)` 정면 기준, `reference.js` 영상→기준 프로필 추출 도구·템포 위상
  - `fuse3d.js` 둘 다 모드 3D 합성: 반복 위상으로 측면(z,y)+정면(x) 대표 반복 → `fusedRows` 진단표. UI는 `src/ui/fused.js`
  - 정면 기준 자세 `IDEAL_SQUAT_FRONT`(exercises.js) + `compareFrontIdeal`(front.js), 고스트 `drawFrontGhost`(draw.js)
  - 측면 무게중심 근사 `comOnFoot`(analyze.js) → `comShift`(서 있을 때 대비), 판정 `balance-fwd/back`(feedback.js), 표시 `drawBalance`. 데드리프트는 바벨 무게 입력 시에만. 무게 입력 `load {bodyKg, barKg}` → `analyzeSession(..., { load })`, `cleanLoad`
  - `back.js` 세그멘테이션 마스크로 등 곡률(실험), `geometry.js`/`signal.js`/`landmarks.js` 유틸, `synthetic.js` 측면·정면 합성 데모
- `src/ui/` — 브라우저 전용: `pose.js`(MediaPipe 래퍼, 유일한 인식 계층), `process.js`(영상→프레임), `capture.js`(카메라), `result.js`(측면 결과), `frontResult.js`(정면 결과), `versus.js`(나 vs 기준 표), `draw.js`(오버레이·근육 도식), `charts.js`, `history.js`, `storage.js`(IndexedDB+localStorage)
- `src/ui/judge.js` 판정 평가(맞아요/틀렸어요/놓친 실수) → localStorage `formcheck-labels`, 설정에서 CSV 내보내기
- `src/app.js` 화면 전환. 촬영 방향 `state.mode` = side/front/both, 둘 다는 `state.pair`로 측면→정면 순서.
- `index.html` 모든 화면(section `view-*`). 결과 화면은 `data-view=side|front`로 `.side-only`/`.front-only` 전환.
- `docs/참고문헌.md` 확인된 논문 11편과 앱 반영 내역.

## 규칙
- 기준값은 논문 근거가 있으면 `[논문 n]`, 없으면 `[초깃값]`으로 주석. 확인 안 된 출처는 넣지 않음.
- 특정 선수·유명인 영상/이름으로 기준을 만들지 않음(법적 위험). 진단·치료 표현 금지, '참고용'.
- 판정 변경 시 `tests/core.test.js`에 합성 데이터 케이스 추가.
