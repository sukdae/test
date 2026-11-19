// 상체 맨몸 종목(친업·딥스, 어시스트 머신 포함) 측면 분석
//
// 스쿼트·데드리프트(analyze.js)는 다리 관절 중심이라 따로 둔다. 결과 객체 모양은 analyzeSession 과 같게 맞춰
// 결과 화면·기록·공유가 그대로 동작하게 한다.
// 근거 번호는 docs/참고문헌.md 의 번호. [초깃값] = 논문에 수치가 없어 정한 값.

import { EXERCISES, getReference } from './exercises.js';
import { SIDES, VIS_MIN, frameSides, detectFacing, visOf } from './landmarks.js';
import { DEG, dist, leanFromVertical } from './geometry.js';
import { fillGaps, smooth, median, percentile, mean, isNum, rangeMin, rangeMax, argmin } from './signal.js';
import { segmentReps } from './reps.js';
import { alignRep, topDiffs } from './compare.js';
import { SERIES_KEYS } from './analyze.js';

export const UPPER_KEYS = ['elbow', 'shoulder', 'trunk', 'hip', 'mouthRel', 'wristX', 'wristY', 'hipX', 'hipY', 'shoulderX', 'shoulderY'];

export const UPPER_THRESHOLDS = {
  chinup: {
    // 꼭대기에서 입이 손목(바를 잡은 높이)보다 위에 있어야 '턱이 바 위로'로 본다 [초깃값].
    //   1회 인정 기준(턱이 바 위, 팔을 다 편 매달림)은 흔히 쓰는 기준이지만 확인한 논문에 수치가 없음
    topReach: 0,
    // 매달림에서 팔꿈치 150° 미만이면 '팔을 다 펴지 않음' [초깃값]
    hangElbow: 150,
    // 반복 안에서 엉덩이 각도가 40° 넘게 변하면 몸 반동(키핑)으로 본다 [초깃값].
    //   키핑하면 최대 엉덩이 각도가 평균 48.8° 커짐 [논문 51]
    //   처음엔 30°였으나 실제 측면 친업 영상의 일반 반복이 26–32°로 나와 경계에 걸림 → 40°
    kipHip: 40,
    // 내려오는 시간 0.7초 미만이면 '툭 떨어짐' [초깃값]
    fastLower: 0.7,
  },
  dip: {
    // 최저점 팔꿈치 굽힘 95° 미만이면 '얕음'. 경험자 평균 114.6 ± 8.6° [논문 52]의 평균 − 2SD ≈ 97° [초깃값]
    shallowFlex: 95,
    // 어깨 신전 79° 초과면 '어깨가 많이 젖혀짐'(참고). 평균 67.7 ± 11.3° [논문 52]의 평균 + 1SD [초깃값].
    //   어깨 신전이 클수록 어깨 앞쪽 부담 우려 [논문 53]
    deepShoulder: 79,
    // 위 자세 팔꿈치 굽힘 29° 초과면 '덜 폄'. 끝 자세 평균 17.4 ± 11.4° [논문 52]의 평균 + 1SD [초깃값]
    lockoutFlex: 29,
    // 앞쪽 2회 대비 뒤쪽 2회 위 자세 팔꿈치가 10° 넘게 덜 펴지면 '후반에 덜 폄' [초깃값].
    //   지치면 최저점 각도는 그대로지만 위 자세에서 어깨가 덜 펴짐 [논문 52]
    fatigueDrop: 10,
    fastLower: 0.7,
  },
};

export const UPPER_REFS = {
  youdas: 'Youdas 외 (2010)',
  dinunzio: 'Dinunzio 외 (2019)',
  mckenzieF: 'McKenzie 외 (2022, 피로)',
  mckenzieV: 'McKenzie 외 (2022, 벤치·바·링)',
  prinold: 'Prinold & Bull (2016)',
};

