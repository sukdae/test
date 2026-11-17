// 규칙 기반 피드백 문구
//
// 표현 원칙: 진단·치료 표현을 쓰지 않고 '참고용 폼 피드백'으로 안내합니다.
// 근거 표기: 각 기준값 옆에 근거를 적었습니다. 번호는 docs/참고문헌.md 의 번호입니다.
//   [논문 n]  = 확인한 논문의 결론·정의에 따름
//   [초깃값]  = 논문에 해당 수치가 없어 정한 값. 실제 영상으로 보정 필요

import { mean, std, isNum } from './signal.js';

const deg = (v) => `${Math.round(v)}°`;
const avgOf = (hit, fn) => mean(hit.map((r) => (typeof fn === 'string' ? r.metrics[fn] : fn(r.metrics))));

export const REFS = {
  escamilla: 'Escamilla (2001)',
  straub: 'Straub & Powers (2024)',
  mckean: 'McKean 외 (2010)',
  wilk: 'Wilk 외 (2021)',
  fry: 'Fry 외 (2003)',
};

export const THRESHOLDS = {
  squat: {
    // 깊이 목표 = 평행(허벅지가 바닥과 수평). [논문 1] 건강한 무릎에는 딥보다 평행 스쿼트를 권함.
    // 15°는 측정 오차(2D 추정)를 감안한 여유 [초깃값], 35°는 '얕음' 경계 [초깃값].
    nearThigh: 15,
    shallowThigh: 35,
    // 상체–정강이 각도 차이 ±10° → 엉덩이 위주 / 중립 / 무릎 위주. [논문 3] 경고가 아닌 정보.
    trunkTibiaBias: 10,
    // 상승 초반 상체가 더 숙여지는 정도 [초깃값 · 논문 근거 없음, 일반 코칭 관행]
    hipsFirstTrunk: 3,
    // 뒤꿈치 들림 (다리 길이 대비) [초깃값 · 논문 근거 없음]
    heelLift: 0.03,
    // 너무 빠른 하강: 느린 내려가기가 유리하다는 방향은 [논문 11], 0.5초라는 값은 [초깃값]
    fastDescent: 0.5,
    // 반복 간 깊이 편차 [초깃값]
    depthStd: 8,
  },
  // 데드리프트 기준은 확인한 논문 목록(스쿼트)에 근거가 없음 [초깃값]
  deadlift: { lockoutHip: 165, leanBackTrunk: -10, hipsFirst: 10, squattyKnee: 100 },
  // 등 곡률·흔들림 [초깃값 · 실험]. 무게를 지면 허리가 어느 정도 굽는 것은 정상일 수 있어 [논문 10]
  // 단정하지 않고 '참고'로만 표시.
  core: { backRound: 4, backArch: -4, wobble: 2.5 },
};

const C = THRESHOLDS.core;
const CORE_RULES = [
  {
    id: 'back-round', level: 'info', group: 'core', ref: `${REFS.mckean}, ${REFS.straub}`,
    when: (m) => m.backRound > C.backRound,
    title: '서 있을 때보다 등이 더 둥글어졌어요 (참고)',
    detail: (hit) => `최저점에서 등 윤곽이 서 있을 때보다 ${avgOf(hit, 'backRound').toFixed(1)}% 더 둥글어요(실험 기능). 무게를 지면 허리가 어느 정도 굽는 것은 정상일 수 있어요. 허리가 불편하다면 등을 곧게 유지할 수 있는 깊이까지만 앉아 보세요.`,
  },
  {
    id: 'back-arch', level: 'info', group: 'core', ref: REFS.straub,
    when: (m) => m.backArch < C.backArch,
    title: '서 있을 때보다 허리가 더 젖혀졌어요 (참고)',
    detail: (hit) => `최저점에서 허리가 서 있을 때보다 ${(-avgOf(hit, 'backArch')).toFixed(1)}% 더 안쪽으로 꺾여요(실험 기능). 갈비뼈를 살짝 내리고 골반을 중립에 두는 느낌을 유지해 보세요.`,
  },
  {
    id: 'trunk-wobble', level: 'info', group: 'core',
    when: (m) => m.trunkWobble > C.wobble,
    title: '상체가 흔들려요',
    detail: (hit) => `동작 흐름에서 벗어난 상체 흔들림이 평균 ±${avgOf(hit, 'trunkWobble').toFixed(1)}°예요. 몸통을 단단히 고정한 채 일정한 속도로 움직여 보세요.`,
  },
];

