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
  ghasemi: 'Ghasemi 외 (2026)',
  biscarini: 'Biscarini 외 (2013)',
  chenCom: 'Chen 외 (2025)',
  kompf: 'Kompf & Arandjelović (2017)',
  krajewski: 'Krajewski 외 (2019)',
  ramirez: 'Ramirez 외 (2024)',
  cherni: 'Cherni 외 (2026)',
};

export const THRESHOLDS = {
  squat: {
    // 깊이 목표 = 평행(허벅지가 바닥과 수평). [논문 1] 건강한 무릎에는 딥보다 평행 스쿼트를 권함.
    // 15°는 측정 오차(2D 추정)를 감안한 여유 [초깃값]. 2D는 3D보다 엉덩이·허벅지 각도가 3–13° 작게 나옴 [논문 33]
    // 35°는 '얕음' 경계 [초깃값].
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
  deadlift: {
    // 마무리·젖힘·무릎 굽힘 기준은 확인한 논문에 수치가 없음 [초깃값]
    // 뒤로 젖힘 −15°: 처음엔 −10°였으나 실제 측면 영상에서 정상으로 보이는 마무리가 −10~−11°로 나와 경계에 걸림.
    //   2D 각도 오차(3–13°) [논문 33]를 감안해 넓힘 [초깃값]
    lockoutHip: 165, leanBackTrunk: -15, squattyKnee: 100,
    // '엉덩이가 먼저 올라옴' 경고는 쓰지 않음: 데드리프트는 원래 무릎 → 엉덩이 순서로 펴지는 동작 [논문 15, 22]
    // 바닥에서 튕김: 튕기면 당기기 초반에 힘을 기르기 어렵다 [논문 20]. 0.15초 기준은 [초깃값]
    bounce: 0.15,
    // 반복이 진행될수록 등 굽힘 증가: 피로하면 몸통 굽힘이 커짐 [논문 25]. 결론이 갈려 참고로만 [논문 19, 24]
    // 4%p는 등 곡률 기준(core.backRound)과 같은 [초깃값]
    backTrend: 4,
  },
  // 등 곡률·흔들림 [초깃값 · 실험]. 무게를 지면 허리가 어느 정도 굽는 것은 정상일 수 있어 [논문 10]
  // 단정하지 않고 '참고'로만 표시.
  core: { backRound: 4, backArch: -4, wobble: 2.5 },
  // 무게중심 앞뒤 이동: 최저점에서 서 있을 때보다 발 길이의 몇 %만큼 움직였는지.
  // 발 앞·뒤 체중 분배가 관절 부하를 바꿈 [논문 45, 46]. ±25%는 논문에 수치가 없어 [초깃값]
  balance: 0.25,
};

const C = THRESHOLDS.core;
const BAL = THRESHOLDS.balance;
const CORE_RULES = [
  {
    id: 'balance-fwd', level: 'info', group: 'balance', ref: `${REFS.biscarini}, ${REFS.chenCom}`,
    when: (m) => m.comShift > BAL,
    title: '앉을수록 무게중심이 앞으로 쏠려요 (추정)',
    detail: (hit) => `최저점에서 무게중심이 서 있을 때보다 발 길이의 ${Math.round(avgOf(hit, 'comShift') * 100)}%만큼 앞으로 옮겨 가요. 발 앞·뒤 체중 분배에 따라 무릎·엉덩이 부하가 달라진다는 연구가 있어요. 관절 위치로 계산한 추정값이에요.${hit[0]?.metrics.withBar ? ' 입력한 바벨 무게를 포함했어요.' : ' 바벨 무게를 입력하면 바벨까지 포함해 계산해요.'}`,
  },
  {
    id: 'balance-back', level: 'info', group: 'balance', ref: `${REFS.biscarini}, ${REFS.chenCom}`,
    when: (m) => m.comShift < -BAL,
    title: '앉을수록 무게중심이 뒤로 쏠려요 (추정)',
    detail: (hit) => `최저점에서 무게중심이 서 있을 때보다 발 길이의 ${Math.round(-avgOf(hit, 'comShift') * 100)}%만큼 뒤로 옮겨 가요. 뒤로 쏠리면 균형을 잡으려 상체가 더 숙여질 수 있어요. 관절 위치로 계산한 추정값이에요.${hit[0]?.metrics.withBar ? ' 입력한 바벨 무게를 포함했어요.' : ' 바벨 무게를 입력하면 바벨까지 포함해 계산해요.'}`,
  },
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
      id: 'depth-shallow', level: 'warn', group: 'depth', ref: `${REFS.escamilla}, ${REFS.ghasemi}`,
      when: (m) => m.thighAboveParallel > T.shallowThigh,
      title: '깊이가 얕아요',
      // 뒤꿈치 받침은 발목·무릎 가동범위를 늘림(발목은 2.5 cm 이상에서) [논문 36]. 깊이는 무릎 가동범위가 가장 큰 요인 [논문 38]
      detail: (hit) => `최저점에서 허벅지가 수평보다 평균 ${deg(avgOf(hit, 'thighAboveParallel'))} 위에 있어요. 허벅지가 바닥과 평행해질 때까지 앉는 것을 목표로 해 보세요. 발목이 뻣뻣해 깊이 앉기 어렵다면 뒤꿈치 받침(약 2.5 cm 이상)이 발목·무릎 가동범위를 늘린다는 연구가 있어요.`,
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
      id: 'dl-bounce', level: 'info', group: 'pull', ref: REFS.krajewski,
      when: (m) => m.floorPause < T.bounce,
      title: '바닥에서 튕기듯 이어서 당겨요 (참고)',
      detail: () => '바닥에서 멈추지 않고 바로 이어서 당겼어요. 튕기면 당기기 초반에 힘을 기르기 어렵다는 연구가 있어요. 매 반복 바닥에서 잠깐 멈췄다 당겨 보세요.',
    },
    {
      id: 'squatty', level: 'info', group: 'pull',
      when: (m) => (isNum(m.kneeAtBottom) ? m.kneeAtBottom : m.minKnee) < T.squattyKnee,
      title: '무릎을 많이 굽혀요',
      detail: (hit) => `바닥 근처 무릎 각도 평균 ${deg(avgOf(hit, (m) => (isNum(m.kneeAtBottom) ? m.kneeAtBottom : m.minKnee)))}. 스쿼트처럼 당기고 있을 수 있어요. 엉덩이를 뒤로 빼는 힌지 동작을 의식해 보세요.`,
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
    { group: 'pull', title: '바닥에서 멈췄다 당겨요', ok: (reps) => reps.some((r) => isNum(r.metrics.floorPause)) },
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

export function evaluateFeedback(exId, reps, { load = null } = {}) {
  // 데드리프트 무게중심은 바벨 무게를 입력했을 때만 판정 (몸만의 무게중심은 바벨 때문에 뒤로 가는 게 정상)
  const dlBalance = exId === 'deadlift' && load?.barKg > 0;
  if (!reps.length) return [];
  const T = THRESHOLDS[exId];
  const items = [];
  const firedGroups = new Set();
  // 데드리프트는 등 곡률을 반복별 단정 대신 '반복할수록 커지는지'로만 본다 [논문 24, 25]
  // 무게중심(앞뒤)도 쓰지 않는다: 몸만의 무게중심은 바벨 무게와 균형을 맞추려 뒤로 가는 게 정상인데 바벨 무게를 모름
  const core = exId === 'deadlift' ? CORE_RULES.filter((r) => r.id === 'trunk-wobble' || (dlBalance && r.id.startsWith('balance'))) : CORE_RULES;
  for (const rule of [...RULES[exId](T), ...core]) {
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
  if (exId === 'deadlift' && hasBack) {
    const full = reps.filter((r) => isNum(r.metrics.backRound));
    if (full.length >= 3) {
      const first = full[0].metrics.backRound, last = full.at(-1).metrics.backRound;
      if (last - first > T.backTrend) {
        items.push({ id: 'dl-back-trend', level: 'info', group: 'core', title: '반복할수록 등이 더 굽어요 (참고)', ref: `${REFS.ramirez}, ${REFS.cherni}`,
          detail: `첫 반복보다 마지막 반복에서 등 윤곽이 ${(last - first).toFixed(1)}%p 더 둥글어요(실험 기능). 지치면 몸통 굽힘이 커진다는 연구가 있어요. 적당한 굽힘 자체가 문제인지는 연구 결론이 갈려요. 무게나 반복 수를 조절해 보세요.`,
          reps: [full.at(-1).index], count: 1, total: reps.length });
        firedGroups.add('core');
      }
    }
  }
  if (exId === 'deadlift' && !hasBack) {
    items.push({ id: 'spine-note', level: 'info', title: '허리 굽음은 분석하지 않아요', detail: '관절 33점에는 척추 중간 지점이 없어 허리가 말리는지는 판단할 수 없어요. 거울이나 영상으로 직접 확인하세요.', ref: null, reps: [], count: 0, total: reps.length });
  }

  const goods = [...GOOD[exId], { group: 'core', title: '코어가 안정적이에요', detail: '등 윤곽이 서 있을 때와 비슷하게 유지되고 상체 흔들림도 적어요.', ok: () => hasBack },
    { group: 'balance', title: '무게중심이 발 중앙에 있어요', detail: '최저점에서도 무게중심(추정)이 서 있을 때 위치에서 발 길이의 ±25% 안에 있어요.', ok: (rs) => (exId !== 'deadlift' || dlBalance) && rs.some((r) => isNum(r.metrics.comShift)) }];
  for (const g of goods) {
    if (firedGroups.has(g.group)) continue;
    if (g.ok && !g.ok(reps)) continue;
    items.push({ id: `good-${g.group}`, level: 'good', title: g.title, detail: g.detail || '', ref: g.ref || null, reps: [], count: 0, total: reps.length });
  }

  const order = { warn: 0, info: 1, good: 2 };
  return items.sort((a, b) => order[a.level] - order[b.level]);
}
