// 둘 다 모드: 측면+정면 3D 합성 진단표와 돌려 볼 수 있는 3D 뼈대
import { fusedRows, idealPoses, midFoot, barPoint, FUSE_N } from '../core/fuse3d.js';
import { cssVar } from './draw.js';
import { phaseByTempo } from '../core/reference.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let raf = 0, ac = null;

export function hideFused() {
  cancelAnimationFrame(raf);
  ac?.abort(); ac = null;
  $('fusedBlock').hidden = true;
}

export function showFused(fz) {
  hideFused();
  if (!fz) return;
  $('fusedBlock').hidden = false;
  let sel = 0; // 0 = 전체(평균), n = n회
  const cur = () => (sel ? fz.reps[sel - 1] : fz);
  const render = () => {
    const anyIssue = fz.reps.some((r) => r.issues.length);
    $('fusedChips').innerHTML = [`<button role="tab" data-r="0" aria-selected="${sel === 0}">전체</button>`]
      .concat(fz.reps.map((r, k) => `<button role="tab" data-r="${k + 1}" aria-selected="${sel === k + 1}" class="${r.issues.length ? 'bad' : ''}">${r.index}회${r.issues.length ? ' ⚠︎' : ''}</button>`)).join('');
    const rows = fusedRows(cur().metrics, sel ? [] : fz.reps, fz.exercise);
    const bad = rows.filter((r) => r.ok === false || r.reps?.length);
    $('fusedSummary').innerHTML = bad.length
      ? bad.map((r) => `<li class="bad">⚠︎ ${esc(r.issue || r.label)}${r.reps?.length ? ` <b>${r.reps.join('·')}회</b>` : ''}</li>`).join('')
      : `<li class="ok">✓ ${sel ? `${sel}회` : anyIssue ? '평균' : '모든 반복'} 정렬 양호</li>`;
    $('fusedTable').innerHTML = `
      <table class="vs compact"><tbody>${rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td><td class="diff ${r.ok === null ? '' : r.ok && !r.reps?.length ? 'same' : 'off'}">${r.ok === null ? '' : r.reps?.length ? r.reps.join('·') + '회' : r.ok ? '✓' : '⚠︎'}</td></tr>`).join('')}</tbody></table>
      ${fz.warnings.map((w) => `<p class="sub warn-text">⚠︎ ${esc(w)}</p>`).join('')}`;
  };
  render();

  // 3D 뼈대: 대표 반복을 3초에 한 번 재생. 좌우로 끌면 몸을 돌리고, 위아래로 끌면 위·아래에서 본다.
  ac = new AbortController();
  const canvas = $('fusedCanvas'), ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const VIEWS = { base: [0.6, 0.25], front: [0, 0], side: [Math.PI / 2, 0], top: [0, Math.PI / 2] };
  const PITCH = [-0.35, Math.PI / 2];
  let [yaw, pitch] = VIEWS.base, drag = null;
  const views = $('fusedViews'); // 예전 HTML이 캐시에 남아 있으면 없을 수 있음
  const setView = (v) => { [yaw, pitch] = VIEWS[v]; views?.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === v))); };
  const clearView = () => views?.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-selected', 'false'));
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); }, { signal: ac.signal });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw += (e.clientX - drag.x) * 0.01;
    pitch = Math.min(PITCH[1], Math.max(PITCH[0], pitch + (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY }; clearView();
  }, { signal: ac.signal });
  canvas.addEventListener('pointerup', () => { drag = null; }, { signal: ac.signal });
  views?.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) setView(b.dataset.v); }, { signal: ac.signal });
  setView('base');
  $('fusedChips').addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { sel = Number(b.dataset.r); render(); } }, { signal: ac.signal });
  const LC = '#38bdf8', RC = '#fb923c', BC = '#facc15', IC = cssVar('--c-ghost') || '#e879f9';
  const ideal = idealPoses(fz, fz.exercise);
  const showIdeal = $('fusedIdeal'), showBar = $('fusedBar');
  const start = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (canvas.offsetParent === null) return; // 접혀 있거나 다른 화면이면 그리지 않음
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 실제 리듬으로 재생: 한 주기 = 내 반복 시간과 기준 반복 시간 중 긴 쪽 + 0.6초 쉼. 먼저 끝난 쪽은 선 자세로 기다린다.
    //   리듬 정보가 없으면 예전처럼 3초 주기
    const myT = cur().tempo || fz.tempo, refT = fz.refTempo || myT;
    const dur = (x) => (x ? x.descent + x.ascent : 0);
    let ph, phIdeal, cycle = 0, dt = 0;
    if (myT) {
      cycle = Math.max(dur(myT), dur(refT)) + 0.6;
      dt = ((now - start) / 1000) % cycle;
      ph = phaseByTempo(myT, dt);
      phIdeal = phaseByTempo(refT, dt);
    } else {
      ph = phIdeal = ((now - start) / 3000) % 1;
    }
    const k = Math.round(ph * (FUSE_N - 1));
    const pose = cur().poses[k];
    const s = (h / 2.1) * (1 + 0.9 * Math.max(0, pitch - 0.6) / (Math.PI / 2 - 0.6)), cx = w / 2, cy = h * 0.5, CY = 0.85; // 몸 가운데 높이(다리 길이 0.85)를 화면 가운데에
    const proj = (p) => {
      const sx = p.x * Math.cos(yaw) + p.z * Math.sin(yaw);
      const d = -p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
      return { x: cx + sx * s, y: cy - ((p.y - CY) * Math.cos(pitch) - d * Math.sin(pitch)) * s };
    };
    // 바닥 격자
    ctx.strokeStyle = cssVar('--border') || '#334155'; ctx.lineWidth = 1;
    for (let g = -0.6; g <= 0.61; g += 0.3) {
      for (const [a, b] of [[{ x: g, y: 0, z: -0.6 }, { x: g, y: 0, z: 0.6 }], [{ x: -0.6, y: 0, z: g }, { x: 0.6, y: 0, z: g }]]) {
        const A = proj(a), B = proj(b); ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      }
    }
    // 앞 방향 화살표
    const f0 = proj({ x: 0, y: 0, z: 0.45 }), f1 = proj({ x: 0, y: 0, z: 0.7 });
    ctx.strokeStyle = cssVar('--muted') || '#94a3b8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(f0.x, f0.y); ctx.lineTo(f1.x, f1.y); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.font = '11px system-ui, sans-serif'; ctx.fillText('앞', f1.x + 4, f1.y);
    // 뼈대
    const line = (a, b, color, width = 4) => { if (!a || !b) return; const A = proj(a), B = proj(b); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); };
    // 기준 자세 (점선, 같은 위상)
    const ip = ideal && showIdeal?.checked ? ideal[Math.round(phIdeal * (FUSE_N - 1))] : null;
    if (ip) {
      ctx.save(); ctx.setLineDash([6, 5]); ctx.globalAlpha = 0.9;
      for (const S of ['L', 'R']) { const J = ip[S]; line(J.shoulder, J.hip, IC, 3); line(J.hip, J.knee, IC, 3); line(J.knee, J.ankle, IC, 3); }
      line(ip.L.hip, ip.R.hip, IC, 2); line(ip.L.shoulder, ip.R.shoulder, IC, 2);
      ctx.restore();
    }
    // 바 궤적 (추정): 대표 반복 전체 경로 + 지금 위치. 발 가운데 수직선은 위치 비교용 표시
    const bar = showBar?.checked ? cur().metrics.bar : null;
    if (bar?.path?.some(Boolean)) {
      const mf = midFoot(cur().poses[0]);
      if (mf) {
        ctx.save(); ctx.setLineDash([3, 4]); line({ x: mf.x, y: 0, z: mf.z }, { x: mf.x, y: 1.9, z: mf.z }, cssVar('--muted') || '#94a3b8', 1.5); ctx.restore();
      }
      ctx.save(); ctx.strokeStyle = BC; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.85;
      ctx.beginPath(); let pen = false;
      for (const b of bar.path) { if (!b) { pen = false; continue; } const B = proj(b); if (pen) ctx.lineTo(B.x, B.y); else ctx.moveTo(B.x, B.y); pen = true; }
      ctx.stroke();
      // 바닥에 비친 그림자 (위에서 볼 때 앞뒤·좌우 흔들림이 잘 보이게)
      ctx.globalAlpha = 0.35; ctx.beginPath(); pen = false;
      for (const b of bar.path) { if (!b) { pen = false; continue; } const B = proj({ ...b, y: 0 }); if (pen) ctx.lineTo(B.x, B.y); else ctx.moveTo(B.x, B.y); pen = true; }
      ctx.stroke(); ctx.restore();
      const now3 = barPoint(pose, fz.exercise);
      if (now3) { const B = proj(now3); ctx.fillStyle = BC; ctx.beginPath(); ctx.arc(B.x, B.y, 6, 0, Math.PI * 2); ctx.fill(); }
    }
    for (const [S, color] of [['L', LC], ['R', RC]]) {
      const J = pose[S];
      line(J.shoulder, J.hip, color); line(J.hip, J.knee, color); line(J.knee, J.ankle, color); line(J.ankle, J.foot, color, 3);
    }
    line(pose.L.hip, pose.R.hip, cssVar('--text') || '#e2e8f0', 3);
    line(pose.L.shoulder, pose.R.shoulder, cssVar('--text') || '#e2e8f0', 3);
    for (const [S, color] of [['L', LC], ['R', RC]]) {
      const k = pose[S].knee; if (!k) continue;
      const K = proj(k); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(K.x, K.y, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = LC; ctx.fillText('● 왼쪽', 8, 16); ctx.fillStyle = RC; ctx.fillText('● 오른쪽', 8, 32);
    let ly = 48;
    if (ip) { ctx.fillStyle = IC; ctx.fillText('┄ 기준 자세', 8, ly); ly += 16; }
    if (bar?.path?.some(Boolean)) { ctx.fillStyle = BC; ctx.fillText('● 바 궤적 (추정)', 8, ly); ly += 16; }
    // 리듬 표시: 내려가기↓ / 올라오기↑ 초, 진행 막대
    if (myT) {
      const fmt = (x) => `↓${x.descent.toFixed(1)}초 ↑${x.ascent.toFixed(1)}초`;
      ctx.fillStyle = cssVar('--text') || '#e2e8f0';
      ctx.fillText(`나 ${fmt(myT)}`, 8, h - 26);
      if (fz.refTempo && ip) { ctx.fillStyle = IC; ctx.fillText(`기준 ${fmt(fz.refTempo)}${fz.refRange ? ` (내려가기 ${fz.refRange[0]}–${fz.refRange[1]}초 범위)` : ''}`, 8, h - 10); }
      ctx.fillStyle = cssVar('--border') || '#334155'; ctx.fillRect(w - 108, h - 16, 100, 4);
      ctx.fillStyle = cssVar('--accent') || '#818cf8'; ctx.fillRect(w - 108, h - 16, 100 * (dt / cycle), 4);
    }
  };
  raf = requestAnimationFrame(loop);
}
