// 등 곡률 측정 (실험 기능)
//
// 관절 33점에는 척추 중간 지점이 없어 허리가 말리는지 알 수 없습니다.
// 그래서 MediaPipe가 함께 주는 사람 윤곽(세그멘테이션 마스크)에서
// 엉덩이→어깨 축을 따라 몸통의 앞·뒤 가장자리를 찾아 기록하고,
// 등 쪽 윤곽선이 곧은 선(현)에서 얼마나 바깥으로 휘었는지를 곡률로 씁니다.
//
// 절대값보다는 '서 있을 때 대비 변화량'이 의미가 있습니다.
//   변화량 > 0 : 등이 바깥으로 더 둥글어짐(말림)
//   변화량 < 0 : 등이 안쪽으로 더 꺾임(과신전)

export const BACK_LEVELS = [0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85];

const mid = (lm, a, b) => {
  const p = lm[a], q = lm[b];
  const ok = (x) => x && (x.v ?? x.visibility ?? 1) >= 0.3;
  if (ok(p) && ok(q)) return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  if (ok(p)) return { x: p.x, y: p.y };
  if (ok(q)) return { x: q.x, y: q.y };
  return null;
};

// 몸통 축 (정규화 좌표 lm → 픽셀 W×H)
export function trunkAxis(lm, W, H) {
  if (!lm) return null;
  const s = mid(lm, 11, 12), h = mid(lm, 23, 24);
  if (!s || !h) return null;
  const S = { x: s.x * W, y: s.y * H }, Hp = { x: h.x * W, y: h.y * H };
  const L = Math.hypot(S.x - Hp.x, S.y - Hp.y);
  if (L < 10) return null;
  const u = { x: (S.x - Hp.x) / L, y: (S.y - Hp.y) / L };
  return { S, H: Hp, L, u, n: { x: -u.y, y: u.x } };
}

// sample(x, y) → 0~1 (사람일 확률), mw×mh 는 마스크 크기
// 반환: { plus: [...], minus: [...] }  각 레벨에서 축 → 가장자리 거리 / 몸통 길이
export function measureTrunkEdges(sample, mw, mh, lm) {
  const ax = trunkAxis(lm, mw, mh);
  if (!ax) return null;
  const { H, L, u, n } = ax;
  const step = Math.max(1, L / 120);
  const maxD = 0.8 * L;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const plus = [], minus = [];
  for (const t of BACK_LEVELS) {
    const P = { x: H.x + u.x * L * t, y: H.y + u.y * L * t };
    const inside = (x, y) => x >= 0 && y >= 0 && x < mw && y < mh && sample(x, y) >= 0.5;
    if (!inside(P.x, P.y)) { plus.push(null); minus.push(null); continue; }
    for (const [sgn, out] of [[1, plus], [-1, minus]]) {
      let e = 0;
      for (let d = step; d <= maxD; d += step) {
        if (!inside(P.x + sgn * n.x * d, P.y + sgn * n.y * d)) break;
        e = d;
      }
      out.push(e >= maxD - step ? null : r3(e / L));
    }
  }
  return { plus, minus };
}

// 등 쪽 가장자리: 앞쪽 법선 = facing·n 이므로 등 쪽은 facing=1 일 때 minus
const backEdges = (back, facing) => (facing === 1 ? back.minus : back.plus);

// 곡률 지수: 등 윤곽선의 내부 점들이 양 끝을 잇는 현보다 바깥(+)/안쪽(−)에 있는 평균 거리, 몸통 길이 대비 %
export function backCurvature(back, facing) {
  if (!back) return NaN;
  const e = backEdges(back, facing);
  const pts = BACK_LEVELS.map((t, j) => [t, e[j]]).filter(([, v]) => typeof v === 'number');
  if (pts.length < 5) return NaN;
  const [t0, p0] = pts[0], [t1, p1] = pts[pts.length - 1];
  let sum = 0, k = 0;
  for (let j = 1; j < pts.length - 1; j++) {
    const [t, p] = pts[j];
    sum += p - (p0 + (p1 - p0) * (t - t0) / (t1 - t0));
    k++;
  }
  return (sum / k) * 100;
}

// 영상 위에 그릴 등 윤곽 점들 (픽셀)
export function backPoints(back, lm, W, H, facing) {
  const ax = trunkAxis(lm, W, H);
  if (!ax || !back) return null;
  const e = backEdges(back, facing);
  const sgn = facing === 1 ? -1 : 1;
  const out = [];
  BACK_LEVELS.forEach((t, j) => {
    if (typeof e[j] !== 'number') return;
    const px = ax.H.x + ax.u.x * ax.L * t + sgn * ax.n.x * e[j] * ax.L;
    const py = ax.H.y + ax.u.y * ax.L * t + sgn * ax.n.y * e[j] * ax.L;
    out.push({ x: px, y: py });
  });
  return out.length >= 3 ? out : null;
}
