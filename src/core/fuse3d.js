// 측면 + 정면 → 3D 합성 (추정)
//
// 두 영상은 같은 순간을 찍은 것이 아니므로 프레임끼리 합칠 수 없다. 그래서 각 영상에서 반복을 위상
// (시작 0 → 최저점 0.5 → 끝 1)으로 맞춰 평균 낸 '대표 반복'을 만들고, 같은 위상끼리 합친다.
//   좌표: 양 발목 가운데가 원점, 서 있을 때 다리 길이 = 1. x = 사람의 왼쪽(+), y = 위(+), z = 앞(+)
//   정면 영상 → x (좌우),  측면 영상 → z (앞뒤)와 y (높이). 정면 y는 두 영상이 맞는지 확인하는 데만 쓴다.
//   측면은 한쪽 다리만 보이므로 양쪽 다리의 앞뒤(z)를 같다고 둔다.
// 기준값은 모두 [초깃값]이다(확인한 논문에 3D 수치 없음).

import { SIDES, visOf } from './landmarks.js';
import { median, isNum } from './signal.js';
import { DEG } from './geometry.js';
import { referenceAngles, getReference, bell } from './exercises.js';

export const FUSE_N = 21; // 위상 표본 수 (0, 0.05, … 1)
export const JOINTS = ['shoulder', 'hip', 'knee', 'ankle', 'foot'];

export const FUSE_THRESHOLDS = {
  // 무릎 방향과 발끝 방향의 차이(수평면, 도). 양수 = 무릎이 발끝보다 안쪽 [초깃값]
  kneeToe: 15,
  // 두 영상의 최저점 엉덩이 높이 차이(다리 길이 대비). 넘으면 같은 세트가 아닐 가능성 [초깃값]
  depthMismatch: 0.15,
  // 3D 상체 옆 기울기(도). 정면 분석의 상체 옆 기울기 기준과 같은 값 [초깃값]
  trunkLateral: 5,
};

const pt = (lm, i, W, H) => { const p = lm?.[i]; return p && visOf(p) >= 0.5 ? { x: p.x * W, y: p.y * H } : null; };
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 반복들의 위상 p(0~1)에 해당하는 프레임 번호
function frameAtPhase(r, p) {
  return Math.round(p <= 0.5 ? r.start + (r.bottom - r.start) * (p / 0.5) : r.bottom + (r.end - r.bottom) * ((p - 0.5) / 0.5));
}

// 대표 반복: 위상별로 관절 좌표의 중앙값. get(frameIndex) → {joint: {a, b}} 또는 null
const fullReps = (reps) => reps.filter((r) => !r.partialStart && !r.partialEnd && isNum(r.bottom));
function averageRep(reps, get) {
  const full = fullReps(reps);
  const use = full.length ? full : reps;
  if (!use.length) return null;
  const out = [];
  for (let k = 0; k < FUSE_N; k++) {
    const p = k / (FUSE_N - 1);
    const samples = use.map((r) => get(frameAtPhase(r, p))).filter(Boolean);
    const avg = {};
    for (const key of Object.keys(samples[0] || {})) {
      const vals = samples.map((s) => s[key]).filter(Boolean);
      avg[key] = vals.length ? { a: median(vals.map((v) => v.a)), b: median(vals.map((v) => v.b)) } : null;
    }
    out.push(avg);
  }
  return out;
}

// 측면: 보이는 쪽 다리. a = z(앞+), b = y(위+), 발목 기준, 다리 길이로 나눔
function sideProfile(side, reps = side.reps) {
  const K = SIDES[side.side || 'left'], f = side.facing || 1, W = side.width, H = side.height;
  const legs = [];
  for (const fr of side.frames) {
    const h = pt(fr.lm, K.hip, W, H), k = pt(fr.lm, K.knee, W, H), a = pt(fr.lm, K.ankle, W, H);
    if (h && k && a) legs.push(d2(h, k) + d2(k, a));
  }
  const leg = median(legs);
  if (!isNum(leg) || !leg) return null;
  return averageRep(reps, (i) => {
    const lm = side.frames[i]?.lm, a = pt(lm, K.ankle, W, H);
    if (!a) return null;
    const o = {};
    for (const j of JOINTS) { const p = pt(lm, K[j], W, H); o[j] = p ? { a: ((p.x - a.x) * f) / leg, b: (a.y - p.y) / leg } : null; }
    return o;
  });
}

// 정면: 양쪽 다리. a = x(사람의 왼쪽+), b = y(위+), 양 발목 가운데 기준
function frontProfile(front, reps = front.reps) {
  const W = front.width, H = front.height;
  const leg = front.legLen;
  if (!isNum(leg) || !leg) return null;
  return averageRep(reps, (i) => {
    const lm = front.frames[i]?.lm;
    const al = pt(lm, SIDES.left.ankle, W, H), ar = pt(lm, SIDES.right.ankle, W, H);
    if (!al || !ar) return null;
    const mx = (al.x + ar.x) / 2, my = (al.y + ar.y) / 2, dir = Math.sign(al.x - ar.x) || 1;
    const o = {};
    for (const [s, K] of [['L', SIDES.left], ['R', SIDES.right]]) {
      for (const j of JOINTS) { const p = pt(lm, K[j], W, H); o[s + j] = p ? { a: ((p.x - mx) * dir) / leg, b: (my - p.y) / leg } : null; }
    }
    return o;
  });
}

