// 분석 파이프라인: 프레임별 관절점 → 각도 시계열 → 반복 분할 → 지표 → 비교 → 피드백
//
// 입력: { frames: [{ t: 초, lm: [{x,y,v}] (정규화 좌표 33점) | null }], width, height }
// 이 모듈은 DOM에 의존하지 않으므로 네이티브 앱으로 옮길 때 그대로 포팅할 수 있습니다.

import { SIDES, chooseSide, toPoints, detectFacing, visOf } from './landmarks.js';
import { leanFromVertical, dist, kneeAngle, hipAngle } from './geometry.js';
import { fillGaps, smooth, median, percentile, mean, std, isNum, rangeMin, rangeMax, argmin } from './signal.js';
import { segmentReps } from './reps.js';
import { alignRep, topDiffs } from './compare.js';
import { evaluateFeedback } from './feedback.js';
import { estimateMuscles } from './muscles.js';
import { EXERCISES, getReference } from './exercises.js';
import { tempoOf, cleanReps } from './reference.js';
import { backCurvature } from './back.js';

export const SERIES_KEYS = ['knee', 'hip', 'trunk', 'shin', 'thigh', 'hipX', 'hipY', 'kneeX', 'kneeY', 'midX', 'heelRel', 'ankleX', 'ankleY', 'backCurv'];

