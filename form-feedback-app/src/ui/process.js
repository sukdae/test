// 영상 파일 → 프레임별 관절점 추출
import { loadPose, beginSequence, detectAt } from './pose.js';

const once = (el, ev, timeout = 4000) => new Promise((resolve, reject) => {
  const tm = setTimeout(() => { el.removeEventListener(ev, h); resolve('timeout'); }, timeout);
  const h = () => { clearTimeout(tm); resolve(ev); };
  el.addEventListener(ev, h, { once: true });
  el.addEventListener('error', () => { clearTimeout(tm); reject(new Error('영상을 읽을 수 없어요. 다른 형식(mp4)으로 시도해 주세요.')); }, { once: true });
});

async function seek(v, t) {
  const p = once(v, 'seeked', 2000);
  v.currentTime = t;
  await p;
}

export async function extractFrames(url, { fps = 15, onProgress = () => {}, isCancelled = () => false } = {}) {
  onProgress(0, '자세 인식 모델 불러오는 중…');
  await loadPose();

  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.className = 'offscreen-video';
  document.body.appendChild(v);
  try {
    v.src = url;
    await once(v, 'loadeddata', 10000);
    let dur = v.duration;
    if (!Number.isFinite(dur)) {
      // MediaRecorder로 만든 webm은 길이가 Infinity로 나오는 경우가 있어 끝으로 한 번 이동해 길이를 얻는다.
      await seek(v, 1e7);
      dur = v.duration;
      if (!Number.isFinite(dur)) dur = v.currentTime;
    }
    if (!dur || !Number.isFinite(dur)) throw new Error('영상 길이를 알 수 없어요.');
    if (dur > 120) throw new Error('2분 이하의 영상만 분석할 수 있어요. 한 세트만 잘라서 올려 주세요.');

    beginSequence();
    const frames = [];
    const step = 1 / fps;
    const total = Math.floor(dur / step) + 1;
    for (let i = 0; i < total; i++) {
      if (isCancelled()) throw new Error('cancelled');
      const t = Math.min(i * step, Math.max(0, dur - 0.01));
      await seek(v, t);
      const { lm, back } = detectAt(v, t);
      frames.push({ t, lm, back });
      onProgress((i + 1) / total, `분석 중… ${i + 1}/${total} 프레임`);
    }
    return { frames, width: v.videoWidth, height: v.videoHeight, duration: dur };
  } finally {
    v.removeAttribute('src');
    v.load();
    v.remove();
  }
}
