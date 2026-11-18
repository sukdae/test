// 결과 화면 맨 위에 보여 줄 '이렇게 해 보세요' (행동 위주, 최대 3개)
//
// 피드백 규칙(feedback.js)과 논문 기반 기준 자세의 리듬 비교를 합쳐,
// 설명 대신 바로 따라 할 수 있는 짧은 문장으로 바꿉니다.

import { isNum, josa } from './signal.js';

// 피드백 id → 한 줄 행동 지시
const DO = {
  'depth-shallow': '허벅지가 바닥과 평행해질 때까지 더 앉으세요',
  'depth-near': '조금만 더 깊이 앉아 보세요',
  'hips-first': '올라올 때 가슴과 엉덩이를 같이 올리세요',
  'heel-lift': '뒤꿈치로 바닥을 누르며 앉으세요',
  'fast-descent': '1~2초에 걸쳐 천천히 내려가세요',
  'depth-consistency': '매번 같은 깊이까지 앉으세요',
  'back-round': '내려가기 전에 숨을 들이마시고 배에 힘을 꽉 주세요',
  'back-arch': '갈비뼈를 내리고 허리를 과하게 젖히지 마세요',
  'trunk-wobble': '몸통을 단단히 고정하고 일정한 속도로 움직이세요',
  lockout: '마지막에 엉덩이를 앞으로 밀어 끝까지 펴세요',
  'lean-back': '끝에서 뒤로 젖히지 말고 곧게 서세요',
  squatty: '무릎보다 엉덩이를 뒤로 빼는 느낌으로 숙이세요',
  'balance-fwd': '발 중앙으로 바닥을 누르며 움직이세요',
  'balance-back': '뒤꿈치에만 기대지 말고 발 중앙에 체중을 두세요',
  'dl-bounce': '매 반복 바닥에서 잠깐 멈췄다 당기세요',
  'dl-back-trend': '지치면 무게나 반복 수를 줄여 등 모양을 유지하세요',
  // 정면
  'knee-cave': '무릎을 발끝 방향으로 밀어 벌리세요',
  'hip-shift': '양발에 체중을 고르게 싣고 앉으세요',
  'pelvic-tilt': '골반을 수평으로 유지하세요',
  'side-lean': '몸통을 가운데로 세운 채 앉으세요',
  'side-wobble': '배에 힘을 주고 몸통이 흔들리지 않게 하세요',
  'foot-lift': '양발 전체로 바닥을 누른 채 움직이세요',
};

// 종목별로 문장이 달라야 하는 경우
const DO_EX = { deadlift: { 'side-lean': '몸통을 가운데로 세운 채 당기세요', 'hip-shift': '양발에 체중을 고르게 싣고 당기세요', 'pelvic-tilt': '골반을 수평으로 유지하며 당기세요' } };
const doText = (exId, id) => DO_EX[exId]?.[id] || DO[id];

// 잘한 점 → 짧은 칩
const GOOD = {
  'good-depth': '깊이 충분',
  'good-trunk': '상체 안정',
  'good-heel': '발바닥 고정',
  'good-core': '코어 안정',
  'good-lockout': '마무리 깔끔',
  'good-pull': '바닥에서 멈췄다 당김',
  'good-bias': '엉덩이·무릎 균형',
  'good-knee-track': '무릎 정렬 좋음',
  'good-symmetry': '좌우 균형',
  'good-core-front': '좌우 코어 안정',
  'good-base': '양발 고르게 지탱',
  'good-balance': '무게중심 발 중앙',
};

const repsText = (f) => (f.total > 1 && f.reps.length && f.reps.length < f.total ? `${f.reps.join(', ')}회차` : f.total > 1 ? '모든 반복' : '');

