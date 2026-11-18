// 정면 분석: 무릎 정렬(안으로 모임), 좌우 대칭(골반 기울기·엉덩이 쏠림), 스탠스 너비
//
// 입력은 측면 분석과 같은 { frames, width, height }. 사람은 카메라를 마주 보고 섭니다.
// 근거 표기는 feedback.js 와 같습니다: [논문 n] / [초깃값]. 번호는 docs/참고문헌.md.

import { fillGaps, smooth, median, mean, percentile, isNum, rangeMin, rangeMax, argmin, std } from './signal.js';
import { segmentReps } from './reps.js';
import { bottomPause, cleanReps } from './reference.js';
import { dist, DEG } from './geometry.js';
import { visOf } from './landmarks.js';
import { idealFront } from './exercises.js';

const L = { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, foot: 31 };
const R = { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, foot: 32 };

export const FRONT_THRESHOLDS = {
  // 무릎 간격 / 발목 간격 (최저점). 참고 표시용 — 넓은 스탠스에서는 정상 자세도 0.8 아래로 나와(실제 영상 확인)
  // 판정에는 쓰지 않는다. [초깃값]
  kneeAnkleRatio: 0.8,
  // 무릎 모임 판정: 무릎이 엉덩이–발목 선보다 안쪽으로 들어간 정도 / 다리 길이 [초깃값]
  kneeInward: 0.04,
  // 골반 좌우 기울기(도) [초깃값]
  pelvicTilt: 5,
  // 엉덩이 중심이 발 중심에서 옆으로 벗어난 정도 / 스탠스 너비 [초깃값]
  hipShift: 0.15,
  // 상체 옆 기울기(도, 서 있을 때 대비) [초깃값]
  sideLean: 5,
  // 좌우 흔들림(도, 동작 흐름 대비 떨림) [초깃값]
  sideWobble: 2.5,
  // 발 뜸: 한쪽 발목이 다른 쪽보다 올라간 정도 / 다리 길이 [초깃값]
  footLift: 0.04,
  // 스탠스 너비 구간: 어깨너비 대비 좁음 75–100%, 중간 100–150%, 넓음 150–200% [논문 3]
  stance: { narrow: 1.0, wide: 1.5 },
};

const SERIES = ['height', 'kneeRatio', 'inL', 'inR', 'tilt', 'shift', 'lean', 'ankleLY', 'ankleRY'];

const P = (lm, i, W, H) => { const p = lm?.[i]; return p && visOf(p) >= 0.5 ? { x: p.x * W, y: p.y * H } : null; };

// 무릎이 엉덩이–발목 직선에서 몸 중심선 쪽(안쪽)으로 들어간 거리 (양수 = 안쪽)
// 허벅지가 화면에서 거의 수평이 되면(깊은 스쿼트, 무릎이 엉덩이 높이 근처나 위) 직선 위 위치를 잴 수 없어
// NaN을 돌려준다. 이 구간은 앞뒤 프레임 값으로 채운다. (실제 영상: 평행보다 깊은 스쿼트에서 무릎 모임 오탐)
export function inward(hip, knee, ankle, midX) {
  const t = (knee.y - hip.y) / ((ankle.y - hip.y) || 1);
  if (!(t >= 0.25 && t <= 1.05)) return NaN;
  const lineX = hip.x + (ankle.x - hip.x) * t;
  const toward = Math.sign(midX - lineX) || 1;
  return (knee.x - lineX) * toward;
}