export function analyzeSession({ frames, width, height }, exId, { referenceId } = {}) {
  const cfg = EXERCISES[exId];
  if (!cfg) throw new Error(`알 수 없는 종목: ${exId}`);
  const ref = getReference(exId, referenceId);
  const refProfile = ref?.curves ? ref : null;
  const n = frames.length;
  const t = frames.map((f) => f.t);
  const side = chooseSide(frames);
  const K = SIDES[side];
  const P = frames.map((f) => toPoints(f.lm, K, width, height));
  const facing = detectFacing(P);

  const raw = Object.fromEntries(SERIES_KEYS.map((k) => [k, new Array(n).fill(NaN)]));
  const lens = { shin: [], thigh: [], torso: [], neck: [] };
  let valid = 0;

  P.forEach((p, i) => {
    if (!p || !p.ok) return;
    valid++;
    const shin = leanFromVertical(p.ankle, p.knee, facing);
    const thigh = leanFromVertical(p.knee, p.hip, facing);
    const trunk = leanFromVertical(p.hip, p.shoulder, facing);
    raw.shin[i] = shin; raw.thigh[i] = thigh; raw.trunk[i] = trunk;
    raw.knee[i] = kneeAngle(shin, thigh);
    raw.hip[i] = hipAngle(trunk, thigh);
    raw.hipX[i] = p.hip.x; raw.hipY[i] = p.hip.y;
    raw.kneeX[i] = p.knee.x; raw.kneeY[i] = p.knee.y;
    raw.ankleX[i] = p.ankle.x; raw.ankleY[i] = p.ankle.y;
    if (p.heel && p.foot) { raw.midX[i] = (p.heel.x + p.foot.x) / 2; raw.heelRel[i] = p.heel.y - p.foot.y; }
    else raw.midX[i] = p.ankle.x + facing * 0.05 * dist(p.ankle, p.knee);
    lens.shin.push(dist(p.ankle, p.knee));
    lens.thigh.push(dist(p.knee, p.hip));
    lens.torso.push(dist(p.hip, p.shoulder));
    if (p.ear) lens.neck.push(dist(p.shoulder, p.ear));
    raw.backCurv[i] = backCurvature(frames[i].back, facing);
  });

  const duration = n > 1 ? t[n - 1] - t[0] : 0;
  const fps = duration > 0 ? (n - 1) / duration : 15;
  let win = Math.max(3, Math.round(fps * 0.2));
  if (win % 2 === 0) win++;
  const s = {};
  for (const k of SERIES_KEYS) s[k] = smooth(fillGaps(raw[k]), k === 'backCurv' ? win * 2 + 1 : win);

  const coverage = n ? valid / n : 0;
  const torso = median(lens.torso);
  const body = {
    shin: median(lens.shin), thigh: median(lens.thigh), torso,
    neck: median(lens.neck) || torso * 0.3, facing, side,
  };
  const legLen = body.shin + body.thigh;

  const rawReps = valid >= 3 ? segmentReps(s[cfg.repSignal], t, { drop: cfg.repDrop }) : [];
  // 뒤꿈치 높이는 발끝 대비 상대값으로 본다(발목이 굽을 때 발 전체 점이 흔들리는 노이즈 제거).
  const heelBase = median(s.heelRel);
  // 반복 끝 보정: 기준 신호만 꼭대기에 닿고 다른 관절은 아직 펴지는 중이면(예: 엉덩이가 먼저 올라오는 스쿼트)
  // 무릎·엉덩이가 모두 꼭대기 근처에 닿거나 더 이상 펴지지 않을 때까지 끝을 늦춘다.
  const kTop = percentile(s.knee, 0.9), hTop = percentile(s.hip, 0.9);
  const lag = Math.max(2, Math.round(fps * 0.2));
  rawReps.forEach((r, idx) => {
    if (r.partialEnd) return;
    const limit = idx + 1 < rawReps.length ? rawReps[idx + 1].start : n - 1;
    let e = r.end;
    while (e < limit) {
      const atTop = s.knee[e] >= kTop - 8 && s.hip[e] >= hTop - 8;
      const j = Math.min(limit, e + lag);
      const rising = s.knee[j] - s.knee[e] > 1.5 || s.hip[j] - s.hip[e] > 1.5;
      if (atTop || !rising) break;
      e++;
    }
    r.end = e;
  });

  // 상체 흔들림: 짧은 스무딩 곡선과 긴(약 0.6초) 스무딩 곡선의 차이 = 동작 흐름에서 벗어난 떨림
  let bigWin = Math.max(5, Math.round(fps * 0.6));
  if (bigWin % 2 === 0) bigWin++;
  const trunkTrend = smooth(s.trunk, bigWin);
  // 등 곡률 변화: 서 있는 구간(기준 신호가 꼭대기 근처)의 곡률을 0으로 둔다.
  const sigTop = percentile(s[cfg.repSignal], 0.9);
  const backBase = median(s.backCurv.filter((v, i) => s[cfg.repSignal][i] >= sigTop - 8));
  s.backDelta = s.backCurv.map((v) => (isNum(v) && isNum(backBase) ? v - backBase : NaN));

  const reps = rawReps.map((r, idx) => {
    const bottom = argmin(s[cfg.repSignal], r.start, r.end);
    const rep = { index: idx + 1, ...r, bottom };
    rep.metrics = repMetrics(rep, s, t, legLen, heelBase, trunkTrend);
    Object.assign(rep, alignRep(exId, rep, s, 50, refProfile));
    return rep;
  });

  const warnings = qualityWarnings({ coverage, frames, width, height, torso, reps, duration, n });
  const summary = summarize(reps);
  const goodReps = reps.length >= 2 ? cleanReps(reps, t) : reps;
  const tempo = goodReps.length ? tempoOf({ series: s, t, exercise: exId }, goodReps) : null;

  return {
    version: 1,
    exercise: exId,
    width, height, side, facing, fps, duration, coverage,
    t, series: s, frames, body,
    reps,
    feedback: evaluateFeedback(exId, reps),
    muscles: estimateMuscles(exId, reps),
    diffs: topDiffs(reps, { label: ref?.short || '기준' }),
    tempo,
    reference: ref ? { id: ref.id, name: ref.name, short: ref.short, note: ref.note || null, tempo: ref.tempo || null, metrics: ref.metrics || null } : null,
    summary,
    warnings,
  };
}

function repMetrics(r, s, t, legLen, heelBase, trunkTrend) {
  const { start, end, bottom: b } = r;
  const w = Math.min(end, b + Math.max(1, Math.round(0.3 * (end - b))));
  const minHeelRel = rangeMin(s.heelRel, start, end);
  return {
    minKnee: rangeMin(s.knee, start, end),
    minHip: rangeMin(s.hip, start, end),
    maxTrunk: rangeMax(s.trunk, start, end),
    minTrunk: rangeMin(s.trunk, b, end),
    topHip: rangeMax(s.hip, b, end),
    trunkAtBottom: s.trunk[b],
    shinAtBottom: s.shin[b],
    hipBelowKnee: s.hipY[b] >= s.kneeY[b],
    heelLift: isNum(heelBase) && isNum(minHeelRel) ? Math.max(0, (heelBase - minHeelRel) / legLen) : 0,
    // 허벅지가 수평보다 몇 도 위에 있는지 (0 = 평행, 음수 = 평행 아래)
    thighAboveParallel: 90 + rangeMin(s.thigh, start, end),
    descent: r.partialStart ? NaN : t[b] - t[start],
    ascent: r.partialEnd ? NaN : t[end] - t[b],
    trunkEarly: s.trunk[w] - s.trunk[b],
    trunkDrop: s.trunk[b] - s.trunk[w],
    kneeEarly: s.knee[w] - s.knee[b],
    kneeArm: Math.abs(s.kneeX[b] - s.midX[b]) / legLen,
    hipArm: Math.abs(s.hipX[b] - s.midX[b]) / legLen,
    trunkWobble: rms(s.trunk, trunkTrend, start, end),
    // 등 곡률 변화: 최저점 앞뒤 구간의 중앙값(옷 펄럭임 같은 순간 노이즈에 강함)
    backRound: backAtBottom(s.backDelta, r),
    backArch: backAtBottom(s.backDelta, r),
  };
}

