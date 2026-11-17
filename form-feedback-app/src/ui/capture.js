// 촬영 화면: 카메라 미리보기, 실시간 전신 인식 체크, 녹화
import { loadPose, detectLive } from './pose.js';
import { drawSkeleton, cssVar } from './draw.js';

const $ = (id) => document.getElementById(id);
const MAX_SEC = 90;

let stream = null, raf = 0, recorder = null, facingMode = 'environment', ac = null, lastDetect = 0, recStart = 0, cdTimer = 0;

export function framingCheck(lm, W, H, view = 'side') {
  if (!lm) return { ok: false, msg: '사람이 보이지 않아요. 프레임 안에 서 주세요.' };
  const vis = (i) => lm[i] && lm[i].v >= 0.5 && lm[i].x > 0.01 && lm[i].x < 0.99 && lm[i].y > 0.01 && lm[i].y < 0.99;
  const L = [11, 23, 25, 27].every(vis), R = [12, 24, 26, 28].every(vis);
  if (!L && !R) {
    if (!vis(27) && !vis(28)) return { ok: false, msg: '발끝까지 보이도록 조금 뒤로 물러나 주세요.' };
    return { ok: false, msg: '머리부터 발끝까지 전신이 보이게 해 주세요.' };
  }
  const s = L ? [11, 23, 27] : [12, 24, 28];
  const top = Math.min(lm[0]?.y ?? 1, lm[s[0]].y);
  const h = lm[s[2]].y - top;
  if (h > 0.92 || top < 0.02) return { ok: false, msg: '너무 가까워요. 조금 뒤로 물러나 주세요.' };
  if (h < 0.4) return { ok: false, msg: '조금 더 가까이 와 주세요.' };
  const torso = Math.hypot((lm[s[0]].x - lm[s[1]].x) * W, (lm[s[0]].y - lm[s[1]].y) * H);
  const shoulderRatio = vis(11) && vis(12) ? Math.abs(lm[11].x - lm[12].x) * W / torso : NaN;
  if (view === 'front') {
    if (!(L && R)) return { ok: false, msg: '양쪽 다리가 모두 보이게 카메라를 마주 보고 서 주세요.' };
    if (shoulderRatio < 0.35) return { ok: false, msg: '카메라를 정면으로 바라봐 주세요.', warnOnly: true };
    return { ok: true, msg: '좋아요! 정면 전신이 인식됐어요.' };
  }
  if (shoulderRatio > 0.5) return { ok: false, msg: '몸을 옆으로 돌려 측면이 보이게 서 주세요.', warnOnly: true };
  return { ok: true, msg: '좋아요! 측면 전신이 인식됐어요.' };
}

function drawGuide(ctx, W, H, ok, view) {
  ctx.save();
  ctx.strokeStyle = ok ? cssVar('--good') : 'rgba(255,255,255,.7)';
  ctx.lineWidth = Math.max(2, W / 300);
  ctx.setLineDash([W / 60, W / 80]);
  const gh = H * 0.86, gw = gh * (view === 'front' ? 0.5 : 0.36), x = (W - gw) / 2, y = H * 0.06;
  ctx.strokeRect(x, y, gw, gh);
  ctx.restore();
}

async function openStream() {
  stopStream();
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  const v = $('camVideo');
  v.srcObject = stream;
  await v.play().catch(() => {});
  const mirror = facingMode === 'user';
  v.classList.toggle('mirror', mirror);
  $('camCanvas').classList.toggle('mirror', mirror);
}

