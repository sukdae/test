// 기록 화면: 종목별 세트 목록과 지표 추이
import { EXERCISES } from '../core/exercises.js';
import { isNum } from '../core/signal.js';
import { lineChart } from './charts.js';
import { cssVar } from './draw.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function sessionItem(s) {
  const ex = EXERCISES[s.exercise];
  const m = s.summary || {};
  const fm = s.frontSummary;
  const modeKo = s.mode === 'both' ? '측면+정면' : s.mode === 'front' ? '정면' : '측면';
  const key = !s.summary && fm ? `무릎 간격 ${isNum(fm.kneeRatio) ? Math.round(fm.kneeRatio * 100) + '%' : '–'}` : s.exercise === 'squat' ? `허벅지 수평 기준 ${isNum(m.thighAboveParallel) ? (m.thighAboveParallel > 0 ? '+' : '') + Math.round(m.thighAboveParallel) + '°' : '–'}` : `최고점 엉덩이 ${isNum(m.topHip) ? Math.round(m.topHip) + '°' : '–'}`;
  return `
  <div class="session" data-id="${esc(s.id)}">
    <button class="session-main" data-open="${esc(s.id)}">
      <b>${esc(ex?.name ?? s.exercise)} · ${m.reps ?? fm?.reps ?? 0}회 <span class="tag">${modeKo}</span></b>
      <small>${fmtDate(s.date)} · ${key}${s.load?.barKg > 0 ? ` · ${s.load.barKg}kg` : ''}${s.video ? ' · 🎞' : ''}</small>
      ${s.topIssue ? `<small class="issue">⚠︎ ${esc(s.topIssue)}</small>` : '<small class="ok-text">✓ 큰 문제 없음</small>'}
    </button>
    <button class="icon-btn del" data-del="${esc(s.id)}" aria-label="삭제">🗑</button>
  </div>`;
}

const TREND = {
  squat: [['minKnee', '최저점 무릎 각도', '--c-knee'], ['maxTrunk', '최대 상체 기울기', '--c-trunk']],
  deadlift: [['topHip', '최고점 엉덩이 각도', '--c-hip'], ['maxTrunk', '최대 상체 기울기', '--c-trunk']],
};

export function renderHistory(sessions, exId, visible = Object.keys(EXERCISES)) {
  $('histTabs').hidden = visible.length < 2;
  $('histTabs').innerHTML = Object.values(EXERCISES).filter((e) => visible.includes(e.id))
    .map((e) => `<button role="tab" data-ex="${e.id}" aria-selected="${e.id === exId}">${e.name}</button>`).join('');
  const list = sessions.filter((s) => s.exercise === exId);
  $('historyList').innerHTML = list.length ? list.map(sessionItem).join('') : '<p class="muted">아직 저장한 기록이 없어요.</p>';

  const chrono = list.slice().reverse();
  const canvas = $('trendChart');
  if (chrono.length < 2) {
    lineChart(canvas, { height: 70, xMin: 0, xMax: 1, yMin: 0, yMax: 1, series: [], legend: false });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = cssVar('--muted');
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('기록이 2개 이상 쌓이면 추이를 보여 드려요.', canvas.clientWidth / 2, 38);
    return;
  }
  const xs = chrono.map((_, i) => i);
  const step = Math.max(1, Math.ceil(chrono.length / 6));
  lineChart(canvas, {
    height: 200, xMin: -0.3, xMax: chrono.length - 0.7, yMin: -10, yMax: 190, yTicks: [0, 45, 90, 135, 180],
    xTicks: chrono.map((s, i) => ({ x: i, label: `${new Date(s.date).getMonth() + 1}/${new Date(s.date).getDate()}` })).filter((_, i) => i % step === 0),
    series: TREND[exId].map(([k, label, color]) => ({ xs, ys: chrono.map((s) => s.summary?.[k]), color: cssVar(color), label, dots: true })),
  });
}
