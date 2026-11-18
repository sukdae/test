// 코어 로직 테스트 (브라우저: tests/index.html, Node: node --test tests/)
import { analyzeSession, comOnFoot, cleanLoad } from '../src/core/analyze.js';
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
import { fuse3D, fusedRows, idealPoses } from '../src/core/fuse3d.js';

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

test('데드리프트 데모: 5회, 락아웃·젖힘 감지, 엉덩이 먼저는 경고하지 않음(논문 15·22)', () => {
  const res = analyzeSession(generateDemo('deadlift'), 'deadlift');
  assert(res.reps.length === 5, `reps=${res.reps.length}`);
  const byId = Object.fromEntries(res.feedback.map((x) => [x.id, x.reps]));
  assert(!byId['hips-first'], 'hips-first should not fire for deadlift');
  assert(byId['lockout']?.join() === '4', `lockout ${byId['lockout']}`);
  assert(byId['lean-back']?.join() === '5', `leanback ${byId['lean-back']}`);
  assert(!byId['squatty'], 'squatty should not fire');
});

test('데드리프트 기준 자세: 3단계 순서와 스티킹 포인트(논문 22)', () => {
  const at = (p) => referenceAngles('deadlift', p, getReference('deadlift', 'ideal'));
  const floor = at(0.5), stick = at(0.7), mid = at(0.85), top = at(1);
  assert(Math.abs(stick.thigh + 30) < 1 && Math.abs(stick.shin - 15) < 1, `stick thigh ${stick.thigh} shin ${stick.shin}`);
  // ① 무릎 위주: 무릎 변화 > 엉덩이 변화, ② 엉덩이 위주: 엉덩이 변화 > 무릎 변화
  assert(stick.knee - floor.knee > stick.hip - floor.hip, `phase1 knee ${stick.knee - floor.knee} hip ${stick.hip - floor.hip}`);
  assert(mid.hip - stick.hip > mid.knee - stick.knee, `phase2 hip ${mid.hip - stick.hip} knee ${mid.knee - stick.knee}`);
  assert(top.knee > 170 && top.hip > 170, 'lockout');
  assert(Math.abs(at(0.3).knee - at(0.7).knee) < 1e-9, 'descent mirrors ascent');
});

