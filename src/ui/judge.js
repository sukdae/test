// 판정 평가: 피드백 항목마다 '맞아요 / 틀렸어요', 그리고 '앱이 놓친 실수'를 기기에 기록한다.
// 트레이너·체대생 피드백을 기준값 보정용 데이터로 받기 위한 기능. 영상·이름은 저장하지 않는다.
// 전문가 라벨 데이터로 자세 판정을 개선한 연구 방향 [논문 32]
import { getSettings } from './storage.js';

const KEY = 'formcheck-labels';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loadLabels() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function saveLabels(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
export function clearLabels() { try { localStorage.removeItem(KEY); } catch { /* 무시 */ } }

// 놓친 실수 선택지 (종목별)
const MISSED = {
  squat: ['깊이가 얕음', '무릎이 안쪽으로 모임', '뒤꿈치 들림', '엉덩이가 먼저 올라옴', '상체가 너무 숙여짐', '허리가 굽음', '몸이 한쪽으로 쏠림', '무게중심이 앞/뒤로 쏠림'],
  deadlift: ['마무리에서 덜 폄', '끝에서 뒤로 젖힘', '허리가 굽음', '바가 몸에서 멀어짐', '무릎을 너무 굽힘', '바닥에서 튕김', '몸이 한쪽으로 쏠림'],
};

let ctx = null; // { key, result, view }

const pick = (m = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(m)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
  return out;
};

function record(entry) {
  const list = loadLabels();
  const i = list.findIndex((x) => x.key === entry.key && x.view === entry.view && x.item === entry.item && entry.verdict !== 'missed');
  if (i >= 0) list[i] = entry; else list.push(entry);
  return saveLabels(list);
}

function base() {
  const r = ctx.result;
  return {
    at: new Date().toISOString(), key: ctx.key, rater: getSettings().rater || '',
    exercise: r.exercise, view: ctx.view, bodyKg: r.load?.bodyKg ?? '', barKg: r.load?.barKg ?? '',
    summary: pick(r.summary),
  };
}

// 결과 화면이 그려진 뒤 호출: 피드백 항목 옆에 버튼을 붙인다.
export function attachJudging(result, view) {
  if (!result) return;
  result._judgeKey ||= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  ctx = { key: result._judgeKey, result, view };
  const saved = loadLabels().filter((x) => x.key === ctx.key && x.view === view);
  const items = [...document.querySelectorAll('#feedbackList > li.fb')];
  items.forEach((li, i) => {
    const f = result.feedback[i];
    if (!f || li.querySelector('.judge')) return;
    const v = saved.find((x) => x.item === f.id)?.verdict;
    li.querySelector('div')?.insertAdjacentHTML('beforeend', `
      <div class="judge" data-i="${i}">
        <button data-v="agree" aria-pressed="${v === 'agree'}">맞아요</button>
        <button data-v="wrong" aria-pressed="${v === 'wrong'}">틀렸어요</button>
      </div>`);
  });
  const ex = result.exercise === 'deadlift' ? 'deadlift' : 'squat';
  $('missedSel').innerHTML = MISSED[ex].map((t) => `<option>${esc(t)}</option>`).join('') + '<option>기타</option>';
  $('missedBox').hidden = false;
  const missed = saved.filter((x) => x.verdict === 'missed').length;
  $('missedCount').textContent = missed ? `알려 준 것 ${missed}개` : '';
}

export function hideJudging() { ctx = null; $('missedBox').hidden = true; }

export function initJudging(toast) {
  $('feedbackList').addEventListener('click', (e) => {
    const b = e.target.closest('.judge button[data-v]');
    if (!b || !ctx) return;
    const f = ctx.result.feedback[Number(b.closest('.judge').dataset.i)];
    if (!f) return;
    let note = '';
    if (b.dataset.v === 'wrong') {
      note = prompt('어떻게 틀렸나요? (선택, 예: 실제로는 괜찮음 / 2회만 해당 / 기준이 너무 엄격)') ?? '';
    }
    const ok = record({ ...base(), item: f.id, title: f.title, level: f.level, verdict: b.dataset.v, reps: (f.reps || []).join(' '), note });
    b.closest('.judge').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    toast(ok ? (b.dataset.v === 'agree' ? '맞다고 기록했어요' : '틀렸다고 기록했어요. 고마워요!') : '저장하지 못했어요');
  });
  $('missedSave').addEventListener('click', () => {
    if (!ctx) return;
    const what = $('missedSel').value, rep = $('missedRep').value.trim(), note = $('missedNote').value.trim();
    const ok = record({ ...base(), item: 'missed', title: what, level: '', verdict: 'missed', reps: rep, note });
    $('missedRep').value = ''; $('missedNote').value = '';
    const n = loadLabels().filter((x) => x.key === ctx.key && x.view === ctx.view && x.verdict === 'missed').length;
    $('missedCount').textContent = `알려 준 것 ${n}개`;
    toast(ok ? '놓친 실수를 기록했어요. 고마워요!' : '저장하지 못했어요');
  });
}

// CSV (엑셀에서 한글이 깨지지 않게 BOM)
export function labelsCSV() {
  const cols = ['at', 'rater', 'exercise', 'view', 'item', 'title', 'level', 'verdict', 'reps', 'note', 'bodyKg', 'barKg', 'key', 'summary'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = loadLabels().map((x) => cols.map((c) => q(c === 'summary' ? JSON.stringify(x.summary || {}) : x[c])).join(','));
  return '﻿' + [cols.join(','), ...rows].join('\n');
}
