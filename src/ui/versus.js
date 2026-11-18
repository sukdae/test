// '나 vs 기준' 비교표와 리듬 비교
import { referenceAngles } from '../core/exercises.js';
import { isNum, josa } from '../core/signal.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDeg = (v) => (isNum(v) ? `${Math.round(v)}°` : '–');
const fmtSec = (v) => (isNum(v) ? `${v.toFixed(1)}초` : '–');
const fmtThigh = (v) => (!isNum(v) ? '–' : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v))}°`);

// 템플릿 기준은 곡선 대신 수식이라, 비교용 지표를 곡선에서 계산해 둔다.
export function referenceMetrics(exId, profile) {
  if (profile?.metrics) return profile.metrics;
  const b = referenceAngles(exId, 0.5, profile), top = referenceAngles(exId, 0, profile);
  return { thighAboveParallel: 90 + b.thigh, minKnee: b.knee, minHip: b.hip, maxTrunk: b.trunk, topHip: top.hip };
}

function diffCell(me, ref, { unit = '°', better = null, fmt } = {}) {
  if (!isNum(me) || !isNum(ref)) return '<td class="muted">–</td>';
  const d = me - ref;
  const txt = fmt ? fmt(d) : `${d >= 0 ? '+' : '−'}${unit === '초' ? Math.abs(d).toFixed(1) : Math.round(Math.abs(d))}${unit}`;
  const tol = unit === '초' ? 0.2 : 5;
  const cls = Math.abs(d) <= tol ? 'same' : better === null ? '' : (better === 'lower' ? d < 0 : d > 0) ? 'good' : 'off';
  return `<td class="diff ${cls}">${Math.abs(d) <= tol ? '비슷 ✓' : txt}</td>`;
}

export function renderVersus(el, result, profile) {
  const ref = result.reference;
  const label = ref?.short || '기준';
  const me = result.summary, rm = referenceMetrics(result.exercise, profile);
  const mt = result.tempo || {}, rt = ref?.tempo || {};
  const rows = [];
  const row = (name, a, b, fmt, opt) => rows.push(`<tr><th>${name}</th><td>${fmt(a)}</td><td>${fmt(b)}</td>${diffCell(a, b, opt)}</tr>`);
  if (result.exercise === 'squat') {
    row('깊이<small>허벅지, 0°=평행 · −는 평행 아래</small>', me.thighAboveParallel, rm.thighAboveParallel, fmtThigh, { fmt: (d) => (d > 0 ? `${Math.round(d)}° 얕음` : `${Math.round(-d)}° 깊음`) });
  } else {
    row('마무리 엉덩이 각도', me.topHip, rm.topHip, fmtDeg);
  }
  row('최저점 무릎 각도', me.minKnee, rm.minKnee, fmtDeg);
  row('최저점 엉덩이 각도', me.minHip, rm.minHip, fmtDeg);
  row('최대 상체 기울기', me.maxTrunk, rm.maxTrunk, fmtDeg);
  const hasTempo = isNum(rt.descent);
  if (hasTempo) {
    rows.push('<tr class="group"><th colspan="4">리듬</th></tr>');
    row('내려가기', mt.descent, rt.descent, fmtSec, { unit: '초' });
    row('바닥에서 멈춤', mt.bottom, rt.bottom, fmtSec, { unit: '초' });
    row('올라오기', mt.ascent, rt.ascent, fmtSec, { unit: '초' });
    row('반복 간격', mt.interval, rt.interval, fmtSec, { unit: '초' });
  }

  el.innerHTML = `
    <table class="vs">
      <thead><tr><th></th><th>나</th><th>${esc(label)}</th><th>차이</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    ${hasTempo ? rhythmBars(mt, rt, label) + rhythmAdvice(mt, rt, label) : '<p class="sub">이 기준에는 리듬 데이터가 없어요(확인한 논문에 템포 수치 없음).</p>'}`;
}

function rhythmBars(mt, rt, label) {
  const seg = (t) => [
    ['down', t.descent - (t.bottom || 0) / 2, '내려가기'],
    ['hold', t.bottom || 0, '멈춤'],
    ['up', t.ascent - (t.bottom || 0) / 2, '올라오기'],
    ['rest', Math.max(0, (t.interval || 0) - t.descent - t.ascent), '쉬기'],
  ];
  const total = (t) => seg(t).reduce((s, [, v]) => s + (isNum(v) ? Math.max(0, v) : 0), 0);
  const max = Math.max(total(mt), total(rt), 0.1);
  const bar = (name, t) => `
    <div class="rh-row"><span class="rh-name">${esc(name)}</span><div class="rh-bar">
      ${seg(t).map(([k, v, txt]) => (isNum(v) && v > 0.02 ? `<span class="rh-${k}" style="width:${(v / max) * 100}%" title="${txt} ${v.toFixed(2)}초">${v >= 0.35 ? v.toFixed(1) : ''}</span>` : '')).join('')}
    </div></div>`;
  return `
    <div class="rhythm">
      ${bar('나', mt)}${bar(label, rt)}
      <div class="rh-legend"><span class="rh-down"></span>내려가기 <span class="rh-hold"></span>멈춤 <span class="rh-up"></span>올라오기 <span class="rh-rest"></span>반복 사이</div>
    </div>`;
}

function rhythmAdvice(mt, rt, label) {
  const out = [];
  const cmp = (a, b, what, faster, slower) => {
    if (!isNum(a) || !isNum(b)) return;
    const d = a - b;
    if (Math.abs(d) <= 0.2) out.push(`✓ ${what}은 ${josa(label, '과', '와')} 비슷해요 (${a.toFixed(1)}초 vs ${b.toFixed(1)}초).`);
    else out.push(`${d < 0 ? faster : slower} ${what}: 나 ${a.toFixed(1)}초, ${label} ${b.toFixed(1)}초.`);
  };
  cmp(mt.descent, rt.descent, '내려가는 시간', '▸ 더 빨리 내려가요. 조금 더 컨트롤하며 내려가 보세요.', '▸ 더 천천히 내려가요.');
  cmp(mt.ascent, rt.ascent, '올라오는 시간', '▸ 더 빨리 올라와요.', '▸ 더 천천히 올라와요. 바닥을 강하게 밀어 올라와 보세요.');
  cmp(mt.interval, rt.interval, '반복 간격', '▸ 반복 사이가 더 짧아요.', '▸ 반복 사이가 더 길어요. 서서 호흡을 다시 채우는 시간이라면 괜찮아요.');
  return `<ul class="rh-advice">${out.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}
