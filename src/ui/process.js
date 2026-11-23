// 영상 파일 → 프레임별 관절점 추출
import { loadPose, beginSequence, detectAt, IS_MOBILE } from './pose.js';

const once = (el, ev, timeout = 4000) => new Promise((resolve, reject) => {
  const tm = setTimeout(() => { el.removeEventListener(ev, h); resolve('timeout'); }, timeout);
  const h = () => { clearTimeout(tm); resolve(ev); };
  el.addEventListener(ev, h, { once: true });
  el.addEventListener('error', () => { clearTimeout(tm); reject(new Error('이 브라우저가 영상을 읽지 못했어요. 아이폰 영상이면 설정 → 카메라 → 포맷 → \'높은 호환성\'으로 찍거나, 크롬·사파리에서 열어 주세요.')); }, { once: true });
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
    // 빠른 길: 영상을 재생하면서 새 프레임이 나올 때마다 분석(requestVideoFrameCallback).
    //   프레임마다 위치를 옮기는(seek) 방식은 폰에서 한 번에 수백 ms 씩 걸려 분석이 아주 느려진다.
    //   폰은 0.5배속으로 재생해 분석이 따라가게 한다. 분석이 밀려 건너뛴 프레임은 앞뒤로 메워진다(fillGaps).
    if ('requestVideoFrameCallback' in v) {
      const ok = await playExtract(v, frames, { step, dur, rate: IS_MOBILE ? 0.5 : 1, onProgress, isCancelled });
      if (ok && frames.length >= Math.min(10, total / 3)) return { frames, width: v.videoWidth, height: v.videoHeight, duration: dur };
      frames.length = 0; // 재생이 막히면(일부 브라우저) 예전 방식으로
      beginSequence();
    }
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

// 재생하며 프레임 받기. 성공하면 true, 재생이 시작되지 않으면 false.
function playExtract(v, frames, { step, dur, rate, onProgress, isCancelled }) {
  return new Promise((resolve, reject) => {
    let lastT = -Infinity, done = false, stall = null;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(stall); v.pause(); resolve(ok); };
    const arm = () => { clearTimeout(stall); stall = setTimeout(() => finish(frames.length > 0 && lastT >= dur - 0.5), 5000); };
    const onFrame = (_now, meta) => {
      if (done) return;
      if (isCancelled()) { done = true; v.pause(); reject(new Error('cancelled')); return; }
      const t = meta.mediaTime ?? v.currentTime;
      if (t - lastT >= step * 0.9) {
        lastT = t;
        const { lm, back } = detectAt(v, t);
        frames.push({ t, lm, back });
        onProgress(Math.min(1, t / dur), `분석 중… ${Math.round(t)}/${Math.round(dur)}초`);
      }
      arm();
      v.requestVideoFrameCallback(onFrame);
    };
    v.addEventListener('ended', () => finish(true), { once: true });
    v.currentTime = 0;
    v.playbackRate = rate;
    v.requestVideoFrameCallback(onFrame);
    v.play().then(arm, () => finish(false));
  });
}