function backAtBottom(a, r) {
  const w = Math.max(2, Math.round((r.end - r.start) * 0.15));
  return median(a.slice(Math.max(r.start, r.bottom - w), Math.min(r.end, r.bottom + w) + 1));
}

function rms(a, b, from, to) {
  let sum = 0, k = 0;
  for (let i = from; i <= to; i++) if (isNum(a[i]) && isNum(b[i])) { sum += (a[i] - b[i]) ** 2; k++; }
  return k ? Math.sqrt(sum / k) : NaN;
}

function summarize(reps) {
  const m = (k) => mean(reps.map((r) => r.metrics[k]));
  return {
    reps: reps.length,
    minKnee: m('minKnee'),
    thighAboveParallel: m('thighAboveParallel'),
    minHip: m('minHip'),
    maxTrunk: m('maxTrunk'),
    topHip: m('topHip'),
    descent: m('descent'),
    ascent: m('ascent'),
    depthStd: reps.length > 1 ? std(reps.map((r) => r.metrics.thighAboveParallel)) : 0,
    meanAbsDiff: mean(reps.map((r) => r.meanAbsDiff)),
    trunkWobble: m('trunkWobble'),
    backRound: m('backRound'),
    backArch: m('backArch'),
  };
}

function qualityWarnings({ coverage, frames, width, torso, reps, duration, n }) {
  const out = [];
  if (n === 0 || coverage === 0) {
    out.push('사람의 관절을 인식하지 못했어요. 전신이 보이는 영상인지 확인해 주세요.');
    return out;
  }
  if (coverage < 0.7) out.push(`관절 인식률이 낮아요(${Math.round(coverage * 100)}%). 촬영 가이드(측면, 2~3m, 전신)를 확인해 주세요.`);

  const ratios = [];
  for (const f of frames) {
    const a = f.lm?.[11], b = f.lm?.[12];
    if (a && b && visOf(a) >= 0.5 && visOf(b) >= 0.5 && torso > 0) ratios.push(Math.abs(a.x - b.x) * width / torso);
  }
  if (ratios.length && median(ratios) > 0.5) out.push('정면에 가까운 촬영으로 보여요. 측면에서 촬영해야 각도가 정확해요.');

  if (!reps.length) out.push('반복 동작을 찾지 못했어요. 한 세트 전체가 담긴 영상인지 확인해 주세요.');
  else if (reps.some((r) => r.partialStart || r.partialEnd)) out.push('영상 처음이나 끝에서 잘린 반복이 있어요. 잘린 구간은 일부만 분석했어요.');
  if (duration > 0 && duration < 2) out.push('영상이 너무 짧아요.');
  return out;
}

// CSV (0단계 검증용: 수동 측정값과 비교)
export function toCSV(result) {
  const { t, series: s, reps } = result;
  const repOf = new Array(t.length).fill('');
  for (const r of reps) for (let k = r.start; k <= r.end; k++) repOf[k] = r.index;
  const f = (v) => (isNum(v) ? v.toFixed(1) : '');
  const rows = ['frame,time_s,knee_deg,hip_deg,trunk_lean_deg,shin_lean_deg,back_curv_change_pct,detected,rep'];
  t.forEach((time, i) => {
    rows.push([i, time.toFixed(3), f(s.knee[i]), f(s.hip[i]), f(s.trunk[i]), f(s.shin[i]), f(s.backDelta?.[i]), result.frames[i]?.lm ? 1 : 0, repOf[i]].join(','));
  });
  return rows.join('\n');
}