const RULES = {
  squat: (T) => [
    {
      id: 'depth-shallow', level: 'warn', group: 'depth', ref: REFS.escamilla,
      when: (m) => m.thighAboveParallel > T.shallowThigh,
      title: '깊이가 얕아요',
      detail: (hit) => `최저점에서 허벅지가 수평보다 평균 ${deg(avgOf(hit, 'thighAboveParallel'))} 위에 있어요. 허벅지가 바닥과 평행해질 때까지 앉는 것을 목표로 해 보세요.`,
    },
    {
      id: 'depth-near', level: 'info', group: 'depth', ref: REFS.escamilla,
      when: (m) => m.thighAboveParallel > T.nearThigh && m.thighAboveParallel <= T.shallowThigh,
      title: '평행에 조금 못 미쳐요',
      detail: (hit) => `최저점에서 허벅지가 수평보다 평균 ${deg(avgOf(hit, 'thighAboveParallel'))} 위에 있어요. 평행 스쿼트가 목표라면 조금 더 앉아 보세요.`,
    },
    {
      id: 'hips-first', level: 'warn', group: 'trunk',
      when: (m) => m.trunkEarly > T.hipsFirstTrunk,
      title: '올라올 때 엉덩이가 먼저 올라와요',
      detail: (hit) => `상승 초반에 상체가 평균 ${deg(avgOf(hit, 'trunkEarly'))} 더 숙여져요. 가슴과 엉덩이가 함께 올라오도록 해 보세요.`,
    },
    {
      id: 'heel-lift', level: 'warn', group: 'heel',
      when: (m) => m.heelLift > T.heelLift,
      title: '뒤꿈치가 들려요',
      detail: () => '발 전체로 바닥을 누르는 느낌을 유지해 보세요. 발목이 뻣뻣하다면 스탠스를 조금 넓히는 것도 방법이에요.',
    },
    {
      id: 'fast-descent', level: 'info', group: 'tempo', ref: REFS.wilk,
      when: (m) => m.descent < T.fastDescent,
      title: '내려가는 속도가 빨라요',
      detail: (hit) => `하강 시간 평균 ${avgOf(hit, 'descent').toFixed(1)}초. 천천히 내려가고 힘차게 올라오는 조합을 해 보세요.`,
    },
  ],
  deadlift: (T) => [
    {
      id: 'lockout', level: 'warn', group: 'lockout',
      when: (m) => m.topHip < T.lockoutHip,
      title: '끝에서 엉덩이를 완전히 펴지 않아요',
      detail: (hit) => `최고점 엉덩이 각도 평균 ${deg(avgOf(hit, 'topHip'))}. 엉덩이를 앞으로 밀어 몸을 곧게 세우며 마무리하세요.`,
    },
    {
      id: 'lean-back', level: 'warn', group: 'lockout',
      when: (m) => m.minTrunk < T.leanBackTrunk,
      title: '마무리에서 상체를 뒤로 젖혀요',
      detail: (hit) => `상체가 수직보다 평균 ${deg(-avgOf(hit, 'minTrunk'))} 뒤로 넘어가요. 엉덩이를 조여 곧게 서는 정도로 마무리하세요.`,
    },
    {
      id: 'hips-first', level: 'warn', group: 'pull',
      when: (m) => m.kneeEarly - m.trunkDrop > T.hipsFirst,
      title: '바닥에서 엉덩이가 먼저 올라와요',
      detail: () => '당기기 초반에 무릎만 먼저 펴지고 상체 각도는 그대로예요. 다리로 바닥을 밀어내며 가슴과 엉덩이가 함께 올라오게 해 보세요.',
    },
    {
      id: 'squatty', level: 'info', group: 'pull',
      when: (m) => m.minKnee < T.squattyKnee,
      title: '무릎을 많이 굽혀요',
      detail: (hit) => `최저점 무릎 각도 평균 ${deg(avgOf(hit, 'minKnee'))}. 스쿼트처럼 당기고 있을 수 있어요. 엉덩이를 뒤로 빼는 힌지 동작을 의식해 보세요.`,
    },
  ],
};

const GOOD = {
  squat: [
    { group: 'depth', title: '깊이가 충분해요', ref: REFS.escamilla, ok: (reps) => reps.every((r) => r.metrics.thighAboveParallel <= THRESHOLDS.squat.nearThigh) },
    { group: 'trunk', title: '상체 각도가 안정적이에요' },
    { group: 'heel', title: '발바닥이 바닥에 잘 붙어 있어요' },
  ],
  deadlift: [
    { group: 'lockout', title: '마무리 자세가 깔끔해요' },
    { group: 'pull', title: '가슴과 엉덩이가 함께 올라와요' },
  ],
};

