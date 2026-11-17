// 1차원 신호 처리 유틸리티 (DOM 의존 없음)

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// 한국어 조사: 마지막 글자에 받침이 있으면 a(이/과), 없으면 b(가/와)
export function josa(word, a, b) {
  const c = String(word).trim().slice(-1).charCodeAt(0);
  const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false;
  return `${word}${has ? a : b}`;
}

export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function mean(a) {
  let s = 0, n = 0;
  for (const v of a) if (isNum(v)) { s += v; n++; }
  return n ? s / n : NaN;
}

export function std(a) {
  const m = mean(a);
  let s = 0, n = 0;
  for (const v of a) if (isNum(v)) { s += (v - m) ** 2; n++; }
  return n > 1 ? Math.sqrt(s / (n - 1)) : 0;
}

export function percentile(a, p) {
  const v = a.filter(isNum).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const i = (v.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}

export const median = (a) => percentile(a, 0.5);

// NaN 구간을 선형 보간하고, 양 끝은 가장 가까운 값으로 채운다.
export function fillGaps(a) {
  const out = a.slice();
  const n = out.length;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (!isNum(out[i])) continue;
    if (prev === -1) {
      for (let k = 0; k < i; k++) out[k] = out[i];
    } else if (i - prev > 1) {
      for (let k = prev + 1; k < i; k++) out[k] = out[prev] + (out[i] - out[prev]) * (k - prev) / (i - prev);
    }
    prev = i;
  }
  if (prev === -1) return out;
  for (let k = prev + 1; k < n; k++) out[k] = out[prev];
  return out;
}

// 중심 이동평균
export function smooth(a, win = 5) {
  const h = Math.floor(win / 2);
  return a.map((_, i) => {
    let s = 0, n = 0;
    for (let k = i - h; k <= i + h; k++) {
      if (k >= 0 && k < a.length && isNum(a[k])) { s += a[k]; n++; }
    }
    return n ? s / n : NaN;
  });
}

export function argmin(a, from = 0, to = a.length - 1) {
  let b = from;
  for (let i = from; i <= to; i++) if (a[i] < a[b]) b = i;
  return b;
}

export function rangeMin(a, from, to) {
  let m = Infinity;
  for (let i = from; i <= to; i++) if (isNum(a[i]) && a[i] < m) m = a[i];
  return m === Infinity ? NaN : m;
}

export function rangeMax(a, from, to) {
  let m = -Infinity;
  for (let i = from; i <= to; i++) if (isNum(a[i]) && a[i] > m) m = a[i];
  return m === -Infinity ? NaN : m;
}
