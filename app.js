/* ============================================================
   Приложение «Системно-динамический калькулятор АТС».
   Одноэкранный интерфейс: меню-бар с выпадающими списками,
   аккордеоны ввода слева, область просмотра справа,
   модальные окна формул.
   ============================================================ */

const STORE_KEY = 'ats-sd-calc-v2';

let cfg = null;           // конфигурация
let result = null;        // последний расчёт
let visibility = {};      // видимость серий на графике
let currentView = 'chart';
let obsParam = 'prois';   // параметр в блоке «Фактические данные»

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pickNum(v, fallback) {
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : fallback;
}

function numInput() { /* заменён ползунками — удалён */ }

/* ============================================================
   Рендеринг формул (HTML)
   ============================================================ */

function termHTML(term) {
  const parts = [];
  if (term.facs.length) {
    const fs = term.facs.map(f => `<span class="mvar">${f}</span>(<span class="mvar">t</span>)`);
    parts.push(term.facs.length > 1 ? '(' + fs.join(' + ') + ')' : fs[0]);
  }
  for (const [fn, arg] of term.fks) {
    const p = PARAMS.find(x => x.id === arg);
    parts.push(`<span class="mvar">f</span><sub>${fn}</sub>(<span class="mvar">${p.label}</span>(<span class="mvar">t</span>))`);
  }
  return parts.join('&thinsp;·&thinsp;');
}

function eqHTML(eq) {
  const p = PARAMS.find(x => x.id === eq.lhs);
  let rhs = [];
  eq.pos.forEach((t, i) => rhs.push((i ? ' + ' : '') + termHTML(t)));
  eq.neg.forEach(t => rhs.push(' − ' + termHTML(t)));
  return `<span class="frac"><span class="top"><span class="mvar">d</span><span class="mvar">${p.label}</span>(<span class="mvar">t</span>)</span><span class="bot"><span class="mvar">dt</span></span></span> = ${rhs.join('')}`;
}

function polyStr(c) {
  const parts = [];
  const fmt = v => (v < 0 ? '− ' + Math.abs(v) : v);
  if (c[0] !== 0 || (c[1] === 0 && c[2] === 0)) parts.push(fmt(c[0]));
  if (c[1] !== 0) parts.push(c[1] < 0 ? '− ' + Math.abs(c[1]) + 't' : (parts.length ? '+ ' : '') + c[1] + 't');
  if (c[2] !== 0) parts.push(c[2] < 0 ? '− ' + Math.abs(c[2]) + 't²' : (parts.length ? '+ ' : '') + c[2] + 't²');
  return parts.length ? parts.join(' ') : '0';
}

function describeTerm(term, verb) {
  const facs = term.facs.length ? 'факторы: ' + term.facs.join(', ') : '';
  const fks = term.fks.map(([n, arg]) => {
    const p = PARAMS.find(x => x.id === arg);
    return 'f<sub>' + n + '</sub>(' + p.label + ')';
  }).join(' × ');
  const bits = [facs, fks].filter(Boolean);
  return !bits.length ? '' : `${verb.charAt(0).toUpperCase() + verb.slice(1)}: ${bits.join(' × ')}`;
}

/* ============================================================
   Хранилище настроек
   ============================================================ */

function defaultConfig() {
  const inits = { ...DEFAULT_INITS };
  const factors = {}, factorScale = {};
  for (const f of FACTORS) { factors[f.id] = [...f.c]; factorScale[f.id] = f.scale; }
  const fks = [];
  for (let i = 0; i < FKS.length; i++) fks.push([...DEFAULT_FK]);
  return { t0: 2011, years: 12, dt: 0.02, clamp01: true, inits, factors, factorScale, fks, observed: {}, shown: {} };
}

