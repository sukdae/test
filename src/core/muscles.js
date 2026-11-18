// 근육 부하 추정 (참고용)
//
// 정밀한 근골격 모델이 아니라, 종목별 주동근 매핑 + 최저점 자세의 간이 지표로
// 상대적인 부하 수준(낮음/보통/높음)만 표시합니다.
//   kneeArm : 발 중앙에서 무릎까지 수평 거리 / 다리 길이 (무릎 모멘트 팔 근사)
//   hipArm  : 발 중앙에서 엉덩이까지 수평 거리 / 다리 길이 (고관절 모멘트 팔 근사)
//   depth   : 무릎 굽힘 정도 0~1,  hipFlex: 고관절 굽힘 정도 0~1

import { mean, clamp } from './signal.js';
import { RAD } from './geometry.js';

export const MUSCLES = {
  quads: '대퇴사두근',
  glutes: '대둔근',
  adductors: '내전근',
  hamstrings: '햄스트링',
  erectors: '척추기립근',
  calves: '종아리',
  traps: '승모근·상부 등',
  forearms: '전완(악력)',
};

const MAP = {
  squat: [
    ['quads', '주동근', (x) => 0.25 + 0.45 * x.depth + 0.9 * x.kneeArm],
    ['glutes', '주동근', (x) => 0.2 + 0.45 * x.hipFlex + 0.9 * x.hipArm],
    ['adductors', '보조근', (x) => 0.15 + 0.5 * x.depth],
    ['hamstrings', '보조근', (x) => 0.1 + 0.3 * x.hipFlex + 0.6 * x.hipArm],
    ['erectors', '안정화', (x) => 0.1 + 0.6 * Math.sin(x.trunk * RAD) + 0.5 * x.hipArm],
    ['calves', '안정화', (x) => 0.15 + 0.3 * x.kneeArm],
  ],
  // 데드리프트: 엉덩이 신전근(대둔근·햄스트링)·척추기립근 중심, 대퇴사두는 바닥 근처에서 큼 [논문 13, 16, 21, 22]
  deadlift: [
    ['glutes', '주동근', (x) => 0.3 + 0.4 * x.hipFlex + 0.6 * x.hipArm],
    ['hamstrings', '주동근', (x) => 0.3 + 0.3 * x.hipFlex + 0.7 * x.hipArm],
    ['erectors', '주동근', (x) => 0.25 + 0.6 * Math.sin(x.trunk * RAD) + 0.4 * x.hipArm],
    ['quads', '보조근', (x) => 0.1 + 0.5 * x.depth + 0.6 * x.kneeArm],
    ['traps', '안정화', (x) => 0.3 + 0.3 * Math.sin(x.trunk * RAD)],
    ['forearms', '안정화', () => 0.45],
  ],
};

export const levelOf = (v) => (v < 0.35 ? '낮음' : v < 0.65 ? '보통' : '높음');

export function estimateMuscles(exId, reps) {
  if (!reps.length) return [];
  const m = (k) => mean(reps.map((r) => r.metrics[k]));
  const x = {
    depth: clamp((180 - m('minKnee')) / 115),
    hipFlex: clamp((180 - m('minHip')) / 110),
    kneeArm: clamp(m('kneeArm'), 0, 0.6),
    hipArm: clamp(m('hipArm'), 0, 0.6),
    trunk: clamp(m('maxTrunk'), 0, 90),
  };
  return MAP[exId]
    .map(([id, role, fn]) => { const load = clamp(fn(x)); return { id, name: MUSCLES[id], role, load, level: levelOf(load) }; })
    .sort((a, b) => b.load - a.load);
}

// ---- 정면: 좌우 근육 사용 (추정) ----
// 기본 부하: 측면 결과가 있으면 그 값(둘 다 모드), 없으면 정면 깊이(엉덩이 높이)로 근사.
// 스탠스 보정: 넓은 스탠스는 대둔근·내전근 활동이 늘어난다는 보고 [논문 3, 다른 연구 인용] → 방향만 반영, 크기(×1.15)는 [초깃값].
// 좌우 비율: 양발 체중 분배(엉덩이 쏠림)로 나눔 [초깃값 · 추정].
const FRONT_SET = ['quads', 'glutes', 'adductors'];

export function estimateFrontMuscles(front, sideMuscles = null) {
  if (!front?.reps?.length) return [];
  const base = {};
  if (sideMuscles?.length) for (const m of sideMuscles) base[m.id] = m.load;
  else {
    const depth = clamp((100 - mean(front.reps.map((r) => r.metrics.depthPct))) / 55);
    Object.assign(base, { quads: clamp(0.3 + 0.6 * depth), glutes: clamp(0.25 + 0.6 * depth), adductors: clamp(0.2 + 0.5 * depth) });
  }
  // 넓은 스탠스: 대둔근·내전근 활성에 영향, 대퇴사두는 무관 [논문 34, 35]. 1.15배는 [초깃값]
  const wide = front.stance?.category === '넓음' ? 1.15 : 1;
  const leftShare = clamp((mean(front.reps.map((r) => r.metrics.leftPct)) || 50) / 100);
  return FRONT_SET.filter((id) => base[id] != null).map((id) => {
    const load = clamp(base[id] * (id === 'quads' ? 1 : wide));
    const left = clamp(load * leftShare * 2), right = clamp(load * (1 - leftShare) * 2);
    return { id, name: MUSCLES[id], load, left, right, levelL: levelOf(left), levelR: levelOf(right), fromSide: !!sideMuscles?.length };
  });
}
