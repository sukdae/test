// 영상에서 뽑은 기준 동작 프로필
//
// 분석 결과(analyzeSession)의 반복들을 위상 기준으로 평균 내 '기준 곡선'과 '리듬'을 만듭니다.
//   위상 p: 반복 시작 0 → 최저점 0.5 → 끝 1 (하강·상승 각각 시간에 비례)
// 영상 자체는 저장하지 않고 이 숫자들만 앱에 넣습니다.

import { mean, median, isNum } from './signal.js';
import { kneeAngle, hipAngle } from './geometry.js';

export const CURVE_POINTS = 101;
const KEYS = ['shin', 'thigh', 'trunk'];

// 한 반복의 시계열을 위상 격자(0~1, 101점)로 다시 샘플링
export function repToPhase(series, t, rep, n = CURVE_POINTS) {
  const { start, bottom, end } = rep;
  const tb = t[bottom] - t[start], ta = t[end] - t[bottom];
  const phaseOf = (k) => (k <= bottom ? (tb > 0 ? 0.5 * (t[k] - t[start]) / tb : 0.5) : 0.5 + (ta > 0 ? 0.5 * (t[k] - t[bottom]) / ta : 0.5));
  const ph = [], val = [];
  for (let k = start; k <= end; k++) { ph.push(phaseOf(k)); val.push(series[k]); }
  return Array.from({ length: n }, (_, j) => {
    const p = j / (n - 1);
    let i = ph.findIndex((x) => x >= p);
    if (i <= 0) return val[Math.max(0, i)];
    const f = (p - ph[i - 1]) / ((ph[i] - ph[i - 1]) || 1);
    return val[i - 1] + (val[i] - val[i - 1]) * f;
  });
}

// 최저점에서 머무른 시간: 기준 신호가 최저값 + tol 이내인 구간
export function bottomPause(sig, t, rep, tol = 5) {
  const lo = sig[rep.bottom];
  let a = rep.bottom, b = rep.bottom;
  while (a > rep.start && sig[a - 1] <= lo + tol) a--;
  while (b < rep.end && sig[b + 1] <= lo + tol) b++;
  return t[b] - t[a];
}

export function tempoOf(result, reps) {
  const sig = result.series[result.exercise === 'deadlift' ? 'hip' : 'knee'];
  const t = result.t;
  const bottoms = reps.map((r) => t[r.bottom]);
  const gaps = bottoms.slice(1).map((b, i) => b - bottoms[i]);
  return {
    descent: median(reps.map((r) => t[r.bottom] - t[r.start])),
    bottom: median(reps.map((r) => bottomPause(sig, t, r))),
    ascent: median(reps.map((r) => t[r.end] - t[r.bottom])),
    interval: gaps.length ? median(gaps) : NaN,
  };
}

// 기준으로 쓸 만한 반복만 고른다: 잘린 반복, 랙에 걸기 같은 비정상적으로 긴 구간 제외
export function cleanReps(reps, t) {
  const ok = reps.filter((r) => !r.partialStart && !r.partialEnd);
  const desc = median(ok.map((r) => t[r.bottom] - t[r.start]));
  const asc = median(ok.map((r) => t[r.end] - t[r.bottom]));
  return ok.filter((r) => t[r.bottom] - t[r.start] < desc * 2 && t[r.end] - t[r.bottom] < asc * 2);
}

export function buildReference(result, meta) {
  const reps = cleanReps(result.reps, result.t);
  if (reps.length < 2) throw new Error('기준으로 쓸 반복이 부족해요.');
  const r1 = (v) => Math.round(v * 10) / 10;
  const curves = {};
  for (const k of KEYS) {
    const per = reps.map((r) => repToPhase(result.series[k], result.t, r));
    curves[k] = Array.from({ length: CURVE_POINTS }, (_, j) => r1(mean(per.map((c) => c[j]))));
  }
  const m = (k) => r1(mean(reps.map((r) => r.metrics[k])));
  const tempo = tempoOf(result, reps);
  return {
    ...meta,
    exercise: result.exercise,
    repsUsed: reps.length,
    curves,
    tempo: Object.fromEntries(Object.entries(tempo).map(([k, v]) => [k, isNum(v) ? Math.round(v * 100) / 100 : null])),
    metrics: {
      thighAboveParallel: m('thighAboveParallel'), minKnee: m('minKnee'), minHip: m('minHip'),
      maxTrunk: m('maxTrunk'), topHip: m('topHip'),
    },
  };
}

// 기준 곡선에서 위상 p 의 각도
export function curveAngles(ref, p) {
  const x = Math.max(0, Math.min(1, p)) * (CURVE_POINTS - 1);
  const i = Math.floor(x), f = x - i, j = Math.min(CURVE_POINTS - 1, i + 1);
  const g = (k) => ref.curves[k][i] + (ref.curves[k][j] - ref.curves[k][i]) * f;
  const shin = g('shin'), thigh = g('thigh'), trunk = g('trunk');
  return { shin, thigh, trunk, knee: kneeAngle(shin, thigh), hip: hipAngle(trunk, thigh) };
}

// 기준 리듬으로 흘렀을 때 반복 시작 후 dt초의 위상
export function phaseByTempo(tempo, dt) {
  const half = Math.max(0, (tempo.bottom || 0) / 2);
  const d = tempo.descent - half, a = tempo.ascent - half;
  if (dt <= 0) return 0;
  if (dt < d) return 0.5 * dt / d;
  if (dt < d + (tempo.bottom || 0)) return 0.5;
  const u = dt - d - (tempo.bottom || 0);
  return u < a ? 0.5 + 0.5 * u / a : 1;
}