test('데드리프트 정면: 스탠스로 컨벤셔널/스모 구분', () => {
  const conv = analyzeFront(generateFrontDemo(), 'deadlift');
  assert(conv.stance && conv.stance.category !== '스모', `cat ${conv.stance?.category} ${conv.stance?.ratio}`);
  const ids = conv.feedback.map((f) => f.id);
  assert(!ids.includes('stance-wide'), 'squat stance rule not used');
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
    // 데드리프트는 반복별 단정 대신 '반복할수록 커지는지'만 본다 [논문 24, 25]
    if (ex === 'squat') assert(byId['back-round']?.join() === String(bad), `${ex} back-round ${byId['back-round']}`);
    else assert(!byId['back-round'] && !byId['dl-back-trend'], `deadlift per-rep ${byId['back-round']} trend ${byId['dl-back-trend']}`);
    assert(res.reps[bad - 1].metrics.backRound > 3, `${ex} rep${bad} measured ${res.reps[bad - 1].metrics.backRound}`);
    for (const r of res.reps) if (r.index !== bad) assert(Math.abs(r.metrics.backRound) < 1.5, `${ex} rep${r.index} back ${r.metrics.backRound}`);
    assert(!byId['spine-note'], 'spine-note should hide when back data exists');
  }
  const tired = analyzeSession(generateDemo('deadlift', { reps: [{}, {}, {}, { round: true }] }), 'deadlift');
  const trend = tired.feedback.find((f) => f.id === 'dl-back-trend');
  assert(trend && trend.reps.join() === '4', `trend ${trend?.reps}`);
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
  const cave = res.feedback.find((x) => x.id === 'knee-cave');
  assert(cave.level === 'info' && cave.title.includes('2D'), `2D 정면 무릎은 참고로만 [논문 29]: ${cave.level} ${cave.title}`);
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

test('3D 기준 자세: 내 발 위치에서 시작, 최저점에서 허벅지 평행·골반 수평', () => {
  const fz = fuse3D(analyzeSession(generateDemo('squat'), 'squat'), analyzeFront(generateFrontDemo(), 'squat'));
  const ip = idealPoses(fz);
  assert(ip && ip.length === 21, 'poses');
  const b = ip[10];
  assert(Math.abs(b.L.hip.y - b.L.knee.y) < 0.05, `thigh parallel: hip ${b.L.hip.y} knee ${b.L.knee.y}`);
  assert(Math.abs(b.L.hip.y - b.R.hip.y) < 1e-9 && b.L.hip.x > 0 && b.R.hip.x < 0, 'pelvis level, left on +x');
  assert(b.L.ankle === fz.poses[0].L.ankle, 'feet planted');
  assert(ip[0].L.hip.y > b.L.hip.y + 0.3, 'hip lower at bottom');
});

test('무게중심(앞뒤) 추정: 발 위 위치, 방향과 무관, 서 있을 때 대비 이동', () => {
  const p = { heel: { x: 100 }, foot: { x: 200 }, ankle: { x: 110 }, knee: { x: 160 }, hip: { x: 90 }, shoulder: { x: 150 } };
  const b = comOnFoot(p);
  assert(b > 0.2 && b < 0.8, `mid ${b}`);
  const fwd = comOnFoot({ ...p, shoulder: { x: 330 }, hip: { x: 200 } });
  assert(fwd > 0.75, `fwd ${fwd}`);
  const flipped = comOnFoot({ heel: { x: 200 }, foot: { x: 100 }, ankle: { x: 190 }, knee: { x: 140 }, hip: { x: 210 }, shoulder: { x: 150 } });
  assert(Math.abs(flipped - b) < 1e-9, 'facing-independent');
  const res = analyzeSession(generateDemo('squat'), 'squat');
  assert(res.reps.every((r) => Number.isFinite(r.metrics.comShift)), 'measured on demo');
});

test('무게 입력: 바벨을 포함하면 무게중심이 바벨 쪽으로, 데드리프트는 바벨 무게가 있어야 판정', () => {
  const p = { heel: { x: 100 }, foot: { x: 200 }, ankle: { x: 110 }, knee: { x: 160 }, hip: { x: 90 }, shoulder: { x: 150 }, wrist: { x: 170, v: 1 } };
  const body = comOnFoot(p), withBar = comOnFoot(p, { bodyKg: 70, barKg: 100 }, 'squat');
  assert(withBar > body && Math.abs(withBar - (body * 70 + 0.5 * 100) / 170) < 1e-9, `squat bar at shoulder ${body} → ${withBar}`);
  const dl = comOnFoot(p, { bodyKg: 70, barKg: 100 }, 'deadlift');
  assert(Math.abs(dl - (body * 70 + 0.7 * 100) / 170) < 1e-9, `deadlift bar at wrist ${dl}`);
  assert(Number.isNaN(comOnFoot({ ...p, wrist: { x: 170, v: 0.1 } }, { bodyKg: 70, barKg: 100 }, 'deadlift')), 'hidden wrist → NaN');
  assert(cleanLoad({ bodyKg: '70', barKg: '' }).barKg === 0 && cleanLoad({ bodyKg: 5 }) === null, 'clean');
  const noLoad = analyzeSession(generateDemo('deadlift'), 'deadlift');
  assert(!noLoad.feedback.some((f) => f.id.startsWith('balance') || f.id === 'good-balance'), 'deadlift without bar: no balance');
  const loaded = analyzeSession(generateDemo('deadlift'), 'deadlift', { load: { bodyKg: 70, barKg: 100 } });
  assert(loaded.load.barKg === 100 && loaded.reps.every((r) => r.metrics.withBar), 'load kept');
});

test('뒤엉킨 관절점 프레임(관절 각도 180° 초과)은 버림', () => {
  const demo = generateDemo('deadlift');
  // 마지막 20프레임의 어깨를 엉덩이 아래로 보내 불가능한 자세를 만든다 (실제 영상에서 본 현상)
  demo.frames.slice(-20).forEach((f) => { if (f.lm) { for (const i of [11, 12]) f.lm[i] = { ...f.lm[i], y: f.lm[23].y + 0.15 }; } });
  const res = analyzeSession(demo, 'deadlift');
  assert(res.series.hip.every((v) => !Number.isFinite(v) || v <= 210), 'hip angle capped');
  assert(res.reps.every((r) => r.metrics.topHip <= 210), `topHip ${res.reps.map((r) => r.metrics.topHip)}`);
});

test('측면 분석인데 정면처럼 찍힌 영상: 경고는 참고로 낮추고 다시 찍기 안내', () => {
  const res = analyzeSession(generateFrontDemo(), 'squat');
  assert(res.warnings.some((w) => w.startsWith('정면에 가까운 촬영')), 'off-angle warning');
  assert(res.feedback.every((f) => f.level !== 'warn'), 'no warn');
  const c = buildCoaching(res);
  assert(c.actions.length === 1 && c.actions[0].kind === 'retake', c.actions.map((a) => a.text).join());
});

test('중간에 방향이 바뀌는 영상: 프레임마다 방향을 정해 두 구간 모두 분석', () => {
  const a = generateDemo('squat', { reps: [{}, {}] }), b = generateDemo('squat', { reps: [{}, {}], seed: 9 });
  // b를 좌우 반전 + 왼/오른 관절 바꿈 = 반대 방향을 보고 선 사람
  const swap = [[11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32], [7, 8]];
  const T = a.frames.at(-1).t + 1 / 30;
  const flipped = b.frames.map((f) => {
    if (!f.lm) return { ...f, t: f.t + T };
    const lm = f.lm.map((p) => (p ? { ...p, x: 1 - p.x } : p));
    for (const [l, r] of swap) [lm[l], lm[r]] = [lm[r], lm[l]];
    return { ...f, t: f.t + T, lm, back: undefined };
  });
  const res = analyzeSession({ ...a, frames: [...a.frames.map((f) => ({ ...f, back: undefined })), ...flipped] }, 'squat');
  assert(res.reps.length === 4, `reps=${res.reps.length}`);
  assert(res.warnings.some((w) => w.includes('방향이 바뀐')), res.warnings.join());
  assert(res.coverage > 0.9, `coverage ${res.coverage}`);
});
