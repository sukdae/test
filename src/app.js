// 화면 전환과 흐름 연결
import { EXERCISES } from './core/exercises.js';
import { fuse3D } from './core/fuse3d.js';
import { showFused, hideFused } from './ui/fused.js';
import { analyzeSession } from './core/analyze.js';
import { analyzeFront } from './core/front.js';
import { detectView, viewScore } from './core/landmarks.js';
import { mergeCoaching, compareViews } from './core/coach.js';
import { generateDemo, generateFrontDemo } from './core/synthetic.js';
import { startCapture, stopCapture } from './ui/capture.js';
import { extractFrames } from './ui/process.js';
import { showResult, disposeResult } from './ui/result.js';
import { showFrontResult, disposeFrontResult } from './ui/frontResult.js';
import { renderHistory, sessionItem } from './ui/history.js';
import * as store from './ui/storage.js';

const $ = (id) => document.getElementById(id);
const TITLES = { onboarding: '시작하기', home: '폼 체크', capture: '촬영', step: '정면 영상', processing: '분석 중', result: '분석 결과', history: '기록', settings: '설정' };
const VIEW_KO = { side: '측면', front: '정면' };
const MODE_HINT = { side: '깊이 · 상체 · 뒤꿈치 · 리듬', front: '무릎 · 좌우 균형 · 체중 분배', both: '영상 2개를 한 번에 골라도 돼요 · 3D' };
// 지금은 스쿼트만 화면에 노출(데드리프트는 코드만 유지)
const VISIBLE_EXERCISES = ['squat'];

const settings0 = store.getSettings();
const state = {
  view: null,
  stack: [],
  exercise: VISIBLE_EXERCISES.includes(settings0.exercise) ? settings0.exercise : 'squat',
  mode: ['side', 'front', 'both'].includes(settings0.viewMode) ? settings0.viewMode : 'side',
  pair: null, // 둘 다: { side, sideBlob, sideUrl, front, frontBlob, frontUrl }
  historyEx: null,
  objectUrls: [],
  cancelled: false,
};

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.tm);
  toast.tm = setTimeout(() => { el.hidden = true; }, 3500);
}

function revokeUrls() { state.objectUrls.forEach((u) => URL.revokeObjectURL(u)); state.objectUrls = []; }

function show(name, { push = true } = {}) {
  const prev = state.view;
  if (prev === name) return;
  if (prev === 'capture') stopCapture();
  if (prev === 'result') { disposeResult(); disposeFrontResult(); revokeUrls(); $('viewTabs').hidden = true; }
  if (prev === 'processing') state.cancelled = true;
  if (push && prev && !['processing', 'capture', 'onboarding', 'step'].includes(prev)) state.stack.push(prev);
  if (name === 'home') { state.stack = []; state.pair = null; }
  state.view = name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $('title').textContent = TITLES[name];
  $('backBtn').hidden = name === 'home' || name === 'onboarding';
  $('settingsBtn').hidden = name !== 'home';
  window.scrollTo(0, 0);
}

function back() { show(state.stack.pop() || 'home', { push: false }); }

// ---------- 홈 ----------
function renderHome() {
  $('viewMode').querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === state.mode)));
  $('viewHint').textContent = MODE_HINT[state.mode];
  store.listSessions().then((list) => {
    $('recentBlock').hidden = !list.length;
    $('recentList').innerHTML = list.slice(0, 3).map(sessionItem).join('');
  }).catch(() => { $('recentBlock').hidden = true; });
}

function goHome() { show('home'); renderHome(); }


$('viewMode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  state.mode = b.dataset.mode;
  store.setSetting('viewMode', state.mode);
  renderHome();
});

// 지금 받아야 할 영상의 방향
const currentView = () => (state.mode === 'both' ? missingView() : state.mode);
const missingView = () => (state.pair?.side ? 'front' : 'side');