function normalizeConfig(c) {
  const d = defaultConfig();
  c.t0 = Math.round(pickNum(c.t0, d.t0));
  c.years = Math.min(60, Math.max(1, Math.round(pickNum(c.years, d.years))));
  c.dt = Math.min(0.5, Math.max(0.01, pickNum(c.dt, d.dt)));
  for (const p of PARAMS) c.inits[p.id] = pickNum(c.inits[p.id], d.inits[p.id]);
  for (const f of FACTORS) {
    if (!Array.isArray(c.factors[f.id]) || c.factors[f.id].length !== 3) c.factors[f.id] = [...f.c];
    else c.factors[f.id] = c.factors[f.id].map(v => pickNum(v, 0));
    if (!(f.id in c.factorScale) || !(+c.factorScale[f.id] > 0)) c.factorScale[f.id] = f.scale;
    else c.factorScale[f.id] = +c.factorScale[f.id];
  }
  if (!Array.isArray(c.fks) || c.fks.length !== FKS.length) c.fks = d.fks;
  c.fks = c.fks.map(a => (Array.isArray(a) && a.length === 3) ? a.map(v => pickNum(v, 0)) : [...DEFAULT_FK]);
  if (typeof c.observed !== 'object' || !c.observed) c.observed = {};
  if (typeof c.shown !== 'object' || !c.shown) c.shown = {};
  c.clamp01 = c.clamp01 !== false;
  return c;
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.inits && parsed.factors) return normalizeConfig(parsed);
    }
  } catch (e) { /* игнорируем повреждённые настройки */ }
  return defaultConfig();
}

function saveConfig() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* приватный режим */ }
}

/* ============================================================
   Боковая панель ввода (аккордеоны)
   ============================================================ */

function sec(topId, title, bodyNode, open) {
  const d = el('details', 'sec');
  d.dataset.top = topId;
  if (open) d.open = true;
  const body = el('div', 'body');
  body.append(bodyNode);
  d.append(el('summary', null, title), body);
  return d;
}

