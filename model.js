/* ============================================================
   Математическая модель характеристик авиационной
   транспортной системы (АТС) на основе аппарата системной
   динамики Дж. Форрестера).
   Источник: Асеев Н.А., Кушников В.А. «Моделирование и
   прогнозирование характеристик авиационной транспортной
   системы для СППР авиационной безопасности».
   ============================================================ */

/* Параметры системы X(t), нормированные относительно
   максимального значения за все годы наблюдения */
const PARAMS = [
  { id: 'prois', label: 'Xпроис', short: 'Происшествия',
    desc: 'X₁(t) — число авиационных катастроф (авиапроисшествий) в год' },
  { id: 'star',  label: 'Xстар',  short: 'Старение ВС',
    desc: 'X₂(t) — доля воздушных судов старше 15 лет, % в год' },
  { id: 'narush', label: 'Xнаруш', short: 'Нарушения',
    desc: 'X₃(t) — количество нарушений и ошибок пилотов в год' },
  { id: 'bil',   label: 'Xбил',   short: 'Авиабилеты',
    desc: 'X₄(t) — количество проданных авиабилетов в год' },
  { id: 'chel',  label: 'Xчел',   short: 'Чел. фактор',
    desc: 'X₅(t) — влияние человеческого фактора в происшествиях, % в год' },
  { id: 'tech',  label: 'Xтех',   short: 'Техн. фактор',
    desc: 'X₆(t) — влияние технического фактора в происшествиях, % в год' },
  { id: 'nov',   label: 'Xнов',   short: 'Обновление',
    desc: 'X₇(t) — параметр обновления (внедрение новых технологий) АТС' },
  { id: 'tren',  label: 'Xтрен',  short: 'Тренировки',
    desc: 'X₈(t) — среднее время тренировок на сертифицированных тренажёрах, дн. в год' },
  { id: 'kontr', label: 'Xконтр', short: 'Контроль',
    desc: 'X₉(t) — показатель активности органов контроля за оборотом контрафакта' },
  { id: 'povt',  label: 'Xповт',  short: 'Повторяемость',
    desc: 'X₁₀(t) — повторяемость причин происшествий' },
];

/* Начальные условия (t = 0 соответствует 2011 году).
   Значения нормированы; пользователь может изменить их на
   фактические данные статистики. */
const DEFAULT_INITS = {
  prois: 0.35, star: 0.70, narush: 0.45, bil: 0.42, chel: 0.72,
  tech: 0.20, nov: 0.30, tren: 0.28, kontr: 0.40, povt: 0.50,
};

/* Регрессионные полиномы f₁…f₃₆, связывающие параметры системы.
   По умолчанию f(x) = 0 + 0.1·x + 0·x² — слабая линейная связь
   (подставьте коэффициенты, полученные регрессионным анализом). */
const DEFAULT_FK = [0, 0.1, 0];
const MAX_ABS = 1e9;   // порог численного «разгона» решения

/* Внешние факторы системы F(t) — регрессионные полиномы
   (значения нормированы).
   Каждый фактор: c = [a0, a1, a2] → F(t) = a0 + a1·t + a2·t²
   scale — масштаб приведения к нормированному диапазону
   (например, For и Law заданы в процентах единицах, поэтому /100) */
const FACTORS = [
  { id: 'Price', label: 'Price', name: 'F₁(t) — стоимость авиатоплива', c: [0.41, 0.26, 0.33], scale: 1 },
  { id: 'For',   label: 'For',   name: 'F₂(t) — доля иностранных самолётов, %', c: [87, -4, -16], scale: 100 },
  { id: 'Dol',   label: 'Dol',   name: 'F₃(t) — валютный курс доллара, руб.', c: [29, 100, -55], scale: 100 },
  { id: 'Covid', label: 'Covid', name: 'F₄(t) — влияние пандемии (COVID-19)', c: [-5, 6, 0], scale: 100 },
  { id: 'Law',   label: 'Law',   name: 'F₅(t) — количество нормативно-правовых актов по авиации', c: [21, 17, -3], scale: 100 },
];