function startRecording() {
  const view = currentView();
  show('capture');
  $('camStatus').textContent = '카메라 준비 중…';
  $('camStatus').className = 'status';
  $('captureHint').textContent = `${VIEW_KO[view]} · 2~3m · 전신`;
  startCapture({ view, onRecorded: (blob) => handleVideo(blob), onError: (msg) => { toast(msg); goHome(); } });
}

$('recordBtn').addEventListener('click', () => { state.pair = null; startRecording(); });
$('fileInput').addEventListener('change', (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  state.pair = null;
  if (state.mode === 'both') handleBothFiles(files.slice(0, 2));
  else handleVideo(files[0]);
});
$('stepRecordBtn').addEventListener('click', startRecording);
$('stepFileInput').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) handleBothFiles([f]);
});
$('stepSkipBtn').addEventListener('click', () => {
  const p = state.pair, v = p?.side ? 'side' : p?.front ? 'front' : null;
  if (!v) { goHome(); return; }
  show('result', { push: false });
  state.objectUrls.push(p[`${v}Url`]);
  showSingle(v, p[v], { videoUrl: p[`${v}Url`], blob: p[`${v}Blob`] });
});

$('demoBtn').addEventListener('click', () => {
  const ex = state.exercise;
  const side = state.mode !== 'front' ? analyzeSession(generateDemo(ex), ex, refOpt(ex)) : null;
  const front = state.mode !== 'side' ? analyzeFront(generateFrontDemo(), ex) : null;
  show('result');
  if (side && front) showCombined({ side, front }, { demo: true });
  else showSingle(side ? 'side' : 'front', side || front, { demo: true });
});

const refOpt = (ex) => ({ referenceId: store.getSettings().references?.[ex] });

// ---------- 분석 ----------
// view: 'side' | 'front' | 'auto'(영상을 보고 판정). label: 진행 표시 앞머리
async function analyzeBlob(blob, view, label = null) {
  show('processing');
  state.cancelled = false;
  const exId = state.exercise;
  const bar = $('procBar'), text = $('procText');
  const stepLabel = label ?? (state.mode === 'both' ? `${view === 'side' ? '1' : '2'}/2 ${VIEW_KO[view]} ` : `${VIEW_KO[view]} `);
  bar.style.width = '0%';
  const url = URL.createObjectURL(blob);
  const started = performance.now();
  try {
    const data = await extractFrames(url, {
      onProgress: (p, msg) => { bar.style.width = `${Math.round(p * 100)}%`; text.textContent = `${stepLabel}${msg}`; },
      isCancelled: () => state.cancelled,
    });
    text.textContent = '지표 계산 중…';
    if (view === 'auto') view = detectView(data);
    const result = view === 'front' ? analyzeFront(data, exId) : analyzeSession(data, exId, refOpt(exId));
    result.analysisSec = (performance.now() - started) / 1000;
    if (state.view !== 'processing') { URL.revokeObjectURL(url); return null; }
    return { result, url, view, score: viewScore(data) };
  } catch (e) {
    URL.revokeObjectURL(url);
    if (e.message === 'cancelled') return null;
    console.error(e);
    toast(/fetch|import|network|Failed/i.test(e.message) ? '자세 인식 모델을 불러오지 못했어요. 처음 한 번은 인터넷 연결이 필요해요.' : e.message);
    goHome();
    return null;
  }
}