function renderSidebar() {
  const sb = $('#sidebar');
  sb.replaceChildren();

  /* — настройки расчёта — */
  const mainBody = el('div');
  mainBody.classList.add('row2');
  const f1 = el('label', 'field');
  f1.innerHTML = `<span>Год t₀</span>`;
  f1.append(sliderCell(cfg.t0, 1970, 2030, 1, { year: 'main' }, false));
  const f2 = el('label', 'field');
  f2.innerHTML = `<span>Горизонт, лет</span>`;
  f2.append(sliderCell(cfg.years, 1, 60, 1, { horizon: 'main' }, false));
  const f3 = el('label', 'field');
  f3.innerHTML = `<span>Шаг РК4 (dt), лет</span>`;
  f3.append(sliderCell(cfg.dt, 0.01, 0.5, 0.01, { stepdt: 'main' }, true));
  mainBody.append(f1, f2, f3);
  const clamp = el('label', 'checkbox');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = cfg.clamp01 !== false; cb.id = 'cfg-clamp';
  clamp.append(cb, document.createTextNode(' Ограничивать параметры 0…1'));
  mainBody.append(clamp, el('p', 'hint',
    'Интегрирование системы (1) — метод Рунге–Кутты 4-го порядка. ' +
    'Значения нормированы относительно максимума за период наблюдения.'));
  sb.append(sec('main', 'Настройки расчёта', mainBody, true));

  /* — начальные условия — */
  const initBody = el('div', 'initGrid');
  for (const p of PARAMS) {
    const row = el('div', 'initRow');
    row.append(el('span', 'lbl', `<span class="mvar">${p.label}</span> <small>${esc(p.short)}</small>`));
    row.append(sliderCell(pickNum(cfg.inits[p.id], 0), 0, 1, 0.01, { init: p.id }, true));
    row.title = p.desc;
    initBody.append(row);
  }
  const initSec = sec('inits', 'Начальные условия X(t₀)', initBody, true);
  initSec.querySelector('summary').innerHTML =
    'Начальные условия X(<span class="cap-year">' + cfg.t0 + '</span>)';
  sb.append(initSec);

  /* — внешние факторы — */
  const facBody = el('div');
  for (const f of FACTORS) {
    const row = el('div', 'factorRow');
    row.innerHTML = `<div class="fName"><b>${f.label}</b><small>${esc(f.name.replace(/^F\d\(.t\)\s—\s*/, ''))}</small></div>`;
    const coeffs = el('div', 'coeffs');
    ['a₀', 'a₁', 'a₂'].forEach((lbl, i) => {
      const w = el('label', 'coeff');
      w.innerHTML = `<span>${lbl}</span>`;
      const c = pickNum(cfg.factors[f.id][i], 0);
      const B = Math.max(1, sampleBounds(c));
      w.append(sliderCell(c, -B, B, (2 * B) / 200, { factor: f.id, ci: i }, true));
      coeffs.append(w);
    });
    const sw = el('label', 'coeff fscale');
    sw.innerHTML = '<span>÷ масштаб</span>';
    const s = pickNum(cfg.factorScale[f.id], f.scale);
    sw.append(sliderCell(s, 0, Math.max(100, sampleBounds(s)), 1, { fscale: f.id }, true));
    coeffs.append(sw);
    row.append(coeffs);
    facBody.append(row);
  }
  facBody.append(el('p', 'hint',
    'F(t) = (a₀ + a₁t + a₂t²) ÷ масштаб; значение приводится к диапазону 0…1.25.'));
  sb.append(sec('facs', 'Внешние факторы F(t)', facBody));

  /* — полиномы fₖ — */
  const fkBody = el('div', 'fkList');
  for (const fk of FKS) {
    const p = PARAMS.find(x => x.id === fk.arg);
    const row = el('div', 'fkRow');
    row.innerHTML = `<span class="fkName"><span class="mvar">f</span><sub>${fk.n}</sub>(<span class="mvar">${p.label}</span>)</span>`;
    const coeffs = el('div', 'coeffs');
    ['a₀', 'a₁', 'a₂'].forEach((lbl, i) => {
      const w = el('label', 'coeff');
      w.innerHTML = `<span>${lbl}</span>`;
      const c = pickNum(cfg.fks[fk.n - 1][i], 0);
      const B = Math.max(1, sampleBounds(c));
      w.append(sliderCell(c, -B, B, (2 * B) / 200, { fk: fk.n, ci: i }, true));
      coeffs.append(w);
    });
    row.append(coeffs);
    row.title = 'f' + fk.n + '(' + p.label + '(t)): f(x) = a₀ + a₁x + a₂x²';
    fkBody.append(row);
  }
  fkBody.append(el('p', 'hint',
    'По умолчанию f(x) = 0.1x (слабая линейная связь). Подставьте коэффициенты регрессии по вашим данным.'));
  sb.append(sec('fks', 'Полиномы f₁…f₃₆', fkBody));

  /* — фактические данные и погрешности — */
  const obsBody = el('div');
  const selWrap = el('label', 'field');
  selWrap.innerHTML = '<span>Параметр</span>';
  const sel = document.createElement('select');
  sel.id = 'obsSelect';
  for (const p of PARAMS) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.label + ' — ' + p.short;
    sel.append(o);
  }
  sel.value = obsParam;
  selWrap.append(sel);
  obsBody.append(selWrap);
  const ta = document.createElement('textarea');
  ta.id = 'obsText'; ta.rows = 2;
  ta.placeholder = 'факт. значения по годам: ' + cfg.t0 + ', ' + (cfg.t0 + 1) + ', …';
  obsBody.append(ta);

  /* — быстрые тестовые данные — */
  const testRow = el('div', 'btnrow');
  const bTest = el('button', 'btn small', 'Тест: параметр');
  bTest.type = 'button'; bTest.title = 'Сгенерировать тестовые данные для выбранного параметра';
  const bAll = el('button', 'btn small', 'Тест: все 10');
  bAll.type = 'button'; bAll.title = 'Сгенерировать тестовые данные для всех параметров сразу';
  const bClr = el('button', 'btn small ghost', 'Очистить');
  bClr.type = 'button'; bClr.title = 'Удалить фактические данные выбранного параметра';
  bTest.addEventListener('click', () => {
    const s = genTestSeries(obsParam);
    if (s === null) return;
    cfg.observed[obsParam] = s;
    afterObsChange();
  });
  bAll.addEventListener('click', () => {
    for (const p of PARAMS) cfg.observed[p.id] = genTestSeries(p.id);
    afterObsChange();
  });
  bClr.addEventListener('click', () => {
    delete cfg.observed[obsParam];
    afterObsChange();
  });
  testRow.append(bTest, bAll, bClr);
  obsBody.append(testRow);
  const metrics = el('div', 'errInline');
  metrics.id = 'obsMetrics';
  obsBody.append(metrics);
  obsBody.append(el('p', 'hint',
    'Введите значения через запятую; калькулятор покажет MAE, СКО (RMSE) и MAPE для модельного прогноза.'));
  const obsSec = sec('obs', 'Фактические данные · погрешности', obsBody);
  obsSec.querySelector('summary').innerHTML =
    'Фактические данные · <span class="cap-year">' + cfg.t0 + '</span>…';
  sb.append(obsSec);

  /* привязка редактора наблюдаемых данных */
  sel.addEventListener('change', () => {
    obsParam = sel.value;
    updateObsUI();
    refreshChartOnly();
    if (currentView === 'errors') renderErrorsView();
  });
  ta.addEventListener('input', () => {
    cfg.observed[obsParam] = ta.value;
    saveConfig();
    updateObsUI();
    refreshChartOnly();
    if (currentView === 'errors') renderErrorsView();
  });
  updateObsUI();
}

