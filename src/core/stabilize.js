// 관절점 튐 보정
//
// 원판·바가 몸을 가리면 MediaPipe 관절점이 몇 프레임 동안 원판 쪽으로 튄다(실제 바벨 스쿼트 영상: 어깨·팔꿈치 점이
// 원판 가장자리로 튀었다가 돌아옴). 관절점마다 시간축 햄펠 필터(이동 중앙값과의 거리가 영상 전체 MAD의 3배 초과)로 튀는 프레임을 찾아
// 앞뒤 프레임으로 메운다. 햄펠 필터는 부드러운(단조) 움직임은 거의 건드리지 않고 순간 튐만 걸러낸다
// (Pearson 외 2016, "Generalized Hampel Filters", EURASIP J. Adv. Signal Process. 2016:87) [참고문헌 70].
// 창 길이 0.6초, 최소 허용 오차(화면 높이의 2%)는 [초깃값].
//
// 그다음 (화면에 그릴 때만) 원판에 가린 동안 계속 떨리는 점은 2차 버터워스 저역 통과 필터를 앞뒤로 한 번씩 걸러(지연 없음) 다듬는다.
// 생체역학 교재의 신호 처리 장에서 다루는 방식이다(Winter 2009, Biomechanics and Motor Control of Human Movement 4판, 2장 신호 처리) [참고문헌 71].
// 차단 주파수 3 Hz 는 [초깃값]: 스쿼트·데드리프트 한 회(2–5초)의 움직임은 대부분 1 Hz 아래라 모양은 남고,
// 실제 바벨 스쿼트 영상(15 fps)에서 원판에 가린 어깨·팔꿈치가 프레임마다 수십 px 씩 흔들리던 떨림을 줄인다.
import { median, isNum } from './signal.js';

export const STAB_WIN_S = 0.6;
export const STAB_K = 3;
export const STAB_MIN = 0.02; // 화면 높이 대비
const VIS_KEEP = 0.5;
export const STAB_CUTOFF = 3; // Hz

// 2차 버터워스 저역 통과, 앞뒤 두 번(filtfilt). 두 번 거르면 응답이 제곱돼 -3 dB 지점이 낮아진다:
//   1/(1+r^4)^2 = 1/2 → r = (√2−1)^(1/4) ≈ 0.802 (계산으로 확인). 그래서 설계 주파수를 0.802 로 나눠 보정.
export function lowpass(a, fps, fc = STAB_CUTOFF) {
  const n = a.length;
  if (n < 7 || !(fps > 0)) return a.slice();
  const f = Math.min(fc / 0.802, fps * 0.45);
  const K = Math.tan((Math.PI * f) / fps), q = Math.SQRT2;
  const norm = 1 / (1 + q * K + K * K);
  const b0 = K * K * norm, b1 = 2 * b0, b2 = b0;
  const a1 = 2 * (K * K - 1) * norm, a2 = (1 - q * K + K * K) * norm;
  const pass = (x) => {
    const y = new Array(x.length);
    y[0] = x[0]; y[1] = x[1];
    for (let i = 2; i < x.length; i++) y[i] = b0 * x[i] + b1 * x[i - 1] + b2 * x[i - 2] - a1 * y[i - 1] - a2 * y[i - 2];
    return y;
  };
  // 양 끝 왜곡을 줄이려고 끝을 뒤집어 붙임
  const m = Math.min(n - 1, Math.round(fps));
  const pre = [], post = [];
  for (let i = m; i >= 1; i--) pre.push(2 * a[0] - a[i]);
  for (let i = n - 2; i >= n - 1 - m; i--) post.push(2 * a[n - 1] - a[i]);
  const x = [...pre, ...a, ...post];
  const y = pass(pass(x).reverse()).reverse();
  return y.slice(m, m + n);
}

