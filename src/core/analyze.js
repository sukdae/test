// 분석 파이프라인: 프레임별 관절점 → 각도 시계열 → 반복 분할 → 지표 → 비교 → 피드백
//
// 입력: { frames: [{ t: 초, lm: [{x,y,v}] (정규화 좌표 33점) | null }], width, height }
// 이 모듈은 DOM에 의존하지 않으므로 네이티브 앱으로 옮길 때 그대로 포팅할 수 있습니다.

import { SIDES, toPoints, detectFacing, visOf, frameSides } from './landmarks.js';
import { leanFromVertical, dist, kneeAngle, hipAngle } from './geometry.js';
import { fillGaps, smooth, median, percentile, mean, std, isNum, rangeMin, rangeMax, argmin } from './signal.js';
import { segmentReps } from './reps.js';
import { alignRep, topDiffs } from './compare.js';
import { evaluateFeedback } from './feedback.js';
import { estimateMuscles } from './muscles.js';
import { EXERCISES, getReference } from './exercises.js';
import { tempoOf, cleanReps, bottomPause } from './reference.js';
import { backCurvature } from './back.js';

export const SERIES_KEYS = ['knee', 'hip', 'trunk', 'shin', 'thigh', 'hipX', 'hipY', 'kneeX', 'kneeY', 'midX', 'heelRel', 'ankleX', 'ankleY', 'backCurv', 'comB'];

// 무게중심(앞뒤) 근사: 분절 중심을 대략적인 몸무게 비율로 가중 평균 [초깃값 — 비율은 근사, 바벨 무게는 반영 못 함]
//   머리 0.08(귀), 몸통 0.50(엉덩이→어깨 중간), 팔 0.10(팔꿈치, 안 보이면 어깨), 허벅지 0.20, 정강이 0.09, 발 0.03
// 반환값: 발 위 위치 (0 = 뒤꿈치, 1 = 발끝). 발 앞·뒤 체중 분배에 따라 관절 부하가 달라짐 [논문 45, 46]
// 2D 근사라 절대값보다 '서 있을 때 대비 얼마나 이동했는지'로 판정한다.
// load: { bodyKg, barKg } 를 주면 바벨을 점 질량으로 더한 '몸 + 바벨' 무게중심.
//   바벨 위치: 스쿼트 = 어깨 관절, 데드리프트 = 손목 (측면 근사) [초깃값]
export function comOnFoot(p, load = null, exId = 'squat') {
  if (!p?.heel || !p?.foot) return NaN;
  const mid = (a, b, u = 0.5) => a.x + (b.x - a.x) * u;
  const ok = (q) => q && (q.v ?? 1) >= 0.5;
  const head = ok(p.ear) ? p.ear.x : p.shoulder.x;
  const arm = ok(p.elbow) ? p.elbow.x : p.shoulder.x;
  const x = 0.08 * head + 0.5 * mid(p.hip, p.shoulder) + 0.1 * arm + 0.2 * mid(p.hip, p.knee)
    + 0.09 * mid(p.knee, p.ankle) + 0.03 * p.ankle.x;
  let cx = x;
  if (load?.barKg > 0 && load?.bodyKg > 0) {
    const bar = exId === 'deadlift' ? (ok(p.wrist) ? p.wrist.x : NaN) : p.shoulder.x;
    if (!isNum(bar)) return NaN;
    cx = (x * load.bodyKg + bar * load.barKg) / (load.bodyKg + load.barKg);
  }
  const len = p.foot.x - p.heel.x;
  return Math.abs(len) > 1 ? (cx - p.heel.x) / len : NaN;
}

// 입력값 정리: 숫자가 아니거나 범위를 벗어나면 무시
export function cleanLoad(load) {
  const n = (v, lo, hi) => (isNum(+v) && +v >= lo && +v <= hi ? +v : null);
  const bodyKg = n(load?.bodyKg, 20, 300), barKg = n(load?.barKg, 0, 600);
  return bodyKg ? { bodyKg, barKg: barKg ?? 0 } : null;
}

