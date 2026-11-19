// 기준선 설문 (촬영 없음)
//
// 참여자가 뼈대 인형의 각도를 막대로 움직여 "어디부터 문제로 보는지"를 직접 정한다.
// 모인 값의 분포를 앱 기준값과 비교해 기준값을 보정하는 데 쓴다(tools/fit_thresholds.py).
// 영상·관절점·이름은 받지 않는다. 성별·나이대·운동 경력만 선택으로 받는다.
import { chainFromAngles } from './geometry.js';

export const SURVEY_FORMAT = 'formcheck-threshold-survey';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// 스쿼트 최저점 자세: 허벅지가 수평보다 a° 위(음수 = 평행 아래), 정강이 s°, 상체 t°
const squatPose = (above = 0, shin = 30, trunk = null) => {
  const depth = clamp((90 - above) / 90, 0, 1.3);
  const sh = shin * Math.min(1, depth);
  return { shin: sh, thigh: above - 90, trunk: trunk ?? sh, heel: 0, bar: 'back' };
};

// 문항: value 는 막대 값. app = 앱 기준값(같은 단위). dir = 앱에서 '문제'가 되는 쪽(> 크면 문제 / < 작으면 문제)
export const QUESTIONS = [
  {
    id: 'depth', exercise: 'squat', title: '스쿼트 깊이',
    ask: "어디부터 '얕다'고 보세요?",
    min: -20, max: 60, step: 1, start: 20, dir: '>', app: 35,
    appNote: '앱: 허벅지가 수평보다 35° 넘게 위면 얕음 (15–35°는 조금 못 미침)',
    label: (v) => (v === 0 ? '허벅지 수평' : v < 0 ? `평행보다 ${-v}° 아래` : `수평보다 ${v}° 위`),
    pose: (v) => squatPose(v),
  },
  {
    id: 'trunk', exercise: 'squat', title: '스쿼트 상체 숙임',
    ask: "어디부터 상체를 '너무 숙였다'고 보세요?",
    min: 10, max: 75, step: 1, start: 35, dir: '>', app: null,
    appNote: '앱: 숙임만으로는 지적하지 않음 (정강이와 비교해 엉덩이·무릎 위주만 알려 줌)',
    label: (v) => `상체 ${v}° 기울임`,
    pose: (v) => squatPose(0, 30, v),
  },
  {
    id: 'heel', exercise: 'squat', title: '뒤꿈치 들림',
    ask: "어디부터 '뒤꿈치가 들렸다'고 보세요?",
    min: 0, max: 10, step: 0.5, start: 3, dir: '>', app: 3,
    appNote: '앱: 다리 길이의 3% 넘게 들리면 지적',
    label: (v) => `다리 길이의 ${v}%`,
    pose: (v) => ({ ...squatPose(0), heel: v / 100 }),
  },
  {
    id: 'kneeFwd', exercise: 'squat', title: '무릎이 앞으로 나감',
    ask: '무릎이 어디까지 앞으로 나가도 괜찮다고 보세요?',
    min: 5, max: 50, step: 1, start: 25, dir: '>', app: null,
    appNote: '앱: 지적하지 않음 (무릎이 발끝을 넘는 것은 괜찮다는 연구 — Fry 외 2003)',
    label: (v) => `정강이 ${v}° 기울임`,
    pose: (v) => ({ ...squatPose(0, v, v) }),
  },
  {
    id: 'dlLockout', exercise: 'deadlift', title: '데드리프트 마무리',
    ask: "어디까지 펴야 '끝까지 폈다'고 보세요?",
    min: 140, max: 180, step: 1, start: 160, dir: '<', app: 165,
    appNote: '앱: 마무리 엉덩이 각도 165° 미만이면 덜 폄',
    label: (v) => `엉덩이 ${v}°`,
    pose: (v) => ({ shin: 2, thigh: -3 + 0, trunk: -3 + 180 - v, heel: 0, bar: 'hands' }),
  },
  {
    id: 'dlLeanBack', exercise: 'deadlift', title: '데드리프트 뒤로 젖힘',
    ask: "어디부터 '뒤로 젖혔다'고 보세요?",
    min: 0, max: 35, step: 1, start: 10, dir: '>', app: 15,
    appNote: '앱: 상체가 수직보다 15° 넘게 뒤로 가면 지적',
    label: (v) => `상체 뒤로 ${v}°`,
    pose: (v) => ({ shin: 2, thigh: -3, trunk: -v, heel: 0, bar: 'hands' }),
  },
];

// 뼈대 인형 관절 위치 (캔버스 픽셀). 오른쪽을 보고 선 사람
export function figurePoints(pose, W = 300, H = 300) {
  const body = { shin: H * 0.22, thigh: H * 0.22, torso: H * 0.27, neck: H * 0.08 };
  const legLen = body.shin + body.thigh;
  const ankle = { x: W * 0.42, y: H * 0.86 - (pose.heel || 0) * legLen };
  const c = chainFromAngles(pose, ankle, body, 1);
  // 발: 뒤꿈치가 들리면 발끝을 축으로 기울어짐
  const toe = { x: ankle.x + H * 0.09, y: H * 0.86 + H * 0.02 };
  const heel = { x: ankle.x - H * 0.03, y: ankle.y + H * 0.02 };
  let arm;
  if (pose.bar === 'hands') {
    // 데드리프트: 팔은 어깨에서 아래로 늘어뜨림, 바는 손
    const hand = { x: c.shoulder.x, y: c.shoulder.y + H * 0.24 };
    arm = { elbow: { x: c.shoulder.x, y: c.shoulder.y + H * 0.12 }, hand, bar: hand };
  } else {
    // 스쿼트: 바는 어깨 위, 손은 바를 잡음
    const bar = { x: c.shoulder.x - H * 0.015, y: c.shoulder.y - H * 0.01 };
    arm = { elbow: { x: c.shoulder.x - H * 0.06, y: c.shoulder.y + H * 0.08 }, hand: { x: bar.x + H * 0.02, y: bar.y }, bar };
  }
  return { ...c, toe, heel, ...arm, plateR: H * 0.1 };
}

// 응답 요약(엑셀용 CSV, 한 사람 한 줄)
const pad = (v) => String(v).padStart(2, '0');
const localTime = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function surveyCSV(records) {
  const cols = ['번호', '날짜', '성별', '나이', '운동 경력', ...QUESTIONS.map((q) => `${q.title} (${q.id})`)];
  const qv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = (records || []).map((r) => [r.n, localTime(r.at), r.profile?.gender, r.profile?.age, r.profile?.career,
    ...QUESTIONS.map((q) => (r.answers?.[q.id] == null ? '모름' : r.answers[q.id]))].map(qv).join(','));
  return '﻿' + [cols.join(','), ...rows].join('\n');
}

export function surveyJSON(records) {
  return {
    format: SURVEY_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    note: '촬영 없는 기준선 설문. 영상·관절점·이름 없음. answers 값이 null 이면 "잘 모르겠어요".',
    questions: QUESTIONS.map(({ id, exercise, title, ask, min, max, dir, app, appNote }) => ({ id, exercise, title, ask, min, max, dir, app, appNote })),
    responses: records || [],
  };
}

// 중앙값·사분위 (설문 결과 화면·분석용)
export function summarize(records) {
  const out = {};
  for (const q of QUESTIONS) {
    const v = (records || []).map((r) => r.answers?.[q.id]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
    const at = (p) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))] : null);
    out[q.id] = { n: v.length, median: at(0.5), q1: at(0.25), q3: at(0.75) };
  }
  return out;
}
