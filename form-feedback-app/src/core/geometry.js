// 2D 관절 기하 계산 (픽셀 좌표, y축은 아래 방향)

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// from→to 벡터가 수직(위쪽)에서 얼마나 기울었는지. 진행 방향(앞)이 양수.
export function leanFromVertical(from, to, facing = 1) {
  return Math.atan2(facing * (to.x - from.x), from.y - to.y) * DEG;
}

// 분절 기울기에서 관절 각도 계산 (180 = 완전히 펴짐)
//   shin  : 발목→무릎, thigh: 무릎→엉덩이, trunk: 엉덩이→어깨
export const kneeAngle = (shin, thigh) => 180 - (shin - thigh);
export const hipAngle = (trunk, thigh) => 180 - (trunk - thigh);

// 분절 기울기와 길이로 관절 위치를 다시 만든다(기준 동작 고스트 표시용).
export function chainFromAngles({ shin, thigh, trunk }, ankle, body, facing = 1) {
  const dir = (a) => ({ x: facing * Math.sin(a * RAD), y: -Math.cos(a * RAD) });
  const step = (p, a, len) => { const d = dir(a); return { x: p.x + d.x * len, y: p.y + d.y * len }; };
  const knee = step(ankle, shin, body.shin);
  const hip = step(knee, thigh, body.thigh);
  const shoulder = step(hip, trunk, body.torso);
  const head = step(shoulder, trunk * 0.6, body.neck);
  return { ankle, knee, hip, shoulder, head };
}
