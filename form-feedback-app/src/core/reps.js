// 반복(rep) 자동 분할
//
// 각도 신호(스쿼트: 무릎, 데드리프트: 엉덩이)가 서 있는 높이에서 충분히 내려갔다가
// 다시 올라오면 한 번의 반복으로 셉니다. 두 임계값(히스테리시스)으로 노이즈에 의한
// 중복 카운트를 막습니다.

import { percentile, isNum } from './signal.js';

const NEAR_TOP = 4; // 꼭대기로 볼 범위(도)

export function segmentReps(sig, t, { drop = 30, minDur = 0.5 } = {}) {
  const n = sig.length;
  if (n < 3) return [];
  const top = percentile(sig, 0.9);
  if (!isNum(top)) return [];
  const hi = top - Math.max(12, drop * 0.5); // 이 위로 올라오면 '서 있음'
  const lo = top - drop;                       // 이 아래까지 내려가야 반복으로 인정

  const peakVal = (a, b) => { let m = -Infinity; for (let k = a; k <= b; k++) m = Math.max(m, sig[k]); return m; };
  const firstNearPeak = (a, b) => { const pk = peakVal(a, b); for (let k = a; k <= b; k++) if (sig[k] >= pk - NEAR_TOP) return k; return a; };
  const lastNearPeak = (a, b) => { const pk = peakVal(a, b); for (let k = b; k >= a; k--) if (sig[k] >= pk - NEAR_TOP) return k; return b; };

  const reps = [];
  const push = (r) => { if (t[r.end] - t[r.start] >= minDur) reps.push(r); };

  let state = sig[0] < hi ? 'down' : 'up';
  let cur = state === 'down' ? { start: 0, bottom: 0, reached: false, partialStart: true, partialEnd: false } : null;
  let pending = null;
  let upFrom = 0;

  for (let i = 0; i < n; i++) {
    const v = sig[i];
    if (state === 'up') {
      if (v < hi) {
        if (pending) { pending.end = firstNearPeak(upFrom, i); push(pending); pending = null; }
        cur = { start: lastNearPeak(upFrom, i), bottom: i, reached: false, partialStart: false, partialEnd: false };
        state = 'down';
      }
    } else {
      if (v < sig[cur.bottom]) cur.bottom = i;
      if (v <= lo) cur.reached = true;
      if (v >= hi) {
        state = 'up';
        upFrom = i;
        if (cur.reached) pending = cur;
        cur = null;
      }
    }
  }
  if (pending) { pending.end = firstNearPeak(upFrom, n - 1); push(pending); }
  if (state === 'down' && cur && cur.reached) { cur.end = n - 1; cur.partialEnd = true; push(cur); }

  return reps.map(({ reached, ...r }) => r);
}