/* Регрессионные полиномы f₁…f₃₆, связывающие параметры системы.
   По умолчанию f(x) = 0 + 1·x + 0·x² = x (линейная связь).
   Коэффициенты [a0, a1, a2] редактируются пользователем. */
const FKS = [
  { n: 1,  arg: 'star'  }, { n: 2,  arg: 'narush' }, { n: 3,  arg: 'nov'    },
  { n: 4,  arg: 'tren'  }, { n: 5,  arg: 'kontr'  }, { n: 6,  arg: 'prois'  },
  { n: 7,  arg: 'tech'  }, { n: 8,  arg: 'bil'    }, { n: 9,  arg: 'nov'    },
  { n: 10, arg: 'prois' }, { n: 11, arg: 'chel'   }, { n: 12, arg: 'povt'   },
  { n: 13, arg: 'tren'  }, { n: 14, arg: 'prois'  }, { n: 15, arg: 'narush' },
  { n: 16, arg: 'povt'  }, { n: 17, arg: 'tren'   }, { n: 18, arg: 'star'   },
  { n: 19, arg: 'povt'  }, { n: 20, arg: 'nov'    }, { n: 21, arg: 'kontr'  },
  { n: 22, arg: 'bil'   }, { n: 23, arg: 'tech'   }, { n: 24, arg: 'kontr'  },
  { n: 25, arg: 'povt'  }, { n: 26, arg: 'prois'  }, { n: 27, arg: 'narush' },
  { n: 28, arg: 'chel'  }, { n: 29, arg: 'povt'   }, { n: 30, arg: 'prois'  },
  { n: 31, arg: 'tech'  }, { n: 32, arg: 'povt'   }, { n: 33, arg: 'chel'   },
  { n: 34, arg: 'tech'  }, { n: 35, arg: 'tren'   }, { n: 36, arg: 'kontr'  },
];

/* ============================================================
   Система нелинейных дифференциальных уравнений (система 1
   из отчёта). Структура уравнения:
   dX/dt = Σ(положительные члены) − Σ(отрицательные члены),
   где каждый член = (сумма внешних факторов) × (произведение полиномов fᵢ).
   ============================================================ */
function T(facs, fks) { return { facs: facs, fks: fks }; } // конструктор "члена"

const EQS = [
  {
    lhs: 'prois',
    pos: [ T(['Price', 'For', 'Dol'], [[1, 'star'], [2, 'narush']]) ],
    neg: [ T(['Covid', 'Law'],        [[3, 'nov'], [4, 'tren'], [5, 'kontr']]) ],
  },
  {
    lhs: 'star',
    pos: [ T(['Dol'], [[6, 'prois'], [7, 'tech']]) ],
    neg: [ T([], [[8, 'bil'], [9, 'nov']]) ],
  },
  {
    lhs: 'narush',
    pos: [ T(['For'], [[10, 'prois'], [11, 'chel'], [12, 'povt']]) ],
    neg: [ T(['Law'], [[13, 'tren']]) ],
  },
  {
    lhs: 'bil',
    pos: [],
    neg: [ T(['Price', 'Dol', 'Covid'], [[14, 'prois']]) ],
  },
  {
    lhs: 'chel',
    pos: [ T(['For'], [[15, 'narush'], [16, 'povt']]) ],
    neg: [ T(['Law'], [[17, 'tren']]) ],
  },
  {
    lhs: 'tech',
    pos: [ T(['Price'], [[18, 'star'], [19, 'povt']]) ],
    neg: [ T(['Law'], [[20, 'nov'], [21, 'kontr']]) ],
  },
  {
    lhs: 'nov',
    pos: [ T(['Law'], [[22, 'bil'], [23, 'tech'], [24, 'kontr'], [25, 'povt']]) ],
    neg: [ T(['Price', 'Dol', 'Covid'], []) ],
  },
  {
    lhs: 'tren',
    pos: [ T(['Law'], []) ],
    neg: [ T(['Covid'], [[26, 'prois'], [27, 'narush'], [28, 'chel'], [29, 'povt']]) ],
  },
  {
    lhs: 'kontr',
    pos: [ T(['Law'], []) ],
    neg: [ T([], [[30, 'prois'], [31, 'tech'], [32, 'povt']]) ],
  },
  {
    lhs: 'povt',
    pos: [ T(['Price'], [[33, 'chel'], [34, 'tech']]) ],
    neg: [ T([], [[35, 'tren'], [36, 'kontr']]) ],
  },
];