const angleFromDown = (v, f) => Math.atan2(f * v.x, v.y) * DEG; // 아래 방향 0°, 앞쪽 +
const wrapShoulder = (a) => { let x = a; while (x >= 240) x -= 360; while (x < -120) x += 360; return x; };

function pts(lm, K, W, H) {
  if (!lm) return null;
  const g = (i) => { const p = lm[i]; return p && visOf(p) >= VIS_MIN ? { x: p.x * W, y: p.y * H } : null; };
  const o = { shoulder: g(K.shoulder), elbow: g(K.elbow), wrist: g(K.wrist), hip: g(K.hip), knee: g(K.knee), ear: g(K.ear), nose: g(K.nose) };
  const mouth = [g(9), g(10)].filter(Boolean);
  o.mouth = mouth.length ? { x: mean(mouth.map((m) => m.x)), y: mean(mouth.map((m) => m.y)) } : null;
  o.ok = !!(o.shoulder && o.elbow && o.wrist && o.hip);
  return o;
}

// 아래팔·위팔 길이가 전체 중앙값의 0.6–1.5배를 벗어나면 그 프레임의 팔 관절점은 버린다 [초깃값].
// 튀는 구간 사이에 끼어 겨우 통과한 프레임(중앙값과 20% 넘게 차이)도 같은 구간으로 본다.
export const ARM_OK = [0.6, 1.5];
function badLengths(P, n) {
  const fa = P.map((p) => (p?.ok ? dist(p.elbow, p.wrist) : NaN));
  const ua = P.map((p) => (p?.ok ? dist(p.shoulder, p.elbow) : NaN));
  const mf = median(fa.filter(isNum)), mu = median(ua.filter(isNum));
  if (!(mf > 0 && mu > 0)) return new Array(n).fill(false);
  const r = (i) => [fa[i] / mf, ua[i] / mu];
  const off = (i, lo, hi) => r(i).some((x) => isNum(x) && (x < lo || x > hi));
  const bad = P.map((_, i) => off(i, ARM_OK[0], ARM_OK[1]));
  const near = (i) => bad.slice(Math.max(0, i - 2), i + 3).some(Boolean);
  return bad.map((b, i) => b || (off(i, 0.8, 1.25) && near(i)));
}

// 한 프레임의 상체 각도 (f = 진행 방향)
export function upperAngles(p, f) {
  const u = { x: p.shoulder.x - p.elbow.x, y: p.shoulder.y - p.elbow.y }, w = { x: p.wrist.x - p.elbow.x, y: p.wrist.y - p.elbow.y };
  const cos = (u.x * w.x + u.y * w.y) / ((Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y)) || 1);
  const elbow = Math.acos(Math.max(-1, Math.min(1, cos))) * DEG;
  const arm = angleFromDown({ x: p.elbow.x - p.shoulder.x, y: p.elbow.y - p.shoulder.y }, f);
  const down = angleFromDown({ x: p.hip.x - p.shoulder.x, y: p.hip.y - p.shoulder.y }, f);
  const shoulder = wrapShoulder(arm - down);
  const trunk = leanFromVertical(p.hip, p.shoulder, f);
  let hip = NaN;
  if (p.knee) {
    const thigh = leanFromVertical(p.knee, p.hip, f);
    hip = 180 - (trunk - thigh);
  }
  return { elbow, shoulder, trunk, hip };
}

