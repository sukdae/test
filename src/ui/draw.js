// 캔버스에 스켈레톤·기준 동작 고스트 그리기, 근육 도식 SVG
import { EDGES, SIDES, VIS_MIN } from '../core/landmarks.js';
import { referenceAngles } from '../core/exercises.js';
import { chainFromAngles } from '../core/geometry.js';
import { isNum } from '../core/signal.js';
import { backPoints } from '../core/back.js';

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function drawSkeleton(ctx, lm, W, H, { side = null, labels = null, color } = {}) {
  if (!lm) return;
  const scale = Math.max(W, H) / 1000;
  const col = color || cssVar('--c-user') || '#38bdf8';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, 4 * scale);
  for (const [a, b] of EDGES) {
    const p = lm[a], q = lm[b];
    if (!p || !q || p.v < VIS_MIN || q.v < VIS_MIN) continue;
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(p.x * W, p.y * H); ctx.lineTo(q.x * W, q.y * H); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const keyIdx = side ? new Set(Object.values(SIDES[side])) : new Set();
  lm.forEach((p, i) => {
    if (!p || p.v < VIS_MIN || i < 11 && i !== 0) return;
    const big = keyIdx.has(i) && i >= 11;
    ctx.fillStyle = big ? '#fff' : col;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2 * scale;
    ctx.beginPath(); ctx.arc(p.x * W, p.y * H, (big ? 7 : 4) * scale, 0, Math.PI * 2); ctx.fill();
    if (big) ctx.stroke();
  });
  if (labels && side) {
    const K = SIDES[side];
    ctx.font = `600 ${Math.round(22 * scale)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const [key, val] of Object.entries(labels)) {
      const p = lm[K[key]];
      if (!p || p.v < VIS_MIN || !isNum(val)) continue;
      const text = `${Math.round(val)}°`;
      const x = p.x * W + 14 * scale, y = p.y * H;
      const w = ctx.measureText(text).width + 12 * scale;
      ctx.fillStyle = 'rgba(15,23,42,.75)';
      roundRect(ctx, x, y - 15 * scale, w, 30 * scale, 8 * scale); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x + 6 * scale, y);
    }
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// 기준 동작 고스트: 사용자의 발목 위치와 분절 길이에 기준 각도를 입혀 그린다.
export function drawGhost(ctx, exId, phase, ankle, body, W, H, profile = null) {
  if (!ankle || !isNum(ankle.x) || !isNum(body.shin)) return;
  const c = chainFromAngles(referenceAngles(exId, phase, profile), ankle, body, body.facing);
  const scale = Math.max(W, H) / 1000;
  ctx.save();
  ctx.strokeStyle = cssVar('--c-ghost') || '#e879f9';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(3, 7 * scale);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.setLineDash([14 * scale, 10 * scale]);
  ctx.beginPath();
  ctx.moveTo(c.ankle.x, c.ankle.y); ctx.lineTo(c.knee.x, c.knee.y); ctx.lineTo(c.hip.x, c.hip.y);
  ctx.lineTo(c.shoulder.x, c.shoulder.y); ctx.lineTo(c.head.x, c.head.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [c.knee, c.hip, c.shoulder]) { ctx.beginPath(); ctx.arc(p.x, p.y, 6 * scale, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.arc(c.head.x, c.head.y, 26 * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// ---- 영상 위 근육 오버레이 ----
// 분석한 쪽(카메라에 가까운 쪽) 관절을 기준으로 근육 위치를 타원으로 근사해 그린다.
// 분절은 모두 '아래 방향'(어깨→엉덩이, 엉덩이→무릎…)으로 잡고, 앞쪽 법선 = (f·dy, −f·dx).
//   [분절, 분절 위 위치 t, 앞(+)/뒤(−) 오프셋, 길이 반경, 두께 반경] (모두 분절 길이 비율)
const MUSCLE_SHAPES = {
  quads:      ['thigh', 0.50, 0.11, 0.40, 0.12],
  hamstrings: ['thigh', 0.52, -0.10, 0.36, 0.09],
  adductors:  ['thigh', 0.35, 0.00, 0.24, 0.06],
  glutes:     ['thigh', 0.02, -0.16, 0.17, 0.14],
  calves:     ['shin', 0.32, -0.10, 0.26, 0.09],
  erectors:   ['trunk', 0.72, -0.11, 0.28, 0.06],
  traps:      ['trunk', 0.10, -0.10, 0.16, 0.07],
  forearms:   ['forearm', 0.45, 0.00, 0.38, 0.10],
};
const SEGMENTS = { thigh: ['hip', 'knee'], shin: ['knee', 'ankle'], trunk: ['shoulder', 'hip'], forearm: ['elbow', 'wrist'] };
const SHORT_NAME = { quads: '대퇴사두근', glutes: '대둔근', hamstrings: '햄스트링', erectors: '척추기립근', adductors: '내전근', calves: '종아리', traps: '승모근', forearms: '전완' };

export function drawMuscles(ctx, lm, side, facing, muscles, effort, W, H, { labels = true } = {}) {
  if (!lm || !muscles?.length) return;
  const K = SIDES[side];
  const pt = (k) => { const p = lm[K[k]]; return p && p.v >= VIS_MIN ? { x: p.x * W, y: p.y * H } : null; };
  const scale = Math.max(W, H) / 1000;
  const tags = [];
  ctx.save();
  if ('filter' in ctx) ctx.filter = `blur(${Math.max(2, 5 * scale)}px)`;
  for (const m of muscles) {
    const shape = MUSCLE_SHAPES[m.id];
    if (!shape) continue;
    const [seg, t, off, rl, rw] = shape;
    const a = pt(SEGMENTS[seg][0]), b = pt(SEGMENTS[seg][1]);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L < 5) continue;
    const ux = dx / L, uy = dy / L;
    const nx = facing * uy, ny = -facing * ux; // 앞쪽 법선
    const cx = a.x + dx * t + nx * off * L, cy = a.y + dy * t + ny * off * L;
    const intensity = Math.max(0, Math.min(1, m.load * (0.3 + 0.7 * effort)));
    ctx.globalAlpha = 0.25 + 0.55 * intensity;
    ctx.fillStyle = heatColor(intensity);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rl * L, rw * L, Math.atan2(dy, dx), 0, Math.PI * 2);
    ctx.fill();
    if (m.role === '주동근') {
      // 이름표는 근육 바깥쪽(앞 근육은 앞, 뒤 근육은 뒤)으로 충분히 띄워 관절 각도 표시와 겹치지 않게 한다.
      const side = off >= 0 ? 1 : -1;
      const d = rw * L + 70 * scale;
      tags.push({ x: cx + side * nx * d, y: cy + side * ny * d, name: SHORT_NAME[m.id], color: heatColor(intensity) });
    }
  }
  ctx.restore();
  if (!labels) return;
  ctx.save();
  ctx.font = `600 ${Math.round(18 * scale)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (const g of tags) {
    const w = ctx.measureText(g.name).width + 16 * scale, h = 26 * scale;
    const x = g.x - w / 2, y = g.y - h / 2;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(15,23,42,.8)';
    roundRect(ctx, x, y, w, h, 7 * scale); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = g.color;
    ctx.fillRect(x + 5 * scale, y + 6 * scale, 3 * scale, h - 12 * scale);
    ctx.fillStyle = '#fff';
    ctx.fillText(g.name, x + 11 * scale, g.y);
  }
  ctx.restore();
}

// ---- 발바닥 접지 표시 ----
// lift: 발끝 대비 뒤꿈치 높이 변화 / 다리 길이. 양수 = 뒤꿈치 들림, 음수 = 앞꿈치 들림.
export const FOOT_LIFT_WARN = 0.03;
const FOOT_LIFT_CAUTION = 0.02;

export function footState(lift) {
  if (!isNum(lift)) return null;
  const a = Math.abs(lift);
  if (a <= FOOT_LIFT_CAUTION) return { level: 'ok', text: '발바닥 고정', color: '#22c55e' };
  if (a <= FOOT_LIFT_WARN) return { level: 'caution', text: lift > 0 ? '뒤꿈치 살짝 뜸' : '앞꿈치 살짝 뜸', color: '#f59e0b' };
  return { level: 'warn', text: lift > 0 ? '뒤꿈치 들림' : '앞꿈치 들림', color: '#ef4444' };
}

export function drawFootContact(ctx, lm, side, lift, W, H) {
  const st = footState(lift);
  if (!lm || !st) return;
  const K = SIDES[side];
  const h = lm[K.heel], f = lm[K.foot];
  if (!h || !f || h.v < VIS_MIN || f.v < VIS_MIN) return;
  const scale = Math.max(W, H) / 1000;
  const heel = { x: h.x * W, y: h.y * H }, toe = { x: f.x * W, y: f.y * H };
  const pad = 9 * scale;
  // 바닥선: 들리지 않은 쪽 끝을 기준으로 잡는다.
  const floorY = (lift > 0 ? toe.y : lift < 0 ? heel.y : Math.max(heel.y, toe.y)) + pad;
  const heelDown = !(st.level !== 'ok' && lift > 0);
  const toeDown = !(st.level !== 'ok' && lift < 0);
  const dir = Math.sign(toe.x - heel.x) || 1;
  const ext = 10 * scale;

  ctx.save();
  ctx.lineCap = 'round';
  // 바닥 그림자
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = st.color;
  ctx.lineWidth = 16 * scale;
  ctx.beginPath(); ctx.moveTo(heel.x - dir * ext, floorY); ctx.lineTo(toe.x + dir * ext, floorY); ctx.stroke();
  // 실제로 닿아 있는 구간
  ctx.globalAlpha = 1;
  ctx.lineWidth = 7 * scale;
  const x0 = heelDown ? heel.x - dir * ext : heel.x + (toe.x - heel.x) * 0.55;
  const x1 = toeDown ? toe.x + dir * ext : heel.x + (toe.x - heel.x) * 0.45;
  ctx.beginPath(); ctx.moveTo(x0, floorY); ctx.lineTo(x1, floorY); ctx.stroke();
  // 접지점
  for (const [p, down] of [[heel, heelDown], [toe, toeDown]]) {
    ctx.beginPath(); ctx.arc(p.x, floorY, 7 * scale, 0, Math.PI * 2);
    if (down) { ctx.fillStyle = st.color; ctx.fill(); }
    else { ctx.lineWidth = 3 * scale; ctx.stroke(); }
  }
  // 들린 쪽: 바닥까지 점선 + 위쪽 화살표
  const up = !heelDown ? heel : !toeDown ? toe : null;
  if (up) {
    ctx.setLineDash([6 * scale, 5 * scale]);
    ctx.lineWidth = 3 * scale;
    ctx.beginPath(); ctx.moveTo(up.x, floorY); ctx.lineTo(up.x, up.y + 4 * scale); ctx.stroke();
    ctx.setLineDash([]);
    const ay = up.y - 10 * scale;
    ctx.fillStyle = st.color;
    ctx.beginPath(); ctx.moveTo(up.x, ay - 18 * scale); ctx.lineTo(up.x - 10 * scale, ay); ctx.lineTo(up.x + 10 * scale, ay); ctx.closePath(); ctx.fill();
  }
  // 상태 이름표
  const label = `${st.level === 'ok' ? '✓' : '↑'} ${st.text}`;
  ctx.font = `700 ${Math.round(19 * scale)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(label).width + 18 * scale, hh = 30 * scale;
  const cx = (heel.x + toe.x) / 2;
  const lx = Math.max(4, Math.min(W - w - 4, cx - w / 2)), ly = Math.min(H - hh - 4, floorY + 14 * scale);
  ctx.fillStyle = 'rgba(15,23,42,.82)';
  roundRect(ctx, lx, ly, w, hh, 8 * scale); ctx.fill();
  ctx.fillStyle = st.color;
  ctx.fillText(label, lx + 9 * scale, ly + hh / 2);
  ctx.restore();
}

// ---- 등 라인 (실험) ----
// delta: 서 있을 때 대비 등 곡률 변화(%). +는 말림, −는 과신전.
export function backState(delta) {
  if (!isNum(delta)) return null;
  if (delta > 4) return { text: '등 둥글어짐 (참고)', color: '#ef4444' };
  if (delta < -4) return { text: '허리 젖혀짐 (참고)', color: '#f59e0b' };
  if (delta > 2.5) return { text: '등 중립 (주의)', color: '#f59e0b' };
  return { text: '등 중립', color: '#22c55e' };
}

export function drawBackLine(ctx, back, lm, facing, delta, W, H) {
  const st = backState(delta);
  const pts = st && backPoints(back, lm, W, H, facing);
  if (!pts) return;
  const scale = Math.max(W, H) / 1000;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // 기준 직선(현)
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.lineWidth = 2 * scale;
  ctx.setLineDash([6 * scale, 6 * scale]);
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts.at(-1).x, pts.at(-1).y); ctx.stroke();
  ctx.setLineDash([]);
  // 등 윤곽
  ctx.strokeStyle = st.color;
  ctx.lineWidth = 6 * scale;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let k = 1; k < pts.length - 1; k++) {
    const mx = (pts[k].x + pts[k + 1].x) / 2, my = (pts[k].y + pts[k + 1].y) / 2;
    ctx.quadraticCurveTo(pts[k].x, pts[k].y, mx, my);
  }
  ctx.lineTo(pts.at(-1).x, pts.at(-1).y);
  ctx.stroke();
  // 이름표
  const m = pts[Math.floor(pts.length / 2)];
  const label = `${st.text} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
  ctx.font = `700 ${Math.round(17 * scale)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(label).width + 16 * scale, h = 26 * scale;
  const lx = Math.max(4, Math.min(W - w - 4, m.x - (facing === 1 ? w + 18 * scale : -18 * scale)));
  ctx.fillStyle = 'rgba(15,23,42,.82)';
  roundRect(ctx, lx, m.y - h / 2, w, h, 7 * scale); ctx.fill();
  ctx.fillStyle = st.color;
  ctx.fillText(label, lx + 8 * scale, m.y);
  ctx.restore();
}

// ---- 정면 가이드 ----
// v: { kneeRatio, inL, inR, tilt, shift } (해당 프레임 값), T: FRONT_THRESHOLDS
export function drawFrontOverlay(ctx, lm, v, T, W, H) {
  if (!lm) return;
  const P = (i) => { const p = lm[i]; return p && p.v >= VIS_MIN ? { x: p.x * W, y: p.y * H } : null; };
  const hl = P(23), hr = P(24), kl = P(25), kr = P(26), al = P(27), ar = P(28);
  if (!hl || !hr || !kl || !kr || !al || !ar) return;
  const scale = Math.max(W, H) / 1000;
  const GOOD = '#22c55e', BAD = '#ef4444', WARN = '#f59e0b';
  const tag = (text, x, y, color) => {
    ctx.font = `700 ${Math.round(17 * scale)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 16 * scale, h = 26 * scale;
    const lx = Math.max(4, Math.min(W - w - 4, x - w / 2));
    ctx.fillStyle = 'rgba(15,23,42,.82)';
    roundRect(ctx, lx, y - h / 2, w, h, 7 * scale); ctx.fill();
    ctx.fillStyle = color; ctx.fillText(text, lx + 8 * scale, y);
  };
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // 다리 정렬: 엉덩이–무릎–발목
  for (const [h, k, a, inw] of [[hl, kl, al, v.inL], [hr, kr, ar, v.inR]]) {
    ctx.strokeStyle = isNum(inw) && inw > T.kneeInward ? BAD : GOOD;
    ctx.lineWidth = 8 * scale;
    ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(k.x, k.y); ctx.lineTo(a.x, a.y); ctx.stroke();
  }
  // 무릎 간격 vs 발목 간격
  const caving = (isNum(v.inL) && v.inL > T.kneeInward) || (isNum(v.inR) && v.inR > T.kneeInward);
  ctx.setLineDash([8 * scale, 6 * scale]);
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = 'rgba(255,255,255,.8)';
  ctx.beginPath(); ctx.moveTo(al.x, al.y + 18 * scale); ctx.lineTo(ar.x, ar.y + 18 * scale); ctx.stroke();
  ctx.strokeStyle = caving ? BAD : GOOD;
  ctx.beginPath(); ctx.moveTo(kl.x, kl.y); ctx.lineTo(kr.x, kr.y); ctx.stroke();
  ctx.setLineDash([]);
  if (isNum(v.kneeRatio)) tag(`무릎 간격 ${Math.round(v.kneeRatio * 100)}%`, (kl.x + kr.x) / 2, (kl.y + kr.y) / 2 + 30 * scale, caving ? BAD : GOOD);
  // 골반 선
  const tilted = isNum(v.tilt) && Math.abs(v.tilt) > T.pelvicTilt;
  ctx.strokeStyle = tilted ? WARN : '#38bdf8';
  ctx.lineWidth = 6 * scale;
  ctx.beginPath(); ctx.moveTo(hl.x, hl.y); ctx.lineTo(hr.x, hr.y); ctx.stroke();
  if (isNum(v.tilt)) tag(`골반 ${Math.abs(v.tilt).toFixed(0)}°`, Math.max(hl.x, hr.x) + 60 * scale, (hl.y + hr.y) / 2, tilted ? WARN : '#38bdf8');
  // 무게중심 선: 양발 가운데에서 위로, 엉덩이 중심 표시
  const am = { x: (al.x + ar.x) / 2, y: (al.y + ar.y) / 2 }, hm = { x: (hl.x + hr.x) / 2, y: (hl.y + hr.y) / 2 };
  const shifted = isNum(v.shift) && Math.abs(v.shift) > T.hipShift;
  ctx.setLineDash([6 * scale, 6 * scale]);
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2 * scale;
  ctx.beginPath(); ctx.moveTo(am.x, am.y); ctx.lineTo(am.x, hm.y - 60 * scale); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = shifted ? BAD : GOOD;
  ctx.beginPath(); ctx.arc(hm.x, hm.y, 9 * scale, 0, Math.PI * 2); ctx.fill();
  if (shifted) tag(`쏠림 ${Math.round(Math.abs(v.shift) * 100)}%`, hm.x, hm.y - 40 * scale, BAD);
  ctx.restore();
}

// ---- 정면: 논문 기반 기준 자세 고스트 ----
// 발은 내 발 위치 그대로 두고, 골반은 수평·양발 가운데, 상체는 수직, 무릎은 엉덩이–발목 선 위(깊이 앉아
// 허벅지가 수평에 가까우면 발 위)에 놓은 자세를 점선으로 그린다. 표시용 도식이며 판정에는 쓰지 않는다.
export function drawFrontGhost(ctx, lm, W, H) {
  if (!lm) return;
  const P = (i) => { const p = lm[i]; return p && p.v >= VIS_MIN ? { x: p.x * W, y: p.y * H } : null; };
  const hl = P(23), hr = P(24), kl = P(25), kr = P(26), al = P(27), ar = P(28), sl = P(11), sr = P(12);
  if (!hl || !hr || !kl || !kr || !al || !ar) return;
  const fl = P(31) || al, fr = P(32) || ar;
  const scale = Math.max(W, H) / 1000;
  const am = (al.x + ar.x) / 2, hy = (hl.y + hr.y) / 2, hHalf = Math.abs(hl.x - hr.x) / 2;
  const sgn = Math.sign(hl.x - hr.x) || 1; // 왼쪽 엉덩이가 화면 어느 쪽인지
  const hip = { L: { x: am + sgn * hHalf, y: hy }, R: { x: am - sgn * hHalf, y: hy } };
  const kneeOf = (h, k, a, f) => {
    const t = (k.y - h.y) / ((a.y - h.y) || 1);
    const lineX = h.x + (a.x - h.x) * Math.max(0, Math.min(1, t));
    const footX = (a.x + f.x) / 2;
    const w = Math.max(0, Math.min(1, (t - 0.1) / 0.3)); // 허벅지가 수평에 가까울수록 발 위로
    return { x: footX + (lineX - footX) * w, y: k.y };
  };
  const knee = { L: kneeOf(hip.L, kl, al, fl), R: kneeOf(hip.R, kr, ar, fr) };
  ctx.save();
  ctx.strokeStyle = cssVar('--c-ghost') || '#e879f9';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(3, 6 * scale);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.setLineDash([14 * scale, 10 * scale]);
  ctx.beginPath();
  ctx.moveTo(al.x, al.y); ctx.lineTo(knee.L.x, knee.L.y); ctx.lineTo(hip.L.x, hip.L.y);
  ctx.lineTo(hip.R.x, hip.R.y); ctx.lineTo(knee.R.x, knee.R.y); ctx.lineTo(ar.x, ar.y);
  if (sl && sr) {
    const torso = Math.hypot((sl.x + sr.x) / 2 - (hl.x + hr.x) / 2, (sl.y + sr.y) / 2 - hy);
    const sy = hy - torso, sHalf = Math.abs(sl.x - sr.x) / 2;
    ctx.moveTo(am, hy); ctx.lineTo(am, sy);
    ctx.moveTo(am - sHalf, sy); ctx.lineTo(am + sHalf, sy);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [knee.L, knee.R, hip.L, hip.R]) { ctx.beginPath(); ctx.arc(p.x, p.y, 6 * scale, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// ---- 정면: 바닥 지탱 (양발 체중 분배 · 발 뜸) ----
export function drawFrontBase(ctx, lm, leftPct, liftL, liftR, T, W, H) {
  if (!lm || !isNum(leftPct)) return;
  const P = (i) => { const p = lm[i]; return p && p.v >= VIS_MIN ? { x: p.x * W, y: p.y * H } : null; };
  const al = P(27), ar = P(28), fl = P(31), fr = P(32);
  if (!al || !ar) return;
  const scale = Math.max(W, H) / 1000;
  const even = Math.abs(leftPct - 50) <= T.hipShift * 100;
  ctx.save();
  ctx.font = `700 ${Math.round(16 * scale)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [a, f, pct, lift, name] of [[al, fl, leftPct, liftL, '왼'], [ar, fr, 100 - leftPct, liftR, '오']]) {
    const y = Math.max(a.y, f?.y ?? a.y) + 28 * scale;
    const lifted = isNum(lift) && lift > T.footLift;
    const color = lifted ? '#ef4444' : even ? '#22c55e' : '#f59e0b';
    const w = 70 * scale, h = 10 * scale;
    ctx.fillStyle = 'rgba(15,23,42,.6)'; ctx.fillRect(a.x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = color; ctx.fillRect(a.x - w / 2, y - h / 2, w * pct / 100, h);
    ctx.fillStyle = 'rgba(15,23,42,.82)'; roundRect(ctx, a.x - 34 * scale, y + 9 * scale, 68 * scale, 22 * scale, 6 * scale); ctx.fill();
    ctx.fillStyle = color; ctx.fillText(`${name} ${Math.round(pct)}%`, a.x, y + 20 * scale);
    if (lifted) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y - 30 * scale); ctx.lineTo(a.x - 9 * scale, a.y - 14 * scale); ctx.lineTo(a.x + 9 * scale, a.y - 14 * scale); ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// ---- 정면: 좌우 근육 사용 (추정) ----
// muscles: estimateFrontMuscles 결과, effort: 0(서 있음)~1(최저점)
export function drawFrontMuscles(ctx, lm, muscles, effort, W, H) {
  if (!lm || !muscles?.length) return;
  const P = (i) => { const p = lm[i]; return p && p.v >= VIS_MIN ? { x: p.x * W, y: p.y * H } : null; };
  const hips = [P(23), P(24)], knees = [P(25), P(26)], ankles = [P(27), P(28)];
  if ([...hips, ...knees, ...ankles].some((p) => !p)) return;
  const midX = (hips[0].x + hips[1].x) / 2;
  const scale = Math.max(W, H) / 1000;
  ctx.save();
  if ('filter' in ctx) ctx.filter = `blur(${Math.max(2, 4 * scale)}px)`;
  for (const m of muscles) {
    [0, 1].forEach((k) => {
      const h = hips[k], kn = knees[k];
      const load = k === 0 ? m.left : m.right;
      const I = Math.max(0, Math.min(1, load * (0.3 + 0.7 * effort)));
      const dx = kn.x - h.x, dy = kn.y - h.y;
      // 앉으면 허벅지가 카메라 쪽을 향해 화면상 짧아지므로, 크기는 엉덩이–발목 길이 기준으로 잡는다.
      const L = Math.max(Math.hypot(dx, dy), 0.5 * Math.hypot(ankles[k].x - h.x, ankles[k].y - h.y)) || 1;
      const out = Math.sign(h.x - midX) || 1;
      let cx, cy, rx, ry;
      if (m.id === 'quads') { cx = h.x + dx * 0.5; cy = h.y + dy * 0.5; rx = Math.max(10 * scale, L * 0.22); ry = Math.max(14 * scale, L * 0.4); }
      else if (m.id === 'adductors') { cx = h.x + dx * 0.35 - out * L * 0.16; cy = h.y + dy * 0.35; rx = L * 0.08; ry = Math.max(10 * scale, L * 0.25); }
      else { cx = h.x + out * L * 0.22; cy = h.y - L * 0.05; rx = L * 0.14; ry = L * 0.16; }
      ctx.globalAlpha = 0.35 + 0.5 * I;
      ctx.fillStyle = heatColor(I);
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, Math.hypot(dx, dy) > 0.3 * L ? Math.atan2(dy, dx) - Math.PI / 2 : 0, 0, Math.PI * 2); ctx.fill();
    });
  }
  ctx.restore();
}

// ---- 근육 부하 도식 (앞/뒤) ----
const REGIONS = {
  front: {
    quads: [[-11.5, 140, 8, 22], [11.5, 140, 8, 22]],
    adductors: [[-4.5, 128, 3.2, 12], [4.5, 128, 3.2, 12]],
  },
  back: {
    traps: [[0, 46, 18, 9]],
    erectors: [[-5.5, 88, 4, 17], [5.5, 88, 4, 17]],
    glutes: [[-10, 114, 10, 9], [10, 114, 10, 9]],
    hamstrings: [[-11.5, 146, 7, 18], [11.5, 146, 7, 18]],
    calves: [[-11.5, 186, 6, 14], [11.5, 186, 6, 14]],
    forearms: [[-37, 104, 4, 12], [37, 104, 4, 12]],
  },
};

function silhouette(cx) {
  return `
  <g class="sil">
    <circle cx="${cx}" cy="18" r="12"/>
    <rect x="${cx - 6}" y="28" width="12" height="8" rx="3"/>
    <path d="M${cx - 24} 40 Q${cx} 32 ${cx + 24} 40 L${cx + 20} 106 Q${cx} 112 ${cx - 20} 106 Z"/>
    <rect x="${cx - 34}" y="40" width="10" height="44" rx="5" transform="rotate(8 ${cx - 29} 40)"/>
    <rect x="${cx + 24}" y="40" width="10" height="44" rx="5" transform="rotate(-8 ${cx + 29} 40)"/>
    <rect x="${cx - 41}" y="86" width="9" height="38" rx="4.5" transform="rotate(4 ${cx - 36} 86)"/>
    <rect x="${cx + 32}" y="86" width="9" height="38" rx="4.5" transform="rotate(-4 ${cx + 36} 86)"/>
    <rect x="${cx - 21}" y="106" width="18" height="60" rx="8"/>
    <rect x="${cx + 3}" y="106" width="18" height="60" rx="8"/>
    <rect x="${cx - 19}" y="166" width="15" height="50" rx="7"/>
    <rect x="${cx + 4}" y="166" width="15" height="50" rx="7"/>
  </g>`;
}

export function heatColor(v) {
  // 낮음(노랑) → 높음(빨강)
  const stops = [[253, 224, 71], [249, 115, 22], [220, 38, 38]];
  const x = Math.max(0, Math.min(1, v)) * 2;
  const i = Math.min(1, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  return `rgb(${c.join(',')})`;
}

export function muscleSVG(muscles) {
  const load = Object.fromEntries(muscles.map((m) => [m.id, m]));
  const regions = (view, cx) => Object.entries(REGIONS[view]).map(([id, shapes]) => {
    const m = load[id];
    if (!m) return '';
    return shapes.map(([dx, cy, rx, ry]) => `<ellipse cx="${cx + dx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${heatColor(m.load)}" fill-opacity="${(0.45 + 0.5 * m.load).toFixed(2)}"><title>${m.name} · ${m.level}</title></ellipse>`).join('');
  }).join('');
  return `
  <svg viewBox="0 0 240 240" class="body-svg" role="img" aria-label="근육 부하 도식">
    ${silhouette(60)}${regions('front', 60)}
    ${silhouette(180)}${regions('back', 180)}
    <text x="60" y="234" text-anchor="middle" class="svg-label">앞</text>
    <text x="180" y="234" text-anchor="middle" class="svg-label">뒤</text>
  </svg>`;
}

// ---- 측면: 무게중심(앞뒤) 표시 — 서 있을 때 위치를 발 중앙(0.5)에 두고 이동만큼 옮긴 위치. 추정값 ----
export function drawBalance(ctx, lm, side, b, W, H) {
  if (!lm || !isNum(b)) return;
  const K = SIDES[side];
  const h = lm[K.heel], f = lm[K.foot];
  if (!h || !f || h.v < VIS_MIN || f.v < VIS_MIN) return;
  const scale = Math.max(W, H) / 1000;
  const heel = { x: h.x * W, y: h.y * H }, toe = { x: f.x * W, y: f.y * H };
  const bb = Math.max(-0.2, Math.min(1.2, b));
  const x = heel.x + (toe.x - heel.x) * bb;
  const y = Math.max(heel.y, toe.y) + 34 * scale;
  const ok = b >= 0.25 && b <= 0.75;
  const color = ok ? '#22c55e' : '#f59e0b';
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, y - 12 * scale); ctx.lineTo(x - 9 * scale, y + 4 * scale); ctx.lineTo(x + 9 * scale, y + 4 * scale); ctx.closePath(); ctx.fill();
  ctx.font = `700 ${Math.round(13 * scale)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(ok ? '무게중심' : b > 0.75 ? '무게중심 앞쪽' : '무게중심 뒤쪽', x, y + 7 * scale);
  ctx.restore();
}