/* ============================================================
   Быстрые тестовые данные: модельный ряд + случайный шум ±5%
   ============================================================ */

function genTestSeries(pid) {
  if (!result) return null;
  const n = cfg.years + 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = result.series[pid][i];
    const v = base * (1 + (Math.random() - 0.5) * 2 * 0.05);
    out.push(Math.max(0, +v.toFixed(3)));
  }
  return out.join(', ');
}

function afterObsChange() {
  saveConfig();
  updateObsUI();
  refreshChartOnly();
  if (currentView === 'errors') renderErrorsView();
}

function updateObsUI() {
  const ta = $('#obsText');
  if (!ta) return;
  ta.value = cfg.observed[obsParam] || '';
  const p = PARAMS.find(x => x.id === obsParam);
  const o = parseObserved(obsParam, cfg.years + 1);
  const e = (o && result) ? calcErrors(result.series[obsParam], o) : null;
  const box = $('#obsMetrics');
  if (e) {
    box.innerHTML =
      `<div class="kpi"><b>${e.mae.toFixed(4)}</b><span>MAE</span></div>` +
      `<div class="kpi"><b>${e.rmse.toFixed(4)}</b><span>СКО</span></div>` +
      `<div class="kpi"><b>${isFinite(e.mape) ? e.mape.toFixed(1) + '%' : '—'}</b><span>MAPE</span></div>`;
  } else {
    box.innerHTML = `<div class="kpi"><b>—</b><span>MAE</span></div>` +
      `<div class="kpi"><b>—</b><span>СКО</span></div>` +
      `<div class="kpi"><b>—</b><span>MAPE ${p.label}</span></div>`;
  }
}

/* ============================================================
   Ввод (делегирование событий на панели)
   ============================================================ */

function bindSidebar() {
  const sb = $('#sidebar');
  sb.addEventListener('input', e => {
    if (!sideChanged(e.target)) return;
    saveConfig();
    runModel();
    refreshView();
  });
  sb.addEventListener('change', e => {
    if (e.target.id === 'cfg-clamp') { cfg.clamp01 = e.target.checked; saveConfig(); runModel(); refreshView(); }
  });
}

/* ============================================================
   Ползунки: sliderCell + синхронизация с точным значением
   ============================================================ */

/* «красивая» граница диапазона ползунка под модуль значения */
function sampleBounds(v) {
  const a = Math.abs(v) || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(a)));
  const n = a / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * mag;
}

/* ползунок + маленькое числовое поле, связанные между собой */
function sliderCell(value, min, max, step, ds, autoStep) {
  const w = el('span', 'srow');
  const r = document.createElement('input');
  r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value;
  for (const k in ds) r.dataset[k] = ds[k];
  if (autoStep) r.dataset.auto = '1';
  const n = document.createElement('input');
  n.type = 'number'; n.value = value; n.step = step;
  for (const k in ds) n.dataset[k] = ds[k];
  w.append(r, n);
  return w;
}

