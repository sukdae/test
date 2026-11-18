// 종목 설정과 기준 동작
//
// 기준 동작은 특정인의 영상이 아니라, 논문 근거로 정한 '이상적 자세'를 수식으로 만든 것입니다.
// 한 번의 반복을 위상 p(0=시작, 0.5=최저점, 1=끝)로 표현하고, 분절 기울기를 코사인 곡선으로 보간합니다.
// 근거 번호는 docs/참고문헌.md 의 번호입니다.

import { kneeAngle, hipAngle } from './geometry.js';
import { curveAngles } from './reference.js';

export const EXERCISES = {
  squat: {
    id: 'squat',
    name: '스쿼트',
    desc: '측면에서 전신이 보이게 촬영하세요.',
    repSignal: 'knee',
    repDrop: 30,
    // [서 있을 때, 최저점] 분절 기울기(도) — 논문 기반 이상 자세
    //   깊이: 최저점에서 허벅지가 바닥과 평행(허벅지 기울기 −90°) [논문 1: 건강한 무릎에 평행 스쿼트 권장]
    //   상체–정강이: 최저점에서 상체 기울기 = 정강이 기울기(차이 0°) [논문 3: ±10° 안 = 엉덩이·무릎 중립]
    //   정강이 30°: 논문에 수치가 없어 정한 값 [초깃값]. 무릎이 발끝을 약간 넘는 정도 [논문 8]
    //   → 최저점 무릎 60°, 엉덩이 60°, 상체 30°
    template: { shin: [2, 30], knee: [175, 60], trunk: [3, 30] },
    templateNote: '논문 기반 기준 자세(평행 깊이, 엉덩이·무릎 중립)',
  },
  deadlift: {
    id: 'deadlift',
    name: '데드리프트',
    badge: '베타',
    desc: '서서 시작하는 세트를 측면에서 촬영하세요.',
    repSignal: 'hip',
    repDrop: 40,
    // [서 있을 때, 바닥] — 예시(합성 데이터) 생성용. 기준 자세는 아래 keys 를 쓴다.
    template: { shin: [2, 18], knee: [175, 120], trunk: [3, 55] },
    // 기준 자세: 올라오는 구간(위상 0.5 바닥 → 1 서기)의 키프레임. 내려가는 구간은 거꾸로 재생.
    //   3단계 순서: ① 무릎이 주로 펴짐 → ② 엉덩이가 주로 펴짐 → ③ 함께 펴짐 [논문 15, 22]
    //   스티킹 포인트: 허벅지 지면 기준 약 60°(= 수직에서 30°), 정강이 약 75°(= 수직에서 15°) → 무릎 135° [논문 22]
    //   상체 기울기와 바닥·마무리 자세 수치는 확인한 자료에 정의가 분명하지 않아 [초깃값]
    keys: [
      [0.5, { shin: 18, knee: 120, trunk: 55 }], // 바닥 [초깃값]
      // 상체 58°: ①단계에서 엉덩이 각도가 거의 안 변하려면 상체가 바닥 자세와 비슷해야 함. Hales 외 상체 58°와 같은 값이지만
      //   그 각도의 기준(수직/지면)을 확인하지 못해 [초깃값]
      [0.7, { shin: 15, knee: 135, trunk: 58 }], // 스티킹 포인트: 정강이·무릎 [논문 22], 상체 [초깃값]
      [0.85, { shin: 8, knee: 150, trunk: 20 }], // 엉덩이 위주로 펴진 뒤 [초깃값, 순서는 논문 22]
      [1.0, { shin: 2, knee: 175, trunk: 3 }], // 마무리 [초깃값]
    ],
    templateNote: '컨벤셔널 데드리프트 기준 자세(3단계 순서·스티킹 포인트는 논문, 나머지는 초깃값)',
  },
};

export const bell = (p) => (1 - Math.cos(2 * Math.PI * Math.min(1, Math.max(0, p)))) / 2;

// 비교 기준: 스쿼트는 논문 기반 이상 자세 하나만 사용합니다(특정 선수 영상 기준은 제거).
const IDEAL_SQUAT = {
  id: 'ideal',
  name: '논문 기반 기준 자세',
  short: '기준',
  note: '논문 기반 기준 자세 — 평행 깊이(Escamilla 2001), 상체·정강이 중립(Straub & Powers 2024), 느린 하강·빠른 상승(Wilk 외 2021)',
  // 템포 2/0/1/0: 느린 내려가기 + 빠른 올라오기가 유리하다는 방향 [논문 11]. 2초·1초라는 값은 [초깃값]
  tempo: { descent: 2.0, bottom: 0, ascent: 1.0, interval: null },
  metrics: { thighAboveParallel: 0, minKnee: 60, minHip: 60, maxTrunk: 30, topHip: 174 },
};