/* ============================================================
   Вычислительная часть
   ============================================================ */

/** Значение полинома фактора в момент t (t отсчитывается от t₀ = 0).
 *  Используется нормированное значение: F̂(t) = (a₀+a₁t+a₂t²) / scale.
 *  Нормированное значение лежит в [0, 1.25]: при экстраполяции полинома
 *  за пределы периода наблюдения оно ограничивается. */
function factorValue(fid, t, cfg) {
  const f = FACTORS.find(x => x.id === fid);
  const c = cfg.factors[fid];
  const scale = cfg.factorScale ? cfg.factorScale[fid] : f.scale;
  let v = (c[0] + c[1] * t + c[2] * t * t) / (scale || 1);
  if (v < 0) v = 0;
  if (v > 1.25) v = 1.25;
  return v;
}

/** Значение регрессионного полинома fₙ в точке x */
function fkValue(n, x, cfg) {
  const c = cfg.fks[n - 1];
  return c[0] + c[1] * x + c[2] * x * x;
}

/** Правые части системы ОДУ. X — объект {paramId: value}, t ≥ 0.
 *  Член = (сумма внешних факторов Fⱼ(t)) × (произведение полиномов fₖ(Xᵢ)),
 *  что соответствует системе (1) и её отображению в интерфейсе. */
function rhs(t, X, cfg) {
  const out = {};
  for (const eq of EQS) {
    let v = 0;
    const groups = [[eq.pos, 1], [eq.neg, -1]];
    for (const [terms, sign] of groups) {
      for (const term of terms) {
        let facPart = 1;                       // нет факторов → нейтральная единица
        if (term.facs.length) {
          facPart = 0;
          for (const f of term.facs) facPart += factorValue(f, t, cfg);
        }
        let fkPart = 1;                        // нет полиномов → нейтральная единица
        for (const [fn, arg] of term.fks) fkPart *= fkValue(fn, X[arg], cfg);
        v += sign * facPart * fkPart;
      }
    }
    out[eq.lhs] = v;
  }
  return out;
}

function clampState(X, cfg) {
  const upper = cfg && cfg.clamp01 ? 1 : MAX_ABS;
  let blowing = false;
  for (const p of PARAMS) {
    const x = X[p.id];
    if (!isFinite(x)) { X[p.id] = 0; blowing = true; }      // NaN/∞ — признак разгона
    else if (x < 0) X[p.id] = 0;
    else if (x > upper) { X[p.id] = upper; blowing = true; }
  }
  return blowing && !(cfg && cfg.clamp01);
}

/**
 * Численное решение системы уравнений системной динамики
 * методом Рунге–Кутты 4-го порядка (RK4).
 * @param {object} cfg {t0, years, dt, inits, factors, fks}
 * @returns {object} {years[], t[], series{paramId[]}}
 */
