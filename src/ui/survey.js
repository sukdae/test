// 현장 설문 화면 (촬영 없음): 동의·간단 정보 → 문항마다 막대로 인형 각도를 움직여 '여기부터 문제' 정하기 → 다음 사람
// 저장: 기기 localStorage. 설정에서 엑셀 CSV / 분석용 JSON 으로 내보낸다.
import { QUESTIONS, figurePoints, LEG_CM } from '../core/survey.js';
import { cssVar } from './draw.js';

const KEY = 'formcheck-survey2';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loadSurveys() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
function saveSurveys(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } }
export function clearSurveys() { try { localStorage.removeItem(KEY); } catch { /* 무시 */ } }

let st = null; // { step: -1(시작) | 0..n-1 | n(끝), profile, answers, value }
let toastFn = () => {};

const todayCount = () => { const d = new Date(); const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; return loadSurveys().filter((r) => { const x = new Date(r.at); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}` === k; }).length; };

export function startSurvey() {
  st = { step: -1, profile: {}, answers: {}, value: null };
  render();
}

function draw(canvas, q, v) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 300, H = canvas.clientHeight || 300;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const p = figurePoints(q.pose(v), W, H);
  const text = cssVar('--text') || '#e2e8f0', accent = cssVar('--accent') || '#818cf8', muted = cssVar('--muted') || '#94a3b8';
  ctx.strokeStyle = muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(W * 0.08, H * 0.88 + 1); ctx.lineTo(W * 0.92, H * 0.88 + 1); ctx.stroke();
  // 수평선(허벅지 평행 비교용) — 깊이 문항
  if (q.id === 'depth') { ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(p.knee.x - W * 0.3, p.knee.y); ctx.lineTo(p.knee.x + W * 0.1, p.knee.y); ctx.stroke(); ctx.restore(); }
  if (q.id === 'dlLeanBack') { ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(p.hip.x, p.hip.y); ctx.lineTo(p.hip.x, p.hip.y - H * 0.32); ctx.stroke(); ctx.restore(); }
  const seg = (a, b, w = 7, c = accent) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
  seg(p.heel, p.toe, 5); seg(p.heel, p.ankle, 5); seg(p.ankle, p.knee); seg(p.knee, p.hip); seg(p.hip, p.shoulder, 8);
  seg(p.shoulder, p.elbow, 5, text); seg(p.elbow, p.hand, 5, text);
  ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.head.x, p.head.y, H * 0.045, 0, Math.PI * 2); ctx.stroke();
  // 바벨 원판
  ctx.fillStyle = 'rgba(148,163,184,.35)'; ctx.strokeStyle = muted; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p.bar.x, p.bar.y, p.plateR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = text; ctx.beginPath(); ctx.arc(p.bar.x, p.bar.y, 4, 0, Math.PI * 2); ctx.fill();
  for (const j of [p.knee, p.hip, p.shoulder]) { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(j.x, j.y, 5, 0, Math.PI * 2); ctx.fill(); }
  // 깊이: 허벅지 선을 굵고 다른 색으로
  if (q.id === 'depth') { seg(p.hip, p.knee, 11, '#38bdf8'); ctx.fillStyle = '#38bdf8'; ctx.font = '600 12px system-ui'; ctx.fillText('허벅지', (p.hip.x + p.knee.x) / 2 - 18, Math.min(p.hip.y, p.knee.y) - 10); ctx.fillStyle = muted; ctx.fillText('수평', p.knee.x + W * 0.1 + 4, p.knee.y + 4); }
  // 뒤꿈치: 실제 크기 비율로 그린 발 확대 그림 (발 길이 26 cm 가정) + 틈(빨간 화살표)과 cm
  if (q.id === 'heel') {
    const bx = W * 0.52, by = H * 0.04, bw = W * 0.44, bh = H * 0.36;
    ctx.save();
    ctx.fillStyle = cssVar('--surface-2') || '#1e293b'; ctx.strokeStyle = muted; ctx.lineWidth = 1;
    ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx, by, bw, bh);
    const floorY = by + bh * 0.8, footPx = bw * 0.7, toeX = bx + bw * 0.85, heelX0 = toeX - footPx;
    const liftCm = (v / 100) * LEG_CM, lift = (liftCm / 26) * footPx;
    ctx.strokeStyle = muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + 6, floorY); ctx.lineTo(bx + bw - 6, floorY); ctx.stroke();
    // 발(신발) 모양: 발끝을 축으로 뒤꿈치가 들림
    const a = Math.asin(Math.min(0.9, lift / footPx));
    const P = (dx, dy) => ({ x: toeX - Math.cos(a) * dx - Math.sin(a) * dy, y: floorY - Math.sin(a) * dx - Math.cos(a) * dy });
    const shoe = [P(0, 0), P(footPx, 0), P(footPx, footPx * 0.28), P(footPx * 0.7, footPx * 0.32), P(footPx * 0.35, footPx * 0.22), P(0, footPx * 0.1)];
    ctx.fillStyle = accent; ctx.beginPath(); shoe.forEach((pt, k) => (k ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y))); ctx.closePath(); ctx.fill();
    const heelPt = P(footPx, 0);
    if (lift > 1.5) {
      ctx.strokeStyle = '#ef4444'; ctx.fillStyle = '#ef4444'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(heelPt.x, heelPt.y + 2); ctx.lineTo(heelPt.x, floorY - 1); ctx.stroke();
      ctx.font = '700 12px system-ui'; ctx.fillText(`${liftCm.toFixed(1)} cm`, heelPt.x + 4, (heelPt.y + floorY) / 2 + 4);
    }
    ctx.restore();
    ctx.fillStyle = muted; ctx.font = '600 11px system-ui'; ctx.fillText('발 확대 (뒤꿈치 ←  → 발끝)', bx + 6, by + 14);
  }
}

function render() {
  const box = $('surveyBox');
  if (!st) return;
  const n = loadSurveys().length + 1;
  const total = QUESTIONS.length;
  if (st.step === -1) {
    const chips = (name, opts) => `<div class="sv-chips" data-q="${name}">${opts.map((o) => `<button type="button" data-v="${esc(o)}" aria-pressed="${st.profile[name] === o}">${esc(o)}</button>`).join('')}</div>`;
    box.innerHTML = `
      <p class="sv-title">참여자 ${n}번 <small class="muted">· 오늘 ${todayCount()}명</small></p>
      <p class="sv-consent">인형을 움직여 '어디부터 잘못된 자세인지' 골라 주시는 설문이에요. 촬영·이름 없이 답만 연구용으로 써요. (문항 ${total}개, 30초)</p>
      ${chips('gender', ['남', '여'])}
      ${chips('age', ['10대', '20대', '30대', '40대+'])}
      ${chips('career', ['1년 미만', '1–3년', '3년+'])}
      <button id="svStart" class="btn primary block">동의하고 시작</button>`;
    return;
  }
  if (st.step >= total) {
    box.innerHTML = `
      <p class="sv-title">참여자 ${n - 1}번 완료 ✓</p>
      <p class="sub">고마워요! 다음 분께 폰을 건네주세요.</p>
      <button id="svNext" class="btn primary block">다음 사람</button>
      <button id="svEnd" class="link block-center">설문 끝내기</button>`;
    return;
  }
  const q = QUESTIONS[st.step];
  if (st.value == null) st.value = st.answers[q.id] ?? q.start;
  box.innerHTML = `
    <div class="sv-progress"><span style="width:${((st.step) / total) * 100}%"></span></div>
    <p class="muted sv-step">${st.step + 1} / ${total} · ${esc(q.title)}</p>
    <p class="sv-title">${esc(q.ask)}</p>
    <p class="sv-explain">${esc(q.explain || '')}</p>
    <canvas id="svFig" class="sv-fig"></canvas>
    <p class="sv-value" id="svValue">${esc(q.label(st.value))}</p>
    <input type="range" id="svRange" min="${q.min}" max="${q.max}" step="${q.step}" value="${st.value}" aria-label="${esc(q.title)} 조절">
    <button id="svPick" class="btn primary block">여기부터예요</button>
    <div class="sv-row"><button id="svBack" class="link">← 이전</button><button id="svSkip" class="link">잘 모르겠어요</button></div>`;
  requestAnimationFrame(() => draw($('svFig'), q, st.value));
}

function finish() {
  const list = loadSurveys();
  list.push({ n: list.length + 1, at: new Date().toISOString(), profile: st.profile, answers: st.answers });
  const ok = saveSurveys(list);
  toastFn(ok ? `참여자 ${list.length}번 저장했어요` : '저장하지 못했어요');
}

export function initSurvey({ toast, onExit }) {
  toastFn = toast;
  $('surveyBox').addEventListener('input', (e) => {
    if (e.target.id !== 'svRange' || !st) return;
    const q = QUESTIONS[st.step];
    st.value = Number(e.target.value);
    $('svValue').textContent = q.label(st.value);
    draw($('svFig'), q, st.value);
  });
  $('surveyBox').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !st) return;
    if (b.id === 'svStart') {
      $('surveyBox').querySelectorAll('.sv-chips').forEach((c) => { st.profile[c.dataset.q] = c.querySelector('[aria-pressed="true"]')?.dataset.v || ''; });
      st.step = 0; st.value = null; render(); return;
    }
    if (b.id === 'svPick' || b.id === 'svSkip') {
      const q = QUESTIONS[st.step];
      st.answers[q.id] = b.id === 'svPick' ? st.value : null;
      st.step++; st.value = null;
      if (st.step >= QUESTIONS.length) finish();
      render(); return;
    }
    if (b.id === 'svBack') { if (st.step > 0) { st.step--; st.value = null; render(); } else { st.step = -1; render(); } return; }
    if (b.id === 'svNext') { startSurvey(); return; }
    if (b.id === 'svEnd') { st = null; onExit?.(); return; }
    const c = b.closest('.sv-chips');
    if (c) c.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  window.addEventListener('resize', () => { if (st && st.step >= 0 && st.step < QUESTIONS.length) draw($('svFig'), QUESTIONS[st.step], st.value); });
}
