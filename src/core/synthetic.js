// 합성 데모 데이터 생성기
//
// 실제 영상 없이 결과 화면과 분석 로직을 확인하기 위한 가짜 관절점 시퀀스입니다.
// 일부 반복에 일부러 자세 오류(얕은 깊이, 엉덩이 먼저 등)를 넣어 피드백이 나오게 합니다.
// 화면에는 반드시 '예시(합성 데이터)'로 표시합니다.

import { EXERCISES, bell } from './exercises.js';
import { chainFromAngles } from './geometry.js';
import { BACK_LEVELS } from './back.js';

export const DEMO_REPS = {
  squat: [{}, {}, { depth: 0.55 }, { lean: 1.5, hipsFirst: true, round: true }, { heel: true }],
  deadlift: [{}, {}, { hipsFirst: true, round: true }, { endTrunk: 14 }, { endTrunk: -24 }],
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function anglesAt(T, R, p, prevOff) {
  const depth = R.depth ?? 1;
  const lean = R.lean ?? 1;
  let fK = bell(p), fT = bell(p), extraT = 0;
  if (R.hipsFirst && p > 0.5) {
    fK = bell(Math.min(1, 0.5 + (p - 0.5) * 1.5));
    if (p < 0.75) { fT = 1; extraT = 8 * Math.sin(Math.PI * (p - 0.5) / 0.25); }
    else fT = bell(0.5 + (p - 0.75) * 2);
  }
  const shin = T.shin[0] + (T.shin[1] - T.shin[0]) * fK * depth;
  const knee = T.knee[0] - (T.knee[0] - T.knee[1]) * fK * depth;
  const leanScale = lean * (depth < 1 ? 0.5 + 0.5 * depth : 1);
  let trunk = T.trunk[0] + (T.trunk[1] - T.trunk[0]) * fT * leanScale + extraT;
  trunk += p <= 0.5 ? prevOff * (1 - bell(p)) : (R.endTrunk || 0) * (1 - bell(p));
  return { shin, thigh: shin - (180 - knee), trunk, heelLift: R.heel ? 0.05 * bell(p) : 0 };
}

export function generateDemo(exId, { fps = 30, W = 720, H = 1280, seed = 7, reps } = {}) {
  const T = EXERCISES[exId].template;
  const list = reps || DEMO_REPS[exId];
  const rnd = mulberry32(seed);
  const noise = () => (rnd() - 0.5) * 4;
  const facing = 1;
  const body = { shin: 250, thigh: 250, torso: 290, neck: 80 };
  const legLen = body.shin + body.thigh;
  const ankle = { x: W * 0.42, y: H * 0.86 };

  // 타임라인: 시작 대기 → (하강, 정지, 상승, 대기) × 반복
  const lead = 0.8, desc = 1.1, pause = 0.15, asc = 0.9, gap = 0.7;
  const segs = [];
  let time = lead;
  list.forEach((R, k) => {
    segs.push({ k, R, t0: time, tb0: time + desc, tb1: time + desc + pause, t1: time + desc + pause + asc });
    time += desc + pause + asc + gap;
  });
  const total = time;

  const frames = [];
  for (let i = 0; ; i++) {
    const t = i / fps;
    if (t > total) break;
    let R = {}, p = 0, prevOff = 0;
    for (const sg of segs) {
      if (t >= sg.t1) { prevOff = sg.R.endTrunk || 0; continue; }
      if (t >= sg.t0) {
        R = sg.R;
        p = t < sg.tb0 ? 0.5 * (t - sg.t0) / desc : t < sg.tb1 ? 0.5 : 0.5 + 0.5 * (t - sg.tb1) / asc;
      }
      break;
    }
    const a = anglesAt(T, R, p, prevOff);
    const c = chainFromAngles(a, ankle, body, facing);
    // 등 윤곽(실험 기능용): 곧은 등 + 'round' 반복은 최저점에서 바깥으로 둥글게
    const bump = R.round ? 0.09 * bell(p) : 0;
    const back = {
      minus: BACK_LEVELS.map((lv) => Math.round((0.12 + bump * Math.sin((Math.PI * (lv - 0.25)) / 0.6) + noise() * 0.001) * 1000) / 1000),
      plus: BACK_LEVELS.map(() => 0.2),
    };
    frames.push({ t, lm: buildLandmarks(c, a, exId, facing, legLen, W, H, noise), back });
  }
  return { frames, width: W, height: H, synthetic: true };
}

function buildLandmarks(c, a, exId, s, legLen, W, H, noise) {
  const P = (x, y) => ({ x: x + noise(), y: y + noise() });
  const heel = P(c.ankle.x - s * 25, c.ankle.y + 18 - a.heelLift * legLen);
  const foot = P(c.ankle.x + s * 70, c.ankle.y + 22);
  const sh = c.shoulder;
  const arms = exId === 'deadlift'
    ? { elbow: { x: sh.x, y: sh.y + 140 }, wrist: { x: sh.x, y: sh.y + 270 } }
    : { elbow: { x: sh.x - s * 55, y: sh.y + 75 }, wrist: { x: sh.x - s * 12, y: sh.y + 12 } };
  const near = {
    shoulder: P(sh.x, sh.y), elbow: P(arms.elbow.x, arms.elbow.y), wrist: P(arms.wrist.x, arms.wrist.y),
    hip: P(c.hip.x, c.hip.y), knee: P(c.knee.x, c.knee.y), ankle: P(c.ankle.x, c.ankle.y), heel, foot,
  };
  const lm = new Array(33);
  const set = (i, p, v) => { lm[i] = { x: p.x / W, y: p.y / H, v }; };
  const nearIdx = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, foot: 31 };
  const farIdx = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, foot: 32 };
  for (const k in nearIdx) {
    set(nearIdx[k], near[k], 0.95);
    set(farIdx[k], { x: near[k].x + 6, y: near[k].y - 4 }, 0.6);
  }
  const hd = c.head;
  set(0, P(hd.x + s * 25, hd.y + 5), 0.95);
  for (let i = 1; i <= 6; i++) set(i, P(hd.x + s * 15, hd.y - 8), 0.9);
  set(7, P(hd.x - s * 5, hd.y), 0.9);
  set(8, P(hd.x - s * 5 + 6, hd.y - 4), 0.5);
  set(9, P(hd.x + s * 20, hd.y + 20), 0.9);
  set(10, P(hd.x + s * 20, hd.y + 20), 0.9);
  for (const [i, base] of [[17, 15], [19, 15], [21, 15], [18, 16], [20, 16], [22, 16]]) {
    const b = lm[base];
    lm[i] = { x: b.x + (s * 8) / W, y: b.y + 6 / H, v: b.v };
  }
  return lm;
}

