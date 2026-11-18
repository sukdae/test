// 결과 화면: 스켈레톤·기준 동작 오버레이 재생, 지표 카드, 피드백, 비교 그래프, 근육 도식
import { EXERCISES, referenceAngles, getReference, REFERENCES } from '../core/exercises.js';
import { analyzeSession } from '../core/analyze.js';
import { phaseByTempo } from '../core/reference.js';
import { renderVersus } from './versus.js';
import { buildCoaching } from '../core/coach.js';
import { disposeFrontResult } from './frontResult.js';
import { setSetting, getSettings } from './storage.js';
import { topDiffs } from '../core/compare.js';
import { toCSV } from '../core/analyze.js';
import { isNum, mean, median, percentile, clamp } from '../core/signal.js';
import { drawSkeleton, drawGhost, drawMuscles, drawFootContact, drawBalance, drawBackLine, FOOT_LIFT_WARN, muscleSVG, heatColor, cssVar } from './draw.js';
import { lineChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const deg = (v) => (isNum(v) ? `${Math.round(v)}°` : '–');
const sec = (v) => (isNum(v) ? `${v.toFixed(1)}초` : '–');

let ac = null, raf = 0;

export function disposeResult() {
  cancelAnimationFrame(raf);
  ac?.abort();
  ac = null;
  const v = $('resultVideo');
  v.pause();
  v.removeAttribute('src');
  v.load();
}

export function showResult(result, opts = {}) {
  const { videoUrl = null, saved = false, demo = false, onSave, onAgain, startTime = null, coach: coachOverride = null, onSwitch = null } = opts;
  disposeFrontResult();
  disposeResult();
  $('view-result').dataset.view = 'side';
  ac = new AbortController();
  const sig = { signal: ac.signal };
  const ex = EXERCISES[result.exercise];
  const profile = getReference(result.exercise, result.reference?.id);
  const refProfile = profile?.curves ? profile : null;
  const refLabel = result.reference?.short || '기준';
  const { t, series: s, reps, body } = result;
  const W = result.width, H = result.height;
  const T0 = t[0] ?? 0, T1 = t[t.length - 1] ?? 0;
  const COLORS = { knee: cssVar('--c-knee'), hip: cssVar('--c-hip'), trunk: cssVar('--c-trunk') };

  // ---- 배너 ----
  const banner = [];
  if (demo) banner.push(`<div class="banner info">예시 (합성 데이터)</div>`);
  for (const w of result.warnings) banner.push(`<div class="banner warn">${esc(w)}</div>`);
  $('resultBanner').innerHTML = banner.join('');

  // ---- 플레이어 ----
  const v = $('resultVideo'), canvas = $('resultCanvas'), stage = $('resultStage');
  canvas.width = W; canvas.height = H;
  stage.style.aspectRatio = `${W} / ${H}`;
  stage.classList.toggle('no-video', !videoUrl);
  const clock = { time: T0, playing: false, last: 0, rate: 1 };
  if (videoUrl) { v.hidden = false; v.src = videoUrl; v.currentTime = 0; } else { v.hidden = true; }
  const rateSel = $('rate');
  rateSel.value = '1';
  const getTime = () => (videoUrl ? v.currentTime : clock.time);
  const isPlaying = () => (videoUrl ? !v.paused && !v.ended : clock.playing);
  const setTime = (x) => { x = Math.max(T0, Math.min(T1, x)); if (videoUrl) v.currentTime = x; else clock.time = x; };
  const play = () => { if (videoUrl) v.play().catch(() => {}); else { if (clock.time >= T1) clock.time = T0; clock.playing = true; clock.last = performance.now(); } };
  const pause = () => { if (videoUrl) v.pause(); else clock.playing = false; };

  $('playBtn').addEventListener('click', () => (isPlaying() ? pause() : play()), sig);
  rateSel.addEventListener('change', () => { const r = Number(rateSel.value); v.playbackRate = r; clock.rate = r; }, sig);
  $('seek').addEventListener('input', (e) => setTime(T0 + (T1 - T0) * (Number(e.target.value) / 1000)), sig);
  const showSkel = $('showSkel'), showGhost = $('showGhost'), showMuscle = $('showMuscle'), showFeet = $('showFeet'), showBack = $('showBack');
  // 발바닥 접지: 발끝 대비 뒤꿈치 높이 변화(양수 = 뒤꿈치 들림)
  const heelBase = median(s.heelRel), legLen = body.shin + body.thigh;
  // 앞꿈치 방향(음수)은 똑바로 설 때 랜드마크가 미세하게 바뀌며 생기는 오탐이라 표시하지 않는다.
  const footLift = (i) => (isNum(s.heelRel?.[i]) && isNum(heelBase) ? Math.max(0, (heelBase - s.heelRel[i]) / legLen) : NaN);
  // 동작 강도: 서 있을 때 0, 가장 깊이 내려갔을 때 1 → 근육 색 진하기에 반영
  const sigArr = s[ex.repSignal];
  const sigTop = percentile(sigArr, 0.9), sigBot = percentile(sigArr, 0.02);
  const effortAt = (i) => (isNum(sigArr[i]) ? clamp((sigTop - sigArr[i]) / ((sigTop - sigBot) || 1)) : 0);

  const frameAt = (time) => {
    let lo = 0, hi = t.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid] <= time) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const repAt = (i) => reps.find((r) => i >= r.start && i <= r.end);

  // ---- 반복 선택 ----
  let selected = 0;
  const chips = $('repChips');
  const renderChips = () => {
    chips.innerHTML = [`<button role="tab" data-rep="0" aria-selected="${selected === 0}">전체</button>`]
      .concat(reps.map((r) => `<button role="tab" data-rep="${r.index}" aria-selected="${selected === r.index}">${r.index}회${r.partialStart || r.partialEnd ? '*' : ''}</button>`))
      .join('');
  };
  const select = (k) => {
    selected = k;
    renderChips();
    renderCards();
    renderCompare();
    renderTimeline();
    if (k) { setTime(t[reps[k - 1].start]); }
  };
  chips.addEventListener('click', (e) => { const b = e.target.closest('button[data-rep]'); if (b) select(Number(b.dataset.rep)); }, sig);

  // ---- 지표 카드 ----
  const refBottom = referenceAngles(result.exercise, 0.5, refProfile);
  const refTop = referenceAngles(result.exercise, 0, refProfile);
  const renderCards = () => {
    const r = selected ? reps[selected - 1] : null;
    const m = r ? r.metrics : result.summary;
    const diff = r ? r.meanAbsDiff : result.summary.meanAbsDiff;
    const cards = [];
    if (!r) cards.push(['반복 수', `${reps.length}회`, '자동 구분']);
    if (result.exercise === 'squat') {
      cards.push(['허벅지 각도 (수평 기준)', isNum(m.thighAboveParallel) ? (m.thighAboveParallel <= 0 ? `평행 아래 ${Math.round(-m.thighAboveParallel)}°` : `+${Math.round(m.thighAboveParallel)}°`) : '–', '0° = 평행, 작을수록 깊음']);
      cards.push(['최저점 무릎 각도', deg(m.minKnee), `기준 ${deg(refBottom.knee)}`]);
      cards.push(['최저점 엉덩이 각도', deg(m.minHip), `기준 ${deg(refBottom.hip)}`]);
      cards.push(['최대 상체 기울기', deg(m.maxTrunk), `기준 ${deg(refBottom.trunk)}`]);
      cards.push(['하강 / 상승', `${sec(m.descent)} / ${sec(m.ascent)}`, '동작 속도']);
      if (!r && reps.length > 1) cards.push(['깊이 편차', `±${Math.round(result.summary.depthStd)}°`, '반복 간 일관성']);
    } else {
      cards.push(['최고점 엉덩이 각도', deg(m.topHip), `기준 ${deg(refTop.hip)}`]);
      cards.push(['최저점 엉덩이 각도', deg(m.minHip), `기준 ${deg(refBottom.hip)}`]);
      cards.push(['최저점 무릎 각도', deg(m.minKnee), `기준 ${deg(refBottom.knee)}`]);
      cards.push(['최대 상체 기울기', deg(m.maxTrunk), `기준 ${deg(refBottom.trunk)}`]);
      cards.push(['당기기 시간', sec(m.ascent), '최저점 → 최고점']);
    }
    const lifted = (rr) => rr.metrics.heelLift > FOOT_LIFT_WARN;
    // 데드리프트 측면은 원판이 발을 가려 발 관절점이 부정확하고, 판정 규칙도 없어 카드를 숨긴다
    if (result.exercise === 'deadlift') { /* 생략 */ } else if (r) cards.push(['발바닥 접지', lifted(r) ? '뒤꿈치 들림' : '고정 ✓', `최대 들림 ${(r.metrics.heelLift * 100).toFixed(1)}% (다리 길이 대비)`]);
    else if (reps.length) cards.push(['발바닥 접지', `${reps.filter((x) => !lifted(x)).length}/${reps.length}회 고정`, '뒤꿈치가 발끝 대비 뜨지 않음']);
    if (isNum(m.backRound)) cards.push(['등 곡률 변화 (실험)', `${m.backRound >= 0 ? '+' : ''}${m.backRound.toFixed(1)}%`, m.backRound > 4 ? '서 있을 때보다 둥글어짐 (참고)' : m.backRound < -4 ? '서 있을 때보다 젖혀짐 (참고)' : '서 있을 때와 비슷 (±4% 이내)']);
    const balOn = result.exercise !== 'deadlift' || result.load?.barKg > 0;
    if (balOn && isNum(m.comShift)) cards.push(['무게중심 이동 (추정)', Math.abs(m.comShift) <= 0.25 ? '안정 ✓' : m.comShift > 0 ? '앞으로 쏠림' : '뒤로 쏠림', `최저점 · 서 있을 때보다 발 길이의 ${m.comShift >= 0 ? '+' : '−'}${Math.round(Math.abs(m.comShift) * 100)}%${result.load?.barKg > 0 ? ` · 바벨 ${result.load.barKg}kg 포함` : ''}`]);
    if (!r && result.load) cards.push(['무게', `몸 ${result.load.bodyKg}kg · 바벨 ${result.load.barKg}kg`, '입력값 (기기에만 저장)']);
    if (isNum(m.trunkWobble)) cards.push(['상체 흔들림', `±${m.trunkWobble.toFixed(1)}°`, m.trunkWobble > 2.5 ? '흔들림 있음' : '안정']);
    cards.push(['기준과 평균 차이', isNum(diff) ? `${Math.round(diff)}°` : '–', '세 각도 평균']);
    $('metricCards').innerHTML = cards.map(([k, val, sub]) => `<div class="metric"><span>${k}</span><b>${val}</b><small>${sub}</small></div>`).join('');
  };

  // ---- 피드백 ----
  const ICON = { warn: '⚠︎', info: 'ℹ︎', good: '✓' };
  $('feedbackList').innerHTML = result.feedback.length
    ? result.feedback.map((f) => `
      <li class="fb ${f.level}">
        <span class="fb-icon" aria-hidden="true">${ICON[f.level]}</span>
        <div><b>${esc(f.title)}</b>${f.count && f.total > 1 ? ` <span class="muted">· ${f.total}회 중 ${f.count}회</span>` : ''}
          ${f.detail ? `<p>${esc(f.detail)}</p>` : ''}
          ${f.ref ? `<p class="ref">근거: ${esc(f.ref)}</p>` : ''}
          ${f.reps.length && f.total > 1 ? `<div class="mini-chips">${f.reps.map((k) => `<button data-rep="${k}">${k}회 보기</button>`).join('')}</div>` : ''}
        </div>
      </li>`).join('')
    : '<li class="fb info"><span class="fb-icon">ℹ︎</span><div>분석할 반복이 없어 피드백을 만들지 못했어요.</div></li>';
  $('feedbackList').addEventListener('click', (e) => { const b = e.target.closest('button[data-rep]'); if (b) { select(Number(b.dataset.rep)); $('resultStage').scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, sig);

  // ---- 기준 비교 그래프 ----
  const full = reps.filter((r) => !r.partialStart && !r.partialEnd);
  const renderCompare = () => {
    const canvasEl = $('compareChart');
    let aligned, label;
    if (selected) { aligned = reps[selected - 1].aligned; label = `${selected}번째 반복`; }
    else if (full.length) {
      aligned = full[0].aligned.map((a, j) => ({
        phase: a.phase, ref: a.ref,
        user: Object.fromEntries(['knee', 'hip', 'trunk'].map((f) => [f, mean(full.map((r) => r.aligned[j].user[f]))])),
      }));
      label = `전체 ${full.length}회 평균`;
    } else if (reps.length) { aligned = reps[0].aligned; label = '1번째 반복'; }
    if (!aligned) { $('compareSub').textContent = '비교할 반복이 없어요.'; lineChart(canvasEl, { height: 60, xMin: 0, xMax: 1, yMin: 0, yMax: 1, series: [], legend: false }); $('diffList').innerHTML = ''; return; }
    $('compareSub').textContent = `${label} · 실선 = 나, 점선 = ${refLabel}`;
    const xs = aligned.map((a) => a.phase);
    const series = [];
    for (const f of ['knee', 'hip', 'trunk']) {
      series.push({ xs, ys: aligned.map((a) => a.ref[f]), color: COLORS[f], dash: true });
      series.push({ xs, ys: aligned.map((a) => a.user[f]), color: COLORS[f], label: { knee: '무릎', hip: '엉덩이', trunk: '상체 기울기' }[f], width: 2.5 });
    }
    lineChart(canvasEl, {
      height: 220, xMin: 0, xMax: 1, yMin: -20, yMax: 190, yTicks: [0, 45, 90, 135, 180],
      xTicks: [{ x: 0, label: '시작' }, { x: 0.5, label: '최저점' }, { x: 1, label: '끝' }],
      bands: [{ x0: 0.4, x1: 0.6 }], series,
    });
    const diffs = selected ? topDiffs([reps[selected - 1]]) : result.diffs;
    $('diffList').innerHTML = diffs.length
      ? diffs.map((d) => `<li><span class="dot" style="background:${COLORS[d.feature]}"></span>${esc(d.text)}</li>`).join('')
      : '<li class="muted">기준과 크게(8° 이상) 다른 구간이 없어요.</li>';
  };

  // ---- 타임라인 ----
  let tl = null;
  const renderTimeline = (cursor = getTime()) => {
    tl = lineChart($('timelineChart'), {
      height: 200, xMin: T0, xMax: T1, yMin: -20, yMax: 190, yTicks: [0, 45, 90, 135, 180],
      xTicks: niceTimeTicks(T0, T1),
      bands: reps.map((r) => ({ x0: t[r.start], x1: t[r.end], label: String(r.index), active: r.index === selected })),
      series: [
        { xs: t, ys: s.knee, color: COLORS.knee, label: '무릎' },
        { xs: t, ys: s.hip, color: COLORS.hip, label: '엉덩이' },
        { xs: t, ys: s.trunk, color: COLORS.trunk, label: '상체 기울기' },
      ],
      cursor,
    });
  };
  $('timelineChart').addEventListener('click', (e) => {
    if (!tl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTime(tl.xFromPixel(e.clientX - rect.left));
  }, sig);

  // ---- 근육 ----
  $('muscleView').innerHTML = result.muscles.length
    ? `${muscleSVG(result.muscles)}
      <ul class="muscle-list">${result.muscles.map((m) => `
        <li><span class="swatch" style="background:${heatColor(m.load)}"></span><b>${m.name}</b><small>${m.role}</small><span class="lvl lvl-${m.level}">${m.level}</span></li>`).join('')}
      </ul>`
    : '<p class="muted">반복이 감지되지 않아 추정할 수 없어요.</p>';

  // ---- 버튼 ----
  const saveBtn = $('saveBtn');
  const markSaved = () => { saveBtn.disabled = true; saveBtn.textContent = '저장됨 ✓'; };
  if (saved) markSaved(); else { saveBtn.disabled = demo || !reps.length; saveBtn.textContent = demo ? '예시는 저장하지 않아요' : '기록 저장'; }
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try { await onSave?.(); markSaved(); } catch (e) { saveBtn.disabled = false; alert(`저장하지 못했어요: ${e.message}`); }
  }, sig);
  $('csvBtn').addEventListener('click', () => {
    const blob = new Blob(['﻿' + toCSV(result)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `formcheck-${result.exercise}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, sig);
  $('againBtn').addEventListener('click', () => onAgain?.(), sig);
  window.addEventListener('resize', () => { renderCompare(); renderTimeline(); }, sig);

  // ---- 렌더 루프 ----
  const ctx = canvas.getContext('2d');
  let lastDrawn = -1, lastTl = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (!videoUrl && clock.playing) {
      clock.time += ((now - clock.last) / 1000) * clock.rate;
      clock.last = now;
      if (clock.time >= T1) { clock.time = T1; clock.playing = false; }
    }
    let time = getTime();
    if (selected && isPlaying()) {
      const r = reps[selected - 1];
      if (time > t[r.end] + 0.3) { setTime(t[r.start]); time = t[r.start]; }
    }
    $('playBtn').textContent = isPlaying() ? '❚❚' : '▶';
    const i = frameAt(time);
    const key = `${i}|${showSkel.checked}|${showGhost.checked}|${showMuscle.checked}|${showFeet.checked}|${showBack.checked}|${ghostMode.value}`;
    if (key !== lastDrawn) {
      lastDrawn = key;
      ctx.clearRect(0, 0, W, H);
      if (!videoUrl) { ctx.fillStyle = cssVar('--stage-bg'); ctx.fillRect(0, 0, W, H); drawFloor(ctx, W, H, s.ankleY[i]); }
      if (showMuscle.checked) drawMuscles(ctx, result.frames[i]?.lm, result.sides?.[i] || result.side, result.facings?.[i] || result.facing, result.muscles, effortAt(i), W, H);
      if (showGhost.checked) {
        const r = repAt(i);
        const tempoMode = ghostMode.value === 'tempo' && result.reference?.tempo;
        const phase = !r ? 0 : tempoMode ? phaseByTempo(result.reference.tempo, t[i] - t[r.start]) : r.phase[i - r.start];
        drawGhost(ctx, result.exercise, phase, { x: s.ankleX[i], y: s.ankleY[i] }, result.facings ? { ...body, facing: result.facings[i] } : body, W, H, refProfile);
      }
      if (showFeet.checked) { if (result.exercise !== 'deadlift') drawFootContact(ctx, result.frames[i]?.lm, result.sides?.[i] || result.side, footLift(i), W, H); if (result.exercise !== 'deadlift' || result.load?.barKg > 0) drawBalance(ctx, result.frames[i]?.lm, result.sides?.[i] || result.side, isNum(s.comShift?.[i]) ? 0.5 + s.comShift[i] : NaN, W, H); }
      if (showBack.checked) drawBackLine(ctx, result.frames[i]?.back, result.frames[i]?.lm, result.facings?.[i] || result.facing, s.backDelta?.[i], W, H);
      if (showSkel.checked) drawSkeleton(ctx, result.frames[i]?.lm, W, H, { side: result.sides?.[i] || result.side, labels: { knee: s.knee[i], hip: s.hip[i] } });
      $('seek').value = String(Math.round(((time - T0) / (T1 - T0 || 1)) * 1000));
    }
    if (more.open && now - lastTl > 120) { lastTl = now; renderTimeline(time); }
  };

  // ---- 비교 기준 선택 · 나 vs 기준 ----
  const ghostMode = $('ghostMode');
  ghostMode.disabled = !result.reference?.tempo;
  if (ghostMode.disabled) ghostMode.value = 'sync';
  ghostMode.addEventListener('change', () => { if (ghostMode.value === 'tempo') showGhost.checked = true; }, sig);
  const refs = REFERENCES[result.exercise] || [];
  $('refChips').innerHTML = refs.length > 1 ? refs.map((r) => `<button role="tab" data-ref="${r.id}" aria-selected="${r.id === profile?.id}">${esc(r.id === 'template' ? '일반 기준' : r.short)}</button>`).join('') : '';
  $('refChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ref]');
    if (!b || b.dataset.ref === profile?.id) return;
    const prefs = { ...(getSettings().references || {}), [result.exercise]: b.dataset.ref };
    setSetting('references', prefs);
    const next = analyzeSession({ frames: result.frames, width: W, height: H }, result.exercise, { referenceId: b.dataset.ref });
    Object.assign(next, { analysisSec: result.analysisSec });
    showResult(next, { ...opts, startTime: getTime() });
  }, sig);
  $('vsTitle').textContent = `나 vs ${result.reference?.name || '기준'}`;
  renderVersus($('vsTable'), result, refProfile);

  // ---- 이렇게 해 보세요 ----
  const coach = coachOverride || buildCoaching(result);
  const combined = !!coachOverride;
  $('coachTitle').textContent = combined ? '이렇게 해 보세요 · 측면+정면' : '이렇게 해 보세요';
  $('actionList').innerHTML = coach.actions.length
    ? coach.actions.map((a) => `<li data-view="${a.view || 'side'}" data-rep="${a.reps?.length && a.reps.length < reps.length ? a.reps[0] : ''}"><b>${esc(a.text)}</b><small>${combined ? `<span class="viewtag">${a.view === 'front' ? '정면' : '측면'}</span>` : ''}${a.kind === 'pro' ? `<span class="pro">${esc(refLabel)} 비교</span>` : ''}${esc(a.tag || '')}</small></li>`).join('')
    : reps.length ? '<li class="done"><b>지금 자세 그대로 유지하세요 👍</b></li>' : '<li class="done"><b>반복을 찾지 못했어요. 측면에서 전신이 보이게 다시 찍어 주세요.</b></li>';
  $('goodChips').innerHTML = coach.good.map((g) => `<span>✓ ${esc(g)}</span>`).join('');
  $('actionList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-view]');
    if (!li) return;
    if (li.dataset.view !== 'side') { onSwitch?.(li.dataset.view, Number(li.dataset.rep) || 0); return; }
    if (!li.dataset.rep) return;
    select(Number(li.dataset.rep));
    $('resultStage').scrollIntoView({ behavior: 'smooth', block: 'center' });
    play();
  }, sig);
  const more = $('moreDetails');
  more.addEventListener('toggle', () => { if (more.open) { renderCompare(); renderTimeline(); } }, sig);

  renderChips();
  renderCards();
  renderCompare();
  renderTimeline();
  if (isNum(startTime)) setTime(startTime);
  raf = requestAnimationFrame(loop);
}

function drawFloor(ctx, W, H, y) {
  if (!isNum(y)) return;
  ctx.strokeStyle = 'rgba(148,163,184,.35)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, y + H * 0.02); ctx.lineTo(W, y + H * 0.02); ctx.stroke();
}

function niceTimeTicks(a, b) {
  const span = b - a;
  const step = span > 60 ? 10 : span > 20 ? 5 : span > 8 ? 2 : 1;
  const out = [];
  for (let x = Math.ceil(a / step) * step; x <= b; x += step) out.push({ x, label: `${x}s` });
  return out;
}
