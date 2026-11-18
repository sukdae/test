// MediaPipe Pose Landmarker 래퍼 (브라우저 전용)
// 네이티브 앱으로 옮길 때는 이 파일만 플랫폼별 MediaPipe SDK 호출로 바꾸면 됩니다.
import { measureTrunkEdges } from '../core/back.js';

const VERSION = '0.10.14';
const BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

let landmarker = null;
let loading = null;
let lastTs = 0;
let seqBase = 0;

export function loadPose() {
  if (landmarker) return Promise.resolve(landmarker);
  if (loading) return loading;
  loading = (async () => {
    const { PoseLandmarker, FilesetResolver } = await import(BUNDLE);
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      // 인식 신뢰도가 낮은 프레임을 거르지 않으면 무릎 각도 오차가 크게 늘어남(ICC 0.77 → 0.43) [논문 28]
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: true, // 등 곡률(실험)용 사람 윤곽
    });
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    return landmarker;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

function normalize(raw) {
  if (!raw) return null;
  const hasVis = raw.some((p) => typeof p.visibility === 'number' && p.visibility > 0);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return raw.map((p) => {
    const inFrame = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    return { x: r4(p.x), y: r4(p.y), v: r4(hasVis ? p.visibility : inFrame ? 0.9 : 0.1) };
  });
}

function run(source, ts, withBack) {
  const safe = Math.max(lastTs + 1, Math.round(ts));
  lastTs = safe;
  const res = landmarker.detectForVideo(source, safe);
  const lm = normalize(res.landmarks?.[0]);
  let back = null;
  const mask = res.segmentationMasks?.[0];
  try {
    if (withBack && mask && lm) {
      const data = mask.getAsFloat32Array();
      const mw = mask.width, mh = mask.height;
      back = measureTrunkEdges((x, y) => data[(y | 0) * mw + (x | 0)], mw, mh, lm);
    }
  } catch { back = null; }
  finally { res.segmentationMasks?.forEach((m) => m.close?.()); }
  return { lm, back };
}

// 실시간 카메라용
export const detectLive = (video) => run(video, performance.now(), false).lm;

// 영상 분석용: 새 시퀀스마다 시간 간격을 두어 추적 상태를 초기화
export function beginSequence() { seqBase = lastTs + 2000; }
export const detectAt = (video, tSec) => run(video, seqBase + tSec * 1000, true);