// ---- 정면 합성 데모 ----
// 카메라를 마주 본 사람. 일부 반복에 무릎 모임·엉덩이 쏠림·골반 기울기를 넣는다.
export const DEMO_FRONT_REPS = [{}, { cave: true }, { shift: 0.25 }, { tilt: true }, {}];

export function generateFrontDemo({ fps = 30, W = 720, H = 1280, seed = 11, reps } = {}) {
  const list = reps || DEMO_FRONT_REPS;
  const rnd = mulberry32(seed);
  const noise = () => (rnd() - 0.5) * 4;
  const cx = W / 2, ankleY = H * 0.88, stanceHalf = 95, hipHalf = 60, shoulderHalf = 85;
  const lead = 0.8, desc = 1.1, pause = 0.15, asc = 0.9, gap = 0.7;
  const segs = [];
  let time = lead;
  list.forEach((R) => { segs.push({ R, t0: time, tb0: time + desc, tb1: time + desc + pause, t1: time + desc + pause + asc }); time += desc + pause + asc + gap; });
  const frames = [];
  for (let i = 0; ; i++) {
    const t = i / fps;
    if (t > time) break;
    let R = {}, p = 0;
    for (const sg of segs) {
      if (t >= sg.t1) continue;
      if (t >= sg.t0) { R = sg.R; p = t < sg.tb0 ? 0.5 * (t - sg.t0) / desc : t < sg.tb1 ? 0.5 : 0.5 + 0.5 * (t - sg.tb1) / asc; }
      break;
    }
    const f = bell(p);
    const shiftX = (R.shift || 0) * stanceHalf * 2 * f;
    const hipY = ankleY - 480 + 260 * f;
    const tiltDy = R.tilt ? 20 * f : 0;
    const kneeHalf = 78 + 25 * f - (R.cave ? 70 * f : 0);
    const kneeY = ankleY - 240 + 20 * f;
    const shY = hipY - 280 + 40 * f;
    const leanX = R.lean ? Math.sin((R.lean * Math.PI) / 180) * 280 * f : 0; // 사람의 왼쪽(+x)으로 상체 기울임
    const liftY = (side) => (R.footLift === side ? 0.06 * 480 * f : 0);
    const pts = {};
    for (const [side, sgn] of [['L', 1], ['R', -1]]) {
      pts[`${side}ankle`] = { x: cx + sgn * stanceHalf, y: ankleY - liftY(side) };
      pts[`${side}heel`] = { x: cx + sgn * stanceHalf, y: ankleY + 20 - liftY(side) };
      pts[`${side}foot`] = { x: cx + sgn * (stanceHalf + 15), y: ankleY + 35 - liftY(side) };
      pts[`${side}knee`] = { x: cx + shiftX * 0.5 + sgn * kneeHalf, y: kneeY };
      pts[`${side}hip`] = { x: cx + shiftX + sgn * hipHalf, y: hipY + (side === 'L' ? tiltDy : 0) };
      pts[`${side}shoulder`] = { x: cx + shiftX + leanX + sgn * shoulderHalf, y: shY };
      pts[`${side}elbow`] = { x: cx + shiftX + leanX + sgn * 70, y: shY + 90 };
      pts[`${side}wrist`] = { x: cx + shiftX + leanX + sgn * 35, y: shY + 70 };
    }
    const idx = { shoulder: [11, 12], elbow: [13, 14], wrist: [15, 16], hip: [23, 24], knee: [25, 26], ankle: [27, 28], heel: [29, 30], foot: [31, 32] };
    const lm = new Array(33);
    const set = (k, p) => { lm[k] = { x: (p.x + noise()) / W, y: (p.y + noise()) / H, v: 0.95 }; };
    for (const [name, [li, ri]] of Object.entries(idx)) { set(li, pts[`L${name}`]); set(ri, pts[`R${name}`]); }
    const head = { x: cx + shiftX + leanX, y: shY - 90 };
    set(0, head);
    for (let k = 1; k <= 10; k++) set(k, { x: head.x + (k % 2 ? 12 : -12), y: head.y + (k > 8 ? 25 : -8) });
    set(7, { x: head.x + 25, y: head.y }); set(8, { x: head.x - 25, y: head.y });
    for (const [k, base] of [[17, 15], [19, 15], [21, 15], [18, 16], [20, 16], [22, 16]]) lm[k] = { ...lm[base] };
    frames.push({ t, lm });
  }
  return { frames, width: W, height: H, synthetic: true };
}