export function analyzeUpper({ frames, width, height }, exId, { referenceId, load = null } = {}) {
  const cfg = EXERCISES[exId];
  const ref = getReference(exId, referenceId);
  const n = frames.length;
  const t = frames.map((f) => f.t);
  const fsd = frameSides(frames);
  const side = fsd.side;
  const K = SIDES[side];
  const P = frames.map((f) => pts(f.lm, K, width, height));
  // 진행 방향: 코가 귀보다 앞
  const face = P.filter((p) => p?.nose && p?.ear).map((p) => p.nose.x - p.ear.x);
  const fm = median(face);
  const facing = isNum(fm) && Math.abs(fm) > 1 ? (fm > 0 ? 1 : -1) : detectFacing([]);

  const raw = Object.fromEntries([...SERIES_KEYS, ...UPPER_KEYS].map((k) => [k, new Array(n).fill(NaN)]));
  const lens = { forearm: [], upperArm: [], torso: [], neck: [] };
  // 팔 길이가 평소와 크게 다르면 팔 관절점이 잘못 잡힌 프레임으로 본다.
  // 실제 영상: 친업 꼭대기에서 손·팔꿈치가 화면 위 가장자리에 걸려 아래팔이 평소의 10–60%로 줄고, 팔꿈치 각도가 튀어 한 반복이 둘로 나뉨
  const armBad = badLengths(P, n);
  let valid = 0;
  P.forEach((p, i) => {
    if (!p?.ok) return;
    const a = upperAngles(p, facing);
    if (!armBad[i] && !(a.elbow >= 10 && a.elbow <= 185)) return;
    valid++;
    raw.trunk[i] = a.trunk; raw.hip[i] = a.hip;
    raw.hipX[i] = p.hip.x; raw.hipY[i] = p.hip.y;
    raw.shoulderX[i] = p.shoulder.x; raw.shoulderY[i] = p.shoulder.y;
    const torso = dist(p.hip, p.shoulder);
    lens.torso.push(torso);
    if (p.ear) lens.neck.push(dist(p.shoulder, p.ear));
    if (armBad[i]) return; // 팔에 의존하는 값은 비워 두고 앞뒤 프레임으로 메운다
    raw.elbow[i] = a.elbow; raw.shoulder[i] = a.shoulder;
    raw.wristX[i] = p.wrist.x; raw.wristY[i] = p.wrist.y;
    if (p.mouth && torso > 0) raw.mouthRel[i] = (p.wrist.y - p.mouth.y) / torso;
    lens.forearm.push(dist(p.elbow, p.wrist));
    lens.upperArm.push(dist(p.shoulder, p.elbow));
  });

  const duration = n > 1 ? t[n - 1] - t[0] : 0;
  const fps = duration > 0 ? (n - 1) / duration : 15;
  let win = Math.max(3, Math.round(fps * 0.2));
  if (win % 2 === 0) win++;
  const s = {};
  for (const k of Object.keys(raw)) s[k] = raw[k].every((v) => !isNum(v)) ? raw[k] : smooth(fillGaps(raw[k]), win);
  // 무릎이 안 보이는 영상(어시스트 머신 무릎 패드 등)은 엉덩이 각도를 쓰지 않는다
  const hipSeen = raw.hip.filter(isNum).length >= valid * 0.6;
  if (!hipSeen) s.hip = new Array(n).fill(NaN);

  const coverage = n ? valid / n : 0;
  const torso = median(lens.torso);
  const body = {
    forearm: median(lens.forearm), upperArm: median(lens.upperArm), torso,
    neck: median(lens.neck) || torso * 0.3, facing, side, kind: 'upper',
    shin: NaN, thigh: NaN,
  };

  const rawReps = valid >= 3 ? segmentReps(s.elbow, t, { drop: cfg.repDrop, rise: cfg.repRise }) : [];
  const reps = rawReps.map((r, idx) => {
    const bottom = argmin(s.elbow, r.start, r.end);
    const rep = { index: idx + 1, ...r, bottom };
    rep.metrics = upperMetrics(exId, rep, s, t, hipSeen);
    Object.assign(rep, alignRep(exId, rep, s, 50, null));
    return rep;
  });

  const warnings = [];
  if (!n || !coverage) warnings.push('사람의 관절을 인식하지 못했어요. 팔과 상체가 보이는 영상인지 확인해 주세요.');
  else if (coverage < 0.7) warnings.push(`관절 인식률이 낮아요(${Math.round(coverage * 100)}%). 옆에서 팔·어깨·엉덩이가 모두 보이게 찍어 주세요.`);
  if (n && !reps.length) warnings.push('반복 동작을 찾지 못했어요. 한 세트 전체가 담긴 영상인지 확인해 주세요.');
  else if (reps.some((r) => r.partialStart || r.partialEnd)) warnings.push('영상 처음이나 끝에서 잘린 반복이 있어요. 잘린 구간은 일부만 분석했어요.');
  if (exId === 'chinup' && n && !raw.mouthRel.some(isNum)) warnings.push('입 위치를 찾지 못해 턱이 바 위로 올라갔는지는 판단하지 않았어요.');

  return {
    version: 1,
    exercise: exId,
    width, height, side, facing, fps, duration, coverage, load,
    sides: null, facings: null,
    t, series: s, frames, body,
    reps,
    feedback: evaluateUpper(exId, reps, { load }),
    muscles: upperMuscles(exId, reps),
    diffs: topDiffs(reps, { label: ref?.short || '기준', phaseKo: cfg.phaseKo }),
    tempo: null,
    reference: ref ? { id: ref.id, name: ref.name, short: ref.short, note: ref.note || null, tempo: null, metrics: null } : null,
    summary: summarizeUpper(reps),
    warnings,
  };
}