// 둘 다 모드에서 파일로 받기: 방향은 영상을 보고 자동 판정. 두 개를 한 번에 올려도 되고 하나씩 올려도 된다.
async function handleBothFiles(files) {
  state.pair = state.pair || {};
  const outs = [];
  for (const [k, f] of files.entries()) {
    const out = await analyzeBlob(f, 'auto', files.length > 1 ? `${k + 1}/2 ` : '');
    if (!out) return;
    outs.push({ ...out, blob: f });
  }
  // 두 개가 같은 방향으로 판정되면 더 정면에 가까운 쪽을 정면으로
  if (outs.length === 2 && outs[0].view === outs[1].view) {
    const [a, b] = outs[0].score >= outs[1].score ? [outs[0], outs[1]] : [outs[1], outs[0]];
    if (a.view !== 'front') a.redo = 'front';
    if (b.view !== 'side') b.redo = 'side';
  }
  // 하나만 올렸는데 이미 있는 방향이면 빠진 쪽으로
  if (outs.length === 1 && state.pair[outs[0].view]) outs[0].redo = missingView();
  for (const o of outs) {
    const v = o.redo || o.view;
    state.pair[v] = o.redo ? reanalyze(o, v) : o.result;
    state.pair[`${v}Blob`] = o.blob; state.pair[`${v}Url`] = o.url;
  }
  const same = outs.length === 2 && outs[0].view === outs[1].view;
  toast(same ? `두 영상이 모두 ${VIEW_KO[outs[0].view]}처럼 보여요. 방향을 확인해 주세요.`
    : outs.length === 2 ? '측면·정면을 자동으로 구분했어요' : `${VIEW_KO[outs[0].redo || outs[0].view]} 영상으로 인식했어요`);
  finishPair();
}

// 판정과 다른 방향으로 다시 분석 (프레임은 그대로 사용)
function reanalyze(o, v) {
  const r = o.result, data = { frames: r.frames, width: r.width, height: r.height };
  return v === 'front' ? analyzeFront(data, state.exercise) : analyzeSession(data, state.exercise, refOpt(state.exercise));
}

function finishPair() {
  const p = state.pair;
  if (p.side && p.front) {
    show('result', { push: false });
    state.objectUrls.push(p.sideUrl, p.frontUrl);
    showCombined(p);
    return;
  }
  const v = missingView();
  $('stepTitle').textContent = `${VIEW_KO[v]} 영상`;
  $('stepRecordBtn').textContent = `● ${VIEW_KO[v]} 촬영`;
  $('stepFileLabel').firstChild.textContent = `${VIEW_KO[v]} 영상 불러오기`;
  $('stepSkipBtn').textContent = `${VIEW_KO[v === 'side' ? 'front' : 'side']} 결과만 보기`;
  show('step');
}

async function handleVideo(blob) {
  const view = currentView();
  const out = await analyzeBlob(blob, view);
  if (!out) return;
  if (state.mode !== 'both') {
    show('result', { push: false });
    state.objectUrls.push(out.url);
    showSingle(view, out.result, { videoUrl: out.url, blob });
    return;
  }
  state.pair = state.pair || {};
  Object.assign(state.pair, { [view]: out.result, [`${view}Blob`]: blob, [`${view}Url`]: out.url });
  finishPair();
}

function showSingle(view, result, { videoUrl = null, blob = null, demo = false, saved = false } = {}) {
  $('viewTabs').hidden = true;
  hideFused();
  const opts = {
    videoUrl, demo, saved, onAgain: goHome,
    onSave: () => persist(view === 'side' ? { side: result, sideBlob: blob } : { front: result, frontBlob: blob }),
  };
  if (view === 'front') { disposeResult(); showFrontResult(result, opts); } else showResult(result, opts);
}

function showCombined(pair, { demo = false, saved = false } = {}) {
  const coach = mergeCoaching(pair.side, pair.front);
  const fz = fuse3D(pair.side, pair.front);
  const tabs = $('viewTabs');
  tabs.hidden = false;
  const render = (view, rep = 0) => {
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === view)));
    const opts = {
      demo, saved, coach, onAgain: goHome,
      onSwitch: (v) => render(v),
      onSave: () => persist(pair),
    };
    if (view === 'front') { disposeResult(); showFrontResult(pair.front, { ...opts, videoUrl: pair.frontUrl || null, sideMuscles: pair.side.muscles }); }
    else showResult(pair.side, { ...opts, videoUrl: pair.sideUrl || null });
    const mismatch = compareViews(pair.side, pair.front);
    if (mismatch.length) $('resultBanner').insertAdjacentHTML('afterbegin', `<div class="banner warn"><b>측면·정면 영상이 서로 달라 보여요</b><br>${mismatch.join('<br>')}</div>`);
    showFused(fz);
    if (rep) setTimeout(() => document.querySelector(`#repChips [data-rep="${rep}"]`)?.click(), 0);
  };
  tabs.onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) render(b.dataset.tab); };
  render('side');
}

