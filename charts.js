/* ============================================================
   Построение графиков на canvas без внешних зависимостей
   ============================================================ */

const PALETTE = [
  '#e63946', '#1d4ed8', '#059669', '#d97706', '#7c3aed',
  '#0ea5e9', '#db2777', '#65a30d', '#92400e', '#475569',
];

/**
 * Линейный график по годам.
 * @param canvas   HTMLCanvasElement
 * @param series   массив {label, name, values[], color, dashed}
 * @param years    массив меток оси X
 */
function drawChart(canvas, series, years, title) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 900, H = canvas.clientHeight || 420;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const pad = { l: 64, r: 20, t: 40, b: 44 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const isDark = document.body.classList.contains('dark');
  const axis = isDark ? '#dfe4ea' : '#333';
  const grid = isDark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.09)';

  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = axis;

  let minY = Infinity, maxY = -Infinity;
  for (const s of series) if (s.visible) for (const v of s.values) {
    if (isFinite(v)) { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
  }
  if (!isFinite(minY)) { minY = 0; maxY = 1; }
  if (maxY - minY < 1e-6) { maxY += 1; }
  const padY = (maxY - minY) * 0.06;
  minY = Math.max(0, minY - padY); maxY += padY;

  const x = i => pad.l + (years.length === 1 ? pw / 2 : pw * i / (years.length - 1));
  const y = v => pad.t + ph - (v - minY) / (maxY - minY) * ph;

  // сетка + подписи Y
  ctx.strokeStyle = grid; ctx.lineWidth = 1;
  ctx.fillStyle = axis;
  const yTicks = 6;
  for (let i = 0; i <= yTicks; i++) {
    const v = minY + (maxY - minY) * i / yTicks;
    const py = y(v);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(v.toFixed(2), pad.l - 8, py);
    ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(W - pad.r, py); ctx.stroke();
  }
  // подписи X (годы)
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const xTicks = Math.min(years.length, 12);
  const stride = Math.max(1, Math.ceil(years.length / xTicks));
  for (let i = 0; i < years.length; i += stride) {
    ctx.fillText(String(years[i]), x(i), pad.t + ph + 8);
  }
  // оси
  ctx.strokeStyle = axis; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ph); ctx.lineTo(W - pad.r, pad.t + ph);
  ctx.stroke();

  // заголовок
  ctx.fillStyle = axis; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '600 14px system-ui, sans-serif';
  if (title) ctx.fillText(title, W / 2, 20);

  // серии
  for (const s of series) {
    if (!s.visible) continue;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.dashed ? 2 : 2.2;
    ctx.setLineDash(s.dashed ? [6, 4] : []);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < s.values.length; i++) {
      const v = s.values[i];
      if (!isFinite(v)) { started = false; continue; }
      if (!started) { ctx.moveTo(x(i), y(v)); started = true; }
      else ctx.lineTo(x(i), y(v));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // маркеры наблюдаемых точек
    if (s.dashed) {
      ctx.fillStyle = s.color;
      for (let i = 0; i < s.values.length; i++) {
        if (isFinite(s.values[i])) {
          ctx.beginPath(); ctx.arc(x(i), y(s.values[i]), 3, 0, 2 * Math.PI); ctx.fill();
        }
      }
    }
  }

  return { x, y, pad };
}

/** Форматирование числа с точкой → запятая (для CSV) */
function csvNum(v, digits) {
  let s = (typeof v === 'number' ? v.toFixed(digits === undefined ? 4 : digits) : String(v));
  return s.replace('.', ',');
}
