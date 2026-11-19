// 학습용 데이터 (1단계: 정답이 붙은 데이터 모으기)
//
// 영상·이름·얼굴은 넣지 않는다. 관절점 좌표(0–1 정규화)·각도 지표·앱 판정·사람 판정만 담는다.
// 찍힌 사람의 동의를 받았다고 평가자가 확인한 영상만 만든다(consent.subject).
// 형식은 docs/데이터-수집-가이드.md, 분석은 tools/fit_thresholds.py.

export const DATASET_FORMAT = 'formcheck-dataset';
export const DATASET_VERSION = 1;

const r4 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);
const numbersOnly = (o = {}) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([k, v]) => [k, r4(v)]));

// 관절점 33개 × [x, y, 신뢰도] → 한 줄 배열(99개). 안 잡힌 프레임은 null
export function packLandmarks(lm) {
  if (!lm) return null;
  const out = [];
  for (let i = 0; i < 33; i++) {
    const p = lm[i];
    out.push(r4(p?.x), r4(p?.y), r4(p?.v ?? p?.visibility ?? null));
  }
  return out;
}

export function unpackLandmarks(arr) {
  if (!arr) return null;
  const lm = [];
  for (let i = 0; i < 33; i++) lm.push({ x: arr[i * 3], y: arr[i * 3 + 1], v: arr[i * 3 + 2] });
  return lm;
}

// 분석 결과 한 개 → 데이터 항목. key 는 판정 기록(judge.js)과 잇는 무작위 id
export function buildDatasetEntry(result, view, { key, consent = {}, appVersion = '' } = {}) {
  if (!result || !key) return null;
  return {
    id: `${key}:${view}`,
    key, view, appVersion,
    createdAt: new Date().toISOString(),
    consent: { subject: !!consent.subject, at: consent.at || null },
    exercise: result.exercise,
    synthetic: !!result.synthetic,
    video: { width: result.width, height: result.height, fps: r4(result.fps), duration: r4(result.duration), side: result.side || null, facing: result.facing ?? null },
    // 무게는 판정 보정에 쓰일 수 있어 넣는다(몸무게·바벨·1RM). 이름·생년월일 같은 정보는 받지 않는다
    load: result.load ? { bodyKg: result.load.bodyKg ?? null, barKg: result.load.barKg ?? 0, oneRM: result.load.oneRM ?? null } : null,
    t: (result.t || []).map(r4),
    landmarks: (result.frames || []).map((f) => packLandmarks(f.lm)),
    reps: (result.reps || []).map((r) => ({
      index: r.index, start: r.start, bottom: r.bottom ?? null, end: r.end,
      partial: !!(r.partialStart || r.partialEnd), metrics: numbersOnly(r.metrics),
    })),
    app: {
      feedback: (result.feedback || []).map((f) => ({ id: f.id, level: f.level, reps: f.reps || [] })),
      summary: numbersOnly(result.summary),
      tempo: result.tempo ? numbersOnly(result.tempo) : null,
    },
  };
}

// 내보내기 파일: 데이터 항목 + 같은 key·view 의 사람 판정
export function buildExport(entries, labels, { raterId = '', raterRole = '', appVersion = '' } = {}) {
  const byId = new Map();
  for (const l of labels || []) {
    const id = `${l.key}:${l.view}`;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({
      at: l.at, raterId: l.raterId || raterId, raterRole: l.rater || raterRole,
      kind: l.verdict === 'rep' ? 'rep' : l.verdict === 'missed' ? 'missed' : 'item',
      item: l.item, verdict: l.verdict, rep: l.rep ?? null, issues: l.issues || null, reps: l.reps || '', note: l.note || '',
    });
  }
  const sessions = (entries || []).filter((e) => e?.consent?.subject).map((e) => ({ ...e, labels: byId.get(e.id) || [] }));
  return {
    format: DATASET_FORMAT, version: DATASET_VERSION, exportedAt: new Date().toISOString(), appVersion,
    rater: { id: raterId, role: raterRole },
    note: '영상·이름·얼굴 없음. 관절점 좌표는 화면 크기 대비 0–1 값. 찍힌 사람의 동의를 평가자가 확인한 영상만 포함.',
    sessions,
  };
}

// 반복 단위 판정 개수 (설정 화면 표시용)
export function countRepLabels(labels) {
  const reps = new Set((labels || []).filter((l) => l.verdict === 'rep').map((l) => `${l.key}:${l.view}:${l.rep}:${l.raterId || ''}`));
  return reps.size;
}

