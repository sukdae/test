// MediaPipe Pose 33점 인덱스와 측면 선택 로직
import { median, isNum } from './signal.js';

export const SIDES = {
  left:  { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, foot: 31, ear: 7, nose: 0 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, foot: 32, ear: 8, nose: 0 },
};

export const CORE_KEYS = ['shoulder', 'hip', 'knee', 'ankle'];
// 관절 신뢰도 0.5 미만은 버린다. 품질 필터가 정확도를 크게 좌우함 [논문 28]
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

// 프레임마다 보이는 쪽(왼/오른)과 진행 방향을 정한다. 편집 영상처럼 중간에 사람이 반대로 서는 경우를 처리하기 위함.
// (실제 영상: 두 장면이 서로 반대 방향이라 영상 전체를 한 방향으로 계산하면 앞 장면이 통째로 버려졌음)
// 1) 진행 방향(발끝 쪽, 없으면 얼굴 쪽)을 약 2초 창 다수결로 정하고 3초보다 짧은 구간은 앞뒤 구간에 합친다
//    (가려짐 때문에 잠깐 뒤집히는 것 무시). 2) 구간마다 관절이 더 잘 보이는 쪽을 고른다.
// 반환: { sides[], facings[], switches, side, facing }
export function frameSides(frames, { win = 31, minRun = 3 } = {}) {
  const n = frames.length;
  const rawFace = new Array(n).fill(0), visL = new Array(n).fill(0), visR = new Array(n).fill(0);
  frames.forEach((f, i) => {
    const lm = f.lm;
    if (!lm) return;
    for (const k of CORE_KEYS) { visL[i] += visOf(lm[SIDES.left[k]]); visR[i] += visOf(lm[SIDES.right[k]]); }
    const K = SIDES[visL[i] >= visR[i] ? 'left' : 'right'];
    const h = lm[K.heel], ft = lm[K.foot], no = lm[K.nose], ea = lm[K.ear];
    if (visOf(h) >= VIS_MIN && visOf(ft) >= VIS_MIN && Math.abs(ft.x - h.x) > 0.003) rawFace[i] = Math.sign(ft.x - h.x);
    else if (visOf(no) >= VIS_MIN && visOf(ea) >= VIS_MIN && Math.abs(no.x - ea.x) > 0.002) rawFace[i] = Math.sign(no.x - ea.x);
  });
  const sum = rawFace.reduce((a, b) => a + b, 0);
  const gFace = sum >= 0 ? 1 : -1, gSide = chooseSide(frames);
  // 1) 창 다수결
  const hw = Math.floor(win / 2);
  const facings = new Array(n);
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let j = Math.max(0, i - hw); j <= Math.min(n - 1, i + hw); j++) f += rawFace[j];
    facings[i] = f === 0 ? (i ? facings[i - 1] : gFace) : f > 0 ? 1 : -1;
  }
  // 짧은 구간 합치기
  const t = frames.map((f) => f.t);
  let changed = true;
  while (changed) {
    changed = false;
    const runs = [];
    for (let i = 0; i < n; ) { let j = i; while (j + 1 < n && facings[j + 1] === facings[i]) j++; runs.push([i, j]); i = j + 1; }
    if (runs.length < 2) break;
    for (const [a, b] of runs) {
      if (t[b] - t[a] < minRun) { const v = a > 0 ? facings[a - 1] : facings[b + 1]; for (let k = a; k <= b; k++) facings[k] = v; changed = true; break; }
    }
  }
  // 2) 구간마다 잘 보이는 쪽
  const sides = new Array(n);
  for (let i = 0; i < n; ) {
    let j = i; while (j + 1 < n && facings[j + 1] === facings[i]) j++;
    let L = 0, R = 0; for (let k = i; k <= j; k++) { L += visL[k]; R += visR[k]; }
    const sd = L >= R ? 'left' : 'right';
    for (let k = i; k <= j; k++) sides[k] = sd;
    i = j + 1;
  }
  let switches = 0;
  for (let i = 1; i < n; i++) if (facings[i] !== facings[i - 1]) switches++;
  return { sides, facings, switches, side: gSide, facing: gFace };
}
