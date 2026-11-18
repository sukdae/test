// 정면 분석 결과 화면 (측면 결과 화면과 같은 영역을 같이 씁니다)
import { FRONT_THRESHOLDS, compareFrontIdeal } from '../core/front.js';
import { idealFront } from '../core/exercises.js';
import { estimateFrontMuscles, levelOf } from '../core/muscles.js';
import { buildCoaching } from '../core/coach.js';
import { isNum } from '../core/signal.js';
import { drawSkeleton, drawFrontOverlay, drawFrontBase, drawFrontMuscles, drawFrontGhost, heatColor, cssVar } from './draw.js';
import { lineChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '–');
const sec = (v) => (isNum(v) ? `${v.toFixed(1)}초` : '–');
const side = (v) => (v > 0 ? '왼쪽' : '오른쪽');

let ac = null, raf = 0;

export function disposeFrontResult() {
  cancelAnimationFrame(raf);
  ac?.abort();
  ac = null;
}

export function showFrontResult(fr, opts = {}) {
  const { videoUrl = null, saved = false, demo = false, onSave, onAgain, coach: coachOverride = null, onSwitch = null, sideMuscles = null } = opts;
  disposeFrontResult();
  ac = new AbortController();
  const sig = { signal: ac.signal };
  const { t, series: s, reps } = fr;
  const W = fr.width, H = fr.height;
  const T0 = t[0] ?? 0, T1 = t[t.length - 1] ?? 0;
  $('view-result').dataset.view = 'front';

  // 배너
  const banner = [];
  if (demo) banner.push('<div class="banner info">예시 (합성 데이터)</div>');
  for (const w of fr.warnings) banner.push(`<div class="banner warn">${esc(w)}</div>`);
  $('resultBanner').innerHTML = banner.join('');

  // 플레이어
  const v = $('resultVideo'), canvas = $('resultCanvas'), stage = $('resultStage');
  v.pause();
  canvas.width = W; canvas.height = H;
  stage.style.aspectRatio = `${W} / ${H}`;
  stage.classList.toggle('no-video', !videoUrl);
  const clock = { time: T0, playing: false, last: 0, rate: 1 };
  if (videoUrl) { v.hidden = false; if (v.getAttribute('src') !== videoUrl) v.src = videoUrl; v.currentTime = 0; } else { v.hidden = true; v.removeAttribute('src'); }
  const getTime = () => (videoUrl ? v.currentTime : clock.time);
  const isPlaying = () => (videoUrl ? !v.paused && !v.ended : clock.playing);
  const setTime = (x) => { x = Math.max(T0, Math.min(T1, x)); if (videoUrl) v.currentTime = x; else clock.time = x; };
  const play = () => { if (videoUrl) v.play().catch(() => {}); else { if (clock.time >= T1) clock.time = T0; clock.playing = true; clock.last = performance.now(); } };
  const pause = () => { if (videoUrl) v.pause(); else clock.playing = false; };
  $('playBtn').addEventListener('click', () => (isPlaying() ? pause() : play()), sig);
  $('rate').addEventListener('change', (e) => { const r = Number(e.target.value); v.playbackRate = r; clock.rate = r; }, sig);
  $('seek').addEventListener('input', (e) => setTime(T0 + (T1 - T0) * (Number(e.target.value) / 1000)), sig);
  const frameAt = (time) => { let lo = 0, hi = t.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid] <= time) lo = mid; else hi = mid - 1; } return lo; };

  // 반복 선택
  let selected = 0;
  const renderChips = () => {
    $('repChips').innerHTML = [`<button role="tab" data-rep="0" aria-selected="${selected === 0}">전체</button>`]
      .concat(reps.map((r) => `<button role="tab" data-rep="${r.index}" aria-selected="${selected === r.index}">${r.index}회</button>`)).join('');
  };
  const select = (k) => { selected = k; renderChips(); renderCards(); renderTimeline(); if (k) setTime(t[reps[k - 1].start]); };
  $('repChips').addEventListener('click', (e) => { const b = e.target.closest('button[data-rep]'); if (b) select(Number(b.dataset.rep)); }, sig);

  // 지표 카드
  const renderCards = () => {
    const m = selected ? reps[selected - 1].metrics : fr.summary;
    const T = FRONT_THRESHOLDS;
    const cards = [];
    if (!selected) cards.push(['반복 수', `${reps.length}회`, '자동 구분']);
    cards.push(['무릎 간격', pct(m.kneeRatio), '발목 간격 대비 (참고)']);
    const caving = Math.max(m.kneeInL ?? -1, m.kneeInR ?? -1) > T.kneeInward;
    cards.push(['무릎 정렬', caving ? '안쪽으로 모임' : '양호', `엉덩이–발목 선 대비 왼 ${pct(m.kneeInL)} · 오 ${pct(m.kneeInR)} (+는 안쪽)`]);
    cards.push(['골반 기울기', isNum(m.tilt) ? `${Math.abs(m.tilt).toFixed(0)}°` : '–', isNum(m.tilt) && Math.abs(m.tilt) > 1 ? `${side(m.tilt)}이 낮음` : '수평']);
    cards.push(['엉덩이 쏠림', pct(Math.abs(m.shift ?? NaN)), isNum(m.shift) && Math.abs(m.shift) > 0.03 ? `${side(m.shift)}으로` : '가운데']);
    if (isNum(m.leftPct)) cards.push(['체중 분배 (추정)', `왼 ${Math.round(m.leftPct)} · 오 ${Math.round(100 - m.leftPct)}`, '엉덩이 중심 위치 기준 %']);
    cards.push(['상체 옆 기울기', isNum(m.sideLean) ? `${Math.abs(m.sideLean).toFixed(0)}°` : '–', isNum(m.sideLean) && Math.abs(m.sideLean) > 1 ? `${side(m.sideLean)}으로` : '가운데']);
    cards.push(['좌우 흔들림', isNum(m.sideWobble) ? `±${m.sideWobble.toFixed(1)}°` : '–', isNum(m.sideWobble) && m.sideWobble > T.sideWobble ? '흔들림 있음' : '안정']);
    const lift = Math.max(m.liftL ?? 0, m.liftR ?? 0);
    cards.push(['발 뜸', lift > T.footLift ? (m.liftL > m.liftR ? '왼발 뜸' : '오른발 뜸') : '양발 고정', `최대 ${pct(lift)} (다리 길이 대비)`]);
    if (!selected && fr.stance) cards.push(['스탠스 너비', `${fr.stance.category}`, `어깨 관절 대비 약 ${Math.round(fr.stance.ratio * 100)}%`]);
    if (!selected && fr.tempo) cards.push(['내려가기 / 올라오기', `${sec(fr.tempo.descent)} / ${sec(fr.tempo.ascent)}`, '정면 높이 변화 기준']);
    $('metricCards').innerHTML = cards.map(([k, val, sub]) => `<div class="metric"><span>${k}</span><b>${val}</b><small>${sub}</small></div>`).join('');
  };

  // 이렇게 해 보세요
  const coach = coachOverride || buildCoaching(fr);
  const combined = !!coachOverride;
  $('coachTitle').textContent = combined ? '이렇게 해 보세요 · 측면+정면' : '이렇게 해 보세요';
  $('refChips').innerHTML = '';
  $('actionList').innerHTML = coach.actions.length
    ? coach.actions.map((a) => `<li data-view="${a.view || 'front'}" data-rep="${a.reps?.length && a.reps.length < reps.length ? a.reps[0] : ''}"><b>${esc(a.text)}</b><small>${combined ? `<span class="viewtag">${a.view === 'side' ? '측면' : '정면'}</span>` : ''}${esc(a.tag || '')}</small></li>`).join('')
    : reps.length ? '<li class="done"><b>지금 자세 그대로 유지하세요 👍</b></li>' : '<li class="done"><b>반복을 찾지 못했어요. 정면에서 전신이 보이게 다시 찍어 주세요.</b></li>';
  $('goodChips').innerHTML = coach.good.map((g) => `<span>✓ ${esc(g)}</span>`).join('');
  $('actionList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-view]');
    if (!li) return;
    if (li.dataset.view !== 'front') { onSwitch?.(li.dataset.view, Number(li.dataset.rep) || 0); return; }
    if (li.dataset.rep) { select(Number(li.dataset.rep)); $('resultStage').scrollIntoView({ behavior: 'smooth', block: 'center' }); play(); }
  }, sig);

  // 나 vs 기준 (논문 기반 정면 기준 자세)
  const vsFmt = { stance: (x) => `${Math.round(x * 100)}%`, knee: (x) => `${x > 0 ? '안쪽 ' : ''}${Math.round(Math.abs(x) * 100)}%`, tilt: (x) => `${x.toFixed(0)}°`, shift: (x) => `${Math.round(x * 100)}%`, lean: (x) => `${x.toFixed(0)}°`, weight: (x) => `${Math.round(x)} : ${Math.round(100 - x)}` };
  const vsRows = compareFrontIdeal(fr, idealFront(fr.exercise));
  $('frontVsTable').innerHTML = `
    <table class="vs">
      <thead><tr><th></th><th>나</th><th>${esc(idealFront(fr.exercise).short)}</th><th></th></tr></thead>
      <tbody>${vsRows.map((r) => `<tr><th>${r.label}</th><td>${isNum(r.me) ? vsFmt[r.key](r.me) : '–'}</td><td>${esc(r.refText)}</td><td class="diff ${r.ok === null ? '' : r.ok ? 'same' : 'off'}">${r.ok === null ? '' : r.ok ? '✓' : '⚠︎'}</td></tr>`).join('')}</tbody>
    </table>
    <p class="sub">근거: ${fr.exercise === 'deadlift' ? 'Kompf & Arandjelović 2017 · 나머지는 초깃값' : 'Straub & Powers 2024 · 좌우 대칭은 초깃값'}</p>`;

  // 피드백 상세
  const ICON = { warn: '⚠︎', info: 'ℹ︎', good: '✓' };
  $('feedbackList').innerHTML = fr.feedback.map((f) => `
    <li class="fb ${f.level}"><span class="fb-icon" aria-hidden="true">${ICON[f.level]}</span>
      <div><b>${esc(f.title)}</b>${f.count && f.total > 1 ? ` <span class="muted">· ${f.total}회 중 ${f.count}회</span>` : ''}
        ${f.detail ? `<p>${esc(f.detail)}</p>` : ''}${f.ref ? `<p class="ref">근거: ${esc(f.ref)}</p>` : '<p class="ref">기준값: 초깃값(논문 수치 없음)</p>'}
      </div></li>`).join('') || '<li class="fb info"><span class="fb-icon">ℹ︎</span><div>분석할 반복이 없어요.</div></li>';

  // 타임라인
  let tl = null;
  const renderTimeline = (cursor = getTime()) => {
    tl = lineChart($('timelineChart'), {
      height: 200, xMin: T0, xMax: T1, yMin: 0, yMax: 130, yTicks: [0, 50, 100], yUnit: '%',
      xTicks: [], bands: reps.map((r) => ({ x0: t[r.start], x1: t[r.end], label: String(r.index), active: r.index === selected })),
      series: [
        { xs: t, ys: s.height, color: cssVar('--c-knee'), label: '엉덩이 높이' },
        { xs: t, ys: s.kneeRatio.map((x) => x * 100), color: cssVar('--c-hip'), label: '무릎 간격' },
      ],
      cursor,
    });
  };
  $('timelineChart').addEventListener('click', (e) => { if (!tl) return; const rect = e.currentTarget.getBoundingClientRect(); setTime(tl.xFromPixel(e.clientX - rect.left)); }, sig);
  const more = $('moreDetails');
  more.addEventListener('toggle', () => { if (more.open) renderTimeline(); }, sig);

  // 버튼
  const saveBtn = $('saveBtn');
  const markSaved = () => { saveBtn.disabled = true; saveBtn.textContent = '저장됨 ✓'; };
  if (saved) markSaved(); else { saveBtn.disabled = demo || !reps.length; saveBtn.textContent = demo ? '예시는 저장하지 않아요' : '기록 저장'; }
  saveBtn.addEventListener('click', async () => { saveBtn.disabled = true; try { await onSave?.(); markSaved(); } catch (e) { saveBtn.disabled = false; alert(`저장하지 못했어요: ${e.message}`); } }, sig);
  $('againBtn').addEventListener('click', () => onAgain?.(), sig);
  $('csvBtn').addEventListener('click', () => {
    const f = (x) => (isNum(x) ? x.toFixed(3) : '');
    const rows = ['frame,time_s,hip_height_pct,knee_ankle_ratio,knee_in_left,knee_in_right,pelvic_tilt_deg,hip_shift'];
    t.forEach((tt, i) => rows.push([i, tt.toFixed(3), f(s.height[i]), f(s.kneeRatio[i]), f(s.inL[i]), f(s.inR[i]), f(s.tiltRel[i]), f(s.shiftRel[i])].join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' }));
    a.download = `formcheck-front-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, sig);

  // 좌우 근육 사용
  const fm = estimateFrontMuscles(fr, sideMuscles);
  $('frontMuscleSub').textContent = fm[0]?.fromSide
    ? '측면 부하 × 좌우 체중 분배'
    : '측면도 함께 찍으면 더 정확해요';
  $('frontMuscleView').innerHTML = fm.length
    ? `<li class="muted"><span></span><span>왼쪽</span><span>오른쪽</span></li>` + fm.map((m) => `<li><b>${esc(m.name)}</b>${['left', 'right'].map((k) => `<div class="bar"><span style="width:${Math.round(m[k] * 100)}%;background:${heatColor(m[k])}">${levelOf(m[k])}</span></div>`).join('')}</li>`).join('')
    : '<li class="muted">반복이 감지되지 않아 추정할 수 없어요.</li>';
  const hTop = Math.max(...s.height.filter(isNum)), hBot = Math.min(...s.height.filter(isNum));
  const effortAt = (i) => (isNum(s.height[i]) ? Math.max(0, Math.min(1, (hTop - s.height[i]) / ((hTop - hBot) || 1))) : 0);

  // 렌더 루프
  const ctx = canvas.getContext('2d');
  const showGhost = $('showFrontGhost'), showSkel = $('showSkel'), showGuide = $('showFrontGuide'), showBase = $('showFrontBase'), showFM = $('showFrontMuscle');
  let lastKey = '', lastTl = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (!videoUrl && clock.playing) { clock.time += ((now - clock.last) / 1000) * clock.rate; clock.last = now; if (clock.time >= T1) { clock.time = T1; clock.playing = false; } }
    let time = getTime();
    if (selected && isPlaying()) { const r = reps[selected - 1]; if (time > t[r.end] + 0.3) { setTime(t[r.start]); time = t[r.start]; } }
    $('playBtn').textContent = isPlaying() ? '❚❚' : '▶';
    const i = frameAt(time);
    const key = `${i}|${showGhost.checked}|${showSkel.checked}|${showGuide.checked}|${showBase.checked}|${showFM.checked}`;
    if (key !== lastKey) {
      lastKey = key;
      ctx.clearRect(0, 0, W, H);
      if (!videoUrl) { ctx.fillStyle = cssVar('--stage-bg'); ctx.fillRect(0, 0, W, H); }
      const lm = fr.frames[i]?.lm;
      if (showFM.checked) drawFrontMuscles(ctx, lm, fm, effortAt(i), W, H);
      if (showSkel.checked) drawSkeleton(ctx, lm, W, H);
      if (showGhost.checked) drawFrontGhost(ctx, lm, W, H);
      if (showBase.checked) drawFrontBase(ctx, lm, s.leftPct[i], s.liftL[i], s.liftR[i], FRONT_THRESHOLDS, W, H);
      if (showGuide.checked) drawFrontOverlay(ctx, lm, { kneeRatio: s.kneeRatio[i], inL: s.inL[i], inR: s.inR[i], tilt: s.tiltRel[i], shift: s.shiftRel[i] }, FRONT_THRESHOLDS, W, H);
      $('seek').value = String(Math.round(((time - T0) / (T1 - T0 || 1)) * 1000));
    }
    if (more.open && now - lastTl > 120) { lastTl = now; renderTimeline(time); }
  };
  renderChips();
  renderCards();
  raf = requestAnimationFrame(loop);
}