export function analyzeSession({ frames, width, height }, exId, { referenceId, load: load0 = null } = {}) {
  const load = cleanLoad(load0);
  const cfg = EXERCISES[exId];
  if (!cfg) throw new Error(`알 수 없는 종목: ${exId}`);
  const ref = getReference(exId, referenceId);
  const refProfile = ref?.curves ? ref : null;
  const n = frames.length;
  const t = frames.map((f) => f.t);
  // 보이는 쪽·진행 방향은 프레임마다 (중간에 방향이 바뀌는 영상 대응)
  const fsd = frameSides(frames);
  const P = frames.map((f, i) => toPoints(f.lm, SIDES[fsd.sides[i]], width, height));
  const side = fsd.side;
  const facing = fsd.switches ? fsd.facing : detectFacing(P);
  const faceAt = (i) => (fsd.switches ? fsd.facings[i] : facing);

  const raw = Object.fromEntries(SERIES_KEYS.map((k) => [k, new Array(n).fill(NaN)]));
  const lens = { shin: [], thigh: [], torso: [], neck: [] };
  let valid = 0;

  P.forEach((p, i) => {
    if (!p || !p.ok) return;
    const fi = faceAt(i);
    const shin = leanFromVertical(p.ankle, p.knee, fi);
    const thigh = leanFromVertical(p.knee, p.hip, fi);
    const trunk = leanFromVertical(p.hip, p.shoulder, fi);
    // 사람이 할 수 없는 자세(관절점이 뒤엉킨 프레임)는 버린다: 관절 각도는 0–180°(약간의 과신전 허용),
    // 상체는 뒤로 60° 넘게 젖혀질 수 없음. (실제 영상: 마무리 뒤 관절점이 튀며 엉덩이 각도 360°대가 나옴)
    const kA = kneeAngle(shin, thigh), hA = hipAngle(trunk, thigh);
    if (!(kA >= 15 && kA <= 195 && hA >= 15 && hA <= 210 && trunk >= -60 && trunk <= 120)) return;
    valid++;
    raw.shin[i] = shin; raw.thigh[i] = thigh; raw.trunk[i] = trunk;
    raw.knee[i] = kA;
    raw.hip[i] = hA;
    raw.hipX[i] = p.hip.x; raw.hipY[i] = p.hip.y;
    raw.kneeX[i] = p.knee.x; raw.kneeY[i] = p.knee.y;
    raw.ankleX[i] = p.ankle.x; raw.ankleY[i] = p.ankle.y;
    if (p.heel && p.foot) { raw.midX[i] = (p.heel.x + p.foot.x) / 2; raw.heelRel[i] = p.heel.y - p.foot.y; }
    else raw.midX[i] = p.ankle.x + fi * 0.05 * dist(p.ankle, p.knee);
    lens.shin.push(dist(p.ankle, p.knee));
    lens.thigh.push(dist(p.knee, p.hip));
    lens.torso.push(dist(p.hip, p.shoulder));
    if (p.ear) lens.neck.push(dist(p.shoulder, p.ear));
    raw.backCurv[i] = backCurvature(frames[i].back, fi);
    raw.comB[i] = comOnFoot(p, load, exId);
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
  // 무게중심 이동: 서 있을 때(기준 신호 꼭대기 근처) 위치를 0으로
  const comBase = median(s.comB.filter((v, i) => s[cfg.repSignal][i] >= sigTop - 8));
  s.comShift = s.comB.map((v) => (isNum(v) && isNum(comBase) ? v - comBase : NaN));

  // 장면 전환: 사람이 0.6초 넘게 안 보이거나(설명 그림 등) 보이는 쪽·방향이 바뀌는 지점.
  // 전환에 걸친 반복은 잘린 반복으로 본다. (실제 영상: 편집된 데드리프트 영상에서 잘린 반복이 '덜 폄'으로 오탐)
  const cuts = [];
  for (let i = 1, gap = 0; i < n; i++) {
    if (!frames[i].lm) { gap++; continue; }
    if (gap && t[i] - t[i - gap - 1] > 0.6) cuts.push(i - Math.ceil(gap / 2));
    gap = 0;
    if (fsd.sides[i] !== fsd.sides[i - 1] || fsd.facings[i] !== fsd.facings[i - 1]) cuts.push(i);
    // 화면이 갑자기 바뀜(편집 컷): 한 프레임 만에 엉덩이가 화면 폭의 15% 넘게 움직이거나 몸통 길이가 40% 넘게 변함 [초깃값]
    const a0 = frames[i - 1].lm, a1 = frames[i].lm;
    if (a0 && a1) {
      const mid = (lm, k1, k2) => ({ x: (lm[k1].x + lm[k2].x) / 2, y: (lm[k1].y + lm[k2].y) / 2 });
      const h0 = mid(a0, 23, 24), h1 = mid(a1, 23, 24), s0 = mid(a0, 11, 12), s1 = mid(a1, 11, 12);
      const L0 = Math.hypot((s0.x - h0.x) * width, (s0.y - h0.y) * height), L1 = Math.hypot((s1.x - h1.x) * width, (s1.y - h1.y) * height);
      if (Math.abs(h1.x - h0.x) > 0.15 || (L0 > 0 && Math.abs(L1 / L0 - 1) > 0.4)) cuts.push(i);
    }
  }
  for (const r of rawReps) {
    if (cuts.some((c) => c > r.start && c <= (r.bottom ?? r.start))) r.partialStart = true;
    if (cuts.some((c) => c > (r.bottom ?? r.start) && c < r.end)) r.partialEnd = true;
  }

  const reps = rawReps.map((r, idx) => {
    const bottom = argmin(s[cfg.repSignal], r.start, r.end);
    const rep = { index: idx + 1, ...r, bottom };
    rep.metrics = repMetrics(rep, s, t, legLen, heelBase, trunkTrend);
    // 바닥(최저점)에서 머문 시간. 처음부터 바닥에서 시작한 반복은 잴 수 없음
    rep.metrics.withBar = !!(load?.barKg > 0);
    // 끝이 잘린 반복은 마무리 지표를 재지 않는다
    if (rep.partialEnd) { rep.metrics.topHip = NaN; rep.metrics.minTrunk = NaN; }
    rep.metrics.floorPause = rep.partialStart ? NaN : bottomPause(s[cfg.repSignal], t, rep, 5);
    Object.assign(rep, alignRep(exId, rep, s, 50, refProfile));
    return rep;
  });

  const warnings = qualityWarnings({ coverage, frames, width, height, torso, reps, duration, n });
  if (cuts.length) warnings.push('중간에 장면이 바뀌거나 서 있는 방향이 바뀐 구간이 있어요(편집된 영상). 장면에 걸친 반복은 잘린 반복으로 봤어요. 한 번에 이어서 찍은 영상이 가장 정확해요.');
  const summary = summarize(reps);
  const goodReps = reps.length >= 2 ? cleanReps(reps, t) : reps;
  const tempo = goodReps.length ? tempoOf({ series: s, t, exercise: exId }, goodReps) : null;

  return {
    version: 1,
    exercise: exId,
    width, height, side, facing, fps, duration, coverage, load,
    sides: fsd.switches ? fsd.sides : null, facings: fsd.switches ? fsd.facings : null,
    t, series: s, frames, body,
    reps,
    feedback: offAngle(evaluateFeedback(exId, reps, { load }), warnings),
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
    comShift: backAtBottom(s.comShift, r),
    // 최저점 앞뒤 구간의 중앙값: 원판에 정강이가 가려 무릎점이 순간적으로 튀는 영향을 줄인다(실제 측면 데드리프트 영상)
    kneeAtBottom: backAtBottom(s.knee, r),
    withBar: false,
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
    comShift: m('comShift'),
  };
}

// 측면이 아닌 각도(정면·대각선)로 찍힌 영상이면 측면 각도가 크게 틀어진다.
// 이때는 경고(warn)를 참고(info)로 낮추고 이유를 붙인다. (실제 영상: 대각선 촬영 데드리프트에서 '뒤로 젖힘' 오탐)
export const OFF_ANGLE_MSG = '정면에 가까운 촬영으로 보여요';
function offAngle(items, warnings) {
  if (!warnings.some((w) => w.startsWith(OFF_ANGLE_MSG))) return items;
  return items.map((f) => (f.level === 'warn'
    ? { ...f, level: 'info', title: `${f.title} (촬영 각도 때문에 부정확할 수 있어요)` }
    : f));
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
  if (ratios.length && median(ratios) > 0.5) out.push(`${OFF_ANGLE_MSG}. 측면에서 촬영해야 각도가 정확해요. 그래서 이번 결과의 경고는 참고로만 보여 드려요.`);

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
