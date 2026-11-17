// 가벼운 캔버스 라인 차트
import { isNum } from '../core/signal.js';
import { cssVar } from './draw.js';

export function setupCanvas(canvas, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, cssHeight);
  return { ctx, w, h: cssHeight };
}

// opts: { height, xMin, xMax, yMin, yMax, yTicks, xTicks:[{x,label}], bands:[{x0,x1,label,active}],
//         series:[{xs, ys, color, dash, label, width}], cursor, legend }
export function lineChart(canvas, opts) {
  const { ctx, w, h } = setupCanvas(canvas, opts.height || 200);
  const pad = { l: 36, r: 10, t: opts.legend === false ? 10 : 28, b: 22 };
  const X = (x) => pad.l + ((x - opts.xMin) / (opts.xMax - opts.xMin || 1)) * (w - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - opts.yMin) / (opts.yMax - opts.yMin || 1)) * (h - pad.t - pad.b);
  const muted = cssVar('--muted'), grid = cssVar('--grid'), band = cssVar('--band'), bandActive = cssVar('--band-active');
  ctx.font = '11px system-ui, sans-serif';

  for (const b of opts.bands || []) {
    ctx.fillStyle = b.active ? bandActive : band;
    ctx.fillRect(X(b.x0), pad.t, X(b.x1) - X(b.x0), h - pad.t - pad.b);
    if (b.label) { ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.fillText(b.label, (X(b.x0) + X(b.x1)) / 2, pad.t + 11); }
  }

  ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of opts.yTicks || []) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
    ctx.fillText(`${v}${opts.yUnit ?? '°'}`, pad.l - 4, Y(v));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const tk of opts.xTicks || []) ctx.fillText(tk.label, X(tk.x), h - pad.b + 5);

  for (const s of opts.series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash ? [5, 4] : []);
    ctx.beginPath();
    let pen = false;
    s.ys.forEach((y, i) => {
      const x = s.xs[i];
      if (!isNum(y) || !isNum(x)) { pen = false; return; }
      if (pen) ctx.lineTo(X(x), Y(y)); else { ctx.moveTo(X(x), Y(y)); pen = true; }
    });
    ctx.stroke();
    if (s.dots) {
      ctx.fillStyle = s.color;
      s.ys.forEach((y, i) => { if (isNum(y)) { ctx.beginPath(); ctx.arc(X(s.xs[i]), Y(y), 3.5, 0, Math.PI * 2); ctx.fill(); } });
    }
  }
  ctx.setLineDash([]);

  if (isNum(opts.cursor)) {
    ctx.strokeStyle = cssVar('--text'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(opts.cursor), pad.t); ctx.lineTo(X(opts.cursor), h - pad.b); ctx.stroke();
  }

  if (opts.legend !== false) {
    let lx = pad.l;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const s of opts.series) {
      if (!s.label) continue;
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.setLineDash(s.dash ? [5, 4] : []);
      ctx.beginPath(); ctx.moveTo(lx, 10); ctx.lineTo(lx + 16, 10); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssVar('--text');
      ctx.fillText(s.label, lx + 20, 10);
      lx += 28 + ctx.measureText(s.label).width;
    }
  }

  return { xFromPixel: (px) => opts.xMin + ((px - pad.l) / (w - pad.l - pad.r)) * (opts.xMax - opts.xMin) };
}