// 상체–정강이 각도 차이로 엉덩이/무릎 중 어디에 부하가 쏠리는지 [논문 3]
// 잘못된 자세의 기준이 아니므로 경고(warn)로 쓰지 않는다.
export function trunkTibiaBias(reps) {
  const d = mean(reps.map((r) => r.metrics.trunkAtBottom - r.metrics.shinAtBottom));
  if (!isNum(d)) return null;
  const B = THRESHOLDS.squat.trunkTibiaBias;
  if (d > B) return {
    id: 'trunk-bias-hip', level: 'info', group: 'bias', ref: REFS.straub, diff: d,
    title: '엉덩이 위주로 앉아요',
    detail: `최저점에서 상체가 정강이보다 ${deg(d)} 더 기울어요(±10° 밖). 엉덩이 근육 쪽 부하가 큰 자세로, 잘못된 자세는 아니에요. 허벅지 앞쪽을 더 쓰고 싶다면 무릎을 조금 더 앞으로 보내며 상체를 세워 보세요. 무릎이 발끝을 약간 넘는 것은 괜찮아요.`,
  };
  if (d < -B) return {
    id: 'trunk-bias-knee', level: 'info', group: 'bias', ref: `${REFS.straub}, ${REFS.fry}`, diff: d,
    title: '무릎 위주로 앉아요',
    detail: `최저점에서 정강이가 상체보다 ${deg(-d)} 더 기울어요(±10° 밖). 허벅지 앞쪽(대퇴사두) 부하가 큰 자세로, 잘못된 자세는 아니에요. 엉덩이를 더 쓰고 싶다면 엉덩이를 조금 더 뒤로 빼며 앉아 보세요.`,
  };
  return {
    id: 'good-bias', level: 'good', group: 'bias', ref: REFS.straub, diff: d,
    title: '엉덩이와 무릎을 고르게 써요',
    detail: `상체와 정강이 기울기 차이가 ${deg(d)}로 ±10° 안이에요(중립).`,
  };
}

export function evaluateFeedback(exId, reps) {
  if (!reps.length) return [];
  const T = THRESHOLDS[exId];
  const items = [];
  const firedGroups = new Set();
  for (const rule of [...RULES[exId](T), ...CORE_RULES]) {
    const hit = reps.filter((r) => { try { return rule.when(r.metrics) === true; } catch { return false; } });
    if (!hit.length) continue;
    firedGroups.add(rule.group);
    items.push({
      id: rule.id, level: rule.level, title: rule.title, detail: rule.detail(hit), ref: rule.ref || null,
      reps: hit.map((r) => r.index), count: hit.length, total: reps.length,
    });
  }

  if (exId === 'squat') {
    const bias = trunkTibiaBias(reps);
    if (bias) items.push({ ...bias, reps: [], count: 0, total: reps.length });
  }

  if (exId === 'squat' && reps.length >= 3) {
    const sd = std(reps.map((r) => r.metrics.thighAboveParallel));
    if (sd > THRESHOLDS.squat.depthStd) {
      items.push({ id: 'depth-consistency', level: 'info', title: '반복마다 깊이가 달라요', detail: `최저점 허벅지 각도의 편차가 ±${Math.round(sd)}°예요. 같은 깊이를 목표로 일정하게 내려가 보세요.`, ref: null, reps: [], count: 0, total: reps.length });
    }
  }
  const hasBack = reps.some((r) => isNum(r.metrics.backRound));
  if (exId === 'deadlift' && !hasBack) {
    items.push({ id: 'spine-note', level: 'info', title: '허리 굽음은 분석하지 않아요', detail: '관절 33점에는 척추 중간 지점이 없어 허리가 말리는지는 판단할 수 없어요. 거울이나 영상으로 직접 확인하세요.', ref: null, reps: [], count: 0, total: reps.length });
  }

  const goods = [...GOOD[exId], { group: 'core', title: '코어가 안정적이에요', detail: '등 윤곽이 서 있을 때와 비슷하게 유지되고 상체 흔들림도 적어요.', ok: () => hasBack }];
  for (const g of goods) {
    if (firedGroups.has(g.group)) continue;
    if (g.ok && !g.ok(reps)) continue;
    items.push({ id: `good-${g.group}`, level: 'good', title: g.title, detail: g.detail || '', ref: g.ref || null, reps: [], count: 0, total: reps.length });
  }

  const order = { warn: 0, info: 1, good: 2 };
  return items.sort((a, b) => order[a.level] - order[b.level]);
}
