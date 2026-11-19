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

// 상체 종목(친업·딥스): 손목(바·손잡이)에 고정한 채 관절 각도로 팔·몸통 위치를 만든다.
//   angles: elbow(안쪽 각도), shoulder(몸통 아래 방향 대비 위팔, + 앞·위), trunk(상체 기울기, + 앞)
//   각도 θ는 '아래 방향 0°, 앞쪽 +'로 잰 분절 방향. 팔꿈치를 굽히면 아래팔이 앞쪽(+)으로 돈다.
//   legs: { hip, knee } 를 주면 다리도 만든다(합성 데이터용).
export function upperChain({ elbow, shoulder, trunk }, wrist, body, facing = 1, legs = null) {
  const v = (th, len) => ({ x: facing * Math.sin(th * RAD) * len, y: Math.cos(th * RAD) * len });
  const add = (p, d, k = 1) => ({ x: p.x + d.x * k, y: p.y + d.y * k });
  const thA = shoulder - trunk, thF = thA + (180 - elbow);
  const el = add(wrist, v(thF, body.forearm), -1);
  const sh = add(el, v(thA, body.upperArm), -1);
  const hip = add(sh, v(-trunk, body.torso));
  const head = add(sh, v(180 - trunk * 0.6, body.neck));
  const out = { wrist, elbow: el, shoulder: sh, hip, head };
  if (legs) {
    const thT = -trunk + (180 - legs.hip);
    out.knee = add(hip, v(thT, body.thigh));
    out.ankle = add(out.knee, v(thT - (180 - legs.knee), body.shin));
  }
  return out;
}