function solveSystem(cfg) {
  const stepsPerYear = Math.max(1, Math.round(1 / cfg.dt));
  const h = 1 / stepsPerYear;
  const N = Math.round(cfg.years * stepsPerYear);

  let X = { ...cfg.inits };
  clampState(X, cfg);
  let abandoned = false;

  const snap = {};                       // snapshots по годам: {paramId: [...]}
  for (const p of PARAMS) snap[p.id] = new Array(cfg.years + 1);
  for (const p of PARAMS) snap[p.id][0] = X[p.id];

  let step = 0;
  for (let i = 1; i <= N; i++) {
    const t = (i - 1) * h;

    const k1 = rhs(t, X, cfg);
    const Xk2 = {}; for (const p of PARAMS) Xk2[p.id] = X[p.id] + h / 2 * k1[p.id];
    if (clampState(Xk2, cfg)) { abandoned = true; break; }
    const k2 = rhs(t + h / 2, Xk2, cfg);
    const Xk3 = {}; for (const p of PARAMS) Xk3[p.id] = X[p.id] + h / 2 * k2[p.id];
    if (clampState(Xk3, cfg)) { abandoned = true; break; }
    const k3 = rhs(t + h / 2, Xk3, cfg);
    const Xk4 = {}; for (const p of PARAMS) Xk4[p.id] = X[p.id] + h * k3[p.id];
    if (clampState(Xk4, cfg)) { abandoned = true; break; }
    const k4 = rhs(t + h, Xk4, cfg);

    const Xn = {};
    for (const p of PARAMS) Xn[p.id] = X[p.id] + h / 6 * (k1[p.id] + 2 * k2[p.id] + 2 * k3[p.id] + k4[p.id]);
    if (clampState(Xn, cfg)) { abandoned = true; X = Xn; break; }
    X = Xn;

    if (i % stepsPerYear === 0) {
      const yr = Math.round(i / stepsPerYear);
      if (yr <= cfg.years) for (const p of PARAMS) snap[p.id][yr] = X[p.id];
    }
    step++;
  }

  // если решение «разгоняется» — завершаем на текущем шаге
  let yearsDone = cfg.years;
  if (abandoned) {
    yearsDone = Math.min(cfg.years, Math.floor((step + 1) / stepsPerYear));
    for (const p of PARAMS) for (let y = yearsDone; y <= cfg.years; y++) snap[p.id][y] = X[p.id];
  }

  const series = {};
  for (const p of PARAMS) series[p.id] = snap[p.id];
  return {
    years: Array.from({ length: yearsDone + 1 }, (_, i) => i),
    abandoned: abandoned,
    series: series,
  };
}

/* ============================================================
   Оценка точности модели: MAE, СКО (RMSE), MAPE
   ============================================================ */
function calcErrors(model, observed) {
  let sumAbs = 0, sumSq = 0, sumPct = 0, cnt = 0, cntPct = 0;
  for (let i = 0; i < observed.length; i++) {
    const o = observed[i];
    if (o === null || o === undefined || o === '' || isNaN(o)) continue;
    const m = model[i];
    if (m === undefined) continue;
    const d = m - o;
    sumAbs += Math.abs(d);
    sumSq += d * d;
    if (Math.abs(o) > 1e-9) { sumPct += Math.abs(d / o) * 100; cntPct++; }  // исключаем деление на ~0
    cnt++;
  }
  if (!cnt) return null;
  return {
    n: cnt,
    mae: sumAbs / cnt,
    rmse: Math.sqrt(sumSq / cnt),
    mape: cntPct ? sumPct / cntPct : NaN,
  };
}

/* Настройки калькулятора по умолчанию */
function defaultConfig() {
  const inits = { ...DEFAULT_INITS };
  const factors = {};
  const factorScale = {};
  for (const f of FACTORS) { factors[f.id] = [...f.c]; factorScale[f.id] = f.scale; }
  const fks = [];
  for (let i = 0; i < FKS.length; i++) fks.push([...DEFAULT_FK]); // f(x) = 0.1·x
  return { t0: 2011, years: 12, dt: 0.02, clamp01: true, inits, factors, factorScale, fks, observed: {}, shown: {} };
}