export function buildCoaching(result, { max = 3 } = {}) {
  // 측면 분석인데 정면·대각선으로 찍힌 영상: 자세 지시 대신 다시 찍기를 먼저 안내한다
  if ((result.warnings || []).some((w) => w.startsWith('정면에 가까운 촬영'))) {
    return { actions: [{ text: '옆에서 다시 찍으면 정확하게 볼 수 있어요', tag: '카메라를 몸 옆 2~3m, 허리 높이에', kind: 'retake', reps: [], prio: 0 }], good: [] };
  }
  const actions = [];
  const good = [];
  const used = new Set();

  // 1) 자세 경고 → 행동
  for (const f of result.feedback) {
    if (f.level === 'good') { if (GOOD[f.id]) good.push(GOOD[f.id]); else if (f.id === 'stance') good.push(f.title.split(' (')[0]); continue; }
    if (f.level !== 'warn' || !DO[f.id]) continue;
    actions.push({ text: doText(result.exercise, f.id), tag: repsText(f), kind: 'form', reps: f.reps, prio: 0 });
    used.add(f.id);
  }

  // 2) 기준 자세의 리듬과 비교 → 행동
  //    깊이는 feedback.js 의 평행 기준 규칙(Escamilla 2001)이 맡으므로 여기서 다루지 않는다.
  const ref = result.reference;
  const label = ref?.short;
  const mt = result.tempo || {}, rt = ref?.tempo;
  if (label && rt && isNum(mt.descent) && isNum(rt.descent)) {
    const d = mt.descent - rt.descent;
    if (d < -0.25 && !used.has('fast-descent')) actions.push({ text: `${rt.descent.toFixed(1)}초에 걸쳐 내려가세요`, tag: `${label} ${rt.descent.toFixed(1)}초 · 나 ${mt.descent.toFixed(1)}초`, kind: 'pro', prio: 2 });
    else if (Math.abs(d) <= 0.2) good.push(`내려가는 속도 ${josa(label, '과', '와')} 비슷`);
  }
  if (label && rt && isNum(mt.ascent) && isNum(rt.ascent)) {
    const d = mt.ascent - rt.ascent;
    if (d > 0.3) actions.push({ text: '바닥을 더 힘차게 밀며 올라오세요', tag: `${label} ${rt.ascent.toFixed(1)}초 · 나 ${mt.ascent.toFixed(1)}초`, kind: 'pro', prio: 2 });
    else if (Math.abs(d) <= 0.2) good.push(`올라오는 속도 ${josa(label, '과', '와')} 비슷`);
  }
  // 바닥 멈춤 시간은 논문 근거가 없고 측정도 불안정해 행동 지시로 쓰지 않는다(비교표에만 표시).

  // 3) 자세 경고가 없으면 정보성 피드백 중 행동 가능한 것
  if (!actions.length) {
    for (const f of result.feedback) {
      if (f.level === 'info' && DO[f.id]) actions.push({ text: doText(result.exercise, f.id), tag: repsText(f), kind: 'form', reps: f.reps, prio: 4 });
    }
  }

  actions.sort((a, b) => a.prio - b.prio);
  return { actions: actions.slice(0, max), more: Math.max(0, actions.length - max), good, all: actions };
}

// 측면 + 정면 결과를 합친 코칭 (경고 우선, 최대 max개)
export function mergeCoaching(side, front, { max = 3 } = {}) {
  const a = side ? buildCoaching(side, { max: 99 }) : { all: [], good: [] };
  const b = front ? buildCoaching(front, { max: 99 }) : { all: [], good: [] };
  const tag = (x, view) => ({ ...x, view });
  // 같은 우선순위 안에서는 측면·정면을 번갈아 놓아 한쪽 문제만 보이지 않게 한다.
  const sa = a.all.map((x) => tag(x, 'side')), fa = b.all.map((x) => tag(x, 'front'));
  const prios = [...new Set([...sa, ...fa].map((x) => x.prio))].sort((x, y) => x - y);
  const all = [];
  for (const p of prios) {
    const s1 = sa.filter((x) => x.prio === p), f1 = fa.filter((x) => x.prio === p);
    for (let i = 0; i < Math.max(s1.length, f1.length); i++) { if (s1[i]) all.push(s1[i]); if (f1[i]) all.push(f1[i]); }
  }
  return { actions: all.slice(0, max), more: Math.max(0, all.length - max), good: [...new Set([...a.good, ...b.good])] };
}

// 측면·정면 영상이 같은 세트인지 검사. 많이 다르면 경고 문구를 돌려준다.
// 두 분석은 서로 독립이라 결과 자체는 유효하지만, '같은 세트를 두 방향에서 본 것'이라는 전제가 깨진다.
// 기준값은 [초깃값].
export function compareViews(side, front) {
  const out = [];
  if (!side || !front) return out;
  if (side.exercise !== front.exercise) out.push('두 영상의 종목이 달라요.');
  const ns = side.reps.length, nf = front.reps.length;
  if (ns && nf && Math.abs(ns - nf) > 1) out.push(`반복 수가 달라요(측면 ${ns}회, 정면 ${nf}회). 같은 세트가 아니라면 결과를 따로 보세요.`);
  const a = side.tempo, b = front.tempo;
  const far = (x, y, lim) => isNum(x) && isNum(y) && Math.abs(x - y) > lim;
  if (a && b && (far(a.descent, b.descent, 0.6) || far(a.ascent, b.ascent, 0.6))) {
    out.push(`리듬이 많이 달라요(내려가기 측면 ${a.descent.toFixed(1)}초, 정면 ${b.descent.toFixed(1)}초). 다른 세트이거나 무게가 다를 수 있어요.`);
  }
  if (out.length) out.push('측면·정면 결과는 각각은 정확하지만, 같은 동작으로 보고 합치지는 마세요. 가능하면 같은 세트를 폰 두 대로 동시에 찍거나, 같은 무게·같은 리듬으로 연달아 찍어 주세요.');
  return out;
}
