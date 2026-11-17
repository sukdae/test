// 기준 동작 비교: DTW로 속도 차이를 맞춘 뒤 구간별 각도 차이를 계산
import { referenceAngles } from './exercises.js';
import { mean } from './signal.js';

export const FEATURES = ['knee', 'hip', 'trunk'];
export const PHASES = { descent: [0, 0.4], bottom: [0.4, 0.6], ascent: [0.6, 1.0001] };
export const PHASE_KO = { descent: '내려갈 때', bottom: '최저점에서', ascent: '올라올 때' };

export function dtw(a, b, distFn) {
  const n = a.length, m = b.length, W = m + 1;
  const D = new Float64Array((n + 1) * W).fill(Infinity);
  D[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const c = distFn(a[i - 1], b[j - 1]);
      D[i * W + j] = c + Math.min(D[(i - 1) * W + j], D[i * W + j - 1], D[(i - 1) * W + j - 1]);
    }
  }
  const path = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    if (i === 1 && j === 1) break;
    const diag = D[(i - 1) * W + (j - 1)], up = D[(i - 1) * W + j], left = D[i * W + (j - 1)];
    if (diag <= up && diag <= left) { i--; j--; } else if (up <= left) i--; else j--;
  }
  path.reverse();
  return { cost: D[n * W + m], path };
}

export function alignRep(exId, rep, s, M = 50, refProfile = null) {
  const [a, b] = rep.partialStart ? [0.5, 1] : rep.partialEnd ? [0, 0.5] : [0, 1];
  const refPhase = Array.from({ length: M }, (_, j) => a + (b - a) * j / (M - 1));
  const ref = refPhase.map((p) => referenceAngles(exId, p, refProfile));
  const user = [];
  for (let k = rep.start; k <= rep.end; k++) user.push({ knee: s.knee[k], hip: s.hip[k], trunk: s.trunk[k] });

  const d = (u, r) => Math.hypot(u.knee - r.knee, u.hip - r.hip, u.trunk - r.trunk);
  const { path } = dtw(user, ref, d);

  // 사용자 프레임별 기준 위상 (고스트 표시용)
  const acc = user.map(() => [0, 0]);
  for (const [i, j] of path) { acc[i][0] += refPhase[j]; acc[i][1]++; }
  const phase = acc.map(([sum, c]) => sum / c);

  // 기준 위상별로 정렬된 사용자 값
  const byRef = refPhase.map(() => ({ knee: 0, hip: 0, trunk: 0, n: 0 }));
  for (const [i, j] of path) { for (const f of FEATURES) byRef[j][f] += user[i][f]; byRef[j].n++; }
  const aligned = byRef.map((o, j) => ({
    phase: refPhase[j],
    user: { knee: o.knee / o.n, hip: o.hip / o.n, trunk: o.trunk / o.n },
    ref: { knee: ref[j].knee, hip: ref[j].hip, trunk: ref[j].trunk },
  }));

  const diffs = {};
  for (const [name, [lo, hi]] of Object.entries(PHASES)) {
    const pts = aligned.filter((x) => x.phase >= lo && x.phase < hi);
    if (!pts.length) continue;
    diffs[name] = {};
    for (const f of FEATURES) diffs[name][f] = mean(pts.map((x) => x.user[f] - x.ref[f]));
  }
  const meanAbsDiff = mean(aligned.flatMap((x) => FEATURES.map((f) => Math.abs(x.user[f] - x.ref[f]))));

  return { phase, aligned, diffs, meanAbsDiff, phaseRange: [a, b] };
}

export function diffText(phase, f, d, label = '기준') {
  const a = Math.round(Math.abs(d));
  const when = PHASE_KO[phase];
  if (f === 'trunk') return `${when} 상체가 ${label}보다 ${a}° ${d > 0 ? '더 앞으로 기울어요' : '더 세워져 있어요'}`;
  if (f === 'knee') return `${when} 무릎이 ${label}보다 ${a}° ${d > 0 ? '덜 굽혀져 있어요' : '더 굽혀져 있어요'}`;
  return `${when} 엉덩이(고관절)가 ${label}보다 ${a}° ${d > 0 ? '덜 접혀 있어요' : '더 접혀 있어요'}`;
}

// 모든 반복을 평균해 차이가 큰 항목을 뽑는다.
export function topDiffs(reps, { min = 8, limit = 3, label = '기준' } = {}) {
  const out = [];
  for (const phase of Object.keys(PHASES)) {
    for (const f of FEATURES) {
      const vals = reps.map((r) => r.diffs?.[phase]?.[f]).filter((v) => typeof v === 'number');
      if (!vals.length) continue;
      const d = mean(vals);
      if (Math.abs(d) >= min) out.push({ phase, feature: f, diff: d, text: diffText(phase, f, d, label) });
    }
  }
  return out.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)).slice(0, limit);
}