function upperMetrics(exId, r, s, t, hipSeen) {
  const { start, end, bottom: b } = r;
  const topStart = r.partialStart ? NaN : rangeMax(s.elbow, start, b);
  const topEnd = r.partialEnd ? NaN : rangeMax(s.elbow, b, end);
  const tops = [topStart, topEnd].filter(isNum);
  return {
    minElbow: rangeMin(s.elbow, start, end),
    flex: 180 - rangeMin(s.elbow, start, end),
    // 팔을 편 자세(친업 매달림 · 딥스 위 자세): 앞뒤 중 덜 편 쪽
    topElbow: tops.length ? Math.min(...tops) : NaN,
    shoulderExt: -rangeMin(s.shoulder, start, end),
    maxShoulder: rangeMax(s.shoulder, start, end),
    maxTrunk: rangeMax(s.trunk, start, end),
    reach: rangeMax(s.mouthRel, start, end),
    hipRange: hipSeen ? rangeMax(s.hip, start, end) - rangeMin(s.hip, start, end) : NaN,
    down: r.partialStart ? NaN : t[b] - t[start], // 친업: 당기기 · 딥스: 내려가기
    up: r.partialEnd ? NaN : t[end] - t[b], //       친업: 내려오기 · 딥스: 밀어 올리기
  };
}

function summarizeUpper(reps) {
  const m = (k) => mean(reps.map((r) => r.metrics[k]));
  return {
    reps: reps.length,
    minElbow: m('minElbow'), flex: m('flex'), topElbow: m('topElbow'),
    shoulderExt: m('shoulderExt'), maxShoulder: m('maxShoulder'), maxTrunk: m('maxTrunk'),
    reach: m('reach'), hipRange: m('hipRange'), down: m('down'), up: m('up'),
    meanAbsDiff: mean(reps.map((r) => r.meanAbsDiff)),
  };
}

const deg = (v) => `${Math.round(v)}°`;
const avgOf = (hit, k) => mean(hit.map((r) => r.metrics[k]));