function stopStream() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function pickMime() {
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

export async function startCapture({ onRecorded, onError, view = 'side' }) {
  ac = new AbortController();
  const sig = { signal: ac.signal };
  const status = $('camStatus'), recBtn = $('recBtn'), v = $('camVideo'), canvas = $('camCanvas');
  const setStatus = (msg, cls = '') => { status.textContent = msg; status.className = `status ${cls}`; };

  if (!navigator.mediaDevices?.getUserMedia) {
    onError('이 브라우저에서는 카메라를 쓸 수 없어요. HTTPS 주소로 열었는지 확인하거나 "영상 불러오기"를 이용해 주세요.');
    return;
  }
  try {
    await openStream();
  } catch (e) {
    onError(e.name === 'NotAllowedError' ? '카메라 권한이 거부됐어요. 브라우저 설정에서 허용하거나 "영상 불러오기"를 이용해 주세요.' : `카메라를 열 수 없어요 (${e.message}).`);
    return;
  }
  recBtn.disabled = false;
  recBtn.textContent = '녹화 시작';
  setStatus('자세 인식 모델 불러오는 중…');
  let poseReady = false;
  loadPose().then(() => { poseReady = true; }).catch(() => setStatus('자세 인식 모델을 불러오지 못했어요. 녹화는 가능하며, 분석 시 다시 시도해요.', 'warn'));

  const ctx = canvas.getContext('2d');
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (!v.videoWidth) return;
    if (canvas.width !== v.videoWidth) { canvas.width = v.videoWidth; canvas.height = v.videoHeight; $('camStage').style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`; }
    if (!poseReady || now - lastDetect < 80) return;
    lastDetect = now;
    let lm = null;
    try { lm = detectLive(v); } catch { return; }
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const chk = framingCheck(lm, W, H, view);
    drawGuide(ctx, W, H, chk.ok, view);
    drawSkeleton(ctx, lm, W, H);
    if (!recorder) setStatus(chk.msg, chk.ok ? 'ok' : 'warn');
  };
  raf = requestAnimationFrame(loop);

  $('flipBtn').addEventListener('click', async () => {
    if (recorder) return;
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    try { await openStream(); } catch (e) { onError(`카메라를 전환할 수 없어요 (${e.message}).`); }
  }, sig);

  recBtn.addEventListener('click', () => {
    if (recorder) { recorder.stop(); return; }
    if (cdTimer) return;
    if (!window.MediaRecorder) { onError('이 브라우저는 녹화를 지원하지 않아요. 기본 카메라 앱으로 찍은 뒤 "영상 불러오기"를 이용해 주세요.'); return; }
    let n = 3;
    const cd = $('countdown');
    cd.hidden = false; cd.textContent = n;
    recBtn.disabled = true;
    cdTimer = setInterval(() => {
      n--;
      if (n > 0) { cd.textContent = n; return; }
      clearInterval(cdTimer); cdTimer = 0; cd.hidden = true;
      startRecording({ onRecorded, onError, setStatus });
    }, 1000);
  }, sig);
}

function startRecording({ onRecorded, onError, setStatus }) {
  const recBtn = $('recBtn');
  const chunks = [];
  const mimeType = pickMime();
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (e) { onError(`녹화를 시작할 수 없어요 (${e.message}).`); return; }
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const type = recorder.mimeType || mimeType || 'video/webm';
    recorder = null;
    $('recBadge').hidden = true;
    const blob = new Blob(chunks, { type });
    stopCapture();
    onRecorded(blob);
  };
  recorder.start(500);
  recStart = performance.now();
  recBtn.disabled = false;
  recBtn.textContent = '■ 녹화 중지';
  recBtn.classList.add('recording');
  $('recBadge').hidden = false;
  setStatus('녹화 중… 한 세트를 끝까지 해 주세요.', 'rec');
  const tick = () => {
    if (!recorder) return;
    const sec = (performance.now() - recStart) / 1000;
    $('recTime').textContent = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
    if (sec >= MAX_SEC) { recorder.stop(); return; }
    setTimeout(tick, 250);
  };
  tick();
}

export function stopCapture() {
  cancelAnimationFrame(raf);
  if (cdTimer) { clearInterval(cdTimer); cdTimer = 0; }
  $('countdown').hidden = true;
  if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
  recorder = null;
  ac?.abort();
  stopStream();
  const recBtn = $('recBtn');
  recBtn.classList.remove('recording');
  recBtn.disabled = true;
  $('recBadge').hidden = true;
  const c = $('camCanvas');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
}