async function persist({ side = null, front = null, sideBlob = null, frontBlob = null }) {
  const settings = store.getSettings();
  const coach = mergeCoaching(side, front);
  await store.saveSession({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toISOString(),
    exercise: (side || front).exercise,
    mode: side && front ? 'both' : side ? 'side' : 'front',
    summary: side ? side.summary : null,
    frontSummary: front ? front.summary : null,
    topIssue: coach.actions[0]?.text || null,
    result: side,
    front,
    video: settings.saveVideo ? sideBlob : null,
    frontVideo: settings.saveVideo ? frontBlob : null,
  });
  toast(settings.saveVideo ? '영상과 함께 저장했어요.' : '분석 결과를 저장했어요. (영상은 저장하지 않음)');
}

$('procCancel').addEventListener('click', () => { state.cancelled = true; goHome(); });

// ---------- 기록 ----------
async function openHistory() {
  show('history');
  state.historyEx = state.historyEx || state.exercise;
  renderHistory(await store.listSessions(), state.historyEx, VISIBLE_EXERCISES);
}

async function openSession(id) {
  const s = await store.getSession(id);
  if (!s) { toast('기록을 찾을 수 없어요.'); return; }
  show('result');
  const url = (b) => { if (!b) return null; const u = URL.createObjectURL(b); state.objectUrls.push(u); return u; };
  if (s.result && s.front) showCombined({ side: s.result, front: s.front, sideUrl: url(s.video), frontUrl: url(s.frontVideo) }, { saved: true });
  else if (s.front) showSingle('front', s.front, { videoUrl: url(s.frontVideo), saved: true });
  else showSingle('side', s.result, { videoUrl: url(s.video), saved: true });
}

async function deleteOne(id) {
  if (!confirm('이 기록을 삭제할까요? 되돌릴 수 없어요.')) return;
  await store.deleteSession(id);
  if (state.view === 'history') renderHistory(await store.listSessions(), state.historyEx, VISIBLE_EXERCISES);
  else renderHome();
}

for (const listId of ['recentList', 'historyList']) {
  $(listId).addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    const del = e.target.closest('[data-del]');
    if (del) deleteOne(del.dataset.del);
    else if (open) openSession(open.dataset.open);
  });
}

$('histTabs').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ex]');
  if (!b) return;
  state.historyEx = b.dataset.ex;
  renderHistory(await store.listSessions(), state.historyEx, VISIBLE_EXERCISES);
});
$('historyBtn').addEventListener('click', openHistory);

// ---------- 설정 ----------
async function openSettings() {
  show('settings');
  $('setSaveVideo').checked = store.getSettings().saveVideo;
  const used = await store.storageEstimate();
  const n = (await store.listSessions().catch(() => [])).length;
  $('storageInfo').textContent = `저장된 기록 ${n}개${used != null ? ` · 사용 중 약 ${(used / 1e6).toFixed(1)}MB` : ''}`;
}
$('settingsBtn').addEventListener('click', openSettings);
$('setSaveVideo').addEventListener('change', (e) => store.setSetting('saveVideo', e.target.checked));
$('deleteAll').addEventListener('click', async () => {
  if (!confirm('저장된 모든 기록과 영상을 삭제할까요? 되돌릴 수 없어요.')) return;
  await store.clearSessions();
  toast('모든 기록을 삭제했어요.');
  openSettings();
});
$('replayOnboarding').addEventListener('click', () => show('onboarding'));

// ---------- 공통 ----------
$('backBtn').addEventListener('click', () => {
  if (['history', 'settings', 'step'].includes(state.view) || state.stack.at(-1) === 'home') { goHome(); return; }
  back();
});
$('onboardDone').addEventListener('click', () => { store.setSetting('onboarded', true); goHome(); });

if (store.getSettings().onboarded) goHome(); else show('onboarding');