/* синхронизация пары «ползунок ↔ число»; число может раздвинуть границы */
function syncSlider(t, v) {
  const pair = t.parentElement.querySelector(t.type === 'range' ? 'input[type=number]' : 'input[type=range]');
  if (!pair) return;
  if (t.type === 'range') { pair.value = v; return; }
  const lo = +pair.min, hi = +pair.max;
  if (isFinite(v) && (v < lo || v > hi)) {
    if (lo < 0) {
      const B = Math.max(sampleBounds(v), Math.abs(lo), Math.abs(hi));
      pair.min = -B; pair.max = B;
    } else {
      pair.min = Math.min(lo, v); pair.max = Math.max(hi, v);
    }
    if (pair.dataset.auto === '1') pair.step = (+pair.max - +pair.min) / 200;
  }
  pair.value = v;
}

/* применение значения любого поля панели к конфигурации */
function sideChanged(t) {
  const fromRange = t.type === 'range';
  const v = fromRange ? parseFloat(t.value) : pickNum(t.value, 0);
  if (!isFinite(v)) return false;
  syncSlider(t, v);
  if (t.dataset.year !== undefined) { cfg.t0 = Math.round(v); updateYearCaptions(); }
  else if (t.dataset.horizon !== undefined) { cfg.years = Math.min(60, Math.max(1, Math.round(v))); rebuildLegend(); }
  else if (t.dataset.stepdt !== undefined) cfg.dt = Math.min(0.5, Math.max(0.01, v));
  else if (t.dataset.init !== undefined) cfg.inits[t.dataset.init] = v;
  else if (t.dataset.fk !== undefined) cfg.fks[+t.dataset.fk - 1][+t.dataset.ci] = v;
  else if (t.dataset.fscale !== undefined) cfg.factorScale[t.dataset.fscale] = v > 0 ? v : 0.0001;
  else if (t.dataset.factor !== undefined) cfg.factors[t.dataset.factor][+t.dataset.ci] = v;
  else return false;
  return true;
}

function updateYearCaptions() {
  $$('.cap-year').forEach(n => n.textContent = cfg.t0);
  const ta = $('#obsText');
  if (ta) ta.placeholder = 'факт. значения по годам: ' + cfg.t0 + ', ' + (cfg.t0 + 1) + ', …';
}

/* ============================================================
   Наблюдаемые данные
   ============================================================ */

function bindObsEditor() {
  /* привязка редактора выполняетcя в renderSidebar() при каждой перерисовке панели */
}

function parseObserved(pid, want) {
  const raw = cfg.observed[pid];
  if (!raw || !raw.trim()) return null;
  const arr = raw.split(/[;,\s]+/).filter(s => s !== '').map(v => pickNum(v, NaN));
  const out = Array.from({ length: want }, (_, i) => (i < arr.length ? arr[i] : NaN));
  return out.some(v => isFinite(v)) ? out : null;
}

/* ============================================================
   Область просмотра: график / таблица / погрешности
   ============================================================ */

function setView(name) {
  currentView = name;
  for (const [id, key] of [['v-chart', 'chart'], ['v-table', 'table'], ['v-errors', 'errors']]) {
    const node = document.getElementById(id);
    node.classList.toggle('visible', key === name);
  }
  requestAnimationFrame(() => {
    if (name === 'chart') renderChart();
    if (name === 'table') renderTable();
    if (name === 'errors') renderErrorsView();
  });
}

function buildLegend() {
  const controls = $('#chartControls');
  controls.replaceChildren();
  for (const [i, p] of PARAMS.entries()) {
    const lab = el('label', 'legend-item');
    lab.style.setProperty('--c', PALETTE[i % PALETTE.length]);
    const cbi = document.createElement('input');
    cbi.type = 'checkbox';
    cbi.checked = cfg.shown[p.id] !== false;
    cbi.addEventListener('change', () => {
      visibility[p.id] = cbi.checked;
      cfg.shown[p.id] = cbi.checked;
      saveConfig();
      renderChart();
    });
    lab.append(cbi, document.createTextNode(p.label + ' · ' + p.short));
    lab.title = p.desc;
    controls.append(lab);
  }
}

function rebuildLegend() {
  for (const p of PARAMS) visibility[p.id] = cfg.shown[p.id] !== false;
  buildLegend();
  renderChart();
}

