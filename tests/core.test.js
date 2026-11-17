// 코어 로직 테스트 (브라우저: tests/index.html, Node: node --test tests/)
import { analyzeSession } from '../src/core/analyze.js';
import { generateDemo, generateFrontDemo } from '../src/core/synthetic.js';
import { analyzeFront, inward, compareFrontIdeal } from '../src/core/front.js';
import { estimateFrontMuscles } from '../src/core/muscles.js';
import { referenceAngles } from '../src/core/exercises.js';
import { chainFromAngles, leanFromVertical, kneeAngle, hipAngle } from '../src/core/geometry.js';
import { segmentReps } from '../src/core/reps.js';
import { buildReference, phaseByTempo, curveAngles } from '../src/core/reference.js';
import { getReference, IDEAL_SQUAT_FRONT } from '../src/core/exercises.js';
import { buildCoaching, mergeCoaching, compareViews } from '../src/core/coach.js';
import { josa } from '../src/core/signal.js';
import { detectView } from '../src/core/landmarks.js';
import { fuse3D, fusedRows } from '../src/core/fuse3d.js';

export const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const ids = (res) => res.feedback.map((f) => f.id);

test('기하: 기준 각도 → 관절 위치 → 각도 왕복이 일치', () => {
  for (const ex of ['squat', 'deadlift']) {
    for (const p of [0, 0.2, 0.5, 0.8]) {
      const a = referenceAngles(ex, p);
      for (const facing of [1, -1]) {
        const c = chainFromAngles(a, { x: 300, y: 900 }, { shin: 250, thigh: 250, torso: 290, neck: 80 }, facing);
        const shin = leanFromVertical(c.ankle, c.knee, facing);
        const thigh = leanFromVertical(c.knee, c.hip, facing);
        const trunk = leanFromVertical(c.hip, c.shoulder, facing);
        assert(Math.abs(kneeAngle(shin, thigh) - a.knee) < 0.01, `${ex} p=${p} knee`);
        assert(Math.abs(hipAngle(trunk, thigh) - a.hip) < 0.01, `${ex} p=${p} hip`);
      }
    }
  }
});

test('반복 분할: 깨끗한 사인 신호에서 3회', () => {
  const t = [], s = [];
  for (let i = 0; i < 300; i++) { t.push(i / 30); s.push(175 - 45 * (1 - Math.cos((2 * Math.PI * i) / 100))); }
  const reps = segmentReps(s, t, { drop: 30 });
  assert(reps.length === 3, `expected 3, got ${reps.length}`);
});

test('반복 분할: 바닥에서 시작하는 첫 반복은 partialStart', () => {
  const t = [], s = [];
  for (let i = 0; i < 250; i++) { t.push(i / 30); s.push(130 + 45 * Math.cos((2 * Math.PI * (i + 50)) / 100)); }
  const reps = segmentReps(s, t, { drop: 40 });
  assert(reps.length >= 2 && reps[0].partialStart, JSON.stringify(reps));
});

test('스쿼트 데모: 5회, 의도한 오류 감지', () => {
  const res = analyzeSession(generateDemo('squat'), 'squat');
  assert(res.reps.length === 5, `reps=${res.reps.length}`);
  assert(res.side === 'left' && res.facing === 1, `side=${res.side} facing=${res.facing}`);
  const f = ids(res);
  for (const id of ['depth-shallow', 'hips-first', 'heel-lift']) assert(f.includes(id), `missing ${id}: ${f}`);
  assert(!f.includes('trunk-lean'), 'trunk lean must not be a warning (Straub & Powers 2024)');
  const bias = res.feedback.find((x) => x.id.startsWith('trunk-bias') || x.id === 'good-bias');
  assert(bias && bias.level !== 'warn', `bias ${bias?.id}`);
  const byId = Object.fromEntries(res.feedback.map((x) => [x.id, x.reps]));
  assert(byId['depth-shallow'].join() === '3', `shallow reps ${byId['depth-shallow']}`);
  assert(byId['hips-first'].join() === '4', `hips reps ${byId['hips-first']}`);
  assert(byId['heel-lift'].join() === '5', `heel reps ${byId['heel-lift']}`);
  assert(!f.includes('fast-descent'), 'fast-descent should not fire');
});

