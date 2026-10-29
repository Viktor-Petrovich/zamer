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
      if (s.length < 2 || s.length > 40) return { e: "Выберите цвет: RAL 7035 или RAL 7038" };
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
    { p: "form.tablo", t: "form", sec: "Общие параметры", q: "Табло индикации", hint: "Спрашиваем один раз на всю заявку.", finish: o => { o.common.ind_floor = o.common.ind_on === "Нет" ? "Нет табло" : (o.common.ind_where || "На всех этажах"); },
      fields: [{ k: "tgl", p: "common.ind_on", label: "Есть табло", def: "Да" }, { k: "seg", p: "common.ind_where", label: "Где", opts: [["Только 1 этаж", "Только на 1 этаже"], ["Все этажи", "На всех этажах"]], def: "На всех этажах", when: o => o.common.ind_on !== "Нет" },
        { k: "dims2", p: "common.ind_size", label: "Размер отверстия под табло", ph: ["80", "120"], when: o => o.common.ind_on !== "Нет" }] },
    { p: "form.bend", t: "form", sec: "Общие параметры", q: "Размеры с учётом загиба или без учёта загиба?", hint: "Выберите, как указаны размеры обрамлений, и укажите размер загиба.",
      fields: [{ k: "seg", p: "common.bend_mode", label: "Размеры", opts: [["С загибом", "С учётом загиба"], ["Без загиба", "Без учёта загиба"]], def: "С учётом загиба" }, { k: "num", p: "common.bend", label: "Размер загиба", unit: mm, max: 500, min: 0 }] },
    { p: "form.btn", t: "form", sec: "Кнопка вызова", q: "Кнопка вызова", hint: "Всё про кнопку вызова на одном экране.",
      fields: [{ k: "seg", p: "common.btn_all", label: "Ставится", opts: [["На всех этажах", "На всех этажах"], ["Не на всех", "Не на всех этажах"]], def: "На всех этажах" },
        { k: "floors", p: "common.btn_floors", label: "На каких этажах", ph: "1, 3, 5-7", when: o => o.common.btn_all === "Не на всех этажах" },
        { k: "seg", p: "common.btn_side", label: "Сторона", opts: [["Слева", "Слева"], ["Справа", "Справа"]], def: "Слева" },
        { k: "num", p: "common.btn_height", label: "От пола до центра отверстия", unit: mm },
        { k: "dims2", p: "common.btn_size", label: "Размер отверстия под кнопку", ph: ["30", "30"] }] },
    { p: "common.color", t: "color", sec: "Общие параметры", q: "Цвет окраски", hint: "RAL 7035 применяется стандартно." },
    { p: "form.shaft", t: "form", sec: "Обрамление ДШ", q: "Лифт и обрамления", hint: "Остановки, общие размеры и как вводить обрамления: одинаковые на всех этажах или по каждому отдельно.", finish: o => { o.ops = o.ops || {}; },
      fields: [{ k: "int", p: "stops", label: "Количество остановок (этажей)", unit: "шт.", min: 1, max: 100 }, { k: "num", p: "width", label: "Ширина проёма", unit: mm }, { k: "num", p: "C", label: "Размер С (высота вертикального обрамления)", unit: mm },
        { k: "seg", p: "dsh_same", label: "Размеры на этажах", opts: [["Одинаковые", "Одинаковые на всех этажах"], ["По этажам", "Индивидуально по этажам"]], def: "Одинаковые на всех этажах" }] }
  ];
  const OPEN = [
    ["top", "Верхнее обрамление", "А — высота, Н — глубина верхнего обрамления.", [["top_A", "Размер А (высота)"], ["top_H", "Размер Н (глубина)"]]],
    ["left", "Левое боковое обрамление", "Н — глубина, В — ширина бокового обрамления.", [["left_H", "Размер Н (глубина)"], ["left_B", "Размер В (ширина)"]]],
    ["right", "Правое боковое обрамление", "Н — глубина, В — ширина бокового обрамления.", [["right_H", "Размер Н (глубина)"], ["right_B", "Размер В (ширина)"]]]
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
  function sectionPic() {
    return `<svg class="pic" viewBox="0 0 300 244" role="img" aria-label="Сечение I-I">${PDEF}
      <text x="190" y="14" text-anchor="middle" class="dl" style="fill:currentColor;font-size:12px">I – I</text><line x1="174" y1="18" x2="206" y2="18" stroke="currentColor" stroke-width="1.2"/>
      <rect x="150" y="62" width="122" height="66" fill="#e3eef7"/><rect x="150" y="62" width="122" height="66" fill="url(#hp2)"/><rect x="150" y="62" width="122" height="66" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M146 26 H130 V62 H150" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><text x="152" y="34" class="flo" style="font-size:12px">Рамка двери</text>
      <path d="M112 26 H120 V182 H188 V134 H196 V190 H112 Z" class="prof"/>
      <line x1="76" y1="26" x2="110" y2="26" stroke="var(--muted)" stroke-width=".8"/><line x1="76" y1="190" x2="110" y2="190" stroke="var(--muted)" stroke-width=".8"/>
      ${dimA(88, 26, 88, 190, 76, 112, "Н", 1)}
      <line x1="112" y1="194" x2="112" y2="222" stroke="var(--muted)" stroke-width=".8"/><line x1="196" y1="194" x2="196" y2="222" stroke="var(--muted)" stroke-width=".8"/>
      ${dimA(112, 216, 196, 216, 154, 236, "В")}</svg>`;
  }
  function bortPic() {
    return `<svg class="pic bort" viewBox="0 0 300 200" role="img" aria-label="Бортик">
      <path d="M70 70 L170 70 L170 150 L70 150 Z" class="bf2"/><path d="M170 70 L230 40 L230 120 L170 150 Z" class="bs2"/><path d="M70 70 L130 40 L230 40 L170 70 Z" class="bt2"/>
      <path d="M130 40 L130 52 L222 52" fill="none" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 3"/>
      <line x1="52" y1="70" x2="52" y2="150" stroke="var(--accent)" stroke-width="1.4"/><path d="M48 76 L52 68 L56 76 M48 144 L52 152 L56 144" fill="none" stroke="var(--accent)" stroke-width="1.4"/>
      <text x="40" y="115" text-anchor="middle" class="dl">h</text>
      <line x1="70" y1="170" x2="170" y2="170" stroke="var(--accent)" stroke-width="1.4"/><path d="M78 166 L68 170 L78 174 M162 166 L172 170 L162 174" fill="none" stroke="var(--accent)" stroke-width="1.4"/>
      <text x="120" y="188" text-anchor="middle" class="dl">w</text>
      <line x1="180" y1="162" x2="240" y2="132" stroke="var(--accent)" stroke-width="1.4"/><path d="M184 154 L178 163 L188 163 M236 140 L242 131 L232 131" fill="none" stroke="var(--accent)" stroke-width="1.4"/>
      <text x="224" y="152" text-anchor="middle" class="dl">l</text></svg>`;
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
    ];
    const N = Math.max(1, order.wins || 1);
    for (let i = 1; i <= N; i++) {
      const sec = N > 1 ? `Окно ${i} из ${N}` : "Окно", pk = `win.${i}`;
      l.push({ p: `${pk}.pair`, t: "pair", pic: "win", pk, min: 100, unit: mm, sec, win: i, first: true, q: "Оконный проём", hint: "Размер окна посчитаем сами: слева, сверху и справа минус 20 мм, т.е. высота минус 20, ширина минус 40.", pair: [[`${pk}.h`, "Высота проёма"], [`${pk}.w`, "Ширина проёма"]] });
      l.push({ p: `${pk}.kind`, t: "choice", sash: "type", pk, sec, q: "Как открывается створка?", hint: "Вид изнутри помещения. Выберите тип, сторону петель и нужен ли отлив.", ch: Object.keys(WK) });
      const k = WK[getP(order, `${pk}.kind`)];
      if (!getP(order, `${pk}.ebb.need`)) setP(order, `${pk}.ebb.need`, "Нет");
      if (!getP(order, `${pk}.hinge`)) setP(order, `${pk}.hinge`, "Слева");
      if (!getP(order, `${pk}.ebb.need`)) setP(order, `${pk}.ebb.need`, "Нет");
      if (getP(order, `${pk}.ebb.need`) === "Да") {
        l.push({ p: `${pk}.ebb.pair`, t: "pair", unit: mm, sec, q: "Размеры отлива", hint: "Введите длину и ширину отлива.", pair: [[`${pk}.ebb.l`, "Длина"], [`${pk}.ebb.w`, "Ширина"]] });
      }
      l.push({ p: `${pk}.qty`, t: "int", min: 1, max: 999, unit: "шт.", quick: 1, sec, win: i, qtyStep: true, q: "Количество таких окон", hint: "Отлив тоже считается на каждое такое окно." });
      l.push({ p: `${pk}.more`, t: "choice", sec, win: i, more: true, q: "Есть ещё окна?", hint: "Если в заявке окна другого размера или с другим открыванием, добавьте ещё одно.", ch: ["Добавить ещё окно", "Нет, это все окна"] });
    }
    return l;
  }
  function winItems() {
    return Array.from({ length: Math.max(1, order.wins || 1) }, (_, i) => {
      const d = (order.win && order.win[i + 1]) || {}, k = WK[d.kind] || "gl";
      return { n: i + 1, h: d.h, w: d.w, kind: k, kindName: d.kind, hinge: k === "tr" || k === "tt" ? (d.hinge === "Справа" ? "Справа" : "Слева") : "", qty: d.qty, ebb: d.ebb && d.ebb.need === "Да" ? { l: d.ebb.l, w: d.ebb.w } : null };
    });
  }
  function winSummaryHtml() {
    const head = [["Адрес", order.address], ["Контакт", order.contact], ["Окон (видов)", Math.max(1, order.wins || 1)]];
    const part = it => `<div class="card"><div class="sum"><span><b>Окно ${it.n}</b></span><span>Проём ${it.h}×${it.w} мм → окно <b>${it.h - 20}×${it.w - 40}</b> мм</span><span>${esc(it.kindName || "")}${it.hinge ? ", петли " + esc(it.hinge.toLowerCase()) : ""}</span><span>Отлив: ${it.ebb ? `${it.ebb.l}×${it.ebb.w} мм` : "не требуется"}</span><span>${it.qty} шт.</span></div></div>`;
    return `<div class="card"><div class="sum">${head.map(([a, b]) => `<span><b>${a}:</b> ${esc(b)}</span>`).join("")}</div></div>` + winItems().map(part).join("");
  }
  const isSimple = () => order.kind === "dl" || order.kind === "win";
  function newOrder(kind) {
    if (LIM && !acc.session) { view = "home"; return render(); }
    if (hasDraft() && !confirm("Начать новую заявку? Текущие ответы будут удалены.")) return;
    order = fresh(); order.kind = kind; pos = 0; view = "wizard"; sub = null; save(); render();
  }
  function ensureForms() {
    order.common = order.common || {};
    const c = order.common;
    if (c.ind_on === undefined) c.ind_on = c.ind_floor ? (c.ind_floor === "Нет табло" ? "Нет" : "Да") : "Да";
    if (c.ind_where === undefined && c.ind_floor && c.ind_floor !== "Нет табло") c.ind_where = c.ind_floor;
    SETUP.forEach(st => { if (st.t === "form") st.fields.forEach(f => { if ((f.k === "seg" || f.k === "tgl") && getP(order, f.p) === undefined) setP(order, f.p, f.def); }); });
  }
  function buildList() {
    if (order.kind === "dl") return buildListDL();
    if (order.kind === "win") return buildListWin();
    ensureForms();
    const l = SETUP.filter(s => !s.when || s.when(order));
    const floors = same() ? [1] : Array.from({ length: order.stops || 0 }, (_, i) => i + 1);
    floors.forEach(f => {
      const sec = same() ? "Обрамление, все этажи" : `Этаж ${f} из ${order.stops}`;
      OPEN.forEach(([k, q, h, pr], i) => l.push({ p: `ops.${f}.${k}.pair`, t: "pair", min: 1, unit: mm, sec, q, hint: h + " В миллиметрах.", pic: k === "top" ? "" : "section", floor: f, first: i === 0, pair: pr.map(([key, lab]) => [`ops.${f}.${key}`, lab]) }));
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
    cv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/></svg>',
    work: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 12l2 2 4-4M8.5 17h7"/></svg>',
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
  const tile = (a, ic, title, sub, soon) => `<button class="tile${soon ? " soon" : ""}" data-a="${a}"><span class="ti">${SECT_ICON[ic]}</span><span class="tt"><b>${title}</b><small>${sub}</small></span>${soon ? `<em>в разработке</em>` : `<span class="go">›</span>`}</button>`;
  let cvData = (() => { try { return JSON.parse(localStorage.getItem("zamer_cv")) || {}; } catch (e) { return {}; } })();
  const REGIONS = ["Республика Адыгея","Республика Алтай","Республика Башкортостан","Республика Бурятия","Республика Дагестан","Республика Ингушетия","Кабардино-Балкарская Республика","Республика Калмыкия","Карачаево-Черкесская Республика","Республика Карелия","Республика Коми","Республика Крым","Республика Марий Эл","Республика Мордовия","Республика Саха (Якутия)","Республика Северная Осетия — Алания","Республика Татарстан","Республика Тыва","Удмуртская Республика","Республика Хакасия","Чеченская Республика","Чувашская Республика","Алтайский край","Забайкальский край","Камчатский край","Краснодарский край","Красноярский край","Пермский край","Приморский край","Ставропольский край","Хабаровский край","Амурская область","Архангельская область","Астраханская область","Белгородская область","Брянская область","Владимирская область","Волгоградская область","Вологодская область","Воронежская область","Ивановская область","Иркутская область","Калининградская область","Калужская область","Кемеровская область","Кировская область","Костромская область","Курганская область","Курская область","Ленинградская область","Липецкая область","Магаданская область","Московская область","Мурманская область","Нижегородская область","Новгородская область","Новосибирская область","Омская область","Оренбургская область","Орловская область","Пензенская область","Псковская область","Ростовская область","Рязанская область","Самарская область","Саратовская область","Сахалинская область","Свердловская область","Смоленская область","Тамбовская область","Тверская область","Томская область","Тульская область","Тюменская область","Ульяновская область","Челябинская область","Ярославская область","Москва","Санкт-Петербург","Севастополь","Еврейская автономная область","Ненецкий АО","Ханты-Мансийский АО","Чукотский АО","Ямало-Ненецкий АО","Донецкая Народная Республика","Луганская Народная Республика","Запорожская область","Херсонская область"];
  const CV_SKILLS = ["Монтаж механики", "Электромонтаж", "Наладка"];
  function cvView() {
    const d = cvData, inp = (id, lab, val, extra = "") => `<label class="plab">${lab}</label><div class="field"><input id="${id}" value="${esc(val || "")}" autocomplete="off" ${extra}></div>`;
    shell("Работа монтажником", null, `<div class="card"><span class="chip">Анкета · резюме</span><h2 class="q">Расскажите о себе</h2><p class="hint">Заполните анкету, и мы получим её на почту stroyliftkompleks@yandex.ru. Вопросы только по делу.</p>
      <div class="form">
      ${inp("cv_name", "Фамилия, имя, отчество", d.name, 'autocapitalize="words"')}
      ${inp("cv_phone", "Телефон", d.phone, 'inputmode="tel" placeholder="+7 900 123-45-67"')}
      ${inp("cv_region", "Регион России, где живёте", d.region, 'list="cv_regs"')}<datalist id="cv_regs">${REGIONS.map(r => `<option value="${esc(r)}">`).join("")}</datalist>
      ${inp("cv_last", "Где работали последнее время", d.last, 'placeholder="Компания или «самозанятый»"')}
      ${inp("cv_exp", "Стаж монтажа лифтов, лет", d.exp, 'inputmode="decimal" placeholder="Например, 5"')}
      ${inp("cv_inn", "ИНН (самозанятый, ИП или организация)", d.inn, 'inputmode="numeric" maxlength="12" placeholder="12 цифр"')}
      <label class="plab">Что умеете делать</label><div class="suppseg">${CV_SKILLS.map(k => `<button type="button" class="${(d.skills || []).includes(k) ? "on" : ""}" data-cvs="${k}">${k}</button>`).join("")}</div>
      <button type="button" class="tgl${d.trip === "Да" ? " on" : ""}" role="switch" aria-checked="${d.trip === "Да"}" data-cvtg="1"><span>Готов к командировкам</span><i class="sw2"><b></b></i></button>
      </div><p class="err" id="err">${esc(d.err || "")}</p></div>`,
      `<button class="btn" data-a="cv_send">Отправить анкету</button><button class="btn ghost" data-a="home">На главный экран</button>`, { menu: false });
  }
  function measView() {
    shell("Замеры", null, `<div class="tiles">
        ${tile("sec_frame", "frame", "Замер обрамлений", "Двери шахты, пороги, нащельник, бортики", false)}
        ${tile("sec_door", "door", "Замер дверей и люков", "Машинное помещение лифта", false)}
        ${tile("sec_win", "win", "Замер окон", "Проём, петли, схема открывания, отлив", false)}</div>`, `<button class="btn ghost" data-a="home">На главный экран</button>`, { menu: false });
  }
  function jobsView() {
    shell("Работа", null, `<div class="tiles">
        ${tile("sec_work", "work", "% выполнения работ по замене лифта", "Тестовая функция · отчёт монтажника о проделанной работе", false)}
        ${tile("sec_claim", "claim", "Составление рекламации", "Поломка, недопоставка, пропажа", false)}</div>`, `<button class="btn ghost" data-a="home">На главный экран</button>`, { menu: false });
  }
  function homeView() {
    $app.innerHTML = `<main style="padding-top:max(24px,env(safe-area-inset-top))">
      <div class="hello"><button class="logob" data-a="theme" aria-label="Сменить тему"><img src="icon-192.png" alt=""></button><div><h2>${esc(greeting())}</h2><p>Выберите, что будем измерять сегодня</p></div><button class="ib hmenu" data-a="menu" aria-label="Меню">${ICON.menu}</button></div>
      <p class="hint" style="margin:-4px 0 0 2px">${esc(dateLong())}</p>
      ${LIM && acc.session ? `<div class="chip" style="justify-self:start">Осталось замеров: ${left()}</div>` : ""}
      ${hasDraft() && !(LIM && !acc.session) ? `<button class="tile cont" data-a="resume"><span class="ti">${SECT_ICON.frame}</span><span class="tt"><b>Продолжить заявку</b><small>${order.kind === "dl" ? "Двери и люки" : order.kind === "win" ? "Окна" : "Обрамления"} · ${esc((order.address || "").slice(0, 32))}</small></span><span class="go">›</span></button>` : ""}
      <div class="tiles">
        ${tile("m_meas", "frame", "Замеры", "Обрамления, двери и люки, окна", false)}
        ${tile("m_jobs", "work", "Работа", "% выполнения работ, рекламации", false)}
      </div>
      <div class="card tips"><div class="sum"><span>✓ Работает без интернета</span><span>✓ Ответы сохраняются на телефоне</span><span>✓ Готовый бланк PDF в один клик</span></div></div>
      <p class="credit">Разработано отделом<br><b>информационных технологий</b><br><button class="co" data-a="mail">СтройЛифтКомплекс</button></p>
    </main>${LIM && !acc.session ? `<footer class="act"><button class="btn" data-a="login">Войти через Telegram</button></footer>` : ""}`;
  }
  function workView() {
    shell("% выполнения работ по замене лифта", null, `<div class="card"><span class="chip">Тестовая функция · начало работ</span><h2 class="q">Остановка лифта</h2><p class="hint">Лифт остановлен, питание снято, вывешена табличка «Не включать, работают люди»?</p><div class="tgls"><button class="btn" data-a="work_yes">Да, лифт остановлен</button><button class="btn sec" data-a="work_no">Ещё нет</button></div></div>`, `<button class="btn ghost" data-a="home">На главный экран</button>`, { menu: false });
  }
  const CLAIMS = { claim_electric: "Электронная поломка", claim_short: "Недопоставка", claim_stolen: "Что-то украли" };
  const MSG = { WhatsApp: n => "https://wa.me/" + n, Telegram: n => "https://t.me/+" + n, Viber: n => "viber://chat?number=%2B" + n, Max: () => "https://max.ru", "SMS": n => "sms:+" + n };
  let supply = (() => { try { return JSON.parse(localStorage.getItem("zamer_supply")) || {}; } catch (e) { return {}; } })();
  const digits = v => { let d = String(v || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1); if (d.length === 10) d = "7" + d; return d; };
  function supplyLink() { const d = digits(supply.phone); return supply.app && d.length >= 11 ? MSG[supply.app](d) : ""; }
  function supplyView() {
    const cur = supplyView.app || supply.app || "WhatsApp";
    shell("Связь со снабжением", null, `<div class="card"><span class="chip">Настройки на этом телефоне</span><h2 class="q">Кому отправлять заявки</h2><p class="hint">Выберите мессенджер и укажите телефон снабжения. Настройки сохранятся на телефоне, и на экране заявки появится кнопка «Открыть чат».</p>
      <label class="plab">Мессенджер</label><div class="suppseg" role="radiogroup">${Object.keys(MSG).map(k => `<button type="button" role="radio" aria-checked="${cur === k}" class="${cur === k ? "on" : ""}" data-supp="${k}">${k}</button>`).join("")}</div>
      <label class="plab">Телефон снабжения</label><div class="field"><input id="sphone" inputmode="tel" placeholder="+7 900 123-45-67" value="${esc(supply.phone || "")}" autocomplete="tel"></div><p class="err" id="err">${esc(supplyView.err || "")}</p></div>`,
      `<button class="btn" data-a="supply_save">Сохранить</button><button class="btn ghost" data-a="menu">Назад в меню</button>`, { menu: false });
  }
  function claimView() {
    shell("Составление рекламации", null, `<div class="card"><span class="chip">Причина рекламации</span><h2 class="q">Что случилось?</h2><p class="hint">Выберите вид рекламации.</p><div class="tgls">${Object.entries(CLAIMS).map(([k, v], i) => `<button class="btn sec" data-a="${k}">${i + 1}. ${v}</button>`).join("")}</div></div>`, `<button class="btn ghost" data-a="home">На главный экран</button>`, { menu: false });
  }
  function soonView() {
    if (CLAIMS[soonView.what]) return shell(CLAIMS[soonView.what], null, `<div class="card"><span class="chip">Обратная связь</span><h2 class="q">${CLAIMS[soonView.what]}</h2><p class="hint">Бланк этой рекламации в разработке. Напишите, какие поля и данные добавить в следующей версии, и мы учтём.</p><textarea id="fb" class="fbtext" rows="6" placeholder="Например: номер заказа, фото повреждения, что именно не пришло…">${esc(soonView.fb || "")}</textarea></div>`, `<button class="btn" data-a="fb_send">Отправить предложение</button><button class="btn ghost" data-a="home">На главный экран</button>`, { menu: false });
    const w = soonView.what === "work" ? "% выполнения работ по замене лифта" : soonView.what === "claim" ? "Составление рекламации" : soonView.what === "win" ? "Замер окон" : "Замер дверей и люков";
    shell(w, null, `<div class="card" style="text-align:center;justify-items:center"><div class="soonico">${SECT_ICON[soonView.what === "work" ? "work" : soonView.what === "claim" ? "claim" : soonView.what === "win" ? "win" : "door"]}</div><h2 class="q">Этот раздел в разработке</h2><p class="hint">Мы готовим удобный опросник и бланк заявки. Скоро он появится в приложении, обновление придёт само.</p><p class="hint">А пока можно оформить замер обрамлений.</p></div>`,
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
    else if (s.pic === "section") h += `<div class="secpic">${sectionPic()}</div>`;
    else if (s.pic === "win") h += winPic(WK[getP(order, s.pk + ".kind")], getP(order, s.pk + ".hinge"));
    if (s.pic && s.tg) h += `<div class="tgls">${s.tg.map(tglHtml).join("")}</div>`;
    h += controlBase(s, val);
    if (!s.pic && s.tg && s.t !== "toggles") h += `<div class="tgls" style="margin-top:12px">${s.tg.map(tglHtml).join("")}</div>`;
    return h;
  }
  let formDraft = {};
  const fvis = (s, f) => !f.when || f.when(order);
  const splitDims = v => String(v == null ? "" : v).split("×");
  function snapForm(s) {
    if (!s || s.t !== "form") return;
    s.fields.forEach((f, i) => {
      if (f.k === "num" || f.k === "int" || f.k === "floors") { const e = document.getElementById("f" + i); if (e) formDraft[f.p] = e.value; }
      if (f.k === "dims2") { const a = document.getElementById("f" + i + "a"), b = document.getElementById("f" + i + "b"); if (a && b) formDraft[f.p] = [a.value, b.value]; }
    });
  }
  function formHtml(s) {
    if (formDraft.__s !== s.p) formDraft = { __s: s.p };
    return `<div class="form">` + s.fields.map((f, i) => {
      if (!fvis(s, f)) return "";
      const v = getP(order, f.p);
      if (f.k === "tgl") return tglHtml0(f.p, f.label, v === "Да");
      if (f.k === "seg") return `<div class="tgl segrow"><span>${esc(f.label)}</span><div class="seg" role="radiogroup">${f.opts.map(([lab, val]) => `<button type="button" role="radio" aria-checked="${v === val}" class="${v === val ? "on" : ""}" data-fseg="${esc(f.p)}|${esc(val)}">${esc(lab)}</button>`).join("")}</div></div>`;
      if (f.k === "dims2") {
        const d = formDraft[f.p] || (v ? splitDims(v) : ["", ""]);
        return `<label class="plab">${esc(f.label)}</label><div class="two"><div class="field"><input id="f${i}a" inputmode="decimal" enterkeyhint="next" placeholder="высота" value="${esc(d[0])}"><span class="u">мм</span></div><span class="mul">×</span><div class="field"><input id="f${i}b" inputmode="decimal" enterkeyhint="done" placeholder="ширина" value="${esc(d[1])}"><span class="u">мм</span></div></div>`;
      }
      const raw = formDraft[f.p] !== undefined ? formDraft[f.p] : (v == null ? "" : String(v).replace(".", ","));
      return `<label class="plab">${esc(f.label)}</label><div class="field"><input id="f${i}" inputmode="${f.k === "floors" ? "text" : f.k === "int" ? "numeric" : "decimal"}" enterkeyhint="next" placeholder="${esc(f.ph || "")}" value="${esc(raw)}">${f.unit ? `<span class="u">${f.unit}</span>` : ""}</div>`;
    }).join("") + `</div>`;
  }
  function tglHtml0(p, lab, on) { return `<button class="tgl${on ? " on" : ""}" role="switch" aria-checked="${on}" data-ftg="${esc(p)}"><span>${esc(lab)}</span><i class="sw2"><b></b></i></button>`; }
  function submitForm(s) {
    snapForm(s);
    const fail = (m, id) => { wizardView.err = m; const el = document.getElementById("err"); if (el) el.textContent = m; const f = document.getElementById(id); if (f) f.focus(); };
    const out = [];
    for (let i = 0; i < s.fields.length; i++) {
      const f = s.fields[i]; if (!fvis(s, f)) continue;
      if (f.k === "num") { const r = parse({ t: "num", min: f.min != null ? f.min : 1, max: f.max }, formDraft[f.p]); if (r.e) return fail(f.label + ": " + r.e, "f" + i); out.push([f.p, r.v]); }
      if (f.k === "int") { const r = parse({ t: "int", min: f.min, max: f.max }, formDraft[f.p]); if (r.e) return fail(f.label + ": " + r.e, "f" + i); out.push([f.p, r.v]); }
      if (f.k === "floors") { const r = parse({ t: "floors" }, formDraft[f.p]); if (r.e) return fail(f.label + ": " + r.e, "f" + i); out.push([f.p, r.v]); }
      if (f.k === "dims2") { const d = formDraft[f.p] || ["", ""]; const r = parse({ t: "dims" }, d[0] + "*" + d[1]); if (r.e) return fail(f.label + ": введите высоту и ширину числами", "f" + i + "a"); out.push([f.p, r.v]); }
    }
    out.forEach(([p, v]) => setP(order, p, v));
    wizardView.err = ""; if (s.finish) s.finish(order);
    formDraft = {}; pos++; save(); return render();
  }
  function controlBase(s, val) {
    if (s.t === "form") return formHtml(s);
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
        return `<div class="tgls" style="margin-top:12px"><div${turn ? "" : ' style="opacity:.45"'}>${tglHtml([`${s.pk}.hinge`, "Петли", "Слева", ["Слева", "Справа"]])}</div>${tglHtml([`${s.pk}.ebb.need`, "Отлив", "Нет"])}</div>`;
      })() : "");
    }
    if (s.t === "choice") return `<div class="choices">${s.ch.map(c => `<button class="choice${val === c ? " on" : ""}" data-pick="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
    if (s.t === "scheme") return `<div class="schemes">${["А", "В"].map(k => `<button class="sch${val === k ? " on" : ""}" data-pick="${k}" aria-label="Схема ${k}">${schemeSvg(k)}<b>Схема ${k}</b><small>${k === "А" ? "Верхнее обрамление накрывает боковые" : "Верхнее обрамление между боковыми"}</small></button>`).join("")}</div>`;
    if (s.t === "color") {
      const sw = [["7035", "#cbd0cc"], ["7038", "#b4b8b0"]];
      return `<div class="sw">${sw.map(([n, h]) => `<button data-pick="RAL ${n}" class="${val === "RAL " + n ? "on" : ""}"><i style="background:${h}"></i>RAL ${n}${n === "7035" ? `<small class="std">применяется стандартно</small>` : ""}</button>`).join("")}</div>`;
    }
    const mode = s.t === "int" ? "numeric" : s.t === "num" ? "decimal" : s.t === "floors" ? "text" : "text";
    const inner = s.area ? `<textarea id="inp" rows="3" placeholder="${esc(s.ph || "")}">${esc(val || "")}</textarea>` : `<input id="inp" inputmode="${mode}" enterkeyhint="next" value="${esc(val == null ? "" : String(val).replace(".", ","))}" placeholder="${esc(s.ph || "")}" autocomplete="off">`;
    return `<div class="field">${inner}${s.unit ? `<span class="u">${s.unit}</span>` : ""}</div>` + (s.quick ? `<div class="quick">${[1, 2, 3, 4, 5, 6, 8, 10].map(n => `<button type="button" data-q="${n}">${n}</button>`).join("")}</div>` : "") + (s.t === "dims" ? `<button class="btn sec" type="button" data-ins="*" style="font-size:26px">*</button><p class="hint" style="text-align:center">Нажмите *, чтобы поставить значок между высотой и шириной</p>` : "");
  }
  function bindInput(s) {
    if (s.t === "form") {
      const ins = [...document.querySelectorAll(".form input")];
      ins.forEach((el, k) => el.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (ins[k + 1]) ins[k + 1].focus(); else act("next"); } }));
      return;
    }
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
    if (s.more) {
      setP(order, s.p, raw); order.wins = String(raw).startsWith("Добавить") ? Math.max(order.wins || 1, s.win + 1) : s.win;
      pos++; save(); return render();
    }
    if (s.t === "form") return submitForm(s);
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
    const d = sub.d;
    const fields = d.steps.map(([k, q, t = "num", unit = mm], i) => `<label class="plab">${esc(q)}</label><div class="field"><input id="sf${i}" inputmode="${t === "int" ? "numeric" : "decimal"}" enterkeyhint="${i === d.steps.length - 1 ? "done" : "next"}" value="${esc(sub.vals[k] == null ? "" : String(sub.vals[k]).replace(".", ","))}" autocomplete="off"><span class="u">${unit}</span></div>`).join("");
    const body = `<div class="card"><span class="chip">${esc(d.title)}</span><h2 class="q">${esc(d.title)}</h2><p class="hint">Все размеры на одном экране, в миллиметрах.</p>${d.cable ? `<div class="secpic">${bortPic()}</div>` : ""}<div class="form">${fields}</div><p class="err" id="err">${esc(sub.err || "")}</p></div>`;
    shell(d.title, null, body, `<button class="btn" data-a="next">Готово</button>`);
    const ins = [...document.querySelectorAll(".form input")]; setTimeout(() => ins[0] && ins[0].focus(), 60);
    ins.forEach((el, k) => el.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (ins[k + 1]) ins[k + 1].focus(); else act("next"); } }));
  }
  function subNext() {
    const d = sub.d, vals = {};
    for (let i = 0; i < d.steps.length; i++) {
      const [k, q, t = "num", , lo, hi] = d.steps[i], el = document.getElementById("sf" + i);
      sub.vals[k] = el.value;
      const r = parse({ t, min: lo, max: hi }, el.value);
      if (r.e) { sub.err = q + ": " + r.e; document.getElementById("err").textContent = sub.err; el.focus(); return; }
      vals[k] = r.v;
    }
    sub.err = "";
    if (d.cable) order.cable[sub.key] = vals; else order[d.list].push(vals);
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
      `${supplyLink() ? `<button class="btn sec" data-a="supply_open">Открыть чат: ${esc(supply.app)}</button>` : ""}<button class="btn" data-a="send" disabled id="sendBtn">Отправить в снабжение</button><button class="btn sec" data-a="download">Скачать PDF</button><button class="btn ghost" data-a="${isSimple() ? "back" : "hub"}">${isSimple() ? "Изменить ответы" : "Назад к разделам"}</button>`);
    try {
      const full = exportOrder();
      const canv = await PDFGEN.buildPages(full);
      const cityOf = ad => { const f = String(ad || "").split(",")[0].trim().replace(/^(г\.?|гор\.?|город)\s*/i, "").trim(); return String(ad || "").includes(",") ? f : ""; };
      const data = { app: "zamer-dsh", version: 1, kind: order.kind, city: cityOf(full.address), address: full.address, contact: full.contact, stamp: full.stamp, order: full };
      pdfCache = { blob: PDFGEN.makePdf(canv, full.address, data), name: fileName() };
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
      o.openings.push(Object.assign({}, src, { floor: f, width: order.width, C: order.C, qty: 1 }));
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
      <line x1="182" y1="56" x2="182" y2="170" class="dm" marker-start="url(#ar${k === "А" ? "a" : "b"})" marker-end="url(#ar${k === "А" ? "a" : "b"})"/><text class="dt" x="192" y="113" text-anchor="middle">C</text>
      ${A ? `<line x1="14" y1="30" x2="46" y2="30" class="ex"/><line x1="14" y1="56" x2="46" y2="56" class="ex"/>` : ""}<line x1="164" y1="56" x2="190" y2="56" class="ex"/><line x1="164" y1="170" x2="190" y2="170" class="ex"/>
      <line x1="30" y1="${bottom}" x2="170" y2="${bottom}" class="floor"/></svg>`;
  }
  function showDone(kind) { ominous("toll"); goal(kind === "sent" ? "sent" : "saved"); doneKind = kind; view = "done"; save(); render(); if (kind === "sent") liftClose(); else confetti(); }
  function liftClose() {
    const n = order.kind === "dl" ? (order.entrances || 1) : order.kind === "win" ? winItems().length : (order.stops || 0), unit = order.kind === "dl" ? "подъездов" : order.kind === "win" ? "окон" : "этажей";
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return confetti();
    const L = document.createElement("div"); L.id = "lift"; L.className = "open";
    L.innerHTML = `<div class="head"><i>▲</i><b>1</b></div><div class="door l"><i class="pk"></i></div><div class="door r"><i class="pk"></i></div><div class="tag"><span>заказано ${unit}: ${n}</span></div>`;
    document.body.appendChild(L); void L.offsetWidth;
    const b = L.querySelector("b"); let off = false;
    const open = () => { if (off) return; off = true; clearInterval(iv); L.classList.add("open"); confetti(); setTimeout(() => L.remove(), 2600); };
    let c = 1, iv;
    L.addEventListener("click", open);
    setTimeout(() => { L.classList.remove("open"); L.querySelector(".tag").style.opacity = 1; }, 50);
    setTimeout(() => { iv = setInterval(() => { c = Math.min(n, c + Math.max(1, Math.ceil(n / 14))); b.textContent = c; if (c >= n) clearInterval(iv); }, 90); }, 1500);
    setTimeout(open, 4200);
  }
  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const w = document.createElement("div"); w.className = "confetti";
    const cols = ["#1b6fa8", "#ffb347", "#2e9e6b", "#c0392b", "#6aa9d6"];
    for (let i = 0; i < 36; i++) { const p = document.createElement("i"); p.style.cssText = `left:${Math.random() * 100}%;background:${cols[i % 5]};animation-delay:${Math.random() * .5}s;animation-duration:${1.6 + Math.random() * 1.4}s;transform:rotate(${Math.random() * 360}deg)`; w.appendChild(p); }
    document.body.appendChild(w); setTimeout(() => w.remove(), 3500);
  }
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
    shell("Меню", null, `<div class="card">${LIM && acc.session ? `<div class="sum"><span><b>${esc(acc.name || "Аккаунт")}</b> (номер ${esc(acc.id)})</span><span>Осталось замеров: ${left()}</span></div>` : ""}<button class="btn sec" data-a="home">На главный экран</button><button class="btn sec" data-a="close">Вернуться к заявке</button><button class="btn sec" data-a="snd">${sndOn ? "🔊 Жуткие звуки: включены" : "🔇 Жуткие звуки: выключены"}</button><button class="btn sec" data-a="supply">Связь со снабжением</button><button class="btn sec" data-a="install">Инструкция по установке</button><button class="btn sec" data-a="refresh">Обновить приложение</button><button class="btn sec danger" data-a="new">Начать новую заявку</button>${LIM && acc.session ? `<button class="btn sec" data-a="logout">Выйти из аккаунта</button>` : ""}</div>`, "", { menu: false });
  }

  /* ---------- диспетчер ---------- */
  function render() {
    if (view === "home") return homeView();
    if (view === "menu") return menuView();
    if (view === "done") return doneView();
    if (view === "soon") return soonView();
    if (view === "work") return workView();
    if (view === "claim") return claimView();
    if (view === "meas") return measView();
    if (view === "cv") return cvView();
    if (view === "jobs") return jobsView();
    if (view === "supply") return supplyView();
    if (view === "login") return loginView();
    if (view === "nocredits") return nocreditsView();
    if (view === "review") return reviewView();
    if (sub) return subView();
    if (view === "hub") return hubView();
    return wizardView();
  }
  /* ---------- жуткие звуки и эффекты ---------- */
  let sndOn = (() => { try { return localStorage.getItem("zamer_snd") !== "0"; } catch (e) { return true; } })(), AC = null, lastSnd = 0;
  let BUS = null;
  function dest() {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (BUS && BUS.ctx === AC) return BUS.in;
    const inp = AC.createGain(), dry = AC.createGain(), wet = AC.createGain(), cv = AC.createConvolver(), len = AC.sampleRate * 2.8, buf = AC.createBuffer(2, len, AC.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    cv.buffer = buf; dry.gain.value = 0.8; wet.gain.value = 0.65;
    inp.connect(dry); dry.connect(AC.destination); inp.connect(cv); cv.connect(wet); wet.connect(AC.destination);
    BUS = { ctx: AC, in: inp }; return inp;
  }
  function creak() {
    if (!sndOn) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume();
      const t = AC.currentTime, dur = 0.3 + Math.random() * 0.45, f0 = 130 + Math.random() * 200;
      const o = AC.createOscillator(), j = AC.createOscillator(), jg = AC.createGain(), f = AC.createBiquadFilter(), g = AC.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (1.5 + Math.random() * 0.8), t + dur * 0.6); o.frequency.linearRampToValueAtTime(f0 * 0.9, t + dur);
      j.type = "square"; j.frequency.value = 28 + Math.random() * 30; jg.gain.value = 55; j.connect(jg); jg.connect(o.frequency);
      f.type = "bandpass"; f.frequency.setValueAtTime(600 + Math.random() * 500, t); f.frequency.linearRampToValueAtTime(1400, t + dur); f.Q.value = 7;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g); g.connect(dest()); o.start(t); j.start(t); o.stop(t + dur + .05); j.stop(t + dur + .05);
    } catch (e) {}
  }
  function moan() {
    if (!sndOn) return;
    const now = Date.now(); if (now - lastSnd < 250) return; lastSnd = now;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume();
      const t = AC.currentTime, f0 = 105 + Math.random() * 70, dur = 1.3 + Math.random() * 0.7;
      const o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), fl = AC.createBiquadFilter(), lfo = AC.createOscillator(), lg = AC.createGain();
      o.type = "sawtooth"; o2.type = "triangle";
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + dur);
      o2.frequency.setValueAtTime(f0 * 1.5, t); o2.frequency.exponentialRampToValueAtTime(f0 * 0.93, t + dur);
      lfo.frequency.value = 5.5; lg.gain.value = 9; lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
      fl.type = "lowpass"; fl.frequency.setValueAtTime(380, t); fl.frequency.linearRampToValueAtTime(900, t + dur * 0.35); fl.frequency.linearRampToValueAtTime(260, t + dur); fl.Q.value = 6;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.18); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const o3 = AC.createOscillator(); o3.type = "sawtooth"; o3.frequency.setValueAtTime(f0 * 1.414, t); o3.frequency.exponentialRampToValueAtTime(f0 * 0.88, t + dur); lg.connect(o3.frequency); o3.connect(fl);
      o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(dest());
      o.start(t); o2.start(t); o3.start(t); lfo.start(t); o.stop(t + dur + .05); o2.stop(t + dur + .05); o3.stop(t + dur + .05); lfo.stop(t + dur + .05);
    } catch (e) {}
  }
  function wail() {
    if (!sndOn) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume();
      const t = AC.currentTime, dur = 2.6;
      const o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), fl = AC.createBiquadFilter(), lfo = AC.createOscillator(), lg = AC.createGain(), d = AC.createDelay(), fb = AC.createGain(), out = AC.createGain();
      o.type = "sine"; o2.type = "triangle";
      o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(520, t + dur * 0.45); o.frequency.exponentialRampToValueAtTime(130, t + dur);
      o2.frequency.setValueAtTime(240, t); o2.frequency.exponentialRampToValueAtTime(735, t + dur * 0.45); o2.frequency.exponentialRampToValueAtTime(184, t + dur);
      lfo.frequency.value = 6.5; lg.gain.value = 14; lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
      fl.type = "bandpass"; fl.frequency.value = 900; fl.Q.value = 1.2;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      d.delayTime.value = 0.23; fb.gain.value = 0.45; out.gain.value = 1;
      o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(out); g.connect(d); d.connect(fb); fb.connect(d); d.connect(out); out.connect(dest());
      o.start(t); o2.start(t); lfo.start(t); o.stop(t + dur + .1); o2.stop(t + dur + .1); lfo.stop(t + dur + .1);
      setTimeout(() => { try { out.disconnect(); } catch (e) {} }, (dur + 2) * 1000);
    } catch (e) {}
  }
  /* зловещие звуки: колокол, скрип, сердцебиение, гул */
  function ominous(kind) {
    if (!sndOn) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume();
      const t = AC.currentTime, out = AC.createGain(); out.gain.value = 1; out.connect(dest());
      const env = (g, a, pk, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + d); };
      const k = kind || ["toll", "creak", "heart", "drone", "whisper", "bat", "cackle"][Math.floor(Math.random() * 7)];
      if (k === "toll") { [1, 2.76, 5.4, 8.9].forEach((m, i) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = "sine"; o.frequency.value = 110 * m; env(g, 0.01, 0.16 / (i + 1), 4.2 - i * 0.6); o.connect(g); g.connect(out); o.start(t); o.stop(t + 4.4); }); }
      else if (k === "creak") { const o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter(), l = AC.createOscillator(), lg = AC.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(240, t + 0.9); o.frequency.linearRampToValueAtTime(130, t + 1.7); l.frequency.value = 23; lg.gain.value = 40; l.connect(lg); lg.connect(o.frequency); f.type = "bandpass"; f.frequency.value = 700; f.Q.value = 5; env(g, 0.25, 0.09, 1.8); o.connect(f); f.connect(g); g.connect(out); o.start(t); l.start(t); o.stop(t + 1.9); l.stop(t + 1.9); }
      else if (k === "heart") { [0, 0.42, 1.3, 1.72].forEach(dt => { const o = AC.createOscillator(), g = AC.createGain(); o.type = "sine"; o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.22); g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.35, t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.28); o.connect(g); g.connect(out); o.start(t + dt); o.stop(t + dt + 0.3); }); }
      else if (k === "whisper") { const n = AC.sampleRate * 2.2, buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; const sr = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(), lf = AC.createOscillator(), lg = AC.createGain(); sr.buffer = buf; f.type = "bandpass"; f.frequency.value = 2600; f.Q.value = 3; lf.frequency.value = 3.2; lg.gain.value = 0.05; lf.connect(lg); lg.connect(g.gain); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1); sr.connect(f); f.connect(g); g.connect(out); sr.start(t); lf.start(t); lf.stop(t + 2.2); }
      else if (k === "bat") { [0, 0.14, 0.3].forEach(dt => { const o = AC.createOscillator(), g = AC.createGain(); o.type = "sine"; o.frequency.setValueAtTime(5200, t + dt); o.frequency.exponentialRampToValueAtTime(2400, t + dt + 0.09); g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.05, t + dt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.1); o.connect(g); g.connect(out); o.start(t + dt); o.stop(t + dt + 0.12); }); }
      else if (k === "cackle") { for (let i = 0; i < 7; i++) { const dt = i * 0.13, o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter(); o.type = "sawtooth"; o.frequency.setValueAtTime(420 - i * 18, t + dt); o.frequency.exponentialRampToValueAtTime(260 - i * 12, t + dt + 0.11); f.type = "bandpass"; f.frequency.value = 1100; f.Q.value = 4; g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.07, t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.12); o.connect(f); f.connect(g); g.connect(out); o.start(t + dt); o.stop(t + dt + 0.14); } }
      else if (k === "bloop") { const o = AC.createOscillator(), g = AC.createGain(); o.type = "sine"; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.09); o.frequency.exponentialRampToValueAtTime(260, t + 0.2); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.26); }
      else { [55, 55.7, 82.4].forEach(fq => { const o = AC.createOscillator(), g = AC.createGain(); o.type = "sawtooth"; o.frequency.value = fq; const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 220; env(g, 1.6, 0.07, 4.5); o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 4.6); }); }
    } catch (e) {}
  }
  document.addEventListener("focusin", e => { if (e.target.matches && e.target.matches("input,textarea") && Math.random() < 0.5) ominous("whisper"); });
  let ambT = null;
  function ambient() {
    clearTimeout(ambT);
    ambT = setTimeout(() => { if (!document.hidden) ominous(); ambient(); }, 8000 + Math.random() * 12000);
  }
  document.addEventListener("pointerdown", function once() { document.removeEventListener("pointerdown", once, true); setTimeout(() => ominous("drone"), 600); ambient(); }, true);
  function spook(x, y) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const E = ["🦇", "💀", "🎃", "👻", "🕷️", "🦴"];
    for (let i = 0; i < 6; i++) {
      const p = document.createElement("span"); p.className = "spk2"; p.textContent = E[Math.floor(Math.random() * E.length)];
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 60;
      p.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 30}px;--r:${(Math.random() - .5) * 120}deg`;
      document.body.appendChild(p); setTimeout(() => p.remove(), 1000);
    }
  }
  document.addEventListener("pointerdown", e => { if (e.target.closest("button,a.btn")) { creak(); setTimeout(moan, 90); if (Math.random() < 0.25) setTimeout(() => ominous(), 800); spook(e.clientX, e.clientY); } }, true);
  /* слизь стекает со значков вниз экрана */
  function slimeFlow() {
    document.querySelectorAll(".slimeflow,.slimepool").forEach(x => x.remove());
    return; // слизь отключена
    document.querySelectorAll(".slimeflow,.slimepool").forEach(x => x.remove());
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const icons = [...document.querySelectorAll(".tile .ti, .logob, .card, .chip, .btn:not(.ghost)")].slice(0, 14), H = Math.max(document.documentElement.scrollHeight, innerHeight);
    icons.forEach((el, i) => {
      const r = el.getBoundingClientRect(), big = r.width > 120, x = r.left + r.width * (big ? 0.12 + ((i * 37) % 76) / 100 : 0.3 + (i % 3) * 0.2) + scrollX, y = (big ? r.top + 14 : r.bottom - 6) + scrollY;
      const d = document.createElement("div"); d.className = "slimeflow";
      d.style.cssText = `left:${x}px;top:${y}px;height:${Math.max(40, H - y)}px;animation-delay:${i * 0.9}s;width:${7 + (i % 3) * 2}px`;
      d.innerHTML = "<b></b>"; document.body.appendChild(d);
    });
    if (icons.length) { const p = document.createElement("div"); p.className = "slimepool"; document.body.appendChild(p); }
  }
  let slT = null;
  new MutationObserver(() => { clearTimeout(slT); slT = setTimeout(slimeFlow, 250); }).observe($app, { childList: true });
  addEventListener("resize", () => { clearTimeout(slT); slT = setTimeout(slimeFlow, 250); });
  function goal(n) { try { if (window.ym) ym(113845787, "reachGoal", n); } catch (e) {} }
  function act(a) {
    if (/^sec_(win|door|frame|claim)$/.test(a) || a === "download") goal(a);
    if (a === "next") { if (sub) return subNext(); const l = buildList(), s = l[pos]; return advance(s, readValue(s)); }
    if (a === "back") {
      if (view === "soon") { view = /^claim_/.test(soonView.what) ? "claim" : "home"; return render(); }
      if (view === "meas" || view === "jobs" || view === "cv") { view = "home"; return render(); }
    if (view === "work" || view === "claim") { view = "jobs"; return render(); }
      if (sub) { sub = null; return render(); }
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
    if (a === "hint") {
      const o = document.createElement("div"); o.className = "sheet";
      o.innerHTML = `<div class="sheetbox" role="dialog" aria-modal="true"><h3>Сечение I – I</h3>${sectionPic()}<p>Н — глубина, В — ширина бокового обрамления.</p><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`;
      o.addEventListener("click", ev => { if (ev.target === o || ev.target.closest("[data-a=mailclose]")) o.remove(); });
      document.body.appendChild(o); return;
    }
    if (a === "mail") {
      const E = "stroyliftkompleks@yandex.ru", o = document.createElement("div"); o.className = "sheet";
      o.innerHTML = `<div class="sheetbox" role="dialog" aria-modal="true"><h3>Предложения по работе приложения</h3><p>Пишите на почту, будем рады любым идеям и замечаниям:</p><div class="mailaddr">${E}</div><p class="hint" style="margin:0 0 10px">Разработчик: <b>Кащеев Виктор Петрович</b></p><a class="btn" href="mailto:${E}?subject=Предложение по приложению «Замер ДШ»">Написать письмо</a><button class="btn sec" data-copy="${E}">Скопировать адрес</button><button class="btn sec" data-a="job_cv">Нужна работа монтажником? Анкета</button><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`;
      o.addEventListener("click", ev => {
        if (ev.target.closest("[data-a=job_cv]")) { o.remove(); return act("job_cv"); }
        const c = ev.target.closest("[data-copy]");
        if (c) { (navigator.clipboard ? navigator.clipboard.writeText(E) : Promise.reject()).then(() => { c.textContent = "Адрес скопирован ✓"; }, () => { c.textContent = E; }); return; }
        if (ev.target === o || ev.target.closest("[data-a=mailclose]")) o.remove();
      });
      document.body.appendChild(o); return;
    }
    if (a === "sec_win") return newOrder("win");
    if (a === "job_cv") { wail(); view = "cv"; return render(); }
    if (a === "cv_send") {
      const v = id => (document.getElementById(id) || {}).value || "", inn = v("cv_inn").replace(/\D/g, ""), ph = v("cv_phone").replace(/\D/g, ""), exp = parseFloat(v("cv_exp").replace(",", "."));
      cvData = { name: v("cv_name"), phone: v("cv_phone"), region: v("cv_region"), last: v("cv_last"), exp: v("cv_exp"), inn: v("cv_inn"), trip: cvData.trip || "Нет", skills: cvData.skills || [] };
      let err = "";
      if (v("cv_name").trim().split(/\s+/).length < 2) err = "Укажите фамилию и имя";
      else if (ph.length < 10) err = "Введите телефон полностью";
      else if (!v("cv_region").trim()) err = "Укажите регион России";
      else if (!v("cv_last").trim()) err = "Укажите, где работали";
      else if (!(exp >= 0 && exp <= 60)) err = "Укажите стаж в годах (0 — если опыта нет)";
      else if (inn.length !== 12 && inn.length !== 10) err = "ИНН: 12 цифр (физлицо, самозанятый, ИП) или 10 (организация)";
      cvData.err = err;
      try { localStorage.setItem("zamer_cv", JSON.stringify(cvData)); } catch (e) {}
      if (err) return render();
      const E = "stroyliftkompleks@yandex.ru", body = ["ФИО: " + v("cv_name"), "Телефон: " + v("cv_phone"), "Регион России: " + v("cv_region"), "Где работал(а): " + v("cv_last"), "Стаж монтажа лифтов: " + v("cv_exp") + " лет", "ИНН: " + inn, "Специализация: " + (cvData.skills.join(", ") || "—"), "Готов к командировкам: " + (cvData.trip || "Нет")].join("\n");
      location.href = "mailto:" + E + "?subject=" + encodeURIComponent("Резюме монтажника: " + v("cv_name") + ", " + v("cv_region")) + "&body=" + encodeURIComponent(body);
      flash = "Открываем письмо…"; return render();
    }
    if (a === "m_meas") { wail(); view = "meas"; return render(); }
    if (a === "m_jobs") { wail(); view = "jobs"; return render(); }
    if (a === "sec_work") { view = "work"; return render(); }
    if (a === "work_yes" || a === "work_no") {
      try { localStorage.setItem("zamer_work", JSON.stringify({ stopped: a === "work_yes", at: new Date().toISOString() })); } catch (e) {}
      flash = a === "work_yes" ? "Остановка лифта отмечена ✓" : "Отмечено: лифт ещё не остановлен"; view = "home"; return render();
    }
    if (a === "sec_claim") { wail(); view = "claim"; return render(); }
    if (a === "fb_send") {
      const t = (document.getElementById("fb") || {}).value || ""; soonView.fb = t;
      if (!t.trim()) { flash = "Напишите пожелание"; return render(); }
      location.href = "mailto:stroyliftkompleks@yandex.ru?subject=" + encodeURIComponent("Замер ДШ: рекламация — " + (CLAIMS[soonView.what] || "")) + "&body=" + encodeURIComponent(t);
      flash = "Открываем письмо…"; return render();
    }
    if (/^claim_/.test(a)) { soonView.fb = ""; soonView.what = a; view = "soon"; return render(); }
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
    if (a === "menu") { wail(); }
    if (a === "menu") { menuReturn = view; view = "menu"; return render(); }
    if (a === "snd") { sndOn = !sndOn; try { localStorage.setItem("zamer_snd", sndOn ? "1" : "0"); } catch (e) {} if (sndOn) moan(); return render(); }
    if (a === "supply") { supplyView.app = ""; supplyView.err = ""; view = "supply"; return render(); }
    if (a === "supply_save") {
      const ph = document.getElementById("sphone").value, d = digits(ph);
      if (d.length < 11) { supplyView.err = "Введите номер телефона полностью"; supplyView.app = supplyView.app || supply.app; return render(); }
      supply = { app: supplyView.app || supply.app || "WhatsApp", phone: ph.trim() };
      try { localStorage.setItem("zamer_supply", JSON.stringify(supply)); } catch (e) {}
      flash = "Сохранено: " + supply.app + ", " + supply.phone; view = "menu"; return render();
    }
    if (a === "supply_open") { const u = supplyLink(); if (u) window.open(u, "_blank"); return; }
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
    if (b.dataset.fseg || b.dataset.ftg) {
      const s0 = buildList()[pos]; snapForm(s0);
      if (b.dataset.fseg) { const i = b.dataset.fseg.lastIndexOf("|"); setP(order, b.dataset.fseg.slice(0, i), b.dataset.fseg.slice(i + 1)); }
      else setP(order, b.dataset.ftg, getP(order, b.dataset.ftg) === "Да" ? "Нет" : "Да");
      save(); return render();
    }
    if (b.dataset.seg) { const [p, v] = b.dataset.seg.split("|"); setP(order, p, v); if (/\.hinge$/.test(p)) { save(); const ls = buildList()[pos]; if (ls && ls.pic === "door") { document.querySelectorAll(".pic .hd").forEach(c => c.setAttribute("cx", v === "Справа" ? 106 : 162)); document.querySelectorAll(".pic .hgL").forEach(g => { g.style.display = v === "Справа" ? "none" : ""; }); document.querySelectorAll(".pic .hgR").forEach(g => { g.style.display = v === "Справа" ? "" : "none"; }); } else return render(); } b.parentNode.querySelectorAll("button").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); }); save(); return; }
    if (b.dataset.tg) { const v = getP(order, b.dataset.tg) === "Да" ? "Нет" : "Да"; setP(order, b.dataset.tg, v); b.classList.toggle("on", v === "Да"); b.setAttribute("aria-checked", v === "Да"); save(); return; }
    if (b.dataset.q) { const i = document.getElementById("inp"); if (i) { i.value = b.dataset.q; return act("next"); } }
    if (b.dataset.cvs) { b.classList.toggle("on"); cvData.skills = [...document.querySelectorAll("[data-cvs].on")].map(x => x.dataset.cvs); return; }
    if (b.dataset.cvtg) { const on = !b.classList.contains("on"); b.classList.toggle("on", on); b.setAttribute("aria-checked", on); cvData.trip = on ? "Да" : "Нет"; return; }
    if (b.dataset.supp) { supplyView.app = b.dataset.supp; document.querySelectorAll("[data-supp]").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); }); return; }
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