function makeSeries() {
  const series = [];
  for (const [i, p] of PARAMS.entries()) {
    series.push({
      values: result.series[p.id],
      color: PALETTE[i % PALETTE.length],
      visible: visibility[p.id] !== false,
    });
  }
  for (const [i, p] of PARAMS.entries()) {
    const obs = parseObserved(p.id, result.years.length);
    if (!obs) continue;
    series.push({
      values: obs.map(v => isFinite(v) ? v : undefined),
      color: PALETTE[i % PALETTE.length],
      visible: visibility[p.id] !== false,
      dashed: true,
    });
  }
  return series;
}

function renderChart() {
  if (!result) return;
  const canvas = $('#chart');
  const years = result.years.map(y => cfg.t0 + y);
  drawChart(canvas, makeSeries(), years, 'Динамика характеристик АТС ' + cfg.t0 + '–' + (cfg.t0 + cfg.years));
}

function refreshChartOnly() {
  if (currentView === 'chart') renderChart();
}

function renderTable() {
  const tbl = $('#dataTable');
  if (!result) return;
  tbl.replaceChildren();
  const head = el('tr');
  head.append(el('th', null, 'Год'));
  for (const p of PARAMS) head.append(el('th', null, p.label));
  tbl.append(head);
  for (let y = 0; y <= result.years.length - 1 && y <= cfg.years; y++) {
    const tr = el('tr');
    tr.append(el('td', 'yearcell', String(cfg.t0 + y)));
    for (const p of PARAMS) tr.append(el('td', null, result.series[p.id][y].toFixed(3)));
    tbl.append(tr);
  }
}

function renderErrorsView() {
  const box = $('#errorsView');
  box.replaceChildren();
  const tbl = el('table', 'errTable');
  const head = el('tr');
  head.append(el('th', null, 'Параметр'), el('th', null, 'Точки'),
    el('th', null, 'MAE'), el('th', null, 'СКО (RMSE)'), el('th', null, 'MAPE, %'));
  tbl.append(head);
  let any = false;
  for (const p of PARAMS) {
    const obs = parseObserved(p.id, cfg.years + 1);
    if (!obs) continue;
    const err = calcErrors(result.series[p.id], obs);
    if (!err) continue;
    any = true;
    const tr = el('tr');
    tr.append(el('td', null, '<span class="mvar">' + p.label + '</span> — ' + esc(p.short)),
      el('td', null, String(err.n)),
      el('td', null, err.mae.toFixed(4)),
      el('td', null, err.rmse.toFixed(4)),
      el('td', null, isFinite(err.mape) ? err.mape.toFixed(2) : '—'));
    tbl.append(tr);
  }
  if (!any) {
    box.append(el('p', 'hint',
      'Введите фактические данные по годам в панели «Фактические данные» (выпадающее меню «Ввод данных»), ' +
      'и здесь появятся MAE, СКО (RMSE) и MAPE для каждого параметра.'));
  } else {
    const wrap = el('div');
    wrap.append(el('p', 'hint', ''), tbl);
    wrap.firstChild.remove();
    box.append(tbl);
  }
}

function refreshView() {
  if (!result) return;
  if (currentView === 'chart') renderChart();
  else if (currentView === 'table') renderTable();
  else renderErrorsView();
  updateObsUI();
  updateYearCaptions();
}

/* ============================================================
   Модальные окна: о модели, формулы, метод
   ============================================================ */

function openModal(title, node) {
  $('#modalTitle').textContent = title;
  const body = $('#modalBody');
  body.replaceChildren(node);
  $('#modal').classList.remove('hidden');
}

function closeModal() { $('#modal').classList.add('hidden'); }

function aboutContent() {
  const box = el('div');
  const h = el('h3', null, 'Метод системной динамики');
  box.append(h, el('ul', null,
    '<li>Выбираются моделируемые параметры X(t) и внешние факторы F(t) авиационной транспортной системы.</li>' +
    '<li>Эксперты формируют матрицу причинно-следственных связей («+» — ускоряет рост, «−» — замедляет).</li>' +
    '<li>По матрице составляется система нелинейных дифференциальных уравнений системной динамики.</li>' +
    '<li>Связи параметров выражаются полиномами регрессии f₁…f₃₆, построенными по нормированным статистическим данным.</li>' +
    '<li>Решение системы численное — методом Рунге–Кутты 4-го порядка от t₀ (2011 г.) до горизонта прогноза.</li>'));
  box.append(el('h3', null, 'Параметры системы'));
  const ul1 = el('ul');
  for (const p of PARAMS) ul1.append(el('li', null, `<span class="mvar"><b>${p.label}</b></span> — ${esc(p.desc)}`));
  box.append(ul1);
  box.append(el('h3', null, 'Внешние факторы'));
  const ul2 = el('ul');
  for (const f of FACTORS) ul2.append(el('li', null, `<b>${f.label}</b> — ${esc(f.name)}`));
  box.append(ul2);
  box.append(el('p', null,
    'Результаты моделирования и прогнозирования характеристик АТС используются системами поддержки ' +
    'принятия решений (СППР) авиационной безопасности: HR-специалистами, специалистами по закупкам, ' +
    'сотрудниками систем управления безопасностью полётов.'));
  return box;
}