test('엉덩이 먼저 올라오는 반복도 끝은 상체가 다 펴진 뒤', () => {
  const res = analyzeSession(generateDemo('squat'), 'squat');
  const last = res.reps[3].aligned.at(-1);
  assert(Math.abs(last.user.trunk - last.ref.trunk) < 8, `end trunk ${last.user.trunk} vs ${last.ref.trunk}`);
  assert(Math.abs(last.user.hip - last.ref.hip) < 8, `end hip ${last.user.hip} vs ${last.ref.hip}`);
});

test('스쿼트 데모: 정상 반복은 기준과 거의 일치, 위상은 단조 증가', () => {
  const res = analyzeSession(generateDemo('squat'), 'squat');
  const r1 = res.reps[0];
  assert(r1.meanAbsDiff < 5, `meanAbsDiff ${r1.meanAbsDiff}`);
  for (let i = 1; i < r1.phase.length; i++) assert(r1.phase[i] >= r1.phase[i - 1] - 1e-9, 'phase not monotonic');
  assert(Math.abs(r1.metrics.minKnee - 60) < 5, `minKnee ${r1.metrics.minKnee}`);
  assert(Math.abs(r1.metrics.thighAboveParallel) < 5, `thigh ${r1.metrics.thighAboveParallel}`);
  assert(Math.abs(r1.metrics.descent - 1.1) < 0.3, `descent ${r1.metrics.descent}`);
});

test('데드리프트 데모: 5회, 락아웃·젖힘·엉덩이 먼저 감지', () => {
  const res = analyzeSession(generateDemo('deadlift'), 'deadlift');
  assert(res.reps.length === 5, `reps=${res.reps.length}`);
  const byId = Object.fromEntries(res.feedback.map((x) => [x.id, x.reps]));
  assert(byId['hips-first']?.join() === '3', `hips ${byId['hips-first']}`);
  assert(byId['lockout']?.join() === '4', `lockout ${byId['lockout']}`);
  assert(byId['lean-back']?.join() === '5', `leanback ${byId['lean-back']}`);
  assert(!byId['squatty'], 'squatty should not fire');
});

test('프레임 15% 누락과 낮은 fps(15)에서도 반복 수 유지', () => {
  const demo = generateDemo('squat', { fps: 15, seed: 3 });
  demo.frames.forEach((f, i) => { if (i % 7 === 3) f.lm = null; });
  const res = analyzeSession(demo, 'squat');
  assert(res.reps.length === 5, `reps=${res.reps.length}`);
  assert(res.coverage < 0.9 && res.coverage > 0.8, `coverage ${res.coverage}`);
});

test('좌우 반전(왼쪽을 보는 사람)도 같은 결과', () => {
  const demo = generateDemo('squat');
  demo.frames.forEach((f) => f.lm.forEach((p) => { p.x = 1 - p.x; }));
  const res = analyzeSession(demo, 'squat');
  assert(res.facing === -1, `facing ${res.facing}`);
  assert(res.reps.length === 5 && ids(res).includes('heel-lift'), 'mirror mismatch');
});

test('코어: 등 말림 반복만 감지하고 나머지는 중립', () => {
  for (const [ex, bad] of [['squat', 4], ['deadlift', 3]]) {
    const res = analyzeSession(generateDemo(ex), ex);
    const byId = Object.fromEntries(res.feedback.map((x) => [x.id, x.reps]));
    assert(byId['back-round']?.join() === String(bad), `${ex} back-round ${byId['back-round']}`);
    for (const r of res.reps) if (r.index !== bad) assert(Math.abs(r.metrics.backRound) < 1.5, `${ex} rep${r.index} back ${r.metrics.backRound}`);
    assert(!byId['spine-note'], 'spine-note should hide when back data exists');
  }
});