// frames: [{t, lm:[{x,y,z,v}...]}...] (정규화 좌표). 같은 구조의 새 배열과 튐으로 고친 점 수를 돌려준다.
export function stabilizeFrames(frames, width = 1, height = 1, { smooth = true } = {}) {
  const n = frames?.length || 0;
  if (n < 5) return { frames, fixed: 0 };
  const t = frames.map((f) => f.t);
  const dur = t[n - 1] - t[0];
  const fps = dur > 0 ? (n - 1) / dur : 15;
  const h = Math.max(2, Math.round((fps * STAB_WIN_S) / 2));
  const J = Math.max(0, ...frames.map((f) => f.lm?.length || 0));
  const out = frames.map((f) => (f.lm ? { ...f, lm: f.lm.map((p) => (p ? { ...p } : p)) } : { ...f }));
  const aspect = width / height;
  let fixed = 0;
  for (let j = 0; j < J; j++) {
    const xs = frames.map((f) => { const p = f.lm?.[j]; return p && (p.v ?? p.visibility ?? 1) >= VIS_KEEP ? p.x * aspect : NaN; });
    const ys = frames.map((f) => { const p = f.lm?.[j]; return p && (p.v ?? p.visibility ?? 1) >= VIS_KEEP ? p.y : NaN; });
    // 1) 프레임마다 주변(자기 제외) 이동 중앙값과의 거리 = 잔차
    const res = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (!isNum(xs[i])) continue;
      const lo = Math.max(0, i - h), hi = Math.min(n, i + h + 1);
      const wx = [], wy = [];
      for (let k = lo; k < hi; k++) if (k !== i && isNum(xs[k])) { wx.push(xs[k]); wy.push(ys[k]); }
      if (wx.length < h) continue; // 주변 정보가 모자라면 판단하지 않음
      res[i] = Math.hypot(xs[i] - median(wx), ys[i] - median(wy));
    }
    // 2) 잔차의 척도는 영상 전체의 MAD 로 잡는다. 창 안의 퍼짐으로 잡으면 빠르게 움직이는 구간(올라오기)에서
    //    기준이 느슨해져 튐을 놓친다.
    const scale = 1.4826 * median(res.filter(isNum));
    const lim = Math.max(STAB_K * (isNum(scale) ? scale : 0), STAB_MIN);
    const bad = res.map((r) => isNum(r) && r > lim);
    // 튄 프레임은 양옆 정상 프레임 사이를 직선으로 메운다
    for (let i = 0; i < n; i++) {
      if (!bad[i]) continue;
      let a = i - 1; while (a >= 0 && (bad[a] || !isNum(xs[a]))) a--;
      let b = i + 1; while (b < n && (bad[b] || !isNum(xs[b]))) b++;
      const p = out[i].lm[j];
      if (a < 0 && b >= n) continue;
      const w = a < 0 ? 1 : b >= n ? 0 : (t[i] - t[a]) / ((t[b] - t[a]) || 1);
      const src = (k) => frames[k].lm[j];
      const A = a < 0 ? src(b) : src(a), B = b >= n ? src(a) : src(b);
      p.x = A.x + (B.x - A.x) * w;
      p.y = A.y + (B.y - A.y) * w;
      if (isNum(A.z) && isNum(B.z)) p.z = A.z + (B.z - A.z) * w;
      p.fixed = true;
      fixed++;
    }
  }
  // 떨림 다듬기: 관절점이 있는 프레임이 이어진 구간마다 저역 통과.
  //   화면 표시용으로만 쓴다(smooth). 분석에 쓰면 펴지는 순서 같은 짧은 타이밍 차이가 흐려진다(테스트로 확인).
  for (let j = 0; smooth && j < J; j++) {
    let i = 0;
    while (i < n) {
      if (!out[i].lm?.[j]) { i++; continue; }
      let e = i; while (e + 1 < n && out[e + 1].lm?.[j]) e++;
      if (e - i >= 6) {
        const seg = out.slice(i, e + 1).map((f) => f.lm[j]);
        const fx = lowpass(seg.map((p) => p.x), fps), fy = lowpass(seg.map((p) => p.y), fps);
        seg.forEach((p, k) => { p.x = fx[k]; p.y = fy[k]; });
      }
      i = e + 1;
    }
  }
  return { frames: out, fixed };
}