function eqsContent() {
  const box = el('div');
  box.append(el('h3', null, 'Система дифференциальных уравнений модели (система 1)'));
  for (const eq of EQS) {
    const p = PARAMS.find(x => x.id === eq.lhs);
    const card = el('div', 'eq');
    card.append(el('div', 'eqTitle', p.label + ' · ' + p.short));
    card.append(el('div', null, eqHTML(eq)));
    const ul = el('ul', 'explain');
    for (const t of eq.pos) { const s = describeTerm(t, 'повышает'); if (s) ul.append(el('li', null, s)); }
    for (const t of eq.neg) { const s = describeTerm(t, 'снижает'); if (s) ul.append(el('li', null, s)); }
    card.append(ul);
    box.append(card);
  }
  box.append(el('p', null,
    'Полиномы fₖ (см. выпадающее меню «Формулы» → «Полиномы f₁…f₃₆») строятся регрессионным анализом ' +
    'данных статистики по годам; значения нормированы относительно максимума за период наблюдения.'));
  return box;
}

function factorsModalContent() {
  const box = el('div');
  box.append(el('h3', null, 'Внешние факторы: полиномы регрессии'));
  const ul = el('ul', 'factorList');
  for (const f of FACTORS) {
    const c = cfg.factors[f.id];
    ul.append(el('li', null,
      `<b>${f.label}</b>(t) = ${polyStr(c)} ÷ ${cfg.factorScale[f.id]} — ${esc(f.name)}`));
  }
  box.append(ul);
  box.append(el('p', null, 'Значения нормируются делением на масштаб и приводятся к диапазону 0…1.25 ' +
    '(при экстраполяции полинома за пределы периода наблюдения).'));
  return box;
}

function fksModalContent() {
  const box = el('div');
  box.append(el('h3', null, 'Внутренние функции модели f₁…f₃₆'));
  const grid = el('div', 'fkModal');
  for (const fk of FKS) {
    const p = PARAMS.find(x => x.id === fk.arg);
    grid.append(el('code', null, `f<sub>${fk.n}</sub>(x) = ${polyStr(cfg.fks[fk.n - 1])}; аргумент — ${p.label}`));
  }
  box.append(grid);
  box.append(el('p', null, 'Коэффициенты редактируются в панели «Полиномы f₁…f₃₆» (меню «Ввод данных»). ' +
    'По умолчанию f(x) = ' + DEFAULT_FK[0] + ' + ' + DEFAULT_FK[1] + 'x.'));
  return box;
}

function methodContent() {
  const box = el('div');
  box.append(el('h3', null, 'Численное решение'));
  box.append(el('p', null,
    'Система нелинейных дифференциальных уравнений (1) решается методом Рунге–Кутты 4-го порядка:'));
  box.append(el('p', null, '<code>x(t+h) = x(t) + h·(k₁ + 2k₂ + 2k₃ + k₄)/6</code>'));
  box.append(el('ul', null,
    '<li>k₁ = f(t, x) — правая часть системы в текущей точке;</li>' +
    '<li>k₂ = f(t + h/2, x + h·k₁/2); k₃ = f(t + h/2, x + h·k₂/2); k₄ = f(t + h, x + h·k₃).</li>'));
  box.append(el('p', null, 'Время t отсчитывается от t₀ (2011 год); на каждый модельный год приходится ' +
    round(1 / cfg.dt) + ' шагов интегрирования. Начальные условия задаются значениями статистики за год t₀.'));
  box.append(el('p', null, '<code>Оценка точности:</code> MAE — средняя абсолютная ошибка; ' +
    'СКО (RMSE) — среднеквадратичное отклонение; MAPE — средняя абсолютная процентная ошибка.'));
  return box;
}