export function analyzeFront({ frames, width: W, height: H }, exId) {
  const n = frames.length;
  const t = frames.map((f) => f.t);
  const raw = Object.fromEntries(SERIES.map((k) => [k, new Array(n).fill(NaN)]));
  const legs = [], shoulderW = [], stanceW = [], sideRatio = [];
  let valid = 0;

  frames.forEach((f, i) => {
    const lm = f.lm;
    if (!lm) return;
    const g = (k, side) => P(lm, side[k], W, H);
    const hl = g('hip', L), hr = g('hip', R), kl = g('knee', L), kr = g('knee', R), al = g('ankle', L), ar = g('ankle', R);
    const sl = g('shoulder', L), sr = g('shoulder', R);
    if (!hl || !hr || !kl || !kr || !al || !ar) return;
    valid++;
    const hipMid = { x: (hl.x + hr.x) / 2, y: (hl.y + hr.y) / 2 };
    const ankleMid = { x: (al.x + ar.x) / 2, y: (al.y + ar.y) / 2 };
    const leg = (dist(hl, kl) + dist(kl, al) + dist(hr, kr) + dist(kr, ar)) / 2;
    legs.push(leg);
    const stance = Math.abs(al.x - ar.x);
    stanceW.push(stance);
    raw.ankleLY[i] = al.y; raw.ankleRY[i] = ar.y;
    if (sl && sr) {
      shoulderW.push(Math.abs(sl.x - sr.x));
      const sm = { x: (sl.x + sr.x) / 2, y: (sl.y + sr.y) / 2 };
      // 상체 옆 기울기: 엉덩이 중심→어깨 중심 선이 수직에서 사람의 왼쪽으로 기운 각도(양수)
      raw.lean[i] = Math.atan2((sm.x - hipMid.x) * (Math.sign(al.x - ar.x) || 1), hipMid.y - sm.y) * DEG;
      const torso = dist({ x: (sl.x + sr.x) / 2, y: (sl.y + sr.y) / 2 }, hipMid);
      if (torso > 0) sideRatio.push(Math.abs(sl.x - sr.x) / torso);
    }
    raw.height[i] = (ankleMid.y - hipMid.y);
    raw.kneeRatio[i] = Math.abs(kl.x - kr.x) / (stance || 1);
    const midX = (hipMid.x + ankleMid.x) / 2;
    raw.inL[i] = inward(hl, kl, al, midX);
    raw.inR[i] = inward(hr, kr, ar, midX);
    // 골반 기울기: 사람의 왼쪽 엉덩이가 낮으면 양수
    raw.tilt[i] = Math.atan2(hl.y - hr.y, Math.abs(hl.x - hr.x) || 1) * DEG;
    // 엉덩이 쏠림: 사람의 왼쪽 방향이 양수 (왼발 쪽으로 쏠림)
    const leftDir = Math.sign(al.x - ar.x) || 1;
    raw.shift[i] = ((hipMid.x - ankleMid.x) * leftDir) / (stance || 1);
  });

  const legLen = median(legs);
  const duration = n > 1 ? t[n - 1] - t[0] : 0;
  const fps = duration > 0 ? (n - 1) / duration : 15;
  let win = Math.max(3, Math.round(fps * 0.2));
  if (win % 2 === 0) win++;
  const s = {};
  for (const k of SERIES) s[k] = smooth(fillGaps(raw[k]), win);
  // 높이 신호: 다리 길이 대비 % (서 있을 때 약 90~100, 앉을수록 감소) → 측면 각도 신호처럼 반복 분할
  s.height = s.height.map((v) => (isNum(v) && legLen ? (v / legLen) * 100 : NaN));
  s.inL = s.inL.map((v) => (isNum(v) ? v / legLen : NaN));
  s.inR = s.inR.map((v) => (isNum(v) ? v / legLen : NaN));

  const coverage = n ? valid / n : 0;
  const reps = (valid >= 3 ? segmentReps(s.height, t, { drop: 25 }) : []).map((r, idx) => {
    const bottom = argmin(s.height, r.start, r.end);
    const rep = { index: idx + 1, ...r, bottom };
    const w = Math.max(1, Math.round((r.end - r.start) * 0.15));
    const a = Math.max(r.start, bottom - w), b = Math.min(r.end, bottom + w);
    const inL = rangeMax(s.inL, a, b), inR = rangeMax(s.inR, a, b);
    const tiltAt = median(s.tilt.slice(a, b + 1));
    const shiftAt = median(s.shift.slice(a, b + 1));
    rep.metrics = {
      kneeRatio: rangeMin(s.kneeRatio, a, b),
      kneeInL: inL, kneeInR: inR, kneeIn: Math.max(inL, inR),
      tilt: tiltAt, shift: shiftAt,
      depthPct: s.height[bottom],
      descent: r.partialStart ? NaN : t[bottom] - t[r.start],
      ascent: r.partialEnd ? NaN : t[r.end] - t[bottom],
    };
    return rep;
  });

  // 서 있을 때 기준 쏠림·기울기를 0으로 (카메라가 살짝 비뚤어진 영향 제거)
  const topFrames = s.height.map((v, i) => i).filter((i) => s.height[i] >= percentile(s.height, 0.8));
  const tilt0 = median(topFrames.map((i) => s.tilt[i]));
  const shift0 = median(topFrames.map((i) => s.shift[i]));
  for (const r of reps) {
    if (isNum(tilt0)) r.metrics.tilt -= tilt0;
    if (isNum(shift0)) r.metrics.shift -= shift0;
  }
  s.tiltRel = s.tilt.map((v) => (isNum(v) && isNum(tilt0) ? v - tilt0 : v));
  const lean0 = median(topFrames.map((i) => s.lean[i]));
  s.leanRel = s.lean.map((v) => (isNum(v) && isNum(lean0) ? v - lean0 : v));
  // 발 뜸: 한쪽 발목이 다른 쪽보다 올라간 정도(서 있을 때 차이를 0으로).
  // 정면에서는 앉을 때 정강이가 카메라 쪽으로 기울며 양 발목 점이 함께 올라가 보이는 착시가 있어(실제 영상 확인)
  // 절대 높이가 아니라 좌우 차이로 판정한다. 그래서 양발 뒤꿈치 들림은 측면 분석이 맡는다.
  const dLR = s.ankleLY.map((v, i) => (isNum(v) && isNum(s.ankleRY[i]) ? v - s.ankleRY[i] : NaN));
  const d0 = median(topFrames.map((i) => dLR[i]));
  s.liftL = dLR.map((v) => (isNum(v) && isNum(d0) ? Math.max(0, -(v - d0) / legLen) : NaN));
  s.liftR = dLR.map((v) => (isNum(v) && isNum(d0) ? Math.max(0, (v - d0) / legLen) : NaN));
  const leanTrend = smooth(s.leanRel, Math.max(5, Math.round(fps * 0.6)) | 1);
  for (const r of reps) {
    const lw = s.leanRel.slice(r.start, r.end + 1), tw = leanTrend.slice(r.start, r.end + 1);
    r.metrics.sideLean = lw.reduce((m, v) => (isNum(v) && Math.abs(v) > Math.abs(m) ? v : m), 0);
    r.metrics.sideWobble = Math.sqrt(mean(lw.map((v, k) => (isNum(v) && isNum(tw[k]) ? (v - tw[k]) ** 2 : NaN))));
    r.metrics.liftL = rangeMax(s.liftL, r.start, r.end);
    r.metrics.liftR = rangeMax(s.liftR, r.start, r.end);
    r.metrics.leftPct = weightLeftPct(r.metrics.shift);
  }
  s.shiftRel = s.shift.map((v) => (isNum(v) && isNum(shift0) ? v - shift0 : v));
  s.leftPct = s.shiftRel.map(weightLeftPct);

  // 스탠스 너비 (어깨 관절 간격 대비) — 서 있을 때 기준
  const stanceRatio = median(stanceW) / (median(shoulderW) || NaN);
  const T = FRONT_THRESHOLDS.stance;
  const D = idealFront('deadlift');
  const stance = !isNum(stanceRatio) ? null
    : exId === 'deadlift'
      ? { ratio: stanceRatio, category: stanceRatio >= D.sumoFrom ? '스모' : stanceRatio > D.stance.max ? '넓은 컨벤셔널' : stanceRatio < D.stance.min ? '좁음' : '컨벤셔널' }
      : { ratio: stanceRatio, category: stanceRatio < T.narrow ? '좁음' : stanceRatio <= T.wide ? '중간' : '넓음' };

  const warnings = [];
  if (!valid) warnings.push('양쪽 다리를 인식하지 못했어요. 정면에서 전신이 보이게 찍어 주세요.');
  else if (coverage < 0.7) warnings.push(`관절 인식률이 낮아요(${Math.round(coverage * 100)}%). 정면에서 전신이 보이게 찍어 주세요.`);
  if (sideRatio.length && median(sideRatio) < 0.35) warnings.push('측면에 가까운 촬영으로 보여요. 정면 분석은 카메라를 마주 보고 찍어야 정확해요.');
  if (valid && !reps.length) warnings.push('반복 동작을 찾지 못했어요. 한 세트 전체가 담긴 영상인지 확인해 주세요.');

  const good = reps.length >= 2 ? cleanReps(reps, t) : reps;
  const tempo = good.length ? {
    descent: median(good.map((r) => t[r.bottom] - t[r.start])),
    bottom: median(good.map((r) => bottomPause(s.height, t, r, 3))),
    ascent: median(good.map((r) => t[r.end] - t[r.bottom])),
    interval: good.length > 1 ? median(good.slice(1).map((r, i) => t[r.bottom] - t[good[i].bottom])) : NaN,
  } : null;

  const m = (k) => mean(reps.map((r) => r.metrics[k]));
  const summary = {
    reps: reps.length, kneeRatio: m('kneeRatio'), kneeIn: m('kneeIn'), kneeInL: m('kneeInL'), kneeInR: m('kneeInR'),
    tilt: m('tilt'), shift: m('shift'), depthPct: m('depthPct'),
    sideLean: m('sideLean'), sideWobble: m('sideWobble'), liftL: m('liftL'), liftR: m('liftR'), leftPct: m('leftPct'),
    depthStd: reps.length > 1 ? std(reps.map((r) => r.metrics.depthPct)) : 0,
  };

  return {
    version: 1, view: 'front', exercise: exId, width: W, height: H, fps, duration, coverage,
    t, series: s, frames, legLen, reps, stance, tempo, summary, warnings,
    feedback: frontFeedback(reps, stance, exId),
  };
}