test('코어: 등 데이터가 없으면(예전 기록) 곡률 판정 없이 동작', () => {
  const demo = generateDemo('deadlift');
  demo.frames.forEach((f) => { delete f.back; });
  const res = analyzeSession(demo, 'deadlift');
  const ids = res.feedback.map((f) => f.id);
  assert(ids.includes('spine-note') && !ids.includes('back-round') && !ids.includes('good-core'), ids.join());
});

test('기준 추출: 데모에서 만든 프로필의 리듬과 곡선이 원래 값과 일치', () => {
  const res = analyzeSession(generateDemo('squat', { reps: [{}, {}, {}, {}] }), 'squat');
  const ref = buildReference(res, { id: 'x', name: 'x', short: 'x' });
  // 데모: 하강 1.1초, 정지 0.15초, 상승 0.9초, 간격 2.85초
  assert(Math.abs(ref.tempo.descent - 1.1) < 0.25, `descent ${ref.tempo.descent}`);
  assert(Math.abs(ref.tempo.ascent - 1.05) < 0.3, `ascent ${ref.tempo.ascent}`);
  assert(Math.abs(ref.tempo.interval - 2.85) < 0.15, `interval ${ref.tempo.interval}`);
  const b = curveAngles(ref, 0.5);
  assert(Math.abs(b.knee - 60) < 6, `ref bottom knee ${b.knee}`);
});

test('논문 기반 기준 자세: 비교·리듬 동작, 위상 단조 증가', () => {
  const res = analyzeSession(generateDemo('squat'), 'squat', { referenceId: 'ideal' });
  assert(res.reference.id === 'ideal' && res.reference.tempo.descent === 2, 'reference missing');
  assert(res.diffs.every((d) => d.text.includes('기준보다')), res.diffs.map((d) => d.text).join('|'));
  const tempo = getReference('squat', 'ideal').tempo;
  let prev = -1;
  for (let dt = 0; dt <= 3; dt += 0.05) { const p = phaseByTempo(tempo, dt); assert(p >= prev - 1e-9 && p >= 0 && p <= 1, `phase ${p} at ${dt}`); prev = p; }
  assert(res.tempo && res.tempo.descent > 0.8, `user tempo ${JSON.stringify(res.tempo)}`);
});

test('코칭: 문제가 많으면 행동 3개만, 문제가 없으면 칭찬 칩', () => {
  const bad = buildCoaching(analyzeSession(generateDemo('squat'), 'squat', { referenceId: 'ideal' }));
  assert(bad.actions.length === 3, JSON.stringify(bad));
  assert(bad.actions.every((a) => a.text.length > 0 && !a.text.includes('°')), 'action text should be an instruction');
  const ok = buildCoaching(analyzeSession(generateDemo('squat', { reps: [{}, {}, {}] }), 'squat'));
  assert(ok.actions.every((a) => a.kind === 'pro'), JSON.stringify(ok.actions));
  assert(!ok.actions.some((a) => a.text.includes('머물지')), 'no pause advice');
  assert(ok.good.includes('발바닥 고정') && ok.good.includes('코어 안정'), ok.good.join());
});

test('논문 기준: 상체–정강이 ±10° 분류와 평행 깊이 목표', () => {
  // 정상 반복만: 기준 자세의 상체–정강이 차이 0° → 중립
  const ok = analyzeSession(generateDemo('squat', { reps: [{}, {}, {}] }), 'squat');
  assert(ok.feedback.some((f) => f.id === 'good-bias'), ok.feedback.map((f) => f.id).join());
  // 상체를 많이 숙인 반복만 → 엉덩이 위주(정보), 경고 아님
  const lean = analyzeSession(generateDemo('squat', { reps: [{ lean: 1.5 }, { lean: 1.5 }] }), 'squat');
  const b = lean.feedback.find((f) => f.id === 'trunk-bias-hip');
  assert(b && b.level === 'info' && b.ref.includes('Straub'), JSON.stringify(b));
  // 평행에 도달한 사람에게는 '더 깊이'를 권하지 않음
  const pro = buildCoaching(analyzeSession(generateDemo('squat', { reps: [{}, {}, {}] }), 'squat', { referenceId: 'ideal' }));
  assert(!pro.actions.some((a) => a.text.includes('깊이')), JSON.stringify(pro.actions));
});