function round(v) { return Math.round(v); }

/* ============================================================
   Экспорт CSV
   ============================================================ */

function exportCSV() {
  const obsIds = PARAMS.filter(p => parseObserved(p.id, 1));
  const rows = [['Год', ...PARAMS.map(p => p.label), ...obsIds.map(p => p.label + ' (факт)')]];
  for (let y = 0; y <= cfg.years; y++) {
    const row = [String(cfg.t0 + y)];
    for (const p of PARAMS) row.push(csvNum(result.series[p.id][y], 4));
    for (const oid of obsIds) row.push(csvNum(parseObserved(oid, cfg.years + 1)[y], 4));
    rows.push(row);
  }
  const csv = rows.map(r => r.join(';')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'АТС_модель.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   Меню и базовая инициализация
   ============================================================ */

function openSection(id) {
  const d = document.querySelector(`details.sec[data-top="${id}"]`);
  if (d) {
    d.open = true;
    d.querySelector('summary').scrollIntoView({ block: 'nearest' });
  }
}

function bindMenus() {
  for (const menu of $$('.menu')) {
    const btn = menu.querySelector(':scope > button');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains('open');
      $$('.menu.open').forEach(m => m.classList.remove('open'));
      if (!wasOpen) menu.classList.add('open');
    });
  }
  document.addEventListener('click', () => $$('.menu.open').forEach(m => m.classList.remove('open')));

  const actions = {
    'go-main': () => openSection('main'),
    'go-inits': () => openSection('inits'),
    'go-facs': () => openSection('facs'),
    'go-fks': () => openSection('fks'),
    'go-obs': () => openSection('obs'),
    'test-all': () => {
      openSection('obs');
      obsParam = PARAMS[0].id;
      for (const p of PARAMS) cfg.observed[p.id] = genTestSeries(p.id);
      afterObsChange();
      renderSidebar();
    },
    'about': () => openModal('О модели', aboutContent()),
    'eqs': () => openModal('Система уравнений', eqsContent()),
    'fmodal-factors': () => openModal('Факторы — полиномы F(t)', factorsModalContent()),
    'fmodal-fks': () => openModal('Полиномы f₁…f₃₆', fksModalContent()),
    'method': () => openModal('Численный метод', methodContent()),
    'view-chart': () => setView('chart'),
    'view-table': () => setView('table'),
    'view-errors': () => setView('errors'),
    'csv': () => exportCSV(),
    'theme': () => toggleTheme(),
    'reset': () => resetAll(),
  };
  for (const item of $$('.dropdown button')) {
    item.addEventListener('click', e => {
      e.stopPropagation();
      $$('.menu.open').forEach(m => m.classList.remove('open'));
      actions[item.dataset.action] && actions[item.dataset.action]();
    });
  }
}

function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem(STORE_KEY + '-dark', document.body.classList.contains('dark') ? '1' : '0');
  renderChart();
}

function resetAll() {
  if (!confirm('Вернуть настройки калькулятора к значениям по умолчанию?')) return;
  localStorage.removeItem(STORE_KEY);
  cfg = defaultConfig();
  visibility = {};
  saveConfig();
  rebuildAll();   
}

function rebuildAll() {
  visibility = {};
  for (const p of PARAMS) if (!(p.id in visibility)) visibility[p.id] = cfg.shown[p.id] !== false;
  renderSidebar();
  buildLegend();
  runModel();
  setView(currentView);
  updateYearCaptions();
}

function runModel() {
  normalizeConfig(cfg);
  result = solveSystem(cfg);
}

document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem(STORE_KEY + '-dark') === '1') document.body.classList.add('dark');
  cfg = loadConfig();

  bindMenus();
  bindSidebar();
  renderSidebar();
  buildLegend();
  runModel();
  setView('chart');
  updateYearCaptions();

  $('#runBtn').addEventListener('click', () => { runModel(); refreshView(); });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  window.addEventListener('resize', () => result && currentView === 'chart' && renderChart());
});
