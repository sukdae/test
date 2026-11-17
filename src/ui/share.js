// 결과를 이미지 한 장으로 만들어 공유(카톡 등) 또는 저장
// 서버로 보내지 않는다. 공유 대상은 사용자가 휴대폰 공유 창에서 직접 고른다.
import { cssVar } from './draw.js';

const $ = (id) => document.getElementById(id);
const W = 1080, PAD = 56;

function wrap(ctx, text, maxW) {
  const out = [];
  let line = '';
  for (const ch of String(text)) {
    if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch.trimStart(); } else line += ch;
  }
  if (line) out.push(line);
  return out;
}

const visibleText = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()).filter(Boolean);

// 지금 결과 화면의 내용으로 이미지를 만든다. includeFrame=false면 영상 없이 뼈대·표시선만
export async function buildShareImage({ title, includeFrame = false }) {
  const video = $('resultVideo'), overlay = $('resultCanvas');
  const actions = visibleText('#actionList li b');
  const good = visibleText('#goodChips span');
  const issues3d = $('fusedBlock').hidden ? [] : visibleText('#fusedSummary li');

  // 높이 계산용으로 먼저 측정
  const meas = document.createElement('canvas').getContext('2d');
  const font = (size, weight = 500) => `${weight} ${size}px system-ui, -apple-system, 'Apple SD Gothic Neo', sans-serif`;
  meas.font = font(40, 700);
  const actionLines = actions.map((a) => wrap(meas, a, W - PAD * 2 - 70));
  meas.font = font(34, 600);
  const issueLines = issues3d.map((a) => wrap(meas, a, W - PAD * 2));
  const stageH = Math.min(1100, Math.round((W - PAD * 2) * (overlay.height / overlay.width)));
  const stageW = Math.round(stageH * (overlay.width / overlay.height));
  let H = 150 + stageH + 60 + 70 + actionLines.reduce((s, l) => s + l.length * 52 + 24, 0);
  if (!actions.length) H += 60;
  if (good.length) H += 90;
  if (issues3d.length) H += 80 + issueLines.reduce((s, l) => s + l.length * 46, 0);
  H += 110;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const bg = cssVar('--bg') || '#0f172a', text = cssVar('--text') || '#e2e8f0', muted = cssVar('--muted') || '#94a3b8';
  const accent = cssVar('--accent') || '#818cf8', good_ = cssVar('--good') || '#22c55e', warn = cssVar('--warn') || '#f59e0b';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'top';

  // 머리
  ctx.fillStyle = text; ctx.font = font(52, 800); ctx.fillText(title, PAD, 50);
  ctx.fillStyle = muted; ctx.font = font(30); ctx.fillText(new Date().toLocaleDateString('ko-KR'), PAD, 112);
  let y = 170;

  // 장면: (선택) 영상 프레임 + 표시선
  const sx = Math.round((W - stageW) / 2);
  ctx.fillStyle = cssVar('--stage-bg') || '#020617';
  ctx.fillRect(PAD, y, W - PAD * 2, stageH);
  if (includeFrame && !video.hidden && video.readyState >= 2) ctx.drawImage(video, sx, y, stageW, stageH);
  ctx.drawImage(overlay, sx, y, stageW, stageH);
  y += stageH + 60;

  // 이렇게 해 보세요
  ctx.fillStyle = text; ctx.font = font(40, 800); ctx.fillText('이렇게 해 보세요', PAD, y); y += 70;
  if (!actions.length) { ctx.fillStyle = good_; ctx.font = font(38, 700); ctx.fillText('지금 자세 그대로 유지하세요 👍', PAD, y); y += 60; }
  actionLines.forEach((lines, i) => {
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(PAD + 24, y + 22, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = font(30, 800); ctx.textAlign = 'center'; ctx.fillText(String(i + 1), PAD + 24, y + 7); ctx.textAlign = 'left';
    ctx.fillStyle = text; ctx.font = font(40, 700);
    lines.forEach((l, k) => ctx.fillText(l, PAD + 70, y + k * 52));
    y += lines.length * 52 + 24;
  });
  if (good.length) {
    ctx.fillStyle = good_; ctx.font = font(32, 600);
    ctx.fillText(wrap(ctx, good.join('   '), W - PAD * 2)[0], PAD, y + 20); y += 90;
  }
  if (issues3d.length) {
    ctx.fillStyle = text; ctx.font = font(36, 800); ctx.fillText('3D (추정)', PAD, y + 10); y += 70;
    ctx.fillStyle = warn; ctx.font = font(34, 600);
    issueLines.forEach((lines) => { lines.forEach((l) => { ctx.fillText(l, PAD, y); y += 46; }); });
    y += 10;
  }
  ctx.fillStyle = muted; ctx.font = font(26);
  ctx.fillText('폼 체크 · 참고용 피드백이며 의료 진단이 아니에요', PAD, H - 70);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

export async function shareResult(opts) {
  const blob = await buildShareImage(opts);
  const file = new File([blob], `formcheck-${new Date().toISOString().slice(0, 10)}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: opts.title }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'downloaded';
}