test('조사: 받침에 따라 와/과, 이/가', () => {
  assert(josa('친구', '과', '와') === '친구와' && josa('기준', '과', '와') === '기준과' && josa('친구', '이', '가') === '친구가', 'josa');
});

test('정면: 5회, 무릎 모임·엉덩이 쏠림·골반 기울기를 해당 반복에서만 감지', () => {
  const res = analyzeFront(generateFrontDemo(), 'squat');
  assert(res.reps.length === 5, `reps=${res.reps.length}`);
  const byId = Object.fromEntries(res.feedback.map((x) => [x.id, x.reps]));
  assert(byId['knee-cave']?.join() === '2', `cave ${byId['knee-cave']}`);
  assert(byId['hip-shift']?.join() === '3', `shift ${byId['hip-shift']}`);
  assert(byId['pelvic-tilt']?.join() === '4', `tilt ${byId['pelvic-tilt']}`);
  const shiftItem = res.feedback.find((x) => x.id === 'hip-shift');
  assert(shiftItem.title.includes('왼쪽'), shiftItem.title);
  assert(res.stance?.category === '중간', JSON.stringify(res.stance));
  assert(res.warnings.length === 0, res.warnings.join());
});

test('정면: 상체 옆 기울기·한쪽 발 뜸 감지, 정상 반복은 좌우 코어 안정', () => {
  const res = analyzeFront(generateFrontDemo({ reps: [{}, { lean: 10 }, { footLift: 'L' }, {}] }), 'squat');
  const byId = Object.fromEntries(res.feedback.map((x) => [x.id, x]));
  assert(byId['side-lean']?.reps.join() === '2' && byId['side-lean'].title.includes('왼쪽'), JSON.stringify(byId['side-lean']));
  assert(byId['foot-lift']?.reps.join() === '3' && byId['foot-lift'].title.includes('왼발'), JSON.stringify(byId['foot-lift']));
  const ok = analyzeFront(generateFrontDemo({ reps: [{}, {}, {}] }), 'squat');
  const ids = ok.feedback.map((x) => x.id);
  assert(ids.includes('good-core-front') && ids.includes('good-base'), ids.join());
  assert(Math.abs(ok.summary.leftPct - 50) < 5, `leftPct ${ok.summary.leftPct}`);
});

test('정면 근육: 쏠린 쪽 다리가 더 높게, 측면 결과가 있으면 그 부하를 사용', () => {
  const shifted = analyzeFront(generateFrontDemo({ reps: [{ shift: 0.25 }, { shift: 0.25 }] }), 'squat');
  const q = estimateFrontMuscles(shifted).find((m) => m.id === 'quads');
  assert(q.left > q.right, `left ${q.left} right ${q.right}`);
  const side = analyzeSession(generateDemo('squat'), 'squat');
  const withSide = estimateFrontMuscles(analyzeFront(generateFrontDemo(), 'squat'), side.muscles);
  assert(withSide.every((m) => m.fromSide), 'should use side loads');
});

test('촬영 방향이 틀리면 경고: 측면 영상을 정면 분석 / 정면 영상을 측면 분석', () => {
  const f = analyzeFront(generateDemo('squat'), 'squat');
  assert(f.warnings.some((w) => w.includes('측면에 가까운')), f.warnings.join());
  const s = analyzeSession(generateFrontDemo(), 'squat');
  assert(s.warnings.some((w) => w.includes('정면에 가까운')), s.warnings.join());
});

test('둘 다: 측면+정면 코칭 합치기 (최대 3개, 경고 우선)', () => {
  const side = analyzeSession(generateDemo('squat'), 'squat');
  const front = analyzeFront(generateFrontDemo(), 'squat');
  const c = mergeCoaching(side, front);
  assert(c.actions.length === 3 && c.more >= 2, JSON.stringify(c.actions));
  assert(c.actions.every((a) => a.prio === 0), 'warnings first');
  assert(new Set(c.actions.map((a) => a.view)).size === 2, `both views in top 3: ${c.actions.map((a) => a.view)}`);
  const views = new Set(mergeCoaching(side, front, { max: 99 }).actions.map((a) => a.view));
  assert(views.has('side') && views.has('front'), [...views].join());
});