// 양발 체중 분배(추정): 엉덩이 중심이 양발 가운데에서 스탠스 너비의 x만큼 왼쪽이면 왼발 50+100x %
export const weightLeftPct = (shift) => (isNum(shift) ? Math.max(0, Math.min(100, 50 + shift * 100)) : NaN);

const ftxt = (v) => `${Math.round(v * 100)}%`;
const sideName = (v) => (v > 0 ? '왼쪽' : '오른쪽');

export function frontFeedback(reps, stance, exId = 'squat') {
  const T = FRONT_THRESHOLDS;
  const items = [];
  if (!reps.length) return items;
  const total = reps.length;
  const add = (id, level, title, detail, hit, ref = null) => items.push({ id, level, title, detail, ref, reps: hit.map((r) => r.index), count: hit.length, total });

  const cave = reps.filter((r) => r.metrics.kneeIn > T.kneeInward);
  if (cave.length) {
    const inL = mean(cave.map((r) => r.metrics.kneeInL)), inR = mean(cave.map((r) => r.metrics.kneeInR));
    const which = inL > T.kneeInward && inR > T.kneeInward ? '양쪽 무릎' : inL >= inR ? '왼쪽 무릎' : '오른쪽 무릎';
    // 경고가 아닌 참고: 2D 정면 무릎 측정은 3D와 상관이 낮다(r = 0.20) [논문 29]. 2D 방법끼리는 잘 맞음 [논문 30]
    add('knee-cave', 'info', `${which}이 안쪽으로 모여 보여요 (2D 추정)`,
      `최저점에서 무릎이 엉덩이–발목을 잇는 선보다 안쪽으로 들어가 보여요(다리 길이의 ${ftxt(Math.max(inL, inR))}). 정면 2D 영상의 무릎 측정은 실제 3D 움직임과 차이가 클 수 있어 참고로만 봐 주세요. 무릎이 발끝과 같은 방향을 향하게 해 보세요.`, cave, 'Haberkamp 외 (2022), Janisch 외 (2026)');
  }
  const shift = reps.filter((r) => Math.abs(r.metrics.shift) > T.hipShift);
  if (shift.length) {
    const d = mean(shift.map((r) => r.metrics.shift));
    add('hip-shift', 'warn', `엉덩이가 ${sideName(d)}으로 쏠려요`,
      `최저점에서 엉덩이 중심이 양발 가운데보다 스탠스 너비의 ${ftxt(Math.abs(d))}만큼 ${sideName(d)}으로 치우쳐요. 양발에 체중을 고르게 실어 보세요.`, shift);
  }
  const tilt = reps.filter((r) => Math.abs(r.metrics.tilt) > T.pelvicTilt);
  if (tilt.length) {
    const d = mean(tilt.map((r) => r.metrics.tilt));
    add('pelvic-tilt', 'info', `골반이 ${sideName(d)}으로 기울어요`,
      `최저점에서 골반이 서 있을 때보다 ${Math.round(Math.abs(d))}° 기울어요(사람 기준 ${sideName(d)}이 낮음). 골반을 수평으로 유지해 보세요.`, tilt);
  }
  const lean = reps.filter((r) => Math.abs(r.metrics.sideLean) > T.sideLean);
  if (lean.length) {
    const d = mean(lean.map((r) => r.metrics.sideLean));
    add('side-lean', 'warn', `상체가 ${sideName(d)}으로 기울어요`, `앉는 동안 상체가 서 있을 때보다 ${sideName(d)}으로 최대 ${Math.round(Math.abs(d))}° 기울어요. 몸통을 가운데로 세운 채 앉아 보세요.`, lean);
  }
  const wob = reps.filter((r) => r.metrics.sideWobble > T.sideWobble);
  if (wob.length) add('side-wobble', 'info', '상체가 좌우로 흔들려요', `동작 흐름에서 벗어난 좌우 흔들림이 평균 ±${mean(wob.map((r) => r.metrics.sideWobble)).toFixed(1)}°예요. 배에 힘을 주고 몸통을 고정해 보세요.`, wob);
  const liftL = reps.filter((r) => r.metrics.liftL > T.footLift), liftR = reps.filter((r) => r.metrics.liftR > T.footLift);
  if (liftL.length || liftR.length) {
    const which = liftL.length >= liftR.length ? '왼발' : '오른발';
    const hit = [...new Set([...liftL, ...liftR])].sort((a, b) => a.index - b.index);
    add('foot-lift', 'warn', `${which}이 바닥에서 떠요`, '앉거나 일어날 때 한쪽 발이 다른 발보다 올라가요. 양발 전체로 바닥을 누른 채 움직여 보세요. (양발 뒤꿈치 들림은 측면 분석에서 확인해요.)', hit);
  }
  if (stance && exId === 'deadlift') {
    const pct = Math.round(stance.ratio * 100);
    const ref = 'Kompf & Arandjelović (2017), Escamilla 외 (2000)';
    if (stance.category === '스모') add('dl-sumo', 'info', '스모 스타일로 보여요', `발 간격이 어깨 관절 간격의 약 ${pct}%예요. 스모는 컨벤셔널보다 2–3배 넓은 스탠스를 써요. 측면 판정은 아직 컨벤셔널 기준이라 참고만 해 주세요.`, [], ref);
    else add('stance', 'good', `스탠스 ${stance.category} (어깨 대비 약 ${pct}%)`, '컨벤셔널은 대략 어깨너비, 스모는 2–3배 넓어요. 어깨 관절 위치로 잰 추정값이에요.', [], ref);
  } else if (stance) {
    const pct = Math.round(stance.ratio * 100);
    if (stance.category === '넓음') add('stance-wide', 'info', '스탠스가 넓어요', `발 간격이 어깨 관절 간격의 약 ${pct}%예요(넓음: 150% 초과). 넓은 스탠스는 무릎 외반 모멘트를 높일 수 있다는 보고가 있어요. 어깨 관절 위치로 잰 추정값이라 실제보다 넓게 나올 수 있어요.`, [], 'Straub & Powers (2024)');
    else add('stance', 'good', `스탠스 ${stance.category} (어깨 대비 약 ${pct}%)`, '좁음 75–100%, 중간 100–150%, 넓음 150–200% 기준이에요. 어깨 관절 위치로 잰 추정값이에요.', [], 'Straub & Powers (2024)');
  }
  if (!cave.length) add('good-knee-track', 'good', '무릎이 발끝 방향으로 잘 정렬돼요', '', []);
  if (!shift.length && !tilt.length) add('good-symmetry', 'good', '좌우 균형이 좋아요', '', []);
  if (!lean.length && !wob.length) add('good-core-front', 'good', '몸통이 좌우로 안정적이에요', '', []);
  if (!liftL.length && !liftR.length && !shift.length) add('good-base', 'good', '양발로 바닥을 고르게 지탱해요', '', []);
  const order = { warn: 0, info: 1, good: 2 };
  return items.sort((a, b) => order[a.level] - order[b.level]);
}

