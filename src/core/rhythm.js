// 무게·사람에 따라 달라지는 리듬
//
// 1) 무게(강도): 무거울수록 올라오는 속도가 느려진다 [논문 65]. 스쿼트 바 평균 추진 속도는 %1RM에 따라 거의 직선으로 줄어듦
//    [논문 66 표 2: 럭비 선수 25명, 2회 측정 n = 51]. 같은 거리를 올라오므로 올라오기 시간은 속도에 반비례한다고 보고, 70% 이하에서 쓰는
//    '올라오기 1.5초' 기준을 무거운 세트에서는 속도 비율만큼 늘린다. (영상은 바 속도가 아니라 시간을 재므로 근사)
// 2) 세트 안 속도 손실: 첫 반복 대비 마지막 반복이 얼마나 느려졌는지(%). 판정 없이 정보로만 [논문 67, 68]
// 3) 개인 리듬: 저장한 기록 중 같은 종목·비슷한 무게(±10%)의 평소 리듬과 비교
import { isNum, median } from './signal.js';

// 스쿼트 %1RM → 평균 추진 속도(m/s) [논문 66 표 2]. 다른 표본(훈련 경험 없는 청소년 여성 34명)도 거의 같은 값 [논문 69]
export const SQUAT_LV = [
  [20, 1.36], [25, 1.28], [30, 1.20], [35, 1.12], [40, 1.05], [45, 0.98], [50, 0.91], [55, 0.84], [60, 0.77],
  [65, 0.71], [70, 0.65], [75, 0.59], [80, 0.53], [85, 0.47], [90, 0.41], [95, 0.36], [100, 0.30],
];

export function velocityAt(pct) {
  if (!isNum(pct)) return NaN;
  const p = Math.max(20, Math.min(100, pct));
  for (let i = 1; i < SQUAT_LV.length; i++) {
    const [p1, v1] = SQUAT_LV[i];
    if (p <= p1) { const [p0, v0] = SQUAT_LV[i - 1]; return v0 + (v1 - v0) * (p - p0) / (p1 - p0); }
  }
  return SQUAT_LV.at(-1)[1];
}

// 기본 올라오기 상한(1.5초)은 70% 이하 기준 [초깃값]. 그보다 무거우면 속도 비율만큼 늘림
export const BASE_PCT = 70;
export function ascentMaxFor(baseMax, pct) {
  if (!isNum(pct) || pct <= BASE_PCT) return baseMax;
  return baseMax * velocityAt(BASE_PCT) / velocityAt(pct);
}

// 강도(%1RM): 바벨 무게 / 1RM. 둘 다 있어야 계산
export function intensityOf(load) {
  return load?.oneRM > 0 && load.barKg > 0 ? Math.min(110, (load.barKg / load.oneRM) * 100) : NaN;
}

// 세트 안 속도 손실(%): 처음 두 반복 중 빠른 쪽 대비 각 반복의 올라오기 시간으로 계산 (거리 같다고 가정)
export function velocityLoss(reps, t) {
  const full = reps.filter((r) => !r.partialStart && !r.partialEnd);
  const up = full.map((r) => t[r.end] - t[r.bottom]);
  if (up.length < 2) return { perRep: reps.map(() => NaN), last: NaN, max: NaN };
  const best = Math.min(...up.slice(0, 2));
  const loss = (u) => (isNum(u) && u > 0 ? Math.max(0, (1 - best / u) * 100) : NaN);
  const perRep = reps.map((r) => (r.partialStart || r.partialEnd ? NaN : loss(t[r.end] - t[r.bottom])));
  const vals = perRep.filter(isNum);
  return { perRep, last: loss(up.at(-1)), max: vals.length ? Math.max(...vals) : NaN };
}

// 개인 리듬: 저장한 세션 중 같은 종목, 바벨 무게 ±10% (맨몸은 맨몸끼리)
export function personalTempo(sessions, exId, load) {
  const bar = load?.barKg || 0;
  const same = (sessions || []).filter((s) => {
    if (s.exercise !== exId || !s.result?.tempo) return false;
    const b = s.load?.barKg || 0;
    return bar === 0 ? b === 0 : b > 0 && Math.abs(b - bar) <= bar * 0.1;
  });
  if (!same.length) return null;
  const pick = (k) => median(same.map((s) => s.result.tempo[k]).filter(isNum));
  return { descent: pick('descent'), ascent: pick('ascent'), n: same.length, barKg: bar };
}