test('둘 다: 같은 세트면 경고 없음, 반복 수·리듬이 다르면 경고', () => {
  const side = analyzeSession(generateDemo('squat'), 'squat');
  assert(compareViews(side, analyzeFront(generateFrontDemo(), 'squat')).length === 0, 'same set should pass');
  const short = analyzeFront(generateFrontDemo({ reps: [{}, {}] }), 'squat');
  const w = compareViews(side, short);
  assert(w.some((x) => x.includes('반복 수가 달라요')), w.join());
});

test('사람이 없는 영상은 경고만 내고 죽지 않음', () => {
  const frames = Array.from({ length: 30 }, (_, i) => ({ t: i / 15, lm: null }));
  const res = analyzeSession({ frames, width: 640, height: 480 }, 'squat');
  assert(res.reps.length === 0 && res.warnings.length > 0, 'expected warning');
});

test('정면: 깊은 스쿼트(무릎이 엉덩이 높이 위)에서는 무릎 정렬을 재지 않음 (오탐 방지)', () => {
  // 실제 뒷모습 영상의 최저점 좌표: 무릎이 엉덩이보다 위, 무릎은 발목보다 바깥 → 예전 계산은 '안쪽 227px'로 오탐
  assert(Number.isNaN(inward({ x: 567, y: 1479 }, { x: 390, y: 1440 }, { x: 430, y: 1635 }, 607)), 'knee above hip → NaN');
  assert(inward({ x: 560, y: 1000 }, { x: 600, y: 1200 }, { x: 540, y: 1400 }, 700) > 0, 'normal cave still detected');
});

test('정면: 논문 기반 기준 자세 비교표', () => {
  const ok = compareFrontIdeal(analyzeFront(generateFrontDemo({ reps: [{}, {}, {}] }), 'squat'), IDEAL_SQUAT_FRONT);
  const by = Object.fromEntries(ok.map((r) => [r.key, r]));
  assert(by.knee.ok && by.tilt.ok && by.shift.ok && by.lean.ok, JSON.stringify(ok.map((r) => [r.key, r.ok])));
  const bad = compareFrontIdeal(analyzeFront(generateFrontDemo({ reps: [{ cave: true }, { cave: true }] }), 'squat'), IDEAL_SQUAT_FRONT);
  assert(bad.find((r) => r.key === 'knee').ok === false, 'cave should be off');
});

test('3D 합성: 측면+정면 → 대표 반복과 지표', () => {
  const side = analyzeSession(generateDemo('squat'), 'squat');
  const fz = fuse3D(side, analyzeFront(generateFrontDemo(), 'squat'));
  assert(fz && fz.poses.length === 21, 'poses');
  const b = fz.poses[10];
  assert(b.L.knee.x > 0 && b.R.knee.x < 0, 'left knee on +x');
  assert(b.L.hip.y < fz.poses[0].L.hip.y, 'hip lower at bottom');
  assert(fusedRows(fz.metrics, fz.reps).length >= 4, 'rows');
  assert(fz.reps.length >= 3, `per-rep ${fz.reps.length}`);
  const cave = fuse3D(side, analyzeFront(generateFrontDemo({ reps: [{ cave: true }, { cave: true }, { cave: true }] }), 'squat'));
  assert(cave.metrics.kneeToe.L > fz.metrics.kneeToe.L, `cave turns knee inward: ${cave.metrics.kneeToe.L} vs ${fz.metrics.kneeToe.L}`);
  assert(fuse3D(side, null) === null, 'needs both');
  const mixed = fuse3D(side, analyzeFront(generateFrontDemo({ reps: [{}, { cave: true }, {}] }), 'squat'));
  assert(mixed.reps[1].metrics.kneeToe.L > mixed.reps[0].metrics.kneeToe.L + 5, 'rep 2 knee turns inward');
});

test('촬영 방향 자동 판정', () => {
  assert(detectView(generateFrontDemo()) === 'front', 'front demo');
  assert(detectView(generateDemo('squat')) === 'side', 'side demo');
});
