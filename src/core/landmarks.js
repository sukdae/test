// MediaPipe Pose 33점 인덱스와 측면 선택 로직
import { median, isNum } from './signal.js';

export const SIDES = {
  left:  { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, foot: 31, ear: 7, nose: 0 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, foot: 32, ear: 8, nose: 0 },
};

export const CORE_KEYS = ['shoulder', 'hip', 'knee', 'ankle'];
export const VIS_MIN = 0.5;

// 화면에 그릴 뼈대 연결
export const EDGES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
  [0, 7], [0, 8],
];

export const visOf = (p) => (p ? (p.v ?? p.visibility ?? 1) : 0);

// 카메라에 더 잘 보이는 쪽(가시성 합이 큰 쪽)을 분석 대상으로 고른다.
export function chooseSide(frames) {
  let L = 0, R = 0;
  for (const f of frames) {
    if (!f.lm) continue;
    for (const k of CORE_KEYS) {
      L += visOf(f.lm[SIDES.left[k]]);
      R += visOf(f.lm[SIDES.right[k]]);
    }
  }
  return L >= R ? 'left' : 'right';
}

// 정규화 좌표 → 픽셀 좌표. 핵심 4관절이 모두 보이면 ok.
export function toPoints(lm, K, W, H) {
  if (!lm) return null;
  const o = {};
  for (const k in K) {
    const p = lm[K[k]];
    o[k] = p ? { x: p.x * W, y: p.y * H, v: visOf(p) } : null;
  }
  o.ok = CORE_KEYS.every((k) => o[k] && o[k].v >= VIS_MIN);
  for (const k of ['heel', 'foot', 'ear', 'nose']) if (o[k] && o[k].v < VIS_MIN) o[k] = null;
  return o;
}

// 진행 방향(앞쪽)이 화면의 +x 이면 1, -x 이면 -1
export function detectFacing(points) {
  const toe = [], face = [];
  for (const p of points) {
    if (!p) continue;
    if (p.heel && p.foot) toe.push(p.foot.x - p.heel.x);
    if (p.nose && p.ear) face.push(p.nose.x - p.ear.x);
  }
  const m = median(toe);
  if (isNum(m) && Math.abs(m) > 2) return m > 0 ? 1 : -1;
  const f = median(face);
  if (isNum(f) && Math.abs(f) > 1) return f > 0 ? 1 : -1;
  return 1;
}

// 촬영 방향 자동 판정: 어깨·엉덩이 좌우 간격 / 몸통 길이. 정면(또는 뒤)이면 크고, 측면이면 작다.
// 측면 분석의 '정면에 가까움' 경고 기준 0.5, 정면 분석의 '측면에 가까움' 경고 기준 0.35 사이에서 가른다. [초깃값]
export const VIEW_SPLIT = 0.42;
export function viewScore({ frames, width: W, height: H }) {
  const r = [];
  for (const f of frames) {
    const lm = f.lm;
    if (!lm) continue;
    const ok = (i) => lm[i] && visOf(lm[i]) >= 0.3;
    if (![11, 12, 23, 24].every(ok)) continue;
    const sx = (lm[11].x + lm[12].x) / 2 * W, sy = (lm[11].y + lm[12].y) / 2 * H;
    const hx = (lm[23].x + lm[24].x) / 2 * W, hy = (lm[23].y + lm[24].y) / 2 * H;
    const torso = Math.hypot(sx - hx, sy - hy);
    if (torso > 0) r.push((Math.abs(lm[11].x - lm[12].x) + Math.abs(lm[23].x - lm[24].x)) * W / 2 / torso);
  }
  return median(r);
}
export const detectView = (data) => { const s = viewScore(data); return isNum(s) && s >= VIEW_SPLIT ? 'front' : 'side'; };
