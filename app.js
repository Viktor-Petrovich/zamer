(function () {
  "use strict";
  const $app = document.getElementById("app");
  try { const th = localStorage.getItem("zamer_theme"); if (th) document.documentElement.dataset.theme = th; } catch (e) {}
  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- состояние ---------- */
  const fresh = () => ({ kind: "frame", paid: "", ent: {}, common: {}, ops: {}, thresholds: [], nashchelnik: [], cable: {} });
  let order = fresh(), pos = 0, view = "home", sub = null, pdfCache = null, flash = "";
  const save = () => { try { localStorage.setItem("zamer", JSON.stringify({ order, pos, view })); } catch (e) {} };
  try {
    const s = JSON.parse(localStorage.getItem("zamer") || "null");
    if (s && s.order) { order = Object.assign(fresh(), s.order); pos = s.pos || 0; view = s.view === "wizard" || s.view === "hub" ? "home" : "home"; }
  } catch (e) {}
  /* ---------- аккаунт и замеры ---------- */
  const CFG = window.ZAMER || {}, LIM = !!(CFG.api && CFG.bot);
  let acc = { session: "", id: "", name: "", credits: null, tickets: [], redeem: [] };
  try { acc = Object.assign(acc, JSON.parse(localStorage.getItem("zamer_acc") || "{}")); } catch (e) {}
  const saveAcc = () => { try { localStorage.setItem("zamer_acc", JSON.stringify(acc)); } catch (e) {} };
  function api(path, body) {
    const h = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" };
    if (acc.session) h.Authorization = "Bearer " + acc.session;
    return fetch(CFG.api.replace(/\/$/, "") + path, { method: body ? "POST" : "GET", headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(async r => {
        if (r.status === 401 || r.status === 403) { acc.session = ""; saveAcc(); if (r.status === 403) loginErr = "Доступ закрыт администратором."; throw new Error("auth"); }
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j;
      });
  }
  async function syncAcc() {
    if (!LIM || !acc.session) return;
    try {
      while (acc.redeem.length) { await api("/api/redeem", { ticket: acc.redeem[0] }); acc.redeem.shift(); saveAcc(); }
      const me = await api("/api/me"); acc.credits = me.credits; acc.id = me.id; acc.name = me.name;
      if (acc.tickets.length < 3 && me.credits > 0) {
        const r = await api("/api/reserve", { n: Math.min(3 - acc.tickets.length, me.credits) });
        acc.tickets = acc.tickets.concat(r.tickets); acc.credits = r.credits;
      }
      saveAcc(); if (view === "home" || view === "menu") render();
    } catch (e) {}
  }
  const left = () => (acc.credits || 0) + acc.tickets.length;
  async function charge() {                      // списывает один замер на заявку; true, если можно отправлять
    if (!LIM || order.paid) return true;
    if (acc.tickets.length) { const t = acc.tickets.shift(); order.paid = t; acc.redeem.push(t); saveAcc(); save(); syncAcc(); return true; }
    try {
      const r = await api("/api/reserve", { n: 1 });
      if (!r.tickets.length) { view = "nocredits"; render(); return false; }
      const t = r.tickets[0]; acc.credits = r.credits; order.paid = t; acc.redeem.push(t); saveAcc(); save(); syncAcc();
      toast("Замер списан. Нажмите кнопку ещё раз"); return false;
    } catch (e) {
      if (e.message === "auth") { view = "login"; render(); return false; }
      toast("Нет связи. Подключитесь к интернету, чтобы списать замер"); return false;
    }
  }
  let loginTimer = null, loginErr = "";
  async function startLogin() {
    loginErr = ""; render();
    try {
      const { token } = await api("/api/login/start", {});
      const url = `https://t.me/${CFG.bot}?start=login_${token}`;
      view = "login"; loginWait = url; render();
      try { localStorage.setItem("zamer_login", JSON.stringify({ token, url, t: Date.now() })); } catch (e) {}
      pollLogin(token);
      location.href = url;
    } catch (e) { loginErr = "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз."; render(); }
  }
  function pollLogin(token) {
      clearInterval(loginTimer);
      let n = 0;
      loginTimer = setInterval(async () => {
        n++;
        try {
          const r = await api("/api/login/poll?token=" + token);
          if (r.status === "ok") { clearInterval(loginTimer); acc.session = r.session; acc.id = r.id; acc.name = r.name; acc.credits = r.credits; saveAcc(); loginWait = ""; try { localStorage.removeItem("zamer_login"); } catch (e) {} view = "home"; render(); syncAcc(); }
          else if (r.status === "expired" || n > 300) { clearInterval(loginTimer); loginWait = ""; loginErr = "Время вышло. Попробуйте ещё раз."; render(); }
        } catch (e) {}
      }, 2000);
  }
  let loginWait = "";
  const hasDraft = () => !!(order.address || order.contact);

  const getP = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
  const setP = (o, p, v) => { const ks = p.split("."); let a = o; ks.slice(0, -1).forEach(k => { if (a[k] == null || typeof a[k] !== "object") a[k] = {}; a = a[k]; }); a[ks[ks.length - 1]] = v; };

  /* ---------- проверка ввода ---------- */
  function parse(t, raw) {
    const s = String(raw == null ? "" : raw).trim();
    if (t.t === "text") return s.length < 2 ? { e: "Введите текст" } : s.length > 300 ? { e: "Слишком длинно (до 300 знаков)" } : { v: s };
    if (t.t === "num" || t.t === "int") {
      const n = Number(s.replace(",", ".").replace(/\s/g, ""));
      if (!s || !isFinite(n)) return { e: "Введите число, например 850" };
      if (t.t === "int" && !Number.isInteger(n)) return { e: "Нужно целое число" };
      const lo = t.min != null ? t.min : 1, hi = t.max != null ? t.max : 20000;
      if (n < lo || n > hi) return { e: `Допустимо от ${lo} до ${hi}` };
      return { v: Math.round(n * 10) / 10 };
    }
    if (t.t === "dims") {
      const parts = s.replace(/[xXхХ×*]/g, "*").replace(/\s+/g, "").split("*");
      const nums = parts.map(x => Number(x.replace(",", ".")));
      if (parts.length !== 2 || parts.some(x => !x) || nums.some(n => !isFinite(n)))
        return { e: "Введите два числа через *: сначала высота, потом ширина. Например 80*120" };
      if (nums.some(n => n < 1 || n > 20000)) return { e: "Каждый размер должен быть от 1 до 20000" };
      return { v: nums.map(n => Math.round(n * 10) / 10).join("×") };
    }
    if (t.t === "floors") {
      if (!/^[\d\s,;–\-]+$/.test(s) || !/\d/.test(s)) return { e: "Например: 1, 3, 5-7" };
      return { v: s.replace(/[;\s]+/g, " ").replace(/\s*,\s*/g, ", ").replace(/–/g, "-").trim() };
    }
    if (t.t === "color") {
      if (s.length < 2 || s.length > 40) return { e: "Введите цвет, например RAL 7035" };
      const m = s.match(/^(?:ral)?\s*(\d{4})$/i);
      return { v: m ? "RAL " + m[1] : s };
    }
    return { v: s };
  }

  /* ---------- вопросы ---------- */
  const mm = "мм";
  const SETUP = [
    { p: "address", t: "text", sec: "Объект", q: "Адрес объекта", hint: "Город, улица, дом. Файл заявки будет назван этим адресом.", ph: "г. Казань, ул. Мира, 3", area: 1 },
    { p: "contact", t: "text", sec: "Объект", q: "Контактное лицо на объекте", hint: "Имя и телефон", ph: "Иван, +7 900 123-45-67", area: 1 },
    { p: "scheme", t: "scheme", sec: "Объект", q: "Схема обрамления", hint: "Выбор действует на всю заявку." },
    { p: "common.ind_floor", t: "choice", sec: "Общие параметры", q: "Табло индикации", hint: "Спрашиваем один раз на всю заявку.", ch: ["Нет табло", "Только на 1 этаже", "На всех этажах"] },
    { p: "common.ind_size", t: "dims", unit: mm, ph: "80*120", sec: "Общие параметры", q: "Размер отверстия под табло", hint: "Сначала высота, потом ширина, через значок *. Например: 80*120", when: o => (o.common.ind_floor || "") !== "Нет табло" },
    { p: "common.bend_mode", t: "choice", sec: "Общие параметры", q: "Размеры обрамлений указаны", ch: ["С учётом загиба", "Без учёта загиба"] },
    { p: "common.bend", t: "num", unit: mm, sec: "Общие параметры", q: "Размер загиба", hint: "В миллиметрах", max: 500 },
    { p: "common.btn_all", t: "choice", sec: "Кнопка вызова", q: "Кнопка вызова ставится", ch: ["На всех этажах", "Не на всех этажах"] },
    { p: "common.btn_floors", t: "floors", sec: "Кнопка вызова", q: "На каких этажах кнопка вызова", hint: "Через запятую или диапазон: 1, 3, 5-7", ph: "1, 3, 5-7", when: o => o.common.btn_all === "Не на всех этажах" },
    { p: "common.btn_side", t: "choice", sec: "Кнопка вызова", q: "С какой стороны кнопка вызова", ch: ["Слева", "Справа"] },
    { p: "common.btn_height", t: "num", unit: mm, sec: "Кнопка вызова", q: "Расстояние от пола до кнопки", hint: "В миллиметрах" },
    { p: "common.btn_size", t: "dims", unit: mm, ph: "30*30", sec: "Кнопка вызова", q: "Размер отверстия под кнопку", hint: "Сначала высота, потом ширина, через значок *. Например: 30*30. Один раз для всей заявки." },
    { p: "common.color", t: "color", sec: "Общие параметры", q: "Цвет окраски", hint: "Выберите или введите номер RAL" },
    { p: "stops", t: "int", min: 1, max: 100, sec: "Обрамление ДШ", q: "Количество остановок", hint: "Сколько этажей обслуживает лифт", unit: "шт." },
    { p: "width", t: "num", unit: mm, sec: "Обрамление ДШ", q: "Ширина проёма", hint: "Применяется ко всей заявке" },
    { p: "C", t: "num", unit: mm, sec: "Обрамление ДШ", q: "Размер С", hint: "Это высота вертикального обрамления. Применяется ко всей заявке." },
    { p: "dsh_same", t: "choice", sec: "Обрамление ДШ", q: "Размеры обрамлений на этажах", hint: "Если на всех этажах одинаковые, вводим один раз.", ch: ["Одинаковые на всех этажах", "Индивидуально по этажам"] }
  ];
  const OPEN = [
    ["top_A", "Верхнее обрамление: размер А", "Размер А — это высота верхнего обрамления."],
    ["top_H", "Верхнее обрамление: размер Н", "Размер Н — это глубина верхнего обрамления."],
    ["left_H", "Левое боковое: размер Н", "Размер Н — это глубина бокового обрамления."],
    ["left_B", "Левое боковое: размер В", "Размер В — это ширина бокового обрамления."],
    ["right_H", "Правое боковое: размер Н", "Размер Н — это глубина бокового обрамления."],
    ["right_B", "Правое боковое: размер В", "Размер В — это ширина бокового обрамления."]
  ];
  const same = () => order.dsh_same === "Одинаковые на всех этажах";
  /* ---------- двери и люки ---------- */
  const sameDL = () => (order.entrances || 0) <= 1 || !String(order.dl_same || "").startsWith("Разные");
  function buildListDL() {
    const l = [
      { p: "address", t: "text", sec: "Объект", q: "Адрес объекта", hint: "Город, улица, дом. Файл заявки будет назван этим адресом.", ph: "г. Казань, ул. Мира, 3", area: 1 },
      { p: "contact", t: "text", sec: "Объект", q: "Контактное лицо на объекте", hint: "Имя и телефон", ph: "Иван, +7 900 123-45-67", area: 1 },
      { p: "entrances", t: "int", min: 1, max: 50, unit: "шт.", sec: "Объект", q: "Сколько подъездов?", hint: "Выберите, одинаковые ли размеры по подъездам, и что нужно измерить: дверь, люк или оба.", tg: [["dl_same", "Размеры", "Одинаковые", ["Одинаковые", "Разные"]], ["need_door", "Дверь", "Да"], ["need_hatch", "Люк", "Да"]] }
    ];
    const N = order.entrances || 0, es = sameDL() ? [1] : Array.from({ length: N }, (_, i) => i + 1);
    es.forEach(e => {
      const sec = sameDL() ? (N > 1 ? "Двери и люки, все подъезды" : "Двери и люки") : `Подъезд ${e} из ${N}`;
      const pk = `ent.${e}`, qh = sameDL() && N > 1 ? "Количество на один подъезд. В бланке оно умножится на число подъездов." : "";
      const gl = { door: order.need_door || "Да", hatch: order.need_hatch || "Да" };
      ["door", "hatch"].forEach(k => { if (sameDL() || !getP(order, `${pk}.${k}.need`)) setP(order, `${pk}.${k}.need`, gl[k]); });
      if (!sameDL() && N > 1) l.push({ p: `${pk}.tg`, t: "toggles", sec, ent: e, first: true, q: `Что нужно в подъезде ${e}?`, hint: "Включите нужное. Размеры спросим дальше.",
        tg: [[`${pk}.door.need`, "Дверь", "Да"], [`${pk}.hatch.need`, "Люк", "Да"]] });
      if (getP(order, `${pk}.door.need`) === "Да") {
        if (!getP(order, `${pk}.door.hinge`)) setP(order, `${pk}.door.hinge`, "Слева");
        if (!getP(order, `${pk}.door.cas`)) setP(order, `${pk}.door.cas`, { l: true, t: true, r: true });
        l.push({ p: `${pk}.door.pair`, t: "pair", pic: "door", min: 100, unit: mm, sec, ent: e, q: "Дверь: проём, петли, наличник", hint: "Нажимайте на наличник на рисунке. Размер двери: высота минус 20, ширина минус 40.",
          casP: `${pk}.door.cas`, hingeP: `${pk}.door.hinge`, tg: [[`${pk}.door.hinge`, "Петли", "Слева", ["Слева", "Справа"]]], pair: [[`${pk}.door.h`, "Высота проёма"], [`${pk}.door.w`, "Ширина проёма"]] });
        l.push({ p: `${pk}.door.qty`, t: "int", min: 1, max: 999, unit: "шт.", quick: 1, sec, ent: e, q: "Количество дверей", hint: qh });
      }
      if (getP(order, `${pk}.hatch.need`) === "Да") {
        l.push({ p: `${pk}.hatch.pair`, t: "pair", pic: "hatch", min: 100, unit: mm, sec, ent: e, q: "Люк: строительный проём", hint: "Размер люка посчитаем сами: проём минус 10 мм. Наличник на люке ставится всегда, со всех сторон.", pair: [[`${pk}.hatch.h`, "Высота проёма"], [`${pk}.hatch.w`, "Ширина проёма"]] });
        l.push({ p: `${pk}.hatch.qty`, t: "int", min: 1, max: 999, unit: "шт.", quick: 1, sec, ent: e, q: "Количество люков", hint: qh });
      }
    });
    return l;
  }
  function dlItems() {
    const N = order.entrances || 1;
    const mk = (e, label, mult) => {
      const d = (order.ent && order.ent[e]) || {};
      const door = d.door && d.door.need === "Да" ? Object.assign({}, d.door, { cas: Object.assign({ l: true, t: true, r: true }, d.door.cas || {}) }) : { need: "Нет" };
      const hatch = d.hatch && d.hatch.need === "Да" ? d.hatch : { need: "Нет" };
      return { label, door, hatch, mult };
    };
    return sameDL() ? [mk(1, N > 1 ? `Все подъезды (${N})` : "Подъезд 1", N)] : Array.from({ length: N }, (_, i) => mk(i + 1, `Подъезд ${i + 1} из ${N}`, 1));
  }
  function casingHtml(val) {
    const c = Object.assign({ l: true, t: true, r: true }, val || {});
    const g = (k, x, y, w, h, tx, ty, name) => `<g class="cas${c[k] ? " on" : ""}" data-cas="${k}" role="button" tabindex="0" aria-label="Наличник ${name}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><text x="${tx}" y="${ty}" text-anchor="middle">${c[k] ? "✓" : "+"}</text></g>`;
    return `<svg class="doorsvg" viewBox="0 0 240 236" aria-hidden="false"><defs><pattern id="hp" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="#b7cde0" stroke-width="1"/></pattern></defs>
      <rect x="82" y="66" width="76" height="140" fill="#e3eef7"/><rect x="82" y="66" width="76" height="140" fill="url(#hp)"/><rect x="82" y="66" width="76" height="140" fill="none" stroke="currentColor" stroke-width="3"/>
      <circle cx="148" cy="140" r="3" fill="currentColor"/><line x1="40" y1="206" x2="200" y2="206" stroke="currentColor" stroke-width="2" stroke-dasharray="6 4"/>
      ${g("l", 56, 40, 26, 166, 69, 128, "слева")}${g("t", 82, 40, 76, 26, 120, 58, "сверху")}${g("r", 158, 40, 26, 166, 171, 128, "справа")}
      <text x="120" y="226" text-anchor="middle" class="flo">пол</text></svg>
      <div class="choices">${[["l", "Слева"], ["t", "Сверху"], ["r", "Справа"]].map(([k, n]) => `<button class="choice${c[k] ? " on" : ""}" data-cas="${k}">Наличник ${n.toLowerCase()}</button>`).join("")}</div>`;
  }
  const dash = (v, sfx) => (v === undefined || v === "" ? "—" : v + (sfx || ""));
  function dlSummaryHtml() {
    const items = dlItems();
    const head = [["Адрес", order.address], ["Контакт", order.contact], ["Подъездов", order.entrances], ["Размеры", sameDL() ? "одинаковые" : "разные по подъездам"]];
    const part = it => {
      const d = it.door, h = it.hatch, m = it.mult, L = [];
      L.push(d.need === "Да" ? `Дверь: строительный проём ${d.h}×${d.w} мм → дверь <b>${d.h - 20}×${d.w - 40}</b> мм, петли ${esc(String(d.hinge || "").toLowerCase())}, наличник: ${["l", "t", "r"].filter(k => d.cas[k]).map(k => ({ l: "слева", t: "сверху", r: "справа" }[k])).join(", ") || "нет"}, ${d.qty * m} шт.` : "Дверь: не требуется");
      L.push(h.need === "Да" ? `Люк: строительный проём ${h.h}×${h.w} мм → люк <b>${h.h - 10}×${h.w - 10}</b> мм, наличник со всех сторон, ${h.qty * m} шт.` : "Люк: не требуется");
      return `<div class="card"><div class="sum"><span><b>${esc(it.label)}</b></span>${L.map(x => `<span>${x}</span>`).join("")}</div></div>`;
    };
    return `<div class="card"><div class="sum">${head.map(([a, b]) => `<span><b>${a}:</b> ${esc(b)}</span>`).join("")}</div></div>` + items.map(part).join("");
  }
  /* ---------- окна ---------- */
  const WK = { "Глухое": "gl", "Поворотное": "tr", "Откидное": "tl", "Поворотно-откидное": "tt" };
  function sashSvg(kind, hinge) {
    const L = hinge !== "Справа", w = 70, h = 92, ln = (a, b, c, d) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`;
    let g = "";
    if (kind === "tr" || kind === "tt") g += L ? ln(w, 0, 0, h / 2) + ln(w, h, 0, h / 2) : ln(0, 0, w, h / 2) + ln(0, h, w, h / 2);
    if (kind === "tl" || kind === "tt") g += ln(0, 0, w / 2, h) + ln(w, 0, w / 2, h);
    const hd = kind === "gl" ? "" : kind === "tl" ? `<rect x="${w / 2 - 7}" y="9" width="14" height="4" rx="1"/>` : `<rect x="${L ? w - 11 : 7}" y="${h / 2 - 8}" width="4" height="16" rx="1"/>`;
    return `<svg class="wsvg" viewBox="-8 -8 86 108" aria-hidden="true"><rect x="-6" y="-6" width="82" height="104" rx="2" class="wf"/><rect x="0" y="0" width="${w}" height="${h}" class="wg"/><g class="wl">${g}</g><g class="wh">${hd}</g></svg>`;
  }
  const dimA = (x1, y1, x2, y2, tx, ty, lab, rot) => `<line class="dm" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-start="url(#pa)" marker-end="url(#pa)"/><text class="dl" x="${tx}" y="${ty}" text-anchor="middle"${rot ? ` transform="rotate(-90 ${tx} ${ty})"` : ""}>${lab}</text>`;
  const PDEF = '<defs><marker id="pa" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L6 3L0 6z" class="mk"/></marker><pattern id="hp2" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="#b7cde0" stroke-width="1"/></pattern></defs>';
  function casG(c, k, x, y, w, h, tx, ty, name) { return `<g class="cas${c[k] ? " on" : ""}" data-cas="${k}" role="button" tabindex="0" aria-label="Наличник ${name}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><text x="${tx}" y="${ty}" text-anchor="middle">${c[k] ? "✓" : "+"}</text></g>`; }
  function doorPic(cas, hinge) {
    const c = Object.assign({ l: true, t: true, r: true }, cas || {});
    return `<svg class="pic" viewBox="0 0 260 250" role="group" aria-label="Дверь">${PDEF}
      <rect x="96" y="70" width="76" height="150" fill="#e3eef7"/><rect x="96" y="70" width="76" height="150" fill="url(#hp2)"/><rect x="96" y="70" width="76" height="150" fill="none" stroke="currentColor" stroke-width="3"/>
      <circle class="hd" cx="${hinge === "Справа" ? 106 : 162}" cy="148" r="3.6" fill="currentColor"/>
      <g class="hgL"${hinge === "Справа" ? ' style="display:none"' : ""}>${[92, 138, 192].map(y => `<rect x="96" y="${y}" width="7" height="16" rx="1.5" class="hg"/>`).join("")}</g>
      <g class="hgR"${hinge === "Справа" ? "" : ' style="display:none"'}>${[92, 138, 192].map(y => `<rect x="165" y="${y}" width="7" height="16" rx="1.5" class="hg"/>`).join("")}</g><line x1="50" y1="220" x2="218" y2="220" stroke="currentColor" stroke-width="2" stroke-dasharray="6 4"/>
      ${casG(c, "l", 68, 44, 28, 176, 82, 136, "слева")}${casG(c, "t", 96, 44, 76, 26, 134, 62, "сверху")}${casG(c, "r", 172, 44, 28, 176, 186, 136, "справа")}
      ${dimA(46, 70, 46, 220, 36, 145, "Высота", 1)}${dimA(96, 28, 172, 28, 134, 19, "Ширина")}
      <text x="134" y="240" text-anchor="middle" class="flo">пол</text></svg>`;
  }
  function hatchPic() {
    const g = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="cf"/>`;
    return `<svg class="pic" viewBox="0 0 260 230" role="img" aria-label="Люк">${PDEF}
      ${g(78, 52, 104, 104 + 0)}<rect x="94" y="68" width="72" height="72" fill="#e3eef7"/><rect x="94" y="68" width="72" height="72" fill="url(#hp2)"/><rect x="94" y="68" width="72" height="72" fill="none" stroke="currentColor" stroke-width="3"/>
      <circle cx="154" cy="104" r="3.6" fill="currentColor"/>
      ${[78, 116].map(y => `<rect x="94" y="${y}" width="7" height="16" rx="1.5" class="hg"/>`).join("")}
      ${dimA(54, 68, 54, 140, 44, 104, "Высота", 1)}${dimA(94, 176, 166, 176, 130, 196, "Ширина")}
      <text x="130" y="214" text-anchor="middle" class="flo">наличник со всех сторон, петли напротив ручки</text></svg>`;
  }
  function winPic(kind, hinge) {
    const w = 100, h = 126, L = hinge !== "Справа", ln = (a, b, c, d) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`;
    let g = "";
    if (kind === "tr" || kind === "tt") g += L ? ln(w, 0, 0, h / 2) + ln(w, h, 0, h / 2) : ln(0, 0, w, h / 2) + ln(0, h, w, h / 2);
    if (kind === "tl" || kind === "tt") g += ln(0, 0, w / 2, h) + ln(w, 0, w / 2, h);
    return `<svg class="pic wsvg" viewBox="0 0 260 230" role="img" aria-label="Окно">${PDEF}
      <rect x="74" y="30" width="112" height="138" rx="2" class="wf"/><g transform="translate(80 36)"><rect width="${w}" height="${h}" class="wg"/><g class="wl">${g}</g></g>
      ${dimA(50, 36, 50, 162, 40, 99, "Высота", 1)}${dimA(80, 188, 180, 188, 130, 208, "Ширина")}</svg>`;
  }
  const winList = () => Math.max(1, Math.min(20, order.wins || 0));
  function buildListWin() {
    const l = [
      { p: "address", t: "text", sec: "Объект", q: "Адрес объекта", hint: "Город, улица, дом. Файл заявки будет назван этим адресом.", ph: "г. Казань, ул. Мира, 3", area: 1 },
      { p: "contact", t: "text", sec: "Объект", q: "Контактное лицо на объекте", hint: "Имя и телефон", ph: "Иван, +7 900 123-45-67", area: 1 },
      { p: "wins", t: "int", min: 1, max: 20, unit: "шт.", sec: "Объект", q: "Сколько видов окон?", hint: "Окна одного размера и с одинаковым открыванием — это один вид. Количество одинаковых окон спросим дальше." }
    ];
    const N = order.wins || 0;
    for (let i = 1; i <= N; i++) {
      const sec = N > 1 ? `Окно ${i} из ${N}` : "Окно", pk = `win.${i}`;
      l.push({ p: `${pk}.pair`, t: "pair", pic: "win", pk, min: 100, unit: mm, sec, win: i, first: true, q: "Оконный проём", hint: "Размер окна посчитаем сами: слева, сверху и справа минус 20 мм, т.е. высота минус 20, ширина минус 40.", pair: [[`${pk}.h`, "Высота проёма"], [`${pk}.w`, "Ширина проёма"]] });
      l.push({ p: `${pk}.kind`, t: "choice", sash: "type", pk, sec, q: "Как открывается створка?", hint: "Вид изнутри помещения. Выберите тип, затем при необходимости включите отлив и сторону петель.", ch: Object.keys(WK) });
      const k = WK[getP(order, `${pk}.kind`)];
      if (!getP(order, `${pk}.ebb.need`)) setP(order, `${pk}.ebb.need`, "Нет");
      if (!getP(order, `${pk}.hinge`)) setP(order, `${pk}.hinge`, "Слева");
      if (!getP(order, `${pk}.ebb.need`)) setP(order, `${pk}.ebb.need`, "Нет");
      if (getP(order, `${pk}.ebb.need`) === "Да") {
        l.push({ p: `${pk}.ebb.pair`, t: "pair", unit: mm, sec, q: "Размеры отлива", hint: "Введите длину и ширину отлива.", pair: [[`${pk}.ebb.l`, "Длина"], [`${pk}.ebb.w`, "Ширина"]] });
      }
      l.push({ p: `${pk}.qty`, t: "int", min: 1, max: 999, unit: "шт.", quick: 1, sec, win: i, qtyStep: true, q: "Количество таких окон", hint: "Отлив тоже считается на каждое такое окно." });
    }
    return l;
  }
  function winItems() {
    return Array.from({ length: order.wins || 0 }, (_, i) => {
      const d = (order.win && order.win[i + 1]) || {}, k = WK[d.kind] || "gl";
      return { n: i + 1, h: d.h, w: d.w, kind: k, kindName: d.kind, hinge: k === "tr" || k === "tt" ? (d.hinge === "Справа" ? "Справа" : "Слева") : "", qty: d.qty, ebb: d.ebb && d.ebb.need === "Да" ? { l: d.ebb.l, w: d.ebb.w } : null };
    });
  }
  function winSummaryHtml() {
    const head = [["Адрес", order.address], ["Контакт", order.contact], ["Видов окон", order.wins]];
    const part = it => `<div class="card"><div class="sum"><span><b>Окно ${it.n}</b></span><span>Проём ${it.h}×${it.w} мм → окно <b>${it.h - 20}×${it.w - 40}</b> мм</span><span>${esc(it.kindName || "")}${it.hinge ? ", петли " + esc(it.hinge.toLowerCase()) : ""}</span><span>Отлив: ${it.ebb ? `${it.ebb.l}×${it.ebb.w} мм` : "не требуется"}</span><span>${it.qty} шт.</span></div></div>`;
    return `<div class="card"><div class="sum">${head.map(([a, b]) => `<span><b>${a}:</b> ${esc(b)}</span>`).join("")}</div></div>` + winItems().map(part).join("");
  }
  const isSimple = () => order.kind === "dl" || order.kind === "win";
  function newOrder(kind) {
    if (LIM && !acc.session) { view = "home"; return render(); }
    if (hasDraft() && !confirm("Начать новую заявку? Текущие ответы будут удалены.")) return;
    order = fresh(); order.kind = kind; pos = 0; view = "wizard"; sub = null; save(); render();
  }
  function buildList() {
    if (order.kind === "dl") return buildListDL();
    if (order.kind === "win") return buildListWin();
    const l = SETUP.filter(s => !s.when || s.when(order));
    const floors = same() ? [1] : Array.from({ length: order.stops || 0 }, (_, i) => i + 1);
    floors.forEach(f => {
      const sec = same() ? "Обрамление, все этажи" : `Этаж ${f} из ${order.stops}`;
      OPEN.forEach(([k, q, h], i) => l.push({ p: `ops.${f}.${k}`, t: "num", unit: mm, sec, q, hint: h + " Введите в миллиметрах.", floor: f, first: i === 0 }));
      l.push({ p: `ops.${f}.qty`, t: "int", min: 1, max: 999, unit: "шт.", sec, q: "Количество комплектов", floor: f });
    });
    return l;
  }
  const SUB = {
    thresholds: { title: "Порог (рифлёнка)", list: "thresholds", steps: [["length", "Длина порога"], ["width", "Ширина порога"], ["holes", "Количество отверстий Ø6", "int", "шт.", 0, 99], ["qty", "Количество порогов", "int", "шт.", 1, 999]] },
    nashchelnik: { title: "Нащельник", list: "nashchelnik", steps: [["length", "Длина нащельника"], ["width", "Ширина нащельника"], ["qty", "Количество", "int", "шт.", 1, 999]] },
    speed_limiter: { title: "Бортики ограничителя скорости", cable: 1, steps: [["h", "Высота"], ["w", "Ширина"], ["l", "Длина"], ["qty", "Количество", "int", "шт.", 1, 999]] },
    main_drive: { title: "Бортики главного привода", cable: 1, steps: [["h", "Высота"], ["w", "Ширина"], ["l", "Длина"], ["qty", "Количество", "int", "шт.", 1, 999]] }
  };

  /* ---------- общие части интерфейса ---------- */
  function shell(title, progress, body, foot, opts = {}) {
    $app.innerHTML = `<header class="top"><div class="bar">${opts.back === false ? "" : `<button class="ib" data-a="back" aria-label="Назад">${ICON.back}</button>`}<h1>${esc(title)}</h1>${opts.menu === false ? "" : `<button class="ib" data-a="menu" aria-label="Меню">${ICON.menu}</button>`}</div>${progress == null ? "" : `<div class="prog"><i style="width:${Math.round(progress * 100)}%"></i></div>`}</header><main>${body}</main><footer class="act">${foot}</footer>${flash ? `<div class="toast">${esc(flash)}</div>` : ""}`;
    if (flash) setTimeout(() => { flash = ""; const t = document.querySelector(".toast"); if (t) t.remove(); }, 2200);
    window.scrollTo(0, 0);
  }
  const toast = m => { flash = m; render(); };

  /* ---------- экраны ---------- */
  const SECT_ICON = {
    frame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V6a1 1 0 011-1h12a1 1 0 011 1v15"/><path d="M9 21V9h6v12"/></svg>',
    door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M14.5 12h.01M5 21h14"/></svg>',
    claim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M12 11v5"/><circle cx="12" cy="18.6" r=".6" fill="currentColor"/></svg>',
    win: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/></svg>'
  };
  function dateLong(d, withTime) {
    d = d || new Date();
    let t = d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).replace(" г.", "");
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (withTime) t += ", " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return t;
  }
  function greeting() {
    const h = new Date().getHours();
    const t = h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
    const n = (acc.name || "").split(" ")[0];
    return t + (n ? ", " + n : "") + "!";
  }
  function homeView() {
    const tile = (a, ic, title, sub, soon) => `<button class="tile${soon ? " soon" : ""}" data-a="${a}"><span class="ti">${SECT_ICON[ic]}</span><span class="tt"><b>${title}</b><small>${sub}</small></span>${soon ? `<em>в разработке</em>` : `<span class="go">›</span>`}</button>`;
    $app.innerHTML = `<main style="padding-top:max(24px,env(safe-area-inset-top))">
      <div class="hello"><button class="logob" data-a="theme" aria-label="Сменить тему"><img src="icon-192.png" alt=""></button><div><h2>${esc(greeting())}</h2><p>Выберите, что будем измерять сегодня</p></div></div>
      <p class="hint" style="margin:-4px 0 0 2px">${esc(dateLong())}</p>
      ${LIM && acc.session ? `<div class="chip" style="justify-self:start">Осталось замеров: ${left()}</div>` : ""}
      ${hasDraft() && !(LIM && !acc.session) ? `<button class="tile cont" data-a="resume"><span class="ti">${SECT_ICON.frame}</span><span class="tt"><b>Продолжить заявку</b><small>${order.kind === "dl" ? "Двери и люки" : order.kind === "win" ? "Окна" : "Обрамления"} · ${esc((order.address || "").slice(0, 32))}</small></span><span class="go">›</span></button>` : ""}
      <div class="tiles">
        ${tile("sec_frame", "frame", "Замер обрамлений", "Двери шахты, пороги, нащельник, бортики", false)}
        ${tile("sec_door", "door", "Замер дверей и люков", "Машинное помещение лифта", false)}
        ${tile("sec_win", "win", "Замер окон", "Проём, петли, схема открывания, отлив", false)}
        ${tile("sec_claim", "claim", "Составление рекламации", "Оформление претензии по заказу", true)}
      </div>
      <div class="card tips"><div class="sum"><span>✓ Работает без интернета</span><span>✓ Ответы сохраняются на телефоне</span><span>✓ Готовый бланк PDF в один клик</span></div></div>
      <p class="credit">Разработчик<br><b>Кащеев Виктор Петрович</b><br><button class="co" data-a="mail">СтройЛифтКомплекс</button></p>
    </main>${LIM && !acc.session ? `<footer class="act"><button class="btn" data-a="login">Войти через Telegram</button></footer>` : ""}`;
  }
  function soonView() {
    const w = soonView.what === "claim" ? "Составление рекламации" : soonView.what === "win" ? "Замер окон" : "Замер дверей и люков";
    shell(w, null, `<div class="card" style="text-align:center;justify-items:center"><div class="soonico">${SECT_ICON[soonView.what === "claim" ? "claim" : soonView.what === "win" ? "win" : "door"]}</div><h2 class="q">Этот раздел в разработке</h2><p class="hint">Мы готовим удобный опросник и бланк заявки. Скоро он появится в приложении, обновление придёт само.</p><p class="hint">А пока можно оформить замер обрамлений.</p></div>`,
      `<button class="btn" data-a="home">На главный экран</button>`, { back: true, menu: false });
  }
  function wizardView() {
    const list = buildList(); if (pos >= list.length) { view = isSimple() ? "review" : "hub"; save(); return render(); }
    const s = list[pos], val = getP(order, s.p), err = wizardView.err || "";
    let body = `<div class="card"><span class="chip">${esc(s.sec)} · вопрос ${pos + 1} из ${list.length}</span><h2 class="q">${esc(s.q)}</h2>${s.hint ? `<p class="hint">${esc(s.hint)}</p>` : ""}`;
    body += controlHtml(s, val) + `<p class="err" id="err">${esc(err)}</p></div>`;
    let foot = s.t === "choice" || s.t === "scheme" ? "" : `<button class="btn" data-a="next">Далее</button>`;
    if (s.sash === "type") foot = `<button class="btn" data-a="next">Далее</button>`;
    if (s.t === "scheme") foot = `<button class="btn" data-a="next">Далее</button>`;
    if (order.kind === "dl" && !sameDL() && s.first && s.ent > 1) foot += `<button class="btn sec" data-a="copyprev">Все размеры как в подъезде ${s.ent - 1}</button>`;
    if (order.kind === "win" && s.first && s.win > 1) foot += `<button class="btn sec" data-a="copyprev">Как окно ${s.win - 1}: всё то же</button>`;
    if (order.kind === "frame" && !same() && s.first && s.floor > 1) foot += `<button class="btn sec" data-a="copyprev">Все размеры как на этаже ${s.floor - 1}</button>`;
    shell(s.sec, pos / list.length, body, foot);
    bindInput(s);
  }
  function tglHtml([p, lab, def, seg]) {
    const v = getP(order, p) || (setP(order, p, def), def);
    if (seg) return `<div class="tgl segrow"><span>${esc(lab)}</span><div class="seg" role="radiogroup">${seg.map(o => `<button type="button" role="radio" aria-checked="${v === o}" class="${v === o ? "on" : ""}" data-seg="${esc(p)}|${esc(o)}">${esc(o)}</button>`).join("")}</div></div>`;
    return `<button class="tgl${v === "Да" ? " on" : ""}" role="switch" aria-checked="${v === "Да"}" data-tg="${p}"><span>${esc(lab)}</span><i class="sw2"><b></b></i></button>`;
  }
  function controlHtml(s, val) {
    let h = "";
    if (s.pic === "door") h += doorPic(getP(order, s.casP), getP(order, s.hingeP));
    else if (s.pic === "hatch") h += hatchPic();
    else if (s.pic === "win") h += winPic(WK[getP(order, s.pk + ".kind")], getP(order, s.pk + ".hinge"));
    if (s.pic && s.tg) h += `<div class="tgls">${s.tg.map(tglHtml).join("")}</div>`;
    h += controlBase(s, val);
    if (!s.pic && s.tg && s.t !== "toggles") h += `<div class="tgls" style="margin-top:12px">${s.tg.map(tglHtml).join("")}</div>`;
    return h;
  }
  function controlBase(s, val) {
    if (s.t === "casing") return casingHtml(val);
    if (s.t === "pair") return s.pair.map(([p, lab], k) => { const v = getP(order, p); return `<label class="plab">${esc(lab)}</label><div class="field"><input id="${k ? "inp2" : "inp"}" inputmode="decimal" enterkeyhint="${k ? "done" : "next"}" value="${esc(v == null ? "" : String(v).replace(".", ","))}"><span class="u">${s.unit}</span></div>`; }).join("");
    if (s.t === "toggles") return `<div class="tgls">${s.tg.map(tglHtml).join("")}</div>`;
    if (false) return `<div class="tgls">${s.tg.map(([p, lab, def, seg]) => { const v = getP(order, p) || (setP(order, p, def), def);
      if (seg) return `<div class="tgl segrow"><span>${esc(lab)}</span><div class="seg" role="radiogroup">${seg.map(o => `<button type="button" role="radio" aria-checked="${v === o}" class="${v === o ? "on" : ""}" data-seg="${esc(p)}|${esc(o)}">${esc(o)}</button>`).join("")}</div></div>`;
      return `<button class="tgl${v === "Да" ? " on" : ""}" role="switch" aria-checked="${v === "Да"}" data-tg="${p}"><span>${esc(lab)}</span><i class="sw2"><b></b></i></button>`; }).join("")}</div>`;
    if (s.t === "choice" && s.sash) {
      const kp = s.sash === "hinge" ? WK[getP(order, s.kindPath)] : null;
      return `<div class="schemes wsch">${s.ch.map(c => `<button class="sch${val === c ? " on" : ""}" data-pick="${esc(c)}">${s.sash === "hinge" ? sashSvg(kp, c) : sashSvg(WK[c], (s.pk && getP(order, s.pk + ".hinge")) || "Слева")}<b>${esc(c)}</b></button>`).join("")}</div>` + (s.sash === "type" ? (() => {
        const k = WK[val], turn = k === "tr" || k === "tt";
        if (!val) return "";
        return `<div class="tgls" style="margin-top:12px">${turn ? tglHtml([`${s.pk}.hinge`, "Петли", "Слева", ["Слева", "Справа"]]) : ""}${tglHtml([`${s.pk}.ebb.need`, "Отлив", "Нет"])}</div>`;
      })() : "");
    }
    if (s.t === "choice") return `<div class="choices">${s.ch.map(c => `<button class="choice${val === c ? " on" : ""}" data-pick="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
    if (s.t === "scheme") return `<div class="schemes">${["А", "В"].map(k => `<button class="sch${val === k ? " on" : ""}" data-pick="${k}" aria-label="Схема ${k}">${schemeSvg(k)}<b>Схема ${k}</b><small>${k === "А" ? "Верхнее обрамление накрывает боковые" : "Верхнее обрамление между боковыми"}</small></button>`).join("")}</div>`;
    if (s.t === "color") {
      const sw = [["7035", "#cbd0cc"], ["7040", "#9da3a6"], ["7016", "#383e42"], ["9003", "#f4f4f4"], ["9010", "#f1ede1"], ["9005", "#0e0e10"], ["9006", "#a5a5a5"], ["3020", "#cc0605"]];
      return `<div class="sw">${sw.map(([n, h]) => `<button data-pick="RAL ${n}" class="${val === "RAL " + n ? "on" : ""}"><i style="background:${h}"></i>RAL ${n}</button>`).join("")}</div><div class="field"><input id="inp" value="${esc(val && !sw.some(x => "RAL " + x[0] === val) ? val : "")}" placeholder="Другой цвет" autocomplete="off"></div>`;
    }
    const mode = s.t === "int" ? "numeric" : s.t === "num" ? "decimal" : s.t === "floors" ? "text" : "text";
    const inner = s.area ? `<textarea id="inp" rows="3" placeholder="${esc(s.ph || "")}">${esc(val || "")}</textarea>` : `<input id="inp" inputmode="${mode}" enterkeyhint="next" value="${esc(val == null ? "" : String(val).replace(".", ","))}" placeholder="${esc(s.ph || "")}" autocomplete="off">`;
    return `<div class="field">${inner}${s.unit ? `<span class="u">${s.unit}</span>` : ""}</div>` + (s.quick ? `<div class="quick">${[1, 2, 3, 4, 5, 6, 8, 10].map(n => `<button type="button" data-q="${n}">${n}</button>`).join("")}</div>` : "") + (s.t === "dims" ? `<button class="btn sec" type="button" data-ins="*" style="font-size:26px">*</button><p class="hint" style="text-align:center">Нажмите *, чтобы поставить значок между высотой и шириной</p>` : "");
  }
  function bindInput(s) {
    const inp = document.getElementById("inp");
    if (inp) {
      setTimeout(() => inp.focus(), 60);
      inp.addEventListener("keydown", e => { if (e.key === "Enter" && !s.area) { e.preventDefault(); const i2 = s.t === "pair" && document.getElementById("inp2"); if (i2) i2.focus(); else act("next"); } });
      const i2 = document.getElementById("inp2"); if (i2) i2.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); act("next"); } });
    }
  }
  function readValue(s) {
    if (s.t === "choice" || s.t === "scheme") return getP(order, s.p);
    const inp = document.getElementById("inp");
    if (s.t === "color") { const v = inp && inp.value.trim(); return v || getP(order, s.p); }
    return inp ? inp.value : "";
  }
  function advance(s, raw) {
    if (s.t === "pair") {
      const ids = ["inp", "inp2"], rs = s.pair.map((x, k) => parse({ t: "num", min: s.min || 10 }, (document.getElementById(ids[k]) || {}).value));
      const bad = rs.findIndex(r => r.e);
      if (bad >= 0) { const m = s.pair[bad][1] + ": " + rs[bad].e; wizardView.err = m; const el = document.getElementById("err"); if (el) el.textContent = m; const f = document.getElementById(ids[bad]); if (f) f.focus(); return; }
      wizardView.err = ""; s.pair.forEach(([p], k) => setP(order, p, rs[k].v)); pos++; save(); return render();
    }
    if (s.t === "toggles") { pos++; save(); return render(); }
    if (s.t === "casing") { if (!getP(order, s.p)) setP(order, s.p, { l: true, t: true, r: true }); pos++; save(); return render(); }
    if (s.p === "entrances" && order.need_door === "Нет" && order.need_hatch === "Нет") { const m = "Включите хотя бы дверь или люк"; wizardView.err = m; const el = document.getElementById("err"); if (el) el.textContent = m; return; }
    const r = (s.t === "choice" || s.t === "scheme") ? (raw ? { v: raw } : { e: "Выберите вариант" }) : parse(s, raw);
    if (r.e) { wizardView.err = r.e; const el = document.getElementById("err"); if (el) el.textContent = r.e; return; }
    wizardView.err = "";
    setP(order, s.p, r.v);
    if (s.p === "stops" || s.p === "dsh_same") order.ops = order.ops || {};
    pos++; save(); render();
  }

  function hubView() {
    const sec = (key, extra) => {
      const d = SUB[key]; const items = d.cable ? (order.cable[key] ? [order.cable[key]] : []) : order[d.list];
      const txt = it => d.cable ? `${it.h}×${it.w}×${it.l} мм, ${it.qty} шт.` : key === "thresholds" ? `${it.length}×${it.width} мм, отв. ${it.holes}, ${it.qty} шт.` : `${it.length}×${it.width} мм, ${it.qty} шт.`;
      return `<div class="card sec-card"><h3>${d.title}</h3>${items.map((it, i) => `<div class="item"><span>${esc(txt(it))}</span><button data-del="${key}:${i}" aria-label="Удалить">×</button></div>`).join("")}${!items.length ? `<p class="hint">Не требуется</p>` : ""}${d.cable && items.length ? "" : `<button class="btn sec" data-add="${key}">${items.length ? "Добавить ещё" : "Добавить"}</button>`}</div>`;
    };
    shell("Что ещё нужно в заявку", 1,
      `<p class="hint">Обрамления внесены: ${order.stops ? (same() ? order.stops + " эт., одинаковые" : order.stops + " эт.") : "—"}. Добавьте остальное, если нужно.</p>` + sec("thresholds") + sec("nashchelnik") + sec("speed_limiter") + sec("main_drive"),
      `<button class="btn" data-a="review">Проверить и сформировать бланк</button><button class="btn ghost" data-a="back">Изменить ответы</button>`);
  }
  function subView() {
    const d = sub.d, st = d.steps[sub.i], [k, q, t = "num", unit = mm, lo, hi] = st;
    const body = `<div class="card"><span class="chip">${esc(d.title)}</span><h2 class="q">${esc(q)}</h2>${st[1] === q ? "" : ""}<div class="field"><input id="inp" inputmode="${t === "int" ? "numeric" : "decimal"}" enterkeyhint="next" value="${esc(sub.vals[k] == null ? "" : String(sub.vals[k]).replace(".", ","))}" autocomplete="off"><span class="u">${unit}</span></div><p class="err" id="err">${esc(sub.err || "")}</p></div>`;
    shell(d.title, sub.i / d.steps.length, body, `<button class="btn" data-a="next">${sub.i === d.steps.length - 1 ? "Готово" : "Далее"}</button>`);
    const inp = document.getElementById("inp"); setTimeout(() => inp.focus(), 60);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); act("next"); } });
  }
  function subNext() {
    const d = sub.d, [k, , t = "num", , lo, hi] = d.steps[sub.i];
    const r = parse({ t, min: lo, max: hi }, document.getElementById("inp").value);
    if (r.e) { sub.err = r.e; document.getElementById("err").textContent = r.e; return; }
    sub.err = ""; sub.vals[k] = r.v;
    if (sub.i < d.steps.length - 1) { sub.i++; return render(); }
    if (d.cable) order.cable[sub.key] = sub.vals; else order[d.list].push(sub.vals);
    sub = null; view = "hub"; save(); render();
  }

  function summaryHtml() {
    if (order.kind === "dl") return dlSummaryHtml();
    if (order.kind === "win") return winSummaryHtml();
    const c = order.common, rows = [
      ["Адрес", order.address], ["Контакт", order.contact], ["Схема", order.scheme], ["Остановок", order.stops],
      ["Ширина проёма / С", `${order.width} / ${order.C} мм`], ["Размеры", `${c.bend_mode}, загиб ${c.bend} мм`],
      ["Табло", c.ind_floor + (c.ind_floor === "Нет табло" ? "" : `, отв. ${c.ind_size} мм`)],
      ["Кнопка", `${c.btn_all === "Не на всех этажах" ? "эт. " + c.btn_floors + ", " : ""}${c.btn_side}, ${c.btn_height} мм от пола, отв. ${c.btn_size} мм`], ["Цвет", c.color]];
    return `<div class="card"><div class="sum">${rows.map(([a, b]) => `<span><b>${a}:</b> ${esc(b)}</span>`).join("")}</div></div>`;
  }
  async function reviewView() {
    shell("Проверка заявки", 1, summaryHtml() + `<div class="card"><p class="hint" id="gen">Формирую бланк…</p><div class="pages" id="pages"></div></div>`,
      `<button class="btn" data-a="send" disabled id="sendBtn">Отправить в снабжение</button><button class="btn sec" data-a="download">Скачать PDF</button><button class="btn ghost" data-a="${isSimple() ? "back" : "hub"}">${isSimple() ? "Изменить ответы" : "Назад к разделам"}</button>`);
    try {
      const full = exportOrder();
      const canv = await PDFGEN.buildPages(full);
      pdfCache = { blob: PDFGEN.makePdf(canv, full.address), name: fileName() };
      const box = document.getElementById("pages"); if (!box) return;
      box.innerHTML = canv.map(c => `<img alt="Страница бланка" src="${c.toDataURL("image/jpeg", 0.6)}">`).join("");
      document.getElementById("gen").textContent = `Страниц: ${canv.length}. Проверьте и отправьте.`;
      document.getElementById("sendBtn").disabled = false;
    } catch (e) { const g = document.getElementById("gen"); if (g) g.textContent = "Не удалось сформировать бланк: " + e.message; }
  }
  const KIND_NAME = { dl: "Двери и люки", win: "Окна", frame: "Обрамления" };
  const kindName = () => KIND_NAME[order.kind] || KIND_NAME.frame;
  function exportOrder() {
    const stamp = dateLong(new Date(), true);
    if (order.kind === "win") return { kind: "win", stamp, address: order.address, contact: order.contact, worker: acc.name || "", items: winItems() };
    if (order.kind === "dl") return { kind: "dl", stamp, address: order.address, contact: order.contact, worker: acc.name || "", items: dlItems() };
    const o = { stamp, address: order.address, contact: order.contact, scheme: order.scheme, stops: order.stops, dsh_same: same(), common: order.common,
      thresholds: order.thresholds, nashchelnik: order.nashchelnik, cable: order.cable, openings: [] };
    const n = order.stops || 0;
    for (let f = 1; f <= n; f++) {
      const src = order.ops[same() ? 1 : f] || {};
      o.openings.push(Object.assign({ floor: f, width: order.width, C: order.C }, src));
    }
    return o;
  }
  function fileName() {
    const a = (order.address || "Заявка").replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Заявка";
    return kindName() + " - " + a + ".pdf";
  }
  async function share() {
    if (!pdfCache) return;
    const file = new File([pdfCache.blob], pdfCache.name, { type: "application/pdf" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: order.address, text: "Заявка: " + order.address });
        return showDone("sent");
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    download(); showDone("saved");
  }
  function download() {
    if (!pdfCache) return;
    const u = URL.createObjectURL(pdfCache.blob), a = document.createElement("a");
    a.href = u; a.download = pdfCache.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  }

  function loginView() {
    shell("Вход", null, `<div class="card"><h2 class="q">Вход через Telegram</h2><p class="hint">Приложение откроет Telegram. Нажмите там «Запустить» (Start), затем вернитесь сюда. Доступ открывает администратор: если вы входите впервые, ему уйдёт запрос, и бот напишет вам, когда доступ откроют.</p>${loginWait ? `<p class="hint">Ждём подтверждения в Telegram…</p><a class="btn" style="text-decoration:none" href="${esc(loginWait)}">Открыть Telegram</a>` : ""}<p class="err">${esc(loginErr)}</p></div>`,
      loginWait ? "" : `<button class="btn" data-a="dologin">Войти через Telegram</button>`, { menu: false });
  }
  function nocreditsView() {
    shell("Замеры закончились", null, `<div class="card"><h2 class="q">Замеры закончились</h2><p class="hint">Чтобы продолжить, пополните баланс: напишите администратору${CFG.contact ? " (" + esc(CFG.contact) + ")" : ""} и назовите ваш номер: <b>${esc(acc.id)}</b>.</p><p class="hint">Заявка сохранена, после пополнения её можно отправить.</p></div>`,
      `<button class="btn" data-a="back2">Назад к заявке</button>`, { menu: false });
  }
  function schemeSvg(k) {
    const A = k === "А";
    const side = (x, y, h, lab) => `<rect class="pc side" x="${x}" y="${y}" width="22" height="${h}" rx="2"/><text class="tl" transform="translate(${x + 14.5} ${y + h / 2}) rotate(-90)" text-anchor="middle">${lab}</text>`;
    const top = A ? `<rect class="pc top" x="40" y="30" width="120" height="26" rx="2"/><text class="tl" x="100" y="46.5" text-anchor="middle">верхнее</text>`
                  : `<rect class="pc top" x="62" y="30" width="76" height="26" rx="2"/><text class="tl" x="100" y="46.5" text-anchor="middle">верхнее</text>`;
    const sides = A ? side(40, 56, 114, "левое") + side(138, 56, 114, "правое") : side(40, 30, 140, "левое") + side(138, 30, 140, "правое");
    const bottom = A ? 170 : 170;
    return `<svg class="schsvg" viewBox="0 0 200 196" aria-hidden="true"><defs><marker id="ar${k === "А" ? "a" : "b"}" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L6 3L0 6z" class="mk"/></marker></defs>
      <rect x="62" y="30" width="76" height="140" class="gap"/>${sides}${top}
${A ? `<line x1="22" y1="30" x2="22" y2="56" class="dm" marker-start="url(#ar${k === "А" ? "a" : "b"})" marker-end="url(#ar${k === "А" ? "a" : "b"})"/><text class="dt" x="14" y="46" text-anchor="middle">A</text>` : ""}
      <line x1="182" y1="${A ? 56 : 30}" x2="182" y2="170" class="dm" marker-start="url(#ar${k === "А" ? "a" : "b"})" marker-end="url(#ar${k === "А" ? "a" : "b"})"/><text class="dt" x="192" y="${A ? 113 : 100}" text-anchor="middle">C</text>
      ${A ? `<line x1="14" y1="30" x2="46" y2="30" class="ex"/><line x1="14" y1="56" x2="46" y2="56" class="ex"/>` : ""}<line x1="164" y1="${A ? 56 : 30}" x2="190" y2="${A ? 56 : 30}" class="ex"/><line x1="164" y1="170" x2="190" y2="170" class="ex"/>
      <line x1="30" y1="${bottom}" x2="170" y2="${bottom}" class="floor"/></svg>`;
  }
  function showDone(kind) { doneKind = kind; view = "done"; save(); render(); }
  let doneKind = "sent";
  function doneView() {
    const sent = doneKind === "sent";
    $app.innerHTML = `<main style="padding-top:max(40px,env(safe-area-inset-top))"><div class="donebox"><div class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></div>
      <h2>${sent ? "Заявка отправлена" : "Файл сохранён"}</h2>
      <p>${sent ? "Спасибо за работу! Снабжение получит ваш бланк." : "Отправьте файл снабжению из папки «Загрузки» на телефоне."}</p>
      <div class="chip">${esc(pdfCache ? pdfCache.name : "")}</div></div></main>
      <footer class="act"><button class="btn" data-a="finish">На главный экран</button><button class="btn ghost" data-a="backrev">Вернуться к заявке</button></footer>`;
  }
  function menuView() {
    shell("Меню", null, `<div class="card">${LIM && acc.session ? `<div class="sum"><span><b>${esc(acc.name || "Аккаунт")}</b> (номер ${esc(acc.id)})</span><span>Осталось замеров: ${left()}</span></div>` : ""}<button class="btn sec" data-a="home">На главный экран</button><button class="btn sec" data-a="close">Вернуться к заявке</button><button class="btn sec" data-a="install">Инструкция по установке</button><button class="btn sec" data-a="refresh">Обновить приложение</button><button class="btn sec danger" data-a="new">Начать новую заявку</button>${LIM && acc.session ? `<button class="btn sec" data-a="logout">Выйти из аккаунта</button>` : ""}</div>`, "", { menu: false });
  }

  /* ---------- диспетчер ---------- */
  function render() {
    if (view === "home") return homeView();
    if (view === "menu") return menuView();
    if (view === "done") return doneView();
    if (view === "soon") return soonView();
    if (view === "login") return loginView();
    if (view === "nocredits") return nocreditsView();
    if (view === "review") return reviewView();
    if (sub) return subView();
    if (view === "hub") return hubView();
    return wizardView();
  }
  function act(a) {
    if (a === "next") { if (sub) return subNext(); const l = buildList(), s = l[pos]; return advance(s, readValue(s)); }
    if (a === "back") {
      if (view === "soon") { view = "home"; return render(); }
      if (sub) { if (sub.i > 0) sub.i--; else sub = null; return render(); }
      if (view === "hub") { view = "wizard"; pos = buildList().length - 1; }
      else if (view === "review") { if (isSimple()) { view = "wizard"; pos = buildList().length - 1; } else view = "hub"; }
      else if (pos > 0) pos--; else view = "home";
      wizardView.err = ""; save(); return render();
    }
    if (a === "refresh") {
      toast("Обновляю…");
      const done = () => location.reload();
      Promise.all([caches ? caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))) : 0,
        navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))) : 0]).then(done, done);
      return;
    }
    if (a === "theme") {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const t = dark ? "light" : "dark"; document.documentElement.dataset.theme = t;
      try { localStorage.setItem("zamer_theme", t); } catch (e) {}
      return toast(t === "dark" ? "Тёмная тема" : "Светлая тема");
    }
    if (a === "finish") { order = fresh(); pos = 0; sub = null; pdfCache = null; view = "home"; save(); return render(); }
    if (a === "backrev") { view = "review"; save(); return render(); }
    if (a === "login" || a === "dologin") return startLogin();
    if (a === "mail") {
      const E = "stroyliftkompleks@yandex.ru", o = document.createElement("div"); o.className = "sheet";
      o.innerHTML = `<div class="sheetbox" role="dialog" aria-modal="true"><h3>Предложения по работе приложения</h3><p>Пишите на почту, будем рады любым идеям и замечаниям:</p><div class="mailaddr">${E}</div><a class="btn" href="mailto:${E}?subject=Предложение по приложению «Замер ДШ»">Написать письмо</a><button class="btn sec" data-copy="${E}">Скопировать адрес</button><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`;
      o.addEventListener("click", ev => {
        const c = ev.target.closest("[data-copy]");
        if (c) { (navigator.clipboard ? navigator.clipboard.writeText(E) : Promise.reject()).then(() => { c.textContent = "Адрес скопирован ✓"; }, () => { c.textContent = E; }); return; }
        if (ev.target === o || ev.target.closest("[data-a=mailclose]")) o.remove();
      });
      document.body.appendChild(o); return;
    }
    if (a === "sec_win") return newOrder("win");
    if (a === "sec_claim") { soonView.what = "claim"; view = "soon"; return render(); }
    if (a === "sec_door") return newOrder("dl");
    if (a === "sec_frame") return newOrder("frame");
    if (a === "home") { view = "home"; return render(); }
    if (a === "back2") { view = "review"; return render(); }
    if (a === "logout") { if (!confirm("Выйти из аккаунта? Неотправленные замеры на телефоне будут возвращены на баланс при следующем входе.")) return; api("/api/release", { tickets: acc.tickets }).catch(() => {}); acc = { session: "", id: "", name: "", credits: null, tickets: [], redeem: acc.redeem }; saveAcc(); view = "home"; return render(); }
    if (a === "new") {
      if (hasDraft() && !confirm("Начать новую заявку? Текущие ответы будут удалены.")) return;
      order = fresh(); pos = 0; sub = null; pdfCache = null; view = "home"; save(); return render();
    }
    if (a === "install") {
      const o = document.createElement("div"); o.className = "sheet";
      o.innerHTML = `<div class="sheetbox scroll" role="dialog" aria-modal="true"><h3>Установка на рабочий стол</h3>
        <div class="inst"><b>Android (Chrome)</b><ol><li>Откройте приложение в браузере Chrome.</li><li>Нажмите значок меню (три вертикальные точки) справа вверху.</li><li>Выберите «Установить приложение» или «Добавить на главный экран».</li><li>Нажмите «Установить» и подтвердите.</li></ol></div>
        <div class="inst"><b>iPhone (Safari)</b><ol><li>Откройте приложение в браузере Safari (в других браузерах не получится).</li><li>Нажмите «Поделиться» (квадрат со стрелкой вверх) внизу экрана.</li><li>Прокрутите вниз и выберите «На экран “Домой”».</li><li>Нажмите «Добавить» справа вверху.</li></ol></div>
        <p>После этого значок «Замер ДШ» появится на рабочем столе, и приложение будет открываться на весь экран.</p><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`;
      o.addEventListener("click", ev => { if (ev.target === o || ev.target.closest("[data-a=mailclose]")) o.remove(); });
      document.body.appendChild(o); return;
    }
    if (a === "resume") { view = "wizard"; const n = buildList().length; if (pos >= n) view = isSimple() ? "review" : (order.stops ? "hub" : "wizard"); return render(); }
    if (a === "menu") { menuReturn = view; view = "menu"; return render(); }
    if (a === "close") { view = menuReturn === "menu" ? "home" : menuReturn; return render(); }
    if (a === "review") { view = "review"; save(); return render(); }
    if (a === "hub") { view = "hub"; return render(); }
    if (a === "send") { if (LIM && !order.paid && !acc.tickets.length) return charge().then(ok => ok && share()); if (!LIM || order.paid || acc.tickets.length) { charge(); return share(); } return; }
    if (a === "download") { if (LIM && !order.paid && !acc.tickets.length) return charge().then(ok => { if (ok) { download(); toast("Файл сохранён"); } }); charge(); download(); return toast("Файл сохранён"); }
    if (a === "copyprev" && order.kind === "win") {
      const l0 = buildList(), i = l0[pos].win;
      order.win = order.win || {}; order.win[i] = JSON.parse(JSON.stringify(order.win[i - 1] || {}));
      const nl = buildList(); const k = nl.findIndex(x => x.win === i && x.qtyStep); pos = k < 0 ? nl.length : k; save(); return render();
    }
    if (a === "copyprev" && order.kind === "dl") {
      const l = buildList(), s = l[pos], e = s.ent;
      order.ent[e] = JSON.parse(JSON.stringify(order.ent[e - 1] || {}));
      const nl = buildList(); let k = nl.findIndex(x => x.ent > e); pos = k < 0 ? nl.length : k; save(); return render();
    }
    if (a === "copyprev") {
      const l = buildList(), s = l[pos], f = s.floor; order.ops[f] = Object.assign({}, order.ops[f - 1]);
      pos += OPEN.length + 1; save(); return render();
    }
  }
  let menuReturn = "home";
  $app.addEventListener("click", e => {
    const cs = e.target.closest("[data-cas]");
    if (cs) {
      const s = buildList()[pos]; if (!s || (s.t !== "casing" && !s.casP)) return;
      const cp = s.casP || s.p;
      const cur = Object.assign({ l: true, t: true, r: true }, getP(order, cp) || {}); cur[cs.dataset.cas] = !cur[cs.dataset.cas];
      setP(order, cp, cur); save();
      if (s.casP) { const g = cs.closest("g[data-cas]") || cs, on = cur[cs.dataset.cas]; g.classList.toggle("on", on); const t = g.querySelector("text"); if (t) t.textContent = on ? "✓" : "+"; return; }
      return render();
    }
    const b = e.target.closest("button"); if (!b) return;
    try { if (!b.matches(".ghost,.ib")) { const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2, sp = document.createElement("span"); sp.className = "rip"; sp.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`; b.appendChild(sp); setTimeout(() => sp.remove(), 650); } } catch (x) {}
    if (b.dataset.ins) { const i = document.getElementById("inp"); if (i) { const a = i.selectionStart == null ? i.value.length : i.selectionStart, z = i.selectionEnd == null ? a : i.selectionEnd; i.value = i.value.slice(0, a) + b.dataset.ins + i.value.slice(z); i.focus(); try { i.setSelectionRange(a + 1, a + 1); } catch (x) {} } return; }
    if (b.dataset.seg) { const [p, v] = b.dataset.seg.split("|"); setP(order, p, v); if (/\.hinge$/.test(p)) { save(); const ls = buildList()[pos]; if (ls && ls.pic === "door") { document.querySelectorAll(".pic .hd").forEach(c => c.setAttribute("cx", v === "Справа" ? 106 : 162)); document.querySelectorAll(".pic .hgL").forEach(g => { g.style.display = v === "Справа" ? "none" : ""; }); document.querySelectorAll(".pic .hgR").forEach(g => { g.style.display = v === "Справа" ? "" : "none"; }); } else return render(); } b.parentNode.querySelectorAll("button").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); }); save(); return; }
    if (b.dataset.tg) { const v = getP(order, b.dataset.tg) === "Да" ? "Нет" : "Да"; setP(order, b.dataset.tg, v); b.classList.toggle("on", v === "Да"); b.setAttribute("aria-checked", v === "Да"); save(); return; }
    if (b.dataset.q) { const i = document.getElementById("inp"); if (i) { i.value = b.dataset.q; return act("next"); } }
    if (b.dataset.a) return act(b.dataset.a);
    if (b.dataset.pick !== undefined) {
      const l = buildList(), s = l[pos];
      if (s.t === "color") { setP(order, s.p, b.dataset.pick); const inp = document.getElementById("inp"); if (inp) inp.value = ""; return advance(s, b.dataset.pick); }
      setP(order, s.p, b.dataset.pick);
      if (s.sash === "type") { save(); return render(); }
      if (s.t === "scheme") { document.querySelectorAll(".sch").forEach(x => x.classList.toggle("on", x === b)); save(); return; }
      b.parentNode.querySelectorAll(".choice,.sch").forEach(x => x.classList.toggle("on", x === b));
      save(); return setTimeout(() => advance(s, b.dataset.pick), 160);
    }
    if (b.dataset.add) { const d = SUB[b.dataset.add]; sub = { d, key: b.dataset.add, i: 0, vals: {}, err: "" }; return render(); }
    if (b.dataset.del) { const [k, i] = b.dataset.del.split(":"); if (SUB[k].cable) delete order.cable[k]; else order[SUB[k].list].splice(+i, 1); save(); return render(); }
  });
  $app.addEventListener("keydown", e => { const g = e.target.closest && e.target.closest("g[data-cas]"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); g.dispatchEvent(new MouseEvent("click", { bubbles: true })); } });
  window.addEventListener("popstate", () => {});
  try {
    const lg = JSON.parse(localStorage.getItem("zamer_login") || "null");
    if (LIM && !acc.session && lg && Date.now() - lg.t < 600000) { view = "login"; loginWait = lg.url; pollLogin(lg.token); }
  } catch (e) {}
  syncAcc();
  window.addEventListener("online", syncAcc);
  if ("serviceWorker" in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && view !== "wizard" && view !== "hub" && !sub) location.reload(); });
    navigator.serviceWorker.register("sw.js").then(r => r.update()).catch(() => {});
  }
  render();
})();