const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
const angle3 = (a, b, c) => { // b에서의 사잇각
  const u = sub(a, b), v = sub(c, b);
  const cos = (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * DEG;
};

function combine(sp, fp) {
  return sp.map((s, k) => {
    const f = fp[k], pose = { L: {}, R: {} };
    for (const S of ['L', 'R']) {
      for (const j of JOINTS) {
        const sj = s[j], fj = f[S + j];
        pose[S][j] = sj && fj ? { x: fj.a, y: sj.b, z: sj.a, yFront: fj.b } : null;
      }
    }
    return pose;
  });
}

function metricsOf(poses) {
  const bottom = poses[(FUSE_N - 1) / 2];
  const metrics = { kneeToe: {}, knee3D: {}, kneeForward: NaN, trunk: null, depthGap: NaN };
  for (const S of ['L', 'R']) {
    const { hip, knee, ankle, foot } = bottom[S];
    if (!hip || !knee || !ankle) continue;
    metrics.knee3D[S] = angle3(hip, knee, ankle);
    if (foot) {
      // 수평면(x,z)에서 발목→무릎 방향과 발목→발끝 방향의 각도 차. 안쪽(몸 가운데 쪽)으로 돌면 양수
      const med = S === 'L' ? -1 : 1; // 왼다리의 안쪽은 -x
      const ang = (v) => Math.atan2(v.x * med, v.z) * DEG;
      const kv = sub(knee, ankle), fv = sub(foot, ankle);
      if (Math.hypot(kv.x, kv.z) > 0.05 && Math.hypot(fv.x, fv.z) > 0.02) metrics.kneeToe[S] = ang(kv) - ang(fv);
    }
  }
  const K = bottom.L.knee && bottom.R.knee ? (bottom.L.knee.z + bottom.R.knee.z) / 2 : NaN;
  const F = bottom.L.foot && bottom.R.foot ? (bottom.L.foot.z + bottom.R.foot.z) / 2 : NaN;
  metrics.kneeForward = K - F; // 양수 = 무릎이 발끝보다 앞
  const mid = (j) => (bottom.L[j] && bottom.R[j] ? { x: (bottom.L[j].x + bottom.R[j].x) / 2, y: (bottom.L[j].y + bottom.R[j].y) / 2, z: (bottom.L[j].z + bottom.R[j].z) / 2 } : null);
  const sh = mid('shoulder'), hp = mid('hip');
  if (sh && hp) {
    const v = sub(sh, hp);
    metrics.trunk = {
      total: Math.atan2(Math.hypot(v.x, v.z), v.y) * DEG, // 수직에서 기운 각도 (3D)
      forward: Math.atan2(v.z, v.y) * DEG,
      lateral: Math.atan2(v.x, v.y) * DEG, // 양수 = 사람의 왼쪽
    };
  }
  if (bottom.L.hip && bottom.R.hip) {
    metrics.depthGap = ((bottom.L.hip.y + bottom.R.hip.y) / 2) - ((bottom.L.hip.yFront + bottom.R.hip.yFront) / 2);
  }
  return metrics;
}

// 판정에 걸린 항목 key 목록 (fusedRows 의 key 와 같음)
export function issuesOf(m) {
  const T = FUSE_THRESHOLDS, out = [];
  for (const S of ['L', 'R']) if (isNum(m.kneeToe[S]) && Math.abs(m.kneeToe[S]) > T.kneeToe) out.push(`kneeToe${S}`);
  if (m.trunk && Math.abs(m.trunk.lateral) > T.trunkLateral) out.push('trunk');
  return out;
}

/**
 * 측면 결과(analyzeSession)와 정면 결과(analyzeFront)를 합쳐 3D 대표 반복과 지표를 만든다.
 * 반복별 합성도 만든다: 측면 n번째 반복과 정면 n번째 반복을 짝지음(같은 세트를 두 방향에서 찍었다고 가정).
 * @returns {{ poses, metrics, reps: [{index, poses, metrics, issues}], warnings } | null}
 */
export function fuse3D(side, front) {
  if (!side?.reps?.length || !front?.reps?.length) return null;
  const sp = sideProfile(side), fp = frontProfile(front);
  if (!sp || !fp) return null;
  const poses = combine(sp, fp);
  const metrics = metricsOf(poses);

  const sr = fullReps(side.reps), fr = fullReps(front.reps);
  const reps = [];
  for (let k = 0; k < Math.min(sr.length, fr.length); k++) {
    const a = sideProfile(side, [sr[k]]), b = frontProfile(front, [fr[k]]);
    if (!a || !b) continue;
    const p = combine(a, b), m = metricsOf(p);
    reps.push({ index: k + 1, poses: p, metrics: m, issues: issuesOf(m) });
  }

  const warnings = [];
  if (isNum(metrics.depthGap) && Math.abs(metrics.depthGap) > FUSE_THRESHOLDS.depthMismatch) {
    warnings.push('측면·정면 깊이가 많이 달라요. 같은 세트인지 확인해 주세요.');
  }
  if (sr.length !== fr.length) warnings.push(`반복 수가 달라서(측면 ${sr.length} · 정면 ${fr.length}) 앞 ${reps.length}회만 짝지었어요.`);
  return { exercise: side.exercise || 'squat', poses, metrics, reps, warnings };
}

// 3D 진단표 행 (짧게). m = 지표, repsList = 반복별 결과(전체 보기일 때 '몇 회'를 붙임)
export function fusedRows(m, repsList = []) {
  if (!m) return [];
  const T = FUSE_THRESHOLDS, rows = [];
  const hit = (key) => repsList.filter((r) => r.issues.includes(key)).map((r) => r.index);
  for (const [S, name] of [['L', '왼무릎'], ['R', '오른무릎']]) {
    const v = m.kneeToe[S];
    const hits = repsList.filter((r) => r.issues.includes(`kneeToe${S}`)).map((r) => r.metrics.kneeToe[S]);
    const dir = (hits.length ? median(hits) : v) > 0 ? '안쪽' : '바깥';
    rows.push({ key: `kneeToe${S}`, issue: `${name}이 발끝보다 ${dir}으로`, label: `${name} 방향`, value: isNum(v) ? `${Math.abs(v) < 1 ? '' : v > 0 ? '안쪽 ' : '바깥 '}${Math.abs(v).toFixed(0)}°` : '–', ok: isNum(v) ? Math.abs(v) <= T.kneeToe : null, reps: hit(`kneeToe${S}`) });
  }
  if (m.trunk) {
    rows.push({ key: 'trunk', issue: '상체가 옆으로 기울어요', label: '상체 옆 기울기', value: `${Math.abs(m.trunk.lateral).toFixed(0)}°`, ok: Math.abs(m.trunk.lateral) <= T.trunkLateral, reps: hit('trunk') });
    rows.push({ key: 'trunkFwd', label: '상체 앞 기울기', value: `${m.trunk.forward.toFixed(0)}°`, ok: null, reps: [] });
  }
  const kl = m.knee3D.L, kr = m.knee3D.R;
  if (isNum(kl) || isNum(kr)) rows.push({ key: 'knee3D', label: '무릎 각도', value: `${isNum(kl) ? kl.toFixed(0) : '–'}° / ${isNum(kr) ? kr.toFixed(0) : '–'}°`, ok: null, reps: [] });
  return rows;
}

// 논문 기반 기준 자세를 같은 3D 좌표로 만든다(내 몸 길이·발 위치에 맞춤).
//   앞뒤·높이: 측면 기준 자세 각도(정강이·허벅지·상체 기울기)  [exercises.js 의 IDEAL_SQUAT]
//   좌우: 골반·어깨 수평, 상체 옆 기울기 0, 무릎은 앉을수록 발끝 위로  [IDEAL_SQUAT_FRONT]
// 표시용 도식이며 판정에는 쓰지 않는다.
export function idealPoses(fz, exId = 'squat') {
  const p0 = fz?.poses?.[0];
  if (!p0) return null;
  const d3 = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : NaN);
  const len = (a, b) => median(['L', 'R'].map((S) => d3(p0[S][a], p0[S][b])).filter(isNum));
  const Ls = len('knee', 'ankle'), Lt = len('hip', 'knee'), Lto = len('shoulder', 'hip');
  if (![Ls, Lt, Lto].every(isNum)) return null;
  const half = (j) => (p0.L[j] && p0.R[j] ? Math.abs(p0.L[j].x - p0.R[j].x) / 2 : NaN);
  const hipHalf = half('hip'), shHalf = isNum(half('shoulder')) ? half('shoulder') : hipHalf * 1.4;
  const ref = getReference(exId, 'ideal');
  const RAD = Math.PI / 180;
  const out = [];
  for (let k = 0; k < FUSE_N; k++) {
    const ph = k / (FUSE_N - 1), a = referenceAngles(exId, ph, ref), f = bell(ph);
    const pose = { L: {}, R: {} };
    for (const S of ['L', 'R']) {
      const sg = S === 'L' ? 1 : -1;
      const ankle = p0[S].ankle;
      if (!ankle) return null;
      const foot = p0[S].foot || ankle;
      const step = (p, deg, l) => ({ y: p.y + Math.cos(deg * RAD) * l, z: p.z + Math.sin(deg * RAD) * l });
      const kn = step(ankle, a.shin, Ls), hp = step(kn, a.thigh, Lt), sh = step(hp, a.trunk, Lto);
      const hipX = sg * hipHalf;
      const kneeX0 = hipX + (ankle.x - hipX) * (Lt / (Lt + Ls));
      pose[S] = {
        ankle, foot,
        knee: { x: kneeX0 + (foot.x - kneeX0) * f, ...kn },
        hip: { x: hipX, ...hp },
        shoulder: { x: sg * shHalf, ...sh },
      };
    }
    out.push(pose);
  }
  return out;
}