// 데드리프트 기준: 논문 일부 + 초깃값. 이름에 그대로 밝힌다.
const IDEAL_DEADLIFT = {
  id: 'ideal',
  name: '기준 자세 (논문 일부 + 초깃값)',
  short: '기준',
  note: '컨벤셔널 데드리프트 — 무릎→엉덩이→함께 펴지는 3단계 순서와 스티킹 포인트 각도(Kompf & Arandjelović 2017, Hales 외 2009). 나머지는 초깃값',
};

// 데드리프트 정면 기준: 컨벤셔널 = 대략 어깨너비, 발끝 10–15° 벌림 [논문 22] (Escamilla 2000 대회 선수 32 ± 8 cm [논문 12])
//   어깨너비 대비 범위 0.8–1.3은 '대략 어깨너비'를 앱 측정값으로 옮긴 [초깃값]
//   스모 = 2–3배 넓은 스탠스 [논문 22] → 1.6 이상이면 스모로 봄 [초깃값]
export const IDEAL_DEADLIFT_FRONT = {
  id: 'ideal-front',
  name: '기준 자세 (정면)',
  short: '기준',
  stance: { min: 0.8, max: 1.3 },
  sumoFrom: 1.6,
  kneeIn: 0, tilt: 0, shift: 0, sideLean: 0, leftPct: 50,
  basis: {
    stance: 'Kompf & Arandjelović 2017 (컨벤셔널 ≈ 어깨너비)',
    knee: '무릎 정렬 (초깃값, 데드리프트 논문 수치 없음)',
    symmetry: '좌우 대칭 (초깃값, 논문 수치 없음)',
  },
};
export const idealFront = (exId) => (exId === 'deadlift' ? IDEAL_DEADLIFT_FRONT : IDEAL_SQUAT_FRONT);

// 정면 기준 자세. 수치 근거는 [논문 3] Straub & Powers 2024 본문 'Stance Width'·'Clinical Applications' 절.
export const IDEAL_SQUAT_FRONT = {
  id: 'ideal-front',
  name: '논문 기반 기준 자세 (정면)',
  short: '기준',
  // 중간 스탠스 = 어깨너비의 100–150%. 150%를 넘는 넓은 스탠스는 무릎 외반(안쪽으로 모이는) 모멘트가 커질 수 있음 [논문 3]
  stance: { min: 1.0, max: 1.5 },
  // 무릎은 엉덩이–발목 선 위, 안쪽으로 모이지 않게. 무릎 외반 모멘트를 피하라는 권고 [논문 3]
  kneeIn: 0,
  // 좌우 대칭(골반 수평·쏠림 0·상체 수직·체중 50:50) [초깃값] — 확인한 논문에 수치 없음
  tilt: 0, shift: 0, sideLean: 0, leftPct: 50,
  basis: {
    stance: 'Straub & Powers 2024 (중간 스탠스 100–150%)',
    knee: 'Straub & Powers 2024 (무릎 외반 피하기)',
    symmetry: '좌우 대칭 (초깃값, 논문 수치 없음)',
  },
};

export const REFERENCES = {
  squat: [IDEAL_SQUAT],
  deadlift: [IDEAL_DEADLIFT],
};

// 예전에 저장된 기준 id → 현재 id
const REFERENCE_ALIASES = { 'pro-squat': 'ideal', template: 'ideal' };

export function getReference(exId, id) {
  const list = REFERENCES[exId] || [];
  return list.find((r) => r.id === id) || list.find((r) => r.id === REFERENCE_ALIASES[id]) || list[0];
}

// 키프레임 보간 (올라오는 구간 기준, 내려가는 구간은 거울상)
function keyAngles(keys, p) {
  const q = p <= 0.5 ? 1 - p : p; // 0→1, 0.5→0.5
  let i = keys.length - 1;
  while (i > 0 && keys[i - 1][0] > q) i--;
  if (q <= keys[0][0]) return { ...keys[0][1] };
  const [qa, A] = keys[Math.max(0, i - 1)], [qb, B] = keys[i];
  const u = qb > qa ? (q - qa) / (qb - qa) : 0, e = u * u * (3 - 2 * u);
  const mix = (k) => A[k] + (B[k] - A[k]) * e;
  return { shin: mix('shin'), knee: mix('knee'), trunk: mix('trunk') };
}

export function referenceAngles(exId, p, ref = null) {
  if (ref?.curves) return curveAngles(ref, p);
  if (EXERCISES[exId].keys) {
    const { shin, knee, trunk } = keyAngles(EXERCISES[exId].keys, p);
    const thigh = shin - (180 - knee);
    return { shin, thigh, trunk, knee: kneeAngle(shin, thigh), hip: hipAngle(trunk, thigh) };
  }
  const T = EXERCISES[exId].template;
  const f = bell(p);
  const lerp = ([a, b]) => a + (b - a) * f;
  const shin = lerp(T.shin);
  const knee = lerp(T.knee);
  const trunk = lerp(T.trunk);
  const thigh = shin - (180 - knee);
  return { shin, thigh, trunk, knee: kneeAngle(shin, thigh), hip: hipAngle(trunk, thigh) };
}