const UPPER_RULES = {
  chinup: (T) => [
    {
      id: 'cu-top', level: 'warn', group: 'top',
      when: (m) => isNum(m.reach) && m.reach < T.topReach,
      title: '턱이 바 위로 올라가지 않아요',
      detail: () => '가장 높이 당긴 순간에도 입이 바를 잡은 손 높이보다 아래에 있어요. 턱이 바를 넘을 때까지 당겨 보세요. 힘이 부족하면 어시스트 무게를 늘려 끝까지 당기는 게 좋아요.',
    },
    {
      id: 'cu-hang', level: 'warn', group: 'hang', ref: UPPER_REFS.youdas,
      when: (m) => m.topElbow < T.hangElbow,
      title: '내려올 때 팔을 끝까지 펴지 않아요',
      detail: (hit) => `매달린 자세 팔꿈치 각도 평균 ${deg(avgOf(hit, 'topElbow'))}. 매 반복 팔을 거의 다 편 매달림에서 시작해 보세요.`,
    },
    {
      id: 'cu-kip', level: 'warn', group: 'swing', ref: UPPER_REFS.dinunzio,
      when: (m) => m.hipRange > T.kipHip,
      title: '몸 반동을 써요',
      detail: (hit) => `한 반복 안에서 엉덩이 각도가 평균 ${deg(avgOf(hit, 'hipRange'))} 바뀌어요. 반동(키핑)을 쓰면 다리·몸통이 함께 일해 팔·등 근육 활성이 낮아진다는 연구가 있어요. 팔·등 근력이 목표라면 몸을 곧게 고정하세요.`,
    },
    {
      id: 'cu-fast-lower', level: 'info', group: 'tempo',
      when: (m) => m.up < T.fastLower,
      title: '내려올 때 툭 떨어져요',
      detail: (hit) => `내려오는 시간 평균 ${avgOf(hit, 'up').toFixed(1)}초. 1초 이상에 걸쳐 천천히 내려와 보세요.`,
    },
  ],
  dip: (T) => [
    {
      id: 'dip-shallow', level: 'warn', group: 'depth', ref: UPPER_REFS.mckenzieF,
      when: (m) => m.flex < T.shallowFlex,
      title: '깊이가 얕아요',
      detail: (hit) => `최저점 팔꿈치 굽힘이 평균 ${deg(avgOf(hit, 'flex'))}예요(실험 참가자 평균 약 115°). 위팔이 바닥과 거의 평행해질 때까지 내려가 보세요. 어깨가 불편하면 무리하지 마세요.`,
    },
    {
      id: 'dip-deep', level: 'info', group: 'shoulder', ref: `${UPPER_REFS.mckenzieF}, ${UPPER_REFS.mckenzieV}`,
      when: (m) => m.shoulderExt > T.deepShoulder,
      title: '어깨가 많이 뒤로 젖혀져요 (참고)',
      detail: (hit) => `최저점에서 위팔이 몸통 뒤로 평균 ${deg(avgOf(hit, 'shoulderExt'))} 넘어가요(실험 참가자 평균 약 68°). 어깨를 많이 젖힐수록 어깨 앞쪽 부담이 커질 수 있다는 우려가 있어요. 어깨 통증이 있었다면 조금 덜 내려가세요.`,
    },
    {
      id: 'dip-lockout', level: 'warn', group: 'lockout', ref: UPPER_REFS.mckenzieF,
      when: (m) => 180 - m.topElbow > T.lockoutFlex,
      title: '위에서 팔을 끝까지 펴지 않아요',
      detail: (hit) => `위 자세 팔꿈치 각도 평균 ${deg(avgOf(hit, 'topElbow'))}. 매 반복 팔을 거의 다 펴며 마무리하세요.`,
    },
    {
      id: 'dip-fast-lower', level: 'info', group: 'tempo',
      when: (m) => m.down < T.fastLower,
      title: '내려가는 속도가 빨라요',
      detail: (hit) => `내려가는 시간 평균 ${avgOf(hit, 'down').toFixed(1)}초. 1초 이상에 걸쳐 천천히 내려가 보세요.`,
    },
  ],
};

const UPPER_GOOD = {
  chinup: [
    { group: 'top', title: '턱이 바 위까지 올라가요', ok: (reps) => reps.some((r) => isNum(r.metrics.reach)) },
    { group: 'hang', title: '매달림에서 팔을 끝까지 펴요' },
    { group: 'swing', title: '반동 없이 당겨요', ok: (reps) => reps.some((r) => isNum(r.metrics.hipRange)) },
  ],
  dip: [
    { group: 'depth', title: '깊이가 충분해요' },
    { group: 'lockout', title: '위에서 팔을 끝까지 펴요' },
  ],
};