// '나 vs 기준' (정면): 논문 기반 정면 기준 자세와 비교. ok = 기준 범위 안
export function compareFrontIdeal(fr, ideal) {
  const T = FRONT_THRESHOLDS, m = fr.summary || {};
  const rows = [];
  const add = (key, label, me, refText, ok, basis) => rows.push({ key, label, me, refText, ok: isNum(me) || key === 'stance' ? ok : null, basis });
  const st = fr.stance?.ratio;
  add('stance', '스탠스 너비', st, `${Math.round(ideal.stance.min * 100)}–${Math.round(ideal.stance.max * 100)}%`,
    isNum(st) ? st >= ideal.stance.min && st <= ideal.stance.max : null, ideal.basis.stance);
  const kin = Math.max(m.kneeInL ?? NaN, m.kneeInR ?? NaN);
  add('knee', '무릎 정렬', kin, '0%', kin <= T.kneeInward, ideal.basis.knee);
  add('tilt', '골반 기울기', isNum(m.tilt) ? Math.abs(m.tilt) : NaN, '0°', Math.abs(m.tilt) <= T.pelvicTilt, ideal.basis.symmetry);
  add('shift', '엉덩이 쏠림', isNum(m.shift) ? Math.abs(m.shift) : NaN, '0%', Math.abs(m.shift) <= T.hipShift, ideal.basis.symmetry);
  add('lean', '상체 옆 기울기', isNum(m.sideLean) ? Math.abs(m.sideLean) : NaN, '0°', Math.abs(m.sideLean) <= T.sideLean, ideal.basis.symmetry);
  add('weight', '체중 왼:오', m.leftPct, '50 : 50', Math.abs(m.leftPct - 50) <= T.hipShift * 100, ideal.basis.symmetry);
  return rows;
}
