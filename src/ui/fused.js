// 둘 다 모드: 측면+정면 3D 합성 진단표와 돌려 볼 수 있는 3D 뼈대
import { fusedRows, idealPoses, FUSE_N } from '../core/fuse3d.js';
import { cssVar } from './draw.js';

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
    const rows = fusedRows(cur().metrics, sel ? [] : fz.reps);
    const bad = rows.filter((r) => r.ok === false || r.reps?.length);
    $('fusedSummary').innerHTML = bad.length
      ? bad.map((r) => `<li class="bad">⚠︎ ${esc(r.issue || r.label)}${r.reps?.length ? ` <b>${r.reps.join('·')}회</b>` : ''}</li>`).join('')
      : `<li class="ok">✓ ${sel ? `${sel}회` : anyIssue ? '평균' : '모든 반복'} 정렬 양호</li>`;
    $('fusedTable').innerHTML = `
      <table class="vs compact"><tbody>${rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td><td class="diff ${r.ok === null ? '' : r.ok && !r.reps?.length ? 'same' : 'off'}">${r.ok === null ? '' : r.reps?.length ? r.reps.join('·') + '회' : r.ok ? '✓' : '⚠︎'}</td></tr>`).join('')}</tbody></table>
      ${fz.warnings.map((w) => `<p class="sub warn-text">⚠︎ ${esc(w)}</p>`).join('')}`;
  };
  render();

  // 3D 뼈대: 대표 반복을 3초에 한 번 재생, 좌우로 끌면 회전
  ac = new AbortController();
  const canvas = $('fusedCanvas'), ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let yaw = 0.6, dragX = null;
  canvas.addEventListener('pointerdown', (e) => { dragX = e.clientX; canvas.setPointerCapture(e.pointerId); }, { signal: ac.signal });
  canvas.addEventListener('pointermove', (e) => { if (dragX === null) return; yaw += (e.clientX - dragX) * 0.01; dragX = e.clientX; }, { signal: ac.signal });
  canvas.addEventListener('pointerup', () => { dragX = null; }, { signal: ac.signal });
  $('fusedChips').addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { sel = Number(b.dataset.r); render(); } }, { signal: ac.signal });
  const pitch = 0.25, LC = '#38bdf8', RC = '#fb923c', IC = cssVar('--c-ghost') || '#e879f9';
  const ideal = idealPoses(fz, fz.exercise);
  const showIdeal = $('fusedIdeal');
  const start = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (canvas.offsetParent === null) return; // 접혀 있거나 다른 화면이면 그리지 않음
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const ph = ((now - start) / 3000) % 1;
    const pose = cur().poses[Math.round(ph * (FUSE_N - 1))];
    const s = h / 2.1, cx = w / 2, cy = h * 0.88;
    const proj = (p) => {
      const sx = p.x * Math.cos(yaw) + p.z * Math.sin(yaw);
      const d = -p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
      return { x: cx + sx * s, y: cy - (p.y * Math.cos(pitch) - d * Math.sin(pitch)) * s };
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
    const ip = ideal && showIdeal?.checked ? ideal[Math.round(ph * (FUSE_N - 1))] : null;
    if (ip) {
      ctx.save(); ctx.setLineDash([6, 5]); ctx.globalAlpha = 0.9;
      for (const S of ['L', 'R']) { const J = ip[S]; line(J.shoulder, J.hip, IC, 3); line(J.hip, J.knee, IC, 3); line(J.knee, J.ankle, IC, 3); }
      line(ip.L.hip, ip.R.hip, IC, 2); line(ip.L.shoulder, ip.R.shoulder, IC, 2);
      ctx.restore();
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
    if (ip) { ctx.fillStyle = IC; ctx.fillText('┄ 기준 자세', 8, 48); }
  };
  raf = requestAnimationFrame(loop);
}