export function evaluateUpper(exId, reps, { load = null } = {}) {
  if (!reps.length) return [];
  const T = UPPER_THRESHOLDS[exId];
  const items = [], fired = new Set();
  const push = (o) => items.push({ ref: null, reps: [], count: 0, total: reps.length, ...o });
  for (const rule of UPPER_RULES[exId](T)) {
    const hit = reps.filter((r) => { try { return rule.when(r.metrics) === true; } catch { return false; } });
    if (!hit.length) continue;
    fired.add(rule.group);
    push({ id: rule.id, level: rule.level, title: rule.title, detail: rule.detail(hit), ref: rule.ref || null, reps: hit.map((r) => r.index), count: hit.length });
  }
  // 딥스: 세트 후반에 위 자세가 덜 펴지는지 (피로) [논문 52]
  if (exId === 'dip') {
    const tops = reps.map((r) => r.metrics.topElbow).filter(isNum);
    if (tops.length >= 4) {
      const first = mean(tops.slice(0, 2)), last = mean(tops.slice(-2));
      if (first - last > T.fatigueDrop && !fired.has('lockout')) {
        push({ id: 'dip-fatigue', level: 'info', group: 'lockout', ref: UPPER_REFS.mckenzieF, title: '후반으로 갈수록 덜 펴요 (참고)',
          detail: `처음 2회보다 마지막 2회에서 위 자세 팔꿈치가 ${deg(first - last)} 덜 펴져요. 지치면 위 자세에서 덜 펴진다는 연구가 있어요. 반복 수나 보조 무게를 조절해 보세요.`,
          reps: reps.slice(-2).map((r) => r.index), count: 2 });
        fired.add('lockout');
      }
    }
  }
  if (exId === 'chinup' && reps.every((r) => !isNum(r.metrics.hipRange))) {
    push({ id: 'cu-legs-note', level: 'info', title: '다리가 안 보여 반동은 보지 않았어요', detail: '무릎이 보이지 않아(어시스트 머신 무릎 패드 등) 몸 반동은 판단하지 않았어요.' });
  }
  if (load?.bodyKg && load.barKg > 0) {
    const eff = Math.max(0, load.bodyKg - load.barKg);
    push({ id: 'assist-load', level: 'info', title: `실제로 드는 무게 약 ${Math.round(eff)}kg`, detail: `몸무게 ${load.bodyKg}kg − 보조 ${load.barKg}kg. 보조 무게를 조금씩 줄여 가면 기록에서 변화를 볼 수 있어요.` });
  }
  for (const g of UPPER_GOOD[exId]) {
    if (fired.has(g.group)) continue;
    if (g.ok && !g.ok(reps)) continue;
    push({ id: `good-${g.group}`, level: 'good', title: g.title, detail: '' });
  }
  const order = { warn: 0, info: 1, good: 2 };
  return items.sort((a, b) => order[a.level] - order[b.level]);
}

// 근육: 근전도 연구의 근육별 활성 수준을 그대로 보여 준다(반복별 추정 없음).
//   친업 %MVIC: 광배근 117–130, 이두근 78–96, 극하근 71–79, 하부 승모근 45–56, 대흉근 44–57 [논문 50]
//   딥스: 바 딥은 삼두근·대흉근을 효과적으로 씀 [논문 52, 53]
const UPPER_MUSCLES = {
  chinup: [
    ['lats', '광배근', '주동근', 0.95],
    ['biceps', '이두근', '주동근', 0.8],
    ['infraspinatus', '극하근', '보조근', 0.7],
    ['traps', '하부 승모근', '안정화', 0.5],
    ['pecs', '대흉근', '보조근', 0.5],
  ],
  dip: [
    ['triceps', '삼두근', '주동근', 0.85],
    ['pecs', '대흉근', '주동근', 0.8],
  ],
};
export function upperMuscles(exId, reps) {
  if (!reps.length) return [];
  return UPPER_MUSCLES[exId].map(([id, name, role, load]) => ({ id, name, role, load, level: load < 0.35 ? '낮음' : load < 0.65 ? '보통' : '높음' }));
}
