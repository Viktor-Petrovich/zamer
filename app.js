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
  let order = fresh(), pos = 0, view = "home", sub = null, pdfCache = null, flash = "", slkMeas = null;
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
    { p: "form.obj", t: "form", sec: "Объект", q: "Адрес и контактное лицо", hint: "Город, улица, дом: файл заявки будет назван этим адресом. Контакт: имя и телефон.",
      fields: [{ k: "text", p: "address", label: "Адрес объекта", ph: "г. Казань, ул. Мира, 3", area: 1 }, { k: "text", p: "contact", label: "Контактное лицо на объекте", ph: "Иван, +7 900 123-45-67" }] },
    { p: "form.sch", t: "form", sch: 1, fscr: 1, floor: 1, sec: "Обрамление ДШ", q: "Параметры обрамления и проём", hint: "Схема и цвет, табло, загиб, кнопка вызова, затем проём и размеры обрамлений. Выбор действует на всю заявку.", finish: o => { o.common.ind_floor = o.common.ind_on === "Нет" ? "Нет табло" : (o.common.ind_where || "На всех этажах"); },
      fields: [{ k: "h", label: "Табло индикации" }, { k: "tgl", p: "common.ind_on", label: "Есть табло", def: "Да" }, { k: "seg", p: "common.ind_where", label: "Где", opts: [["Только 1 этаж", "Только на 1 этаже"], ["Все этажи", "На всех этажах"]], def: "На всех этажах", when: o => o.common.ind_on !== "Нет" },
        { k: "dims2", p: "common.ind_size", label: "Размер отверстия под табло", ph: ["80", "120"], when: o => o.common.ind_on !== "Нет" },
        { k: "h", label: "Загиб" }, { k: "seg", p: "common.bend_mode", label: "Размеры", opts: [["С учётом загиба", "С учётом загиба"], ["Без учёта загиба", "Без учёта загиба"]], def: "С учётом загиба" }, { k: "num", p: "common.bend", label: "Размер загиба", unit: mm, max: 500, min: 0 },
        { k: "h", label: "Кнопка вызова" },
        { k: "seg", p: "common.btn_all", label: "Ставится", opts: [["На всех этажах", "На всех этажах"], ["Не на всех", "Не на всех этажах"]], def: "На всех этажах" },
        { k: "floors", p: "common.btn_floors", label: "На каких этажах", ph: "1, 3, 5-7", when: o => o.common.btn_all === "Не на всех этажах" },
        { k: "seg", p: "common.btn_side", label: "Сторона", opts: [["Слева", "Слева"], ["Справа", "Справа"]], def: "Слева" },
        { k: "num", p: "common.btn_height", label: "От пола до центра отверстия", unit: mm },
        { k: "dims2", p: "common.btn_size", label: "Размер отверстия под кнопку", ph: ["30", "30"] }] }
  ];
  const OPEN = [
    ["top", "Верхнее обрамление", "А — высота, Н — глубина верхнего обрамления.", [["top_A", "Размер А (высота)"], ["top_H", "Размер Н (глубина)"]]],
    ["left", "Левое боковое обрамление", "Н — глубина, В — ширина бокового обрамления.", [["left_H", "Размер Н (глубина)"], ["left_B", "Размер В (ширина)"]]],
    ["right", "Правое боковое обрамление", "Н — глубина, В — ширина бокового обрамления.", [["right_H", "Размер Н (глубина)"], ["right_B", "Размер В (ширина)"]]]
  ];
  const same = () => order.dsh_same === "Одинаковые на всех этажах";
  /* ---------- двери и люки ---------- */
  const OBJ = () => SETUP[0];
  const sameDL = () => (order.entrances || 0) <= 1 || !String(order.dl_same || "").startsWith("Разные");
  function buildListDL() {
    const l = [
      OBJ()
    ];
    const N = order.entrances || 0, es = sameDL() ? [1] : Array.from({ length: Math.max(1, N) }, (_, i) => i + 1);
    es.forEach(e => {
      const sec = sameDL() ? (N > 1 ? "Двери и люки, все подъезды" : "Двери и люки") : `Подъезд ${e} из ${N}`;
      const pk = `ent.${e}`;
      const gl = { door: order.need_door || "Да", hatch: order.need_hatch || "Да" };
      ["door", "hatch"].forEach(k => { if (sameDL() || !getP(order, `${pk}.${k}.need`)) setP(order, `${pk}.${k}.need`, gl[k]); });
      if (!getP(order, `${pk}.door.hinge`)) setP(order, `${pk}.door.hinge`, "Слева");
      if (!getP(order, `${pk}.door.cas`)) setP(order, `${pk}.door.cas`, { l: true, t: true, r: true });
      l.push({ p: `${pk}.screen`, t: "dlscr", dlscr: 1, pic: "door", pk, sec, ent: e, first: true, casP: `${pk}.door.cas`, hingeP: `${pk}.door.hinge`,
        q: e === 1 ? "Подъезды, двери и люки" : `Подъезд ${e}: двери и люки`, hint: e === 1 ? "Количество подъездов, что нужно измерить и все размеры на одном экране. Наличник на двери отмечайте на рисунке." : "Включите нужное и внесите размеры." });
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
  function sectionPic(mir) {
    const s = sectionPic0();
    if (!mir) return s;
    const W = 300, texts = [];
    const body = s.replace(/<text\b[^>]*>[^<]*<\/text>/g, t => { texts.push(t.replace(/\bx="([\d.]+)"/, (m, x) => `x="${W - x}"`).replace(/rotate\(-90 ([\d.]+) /, (m, x) => `rotate(-90 ${W - x} `).replace(/(<text\b[^>]*?)(\s*(?:transform="[^"]*")?\s*>)/, (m, p, q) => /text-anchor/.test(m) ? m : `${p} text-anchor="end"${q}`)); return ""; });
    return body.replace(/(<svg[^>]*>)(<defs>.*?<\/defs>)?/s, (m, h, d) => `${h}${d || ""}<g transform="translate(${W},0) scale(-1,1)">`).replace(/<\/svg>\s*$/, `</g>${texts.join("")}</svg>`);
  }
  function sectionPic0() {
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
      OBJ(),
    ];
    const N = Math.max(1, order.wins || 1);
    for (let i = 1; i <= N; i++) {
      const sec = N > 1 ? `Окно ${i} из ${N}` : "Окно", pk = `win.${i}`;
      l.push({ p: `${pk}.kind`, t: "choice", sash: "type", winscr: 1, pic: "win", first: true, unit: mm, min: 100, pair: [[`${pk}.h`, "Высота проёма"], [`${pk}.w`, "Ширина проёма"]], pk, sec, win: i, qtyStep: true, q: "Окно: проём, открывание, отлив, количество", hint: "Размер окна посчитаем сами: высота минус 20, ширина минус 40. Выберите тип открывания и петли, при отливе внесите его размеры, внизу укажите количество.", ch: Object.keys(WK) });
      const k = WK[getP(order, `${pk}.kind`)];
      if (!getP(order, `${pk}.ebb.need`)) setP(order, `${pk}.ebb.need`, "Нет");
      if (!getP(order, `${pk}.hinge`)) setP(order, `${pk}.hinge`, "Слева");
      if (!getP(order, `${pk}.ebb.need`)) setP(order, `${pk}.ebb.need`, "Нет");
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
    order = fresh(); order.kind = kind; if (slkMeas) { order.address = slkMeas.addr + ", подъезд " + slkMeas.ent; order.contact = sU ? sU.fio : ""; } pos = 0; view = "wizard"; sub = null; save(); render();
  }
  function ensureForms() {
    order.common = order.common || {};
    const c = order.common;
    if (!c.color) c.color = "RAL 7035";
    if (!order.dsh_same) order.dsh_same = "Одинаковые на всех этажах";
    if (!order.C) order.C = 2000;
    if (order.c_mode === undefined) order.c_mode = order.C && Number(order.C) !== 2000 ? "Свой размер" : "Стандарт 2000 мм";
    if (c.ind_on === undefined) c.ind_on = c.ind_floor ? (c.ind_floor === "Нет табло" ? "Нет" : "Да") : "Да";
    if (c.ind_where === undefined && c.ind_floor && c.ind_floor !== "Нет табло") c.ind_where = c.ind_floor;
    SETUP.forEach(st => { if (st.t === "form") st.fields.forEach(f => { if ((f.k === "seg" || f.k === "tgl") && getP(order, f.p) === undefined) setP(order, f.p, f.def); }); });
  }
  function buildList() {
    if (order.kind === "dl") return buildListDL();
    if (order.kind === "win") return buildListWin();
    ensureForms();
    const l = SETUP.filter(s => !s.when || s.when(order));
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
    const sig = view + "|" + pos + "|" + (sub ? sub.key + sub.i : "") + "|" + title, keepY = shell.sig === sig ? window.scrollY : 0; shell.sig = sig;
    $app.innerHTML = `<header class="top"><div class="bar">${opts.back === false ? "" : `<button class="ib" data-a="back" aria-label="Назад">${ICON.back}</button>`}<h1>${esc(title)}</h1>${opts.menu === false ? "" : `<button class="ib" data-a="menu" aria-label="Меню">${ICON.menu}</button>`}</div>${progress == null ? "" : `<div class="prog"><i style="width:${Math.round(progress * 100)}%"></i></div>`}</header><main>${body}</main><footer class="act">${foot}</footer>${flash ? `<div class="toast">${esc(flash)}</div>` : ""}`;
    if (flash) setTimeout(() => { flash = ""; const t = document.querySelector(".toast"); if (t) t.remove(); }, 2200);
    window.scrollTo(0, keepY);
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
    if (slkMeas) return shell("Заявка с размерами · п." + slkMeas.ent, null, `<div class="card"><p class="hint" style="margin:0">Объект: ${esc(slkMeas.addr)}, подъезд ${esc(slkMeas.ent)}. Адрес подставится сам. После отправки заявка появится у снабжения.</p></div><div class="tiles">
        ${tile("sec_frame", "frame", "Замер обрамлений", "Двери шахты, пороги, нащельник, бортики", false)}
        ${tile("sec_door", "door", "Замер дверей и люков", "Машинное помещение лифта", false)}
        ${tile("sec_win", "win", "Замер окон", "Проём, петли, схема открывания, отлив", false)}</div>`, `<button class="btn ghost" data-a="s:mback">Назад к подъезду</button>`, { menu: false });
    shell("Замеры", null, `<div class="tiles">
        ${tile("sec_frame", "frame", "Замер обрамлений", "Двери шахты, пороги, нащельник, бортики", false)}
        ${tile("sec_door", "door", "Замер дверей и люков", "Машинное помещение лифта", false)}
        ${tile("sec_win", "win", "Замер окон", "Проём, петли, схема открывания, отлив", false)}
        ${tile("sec_axis", "frame", "Тестовый замер", "Обрамление по осям · тестовая функция", false)}</div>`, `<button class="btn ghost" data-a="home">На главный экран</button>`, { menu: false });
  }
  function homeView() {
    $app.innerHTML = `<main style="padding-top:max(24px,env(safe-area-inset-top))">
      <div class="hello"><button class="logob" data-a="theme" aria-label="Сменить тему"><img src="icon-192.png" alt=""></button><div><h2>${esc(greeting())}</h2><p>Выберите, что будем измерять сегодня</p></div><button class="ib hmenu" data-a="menu" aria-label="Меню">${ICON.menu}</button></div>
      <p class="hint" style="margin:-4px 0 0 2px">${esc(dateLong())}</p>
      ${LIM && acc.session ? `<div class="chip" style="justify-self:start">Осталось замеров: ${left()}</div>` : ""}
      ${hasDraft() && !(LIM && !acc.session) ? `<button class="tile cont" data-a="resume"><span class="ti">${SECT_ICON.frame}</span><span class="tt"><b>Продолжить заявку</b><small>${order.kind === "dl" ? "Двери и люки" : order.kind === "win" ? "Окна" : "Обрамления"} · ${esc((order.address || "").slice(0, 32))}</small></span><span class="go">›</span></button>` : ""}
      <div class="tiles">
        ${tile("m_meas", "frame", "Замеры", "Обрамления, двери и люки, окна", false)}
        ${tile("s:enter", "work", "СтройЛифтКомплекс вход для сотрудников", "Работа, заявки, ПТО, финансы: по фамилии и паролю", false)}
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
    if (s.t === "form" && wizardView.last === pos) snapForm(s);
    const secC = ({ "Объект": "#1b6fa8", "Общие параметры": "#0f8a8a", "Кнопка вызова": "#d9822b", "Обрамление ДШ": "#243b6b" })[s.sec] || "#1b6fa8";
    const dir = wizardView.last === undefined ? "" : pos > wizardView.last ? " sl-f" : pos < wizardView.last ? " sl-b" : ""; wizardView.last = pos;
    let body = `<div class="card wz${dir}" style="--sc:${secC}"><b class="stepn" aria-hidden="true">${pos + 1}<small>/${list.length}</small></b><span class="chip">${esc(s.sec)} · вопрос ${pos + 1} из ${list.length}</span><h2 class="q">${esc(s.q)}</h2>${s.hint ? `<p class="hint">${esc(s.hint)}</p>` : ""}`;
    body += controlHtml(s, val) + `<p class="err" id="err">${esc(err)}</p></div>`;
    let foot = s.t === "choice" || s.t === "scheme" ? "" : `<button class="btn" data-a="next">Далее</button>`;
    if (s.sash === "type") foot = `<button class="btn" data-a="next">Далее</button>`;
    if (s.t === "scheme") foot = `<button class="btn" data-a="next">Далее</button>`;
    if (order.kind === "dl" && !sameDL() && s.first && s.ent > 1) foot += `<button class="btn sec" data-a="copyprev">Все размеры как в подъезде ${s.ent - 1}</button>`;
    if (order.kind === "win" && s.first && s.win > 1) foot += `<button class="btn sec" data-a="copyprev">Как окно ${s.win - 1}: всё то же</button>`;
    shell(s.sec, pos / list.length, body, foot);
    bindInput(s);
  }
  function tglHtml([p, lab, def, seg]) {
    const v = getP(order, p) || (setP(order, p, def), def);
    if (seg) return `<div class="tgl segrow"><span>${esc(lab)}</span><div class="seg" role="radiogroup">${seg.map(o => `<button type="button" role="radio" aria-checked="${v === o}" class="${v === o ? "on" : ""}" data-seg="${esc(p)}|${esc(o)}">${esc(o)}</button>`).join("")}</div></div>`;
    return `<button class="tgl${v === "Да" ? " on" : ""}" role="switch" aria-checked="${v === "Да"}" data-tg="${p}"><span>${esc(lab)}</span><i class="sw2"><b></b></i></button>`;
  }
  const flist = () => same() ? [1] : Array.from({ length: order.stops || 1 }, (_, i) => i + 1);
  const partOk = (k, fl) => flist().every(f => OPEN.find(x => x[0] === k)[3].every(([key]) => ((order.ops && order.ops[f]) || {})[key] > 0));
  const gbtn = (id, x, y, w, h, lab, val, done) => `<g class="fpart gbtn${done ? " done" : ""}" data-gap="${id}" role="button" tabindex="0" aria-label="${[].concat(lab).join(" ")}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>${[].concat(lab).map((t, k, arr) => `<text${arr.length > 1 ? ' class="gl2"' : ""} x="${x + w / 2}" y="${y + h / 2 - 3 - (arr.length - 1 - k) * -0 + (k - (arr.length - 1)) * 8 + (arr.length - 1) * 4}" text-anchor="middle">${t}</text>`).join("")}<text class="gv" x="${x + w / 2}" y="${y + h / 2 + 9}" text-anchor="middle">${esc(String(val))}</text></g>`;
  function openGap(id) {
    const o = document.createElement("div"); o.className = "sheet";
    const seg = (cur) => ["Стандарт 2000 мм", "Свой размер"].map(v => `<button type="button" role="radio" aria-checked="${cur === v}" class="${cur === v ? "on" : ""}" data-gseg="${v}">${v}</button>`).join("");
    o.innerHTML = id === "shaft"
      ? `<div class="sheetbox scroll" role="dialog" aria-modal="true"><h3>Проём шахты</h3><p class="hint">Количество остановок и ширина проёма.</p><label class="plab">Количество остановок (этажей)</label><div class="field"><input id="g_stops" inputmode="numeric" value="${order.stops || ""}"><span class="u">шт.</span></div><label class="plab">Ширина проёма</label><div class="field"><input id="g_w" inputmode="decimal" value="${order.width || ""}"><span class="u">мм</span></div><p class="err" id="gerr"></p><button class="btn" data-a="gsave">Сохранить</button><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`
      : `<div class="sheetbox scroll" role="dialog" aria-modal="true"><h3>Размер С</h3><p class="hint">Высота вертикального обрамления.</p><div class="tgl segrow dsh"><div class="seg" role="radiogroup">${seg(order.c_mode)}</div></div><div id="g_cw" ${order.c_mode === "Свой размер" ? "" : "hidden"}><label class="plab">Свой размер С</label><div class="field"><input id="g_c" inputmode="decimal" value="${order.c_mode === "Свой размер" ? order.C || "" : ""}"><span class="u">мм</span></div></div><p class="err" id="gerr"></p><button class="btn" data-a="gsave">Сохранить</button><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`;
    let mode = order.c_mode;
    const fail = (m, sel) => { o.querySelector("#gerr").textContent = m; const e = o.querySelector(sel); e && e.focus(); };
    o.addEventListener("click", ev => {
      if (ev.target === o || ev.target.closest("[data-a=mailclose]")) return o.remove();
      const sg = ev.target.closest("[data-gseg]");
      if (sg) { mode = sg.dataset.gseg; o.querySelectorAll("[data-gseg]").forEach(x => { x.classList.toggle("on", x === sg); x.setAttribute("aria-checked", x === sg); }); o.querySelector("#g_cw").hidden = mode !== "Свой размер"; if (mode === "Свой размер") o.querySelector("#g_c").focus(); return; }
      if (!ev.target.closest("[data-a=gsave]")) return;
      if (id === "shaft") {
        const r1 = parse({ t: "int", min: 1, max: 100 }, o.querySelector("#g_stops").value), r2 = parse({ t: "num", min: 1 }, o.querySelector("#g_w").value);
        if (r1.e) return fail("Остановки: " + r1.e, "#g_stops"); if (r2.e) return fail("Ширина проёма: " + r2.e, "#g_w");
        order.stops = r1.v; order.width = r2.v; order.ops = order.ops || {};
      } else {
        if (mode === "Свой размер") { const r = parse({ t: "num", min: 1 }, o.querySelector("#g_c").value); if (r.e) return fail("Размер С: " + r.e, "#g_c"); order.C = r.v; } else order.C = 2000;
        order.c_mode = mode;
      }
      wizardView.err = ""; o.remove(); save(); render();
    });
    o.addEventListener("keydown", ev => { if (ev.key === "Enter" && ev.target.matches("input")) { ev.preventDefault(); const ins = [...o.querySelectorAll("input")].filter(i => i.offsetParent), k = ins.indexOf(ev.target); if (ins[k + 1]) ins[k + 1].focus(); else o.querySelector("[data-a=gsave]").click(); } });
    document.body.appendChild(o); setTimeout(() => { const i0 = o.querySelector("input"); i0 && i0.offsetParent && i0.focus(); }, 80);
  }
  function frameBig(f) {
    const A = order.scheme !== "В", o = (order.ops && order.ops[f]) || {};
    const ok = k => partOk(k);
    const part = (k, x, y, w, h, lab, tx, ty, rot) => `<g class="fpart${ok(k) ? " done" : ""}" data-fpart="${k}" role="button" tabindex="0" aria-label="${lab}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/><text ${rot ? `transform="translate(${tx} ${ty}) rotate(-90)"` : `x="${tx}" y="${ty}"`} text-anchor="middle">${ok(k) ? "✓ " : ""}${lab}</text></g>`;
    const svg = `<svg class="fbig" viewBox="0 0 200 196" role="group" aria-label="Схема обрамления">${PDEF}
      <rect x="62" y="30" width="76" height="140" class="gap"/>
      ${A ? part("left", 40, 56, 22, 114, "левое", 54.5, 113, 1) + part("right", 138, 56, 22, 114, "правое", 152.5, 113, 1) + part("top", 40, 30, 120, 26, "верхнее", 100, 46.5)
          : part("left", 40, 30, 22, 140, "левое", 54.5, 100, 1) + part("right", 138, 30, 22, 140, "правое", 152.5, 100, 1) + part("top", 62, 30, 76, 26, "верхнее", 100, 46.5)}
      ${gbtn("shaft", 66, 62, 68, 48, ["Этажность и", "ширина проёма"], order.stops && order.width ? order.stops + " эт. · " + order.width : "заполнить", !!(order.stops && order.width))}
      ${gbtn("c", 66, 116, 68, 48, "Размер С", order.c_mode === "Свой размер" && order.C ? order.C + " мм" : "2000 мм", true)}
      <line x1="30" y1="170" x2="170" y2="170" class="floor"/></svg>`;
    const sum = OPEN.map(([k, q, h, pr]) => `<button type="button" class="fchip${ok(k) ? " on" : ""}" data-fpart="${k}"><b>${{ top: "Верхнее", left: "Левое", right: "Правое" }[k]}</b><span>${ok(k) ? (same() ? pr.map(([key]) => o[key]).join(" × ") + " мм" : "все " + flist().length + " эт. внесены") : same() ? "нажмите, чтобы внести" : (flist().filter(x => OPEN.find(y => y[0] === k)[3].every(([key]) => ((order.ops && order.ops[x]) || {})[key] > 0)).length + " из " + flist().length + " эт.")}</span></button>`).join("");
    return `<div class="fscr"><div class="ledfl" aria-label="Остановок">▲ <b data-n="${order.stops || 0}">${order.stops || "–"}</b> эт.</div>${svg}<div class="fchips">${sum}</div>${!same() && order.stops > 1 ? `<button type="button" class="btn sec" data-a="opencopy" style="margin-top:12px">Копировать размеры между этажами</button>` : ""}</div>`;
  }
  function openCopy() {
    const n = order.stops || 1, o = document.createElement("div"); o.className = "sheet";
    const opts = sel => Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${sel === i + 1 ? " selected" : ""}>Этаж ${i + 1}</option>`).join("");
    o.innerHTML = `<div class="sheetbox" role="dialog" aria-modal="true"><h3>Копировать размеры этажа</h3><p class="hint">Все три части (верх, лево, право) с одного этажа на другие.</p><label class="plab">Откуда</label><select id="cp_from" class="bigsel">${opts(1)}</select><label class="plab">Куда</label><div class="cpto">${Array.from({ length: n }, (_, i) => `<label class="cpchk"><input type="checkbox" value="${i + 1}"${i === 1 ? " checked" : ""}><span>${i + 1}</span></label>`).join("")}</div><div class="cpq"><button type="button" class="btn sec" data-a="cpall">Все остальные</button></div><p class="err" id="cperr"></p><button class="btn" data-a="copysave">Скопировать</button><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`;
    o.addEventListener("click", ev => {
      if (ev.target === o || ev.target.closest("[data-a=mailclose]")) return o.remove();
      if (ev.target.closest("[data-a=cpall]")) { const f = o.querySelector("#cp_from").value; o.querySelectorAll(".cpto input").forEach(c => { c.checked = c.value !== f; }); return; }
      if (!ev.target.closest("[data-a=copysave]")) return;
      const from = o.querySelector("#cp_from").value, to = [...o.querySelectorAll(".cpto input:checked")].map(c => c.value).filter(v => v !== from);
      const src = (order.ops && order.ops[from]) || {};
      if (!OPEN.every(x => x[3].every(([key]) => src[key] > 0))) { o.querySelector("#cperr").textContent = "На этаже " + from + " не все размеры внесены"; return; }
      if (!to.length) { o.querySelector("#cperr").textContent = "Отметьте этажи, куда копировать"; return; }
      to.forEach(t => { order.ops[t] = Object.assign({}, src); });
      o.remove(); save(); toast("Скопировано на этажи: " + to.join(", "));
    });
    document.body.appendChild(o);
  }
  function bendToggle() {
    const c = order.common || {}, withB = (c.bend_mode || "С учётом загиба") === "С учётом загиба";
    const txt = withB ? `Размеры с учётом загиба: <b>${esc(String(c.bend == null || c.bend === "" ? "—" : String(c.bend).replace(".", ",")))} мм</b>` : `Размеры без учёта загиба. Загиб стандартный: <b>20 мм</b>`;
    return `<div class="bendnote">${txt}</div>`;
  }
  function dshToggle() {
    return `<div class="tgl segrow dsh"><span>Размеры на этажах</span><div class="seg" role="radiogroup">${[["Одинаковые", "Одинаковые на всех этажах"], ["По этажам", "Индивидуально по этажам"]].map(([t, v]) => `<button type="button" role="radio" aria-checked="${order.dsh_same === v}" class="${order.dsh_same === v ? "on" : ""}" data-dsh="${v}">${t}</button>`).join("")}</div></div>`;
  }
  function openPart(f, k) {
    const d = OPEN.find(x => x[0] === k), o = document.createElement("div"); o.className = "sheet"; const fl = flist();
    const pic = k === "left" ? sectionPic(true) : k === "right" ? sectionPic() : "";
    const cols = d[3];
    const body = same()
      ? cols.map(([key, lab], i) => `<label class="plab">${esc(lab)}</label><div class="field"><input id="p1_${i}" inputmode="decimal" value="${((order.ops && order.ops[1]) || {})[key] || ""}"><span class="u">мм</span></div>`).join("")
      : `<div class="ftab"><table><tr><th>Эт.</th>${cols.map(([key, lab]) => `<th>${esc(lab.replace(/^Размер /, "").replace(/ \(.*\)/, ""))}</th>`).join("")}<th>Как</th></tr>${fl.map(n => `<tr><td><b>${n}</b></td>${cols.map(([key], i) => `<td><input id="p${n}_${i}" inputmode="decimal" value="${((order.ops && order.ops[n]) || {})[key] || ""}"></td>`).join("")}<td>${n > 1 || fl.length > 1 ? `<select class="cpsel" data-row="${n}" aria-label="Как на этаже"><option value="">эт.</option>${fl.filter(m => m !== n).map(m => `<option value="${m}">${m}</option>`).join("")}</select>` : ""}</td></tr>`).join("")}</table></div><button class="btn sec" data-a="pfill">Как на этаже 1 для всех</button>`;
    o.innerHTML = `<div class="sheetbox scroll" role="dialog" aria-modal="true"><h3>${d[1]}${same() ? "" : ": все этажи"}</h3><p class="hint">${d[2]} В миллиметрах.</p>${pic ? `<div class="secpic">${pic}</div>` : ""}${body}<p class="err" id="perr"></p><button class="btn" data-a="partsave">Сохранить</button><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`;
    const save1 = () => {
      const out = [];
      for (const n of fl) for (let i = 0; i < cols.length; i++) {
        const el = o.querySelector(`#p${n}_${i}`), r = parse({ t: "num", min: 1 }, el.value);
        if (r.e) { o.querySelector("#perr").textContent = (same() ? "" : "Этаж " + n + ", ") + cols[i][1] + ": " + r.e; el.focus(); return; }
        out.push([n, cols[i][0], r.v]);
      }
      order.ops = order.ops || {};
      out.forEach(([n, key, v]) => { order.ops[n] = order.ops[n] || {}; order.ops[n][key] = v; });
      wizardView.err = ""; o.remove(); save(); render();
    };
    o.addEventListener("click", ev => {
      if (ev.target === o || ev.target.closest("[data-a=mailclose]")) o.remove();
      else if (ev.target.closest("[data-a=partsave]")) save1();
      else if (ev.target.closest("[data-a=pfill]")) { cols.forEach((c, i) => { const v = o.querySelector(`#p1_${i}`).value; fl.forEach(n => { o.querySelector(`#p${n}_${i}`).value = v; }); }); }
    });
    o.addEventListener("change", ev => {
      const sel = ev.target.closest(".cpsel"); if (!sel || !sel.value) return;
      const n = sel.dataset.row, src = sel.value;
      cols.forEach((c, i) => { o.querySelector(`#p${n}_${i}`).value = o.querySelector(`#p${src}_${i}`).value; });
      sel.value = "";
    });
    o.addEventListener("keydown", ev => {
      if (ev.key !== "Enter" || !ev.target.matches("input")) return; ev.preventDefault();
      const ins = [...o.querySelectorAll("input")], k2 = ins.indexOf(ev.target); if (ins[k2 + 1]) ins[k2 + 1].focus(); else save1();
    });
    document.body.appendChild(o); setTimeout(() => { const i0 = o.querySelector("input"); i0 && i0.focus(); }, 80);
  }
  const live = (id, path, lab, unit, mode) => `<label class="plab">${esc(lab)}</label><div class="field"><input id="${id}" data-live="${path}" inputmode="${mode || "decimal"}" value="${esc(String(getP(order, path) == null ? "" : getP(order, path)).replace(".", ","))}"><span class="u">${unit}</span></div>`;
  function dlScreenHtml(s) {
    const pk = s.pk, e = s.ent, N = order.entrances || 0, one = sameDL() && N > 1 ? " (на один подъезд)" : "";
    let h = "";
    if (e === 1) {
      h += live("d_n", "entrances", "Сколько подъездов?", "шт.", "numeric");
      h += `<div class="tgls" style="margin-top:12px">${tglHtml(["dl_same", "Размеры", "Одинаковые", ["Одинаковые", "Разные"]])}</div>`;
    }
    h += `<div class="tgls" style="margin-top:12px">${sameDL() ? tglHtml(["need_door", "Дверь", "Да"]) + tglHtml(["need_hatch", "Люк", "Да"]) : tglHtml([`${pk}.door.need`, "Дверь", "Да"]) + tglHtml([`${pk}.hatch.need`, "Люк", "Да"])}</div>`;
    if (getP(order, `${pk}.door.need`) === "Да") {
      h += `<h3 class="fh">Дверь</h3><p class="hint">Размер двери: высота минус 20, ширина минус 40.</p>` + doorPic(getP(order, s.casP), getP(order, s.hingeP));
      h += `<div class="tgls">${tglHtml([`${pk}.door.hinge`, "Петли", "Слева", ["Слева", "Справа"]])}</div>`;
      h += live("dd_h", `${pk}.door.h`, "Высота проёма", mm) + live("dd_w", `${pk}.door.w`, "Ширина проёма", mm) + live("dd_q", `${pk}.door.qty`, "Количество дверей" + one, "шт.", "numeric");
    }
    if (getP(order, `${pk}.hatch.need`) === "Да") {
      h += `<h3 class="fh">Люк</h3><p class="hint">Размер люка посчитаем сами: проём минус 10 мм. Наличник на люке со всех сторон.</p>` + hatchPic();
      h += live("hh_h", `${pk}.hatch.h`, "Высота проёма", mm) + live("hh_w", `${pk}.hatch.w`, "Ширина проёма", mm) + live("hh_q", `${pk}.hatch.qty`, "Количество люков" + one, "шт.", "numeric");
    }
    return h;
  }
  function controlHtml(s, val) {
    let h = "";
    if (s.dlscr) return dlScreenHtml(s);
    if (s.fscr) return controlBase(s, val) + `<h3 class="fh">Проём и обрамление</h3><p class="hint">Внутри проёма: «Этажность и ширина проёма» и «Размер С». Нажмите на часть обрамления, чтобы внести размеры.</p>` + dshToggle() + frameBig(1);
    if (s.t === "fscreen") return (s.floor === 1 ? dshToggle() : "") + bendToggle() + frameBig(s.floor);
    if (s.pic === "door") h += doorPic(getP(order, s.casP), getP(order, s.hingeP));
    else if (s.pic === "hatch") h += hatchPic();
    else if (s.pic === "section_l") h += `<div class="secpic">${sectionPic(true)}</div>`;
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
      if (f.k === "text") { const e = document.getElementById("f" + i); if (e) formDraft[f.p] = e.value; }
      if (f.k === "dims2") { const a = document.getElementById("f" + i + "a"), b = document.getElementById("f" + i + "b"); if (a && b) formDraft[f.p] = [a.value, b.value]; }
    });
  }
  function formHtml(s) {
    if (formDraft.__s !== s.p) formDraft = { __s: s.p };
    return (s.sch ? schemeBlock() : "") + `<div class="form">` + s.fields.map((f, i) => {
      if (!fvis(s, f)) return "";
      if (f.k === "h") return `<h3 class="fh">${esc(f.label)}</h3>`;
      const v = getP(order, f.p);
      if (f.k === "tgl") return tglHtml0(f.p, f.label, v === "Да");
      if (f.k === "text") { const raw = formDraft[f.p] !== undefined ? formDraft[f.p] : (v == null ? "" : String(v));
        return `<label class="plab">${esc(f.label)}</label><div class="field">${f.area ? `<textarea id="f${i}" rows="2" placeholder="${esc(f.ph || "")}">${esc(raw)}</textarea>` : `<input id="f${i}" enterkeyhint="next" placeholder="${esc(f.ph || "")}" value="${esc(raw)}" autocomplete="off">`}</div>`; }
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
    if (s.sch && !order.scheme) return fail("Выберите схему обрамления (А или В)", "");
    const out = [];
    for (let i = 0; i < s.fields.length; i++) {
      const f = s.fields[i]; if (!fvis(s, f)) continue;
      if (f.k === "text") { const r = parse({ t: "text" }, formDraft[f.p]); if (r.e) return fail(f.label + ": " + r.e, "f" + i); out.push([f.p, r.v]); }
      if (f.k === "num") { const r = parse({ t: "num", min: f.min != null ? f.min : 1, max: f.max }, formDraft[f.p]); if (r.e) return fail(f.label + ": " + r.e, "f" + i); out.push([f.p, r.v]); }
      if (f.k === "int") { const r = parse({ t: "int", min: f.min, max: f.max }, formDraft[f.p]); if (r.e) return fail(f.label + ": " + r.e, "f" + i); out.push([f.p, r.v]); }
      if (f.k === "floors") { const r = parse({ t: "floors" }, formDraft[f.p]); if (r.e) return fail(f.label + ": " + r.e, "f" + i); out.push([f.p, r.v]); }
      if (f.k === "dims2") { const d = formDraft[f.p] || ["", ""]; const r = parse({ t: "dims" }, d[0] + "*" + d[1]); if (r.e) return fail(f.label + ": введите высоту и ширину числами", "f" + i + "a"); out.push([f.p, r.v]); }
    }
    if (s.fscr) {
      if (!(out.length >= 0)) return;
      const bad = m => fail(m, "");
      out.forEach(([p, v]) => setP(order, p, v));
      if (!(order.stops > 0) || !(order.width > 0)) return bad("Нажмите «Этажность и ширина проёма» и внесите количество остановок и ширину проёма");
      const miss = OPEN.filter(x => !partOk(x[0])).map(x => ({ top: "верхнее", left: "левое", right: "правое" }[x[0]]));
      if (miss.length) return bad("Внесите размеры обрамления: " + miss.join(", "));
    }
    out.forEach(([p, v]) => setP(order, p, v));
    wizardView.err = ""; if (s.finish) s.finish(order);
    formDraft = {}; pos++; save(); return render();
  }
  function schemeBlock() {
    const val = order.scheme;
    return `<div class="schemes">${["А", "В"].map(k => `<button type="button" class="sch${val === k ? " on" : ""}" data-pick="${k}" aria-label="Схема ${k}">${schemeSvg(k)}<b>Схема ${k}</b><small>${k === "А" ? "Верхнее обрамление накрывает боковые" : "Верхнее обрамление между боковыми"}</small></button>`).join("")}</div>` + colorBlock();
  }
  function colorBlock() {
    const cur = getP(order, "common.color") || "RAL 7035";
    return `<label class="plab" style="margin-top:14px;display:block">Цвет окраски</label><div class="sw colsw">${[["7035", "#cbd0cc"], ["7038", "#b4b8b0"]].map(([n, h]) => `<button type="button" data-colpick="RAL ${n}" class="${cur === "RAL " + n ? "on" : ""}"><i style="background:${h}"></i>RAL ${n}${n === "7035" ? `<small class="std">применяется стандартно</small>` : ""}</button>`).join("")}</div>`;
  }
  function controlBase(s, val) {
    if (s.t === "form") return formHtml(s);
    if (s.t === "casing") return casingHtml(val);
    if (s.t === "pair") return s.pair.map(([p, lab], k) => { const v = getP(order, p); return `<label class="plab">${esc(lab)}</label><div class="field"><input id="${k ? "inp2" : "inp"}" inputmode="decimal" enterkeyhint="${k ? "done" : "next"}" value="${esc(v == null ? "" : String(v).replace(".", ","))}"><span class="u">${s.unit}</span></div>`; }).join("") + (s.qtyP ? `<label class="plab">${esc(s.qtyLab || "Количество")}</label><div class="field"><input id="inp3" inputmode="numeric" enterkeyhint="done" value="${esc(String(getP(order, s.qtyP) || ""))}"><span class="u">шт.</span></div>` : "");
    if (s.t === "toggles") return `<div class="tgls">${s.tg.map(tglHtml).join("")}</div>`;
    if (false) return `<div class="tgls">${s.tg.map(([p, lab, def, seg]) => { const v = getP(order, p) || (setP(order, p, def), def);
      if (seg) return `<div class="tgl segrow"><span>${esc(lab)}</span><div class="seg" role="radiogroup">${seg.map(o => `<button type="button" role="radio" aria-checked="${v === o}" class="${v === o ? "on" : ""}" data-seg="${esc(p)}|${esc(o)}">${esc(o)}</button>`).join("")}</div></div>`;
      return `<button class="tgl${v === "Да" ? " on" : ""}" role="switch" aria-checked="${v === "Да"}" data-tg="${p}"><span>${esc(lab)}</span><i class="sw2"><b></b></i></button>`; }).join("")}</div>`;
    if (s.t === "choice" && s.sash) {
      const kp = s.sash === "hinge" ? WK[getP(order, s.kindPath)] : null;
      return (s.pair ? s.pair.map(([p, lab], k) => live(k ? "inp2" : "inp", p, lab, mm)).join("") : "") + `<div class="schemes wsch">${s.ch.map(c => `<button class="sch${val === c ? " on" : ""}" data-pick="${esc(c)}">${s.sash === "hinge" ? sashSvg(kp, c) : sashSvg(WK[c], (s.pk && getP(order, s.pk + ".hinge")) || "Слева")}<b>${esc(c)}</b></button>`).join("")}</div>` + (s.sash === "type" ? (() => {
        const k = WK[val], turn = k === "tr" || k === "tt";
        return `<div class="tgls" style="margin-top:12px"><div${turn ? "" : ' style="opacity:.45"'}>${tglHtml([`${s.pk}.hinge`, "Петли", "Слева", ["Слева", "Справа"]])}</div>${tglHtml([`${s.pk}.ebb.need`, "Отлив", "Нет"])}</div>` + (getP(order, `${s.pk}.ebb.need`) === "Да" ? `<div class="ebbbox"><label class="plab">Длина отлива</label><div class="field"><input id="eb1" data-live="${s.pk}.ebb.l" inputmode="decimal" value="${esc(String(getP(order, s.pk + ".ebb.l") || "").replace(".", ","))}"><span class="u">мм</span></div><label class="plab">Ширина отлива</label><div class="field"><input id="eb2" data-live="${s.pk}.ebb.w" inputmode="decimal" value="${esc(String(getP(order, s.pk + ".ebb.w") || "").replace(".", ","))}"><span class="u">мм</span></div></div>` : "") + `<label class="plab" style="margin-top:12px;display:block">Количество таких окон</label><div class="field"><input id="eqty" data-live="${s.pk}.qty" inputmode="numeric" value="${esc(String(getP(order, s.pk + ".qty") || ""))}"><span class="u">шт.</span></div>`;
      })() : "");
    }
    if (s.t === "choice") return `<div class="choices">${s.ch.map(c => `<button class="choice${val === c ? " on" : ""}" data-pick="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
    if (s.t === "scheme") return `<div class="schemes">${["А", "В"].map(k => `<button class="sch${val === k ? " on" : ""}" data-pick="${k}" aria-label="Схема ${k}">${schemeSvg(k)}<b>Схема ${k}</b><small>${k === "А" ? "Верхнее обрамление накрывает боковые" : "Верхнее обрамление между боковыми"}</small></button>`).join("")}</div>` + colorBlock();
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
      if (s.p === "form.obj") setTimeout(() => { const t = document.querySelector(".form textarea,.form input"); if (t) t.focus(); }, 60);
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
    if (s.sash === "type") {
      if (s.pair) {
        const rs = s.pair.map(([p, lab], k) => parse({ t: "num", min: 100 }, (document.getElementById(k ? "inp2" : "inp") || {}).value)), bi = rs.findIndex(r => r.e);
        if (bi >= 0) { const m = s.pair[bi][1] + ": " + rs[bi].e; wizardView.err = m; const el = document.getElementById("err"); if (el) el.textContent = m; const f = document.getElementById(bi ? "inp2" : "inp"); if (f) f.focus(); return; }
        s.pair.forEach(([p], k) => setP(order, p, rs[k].v));
      }
      const bad = m => { wizardView.err = m; const el = document.getElementById("err"); if (el) el.textContent = m; };
      if (!getP(order, s.p)) return bad("Выберите, как открывается створка");
      if (getP(order, `${s.pk}.ebb.need`) === "Да") for (const [k, lab, id] of [["l", "Длина отлива", "eb1"], ["w", "Ширина отлива", "eb2"]]) { const r = parse({ t: "num", min: 1 }, (document.getElementById(id) || {}).value); if (r.e) { bad(lab + ": " + r.e); const f = document.getElementById(id); if (f) f.focus(); return; } setP(order, `${s.pk}.ebb.${k}`, r.v); }
      const q = parse({ t: "int", min: 1, max: 999 }, (document.getElementById("eqty") || {}).value); if (q.e) { bad("Количество окон: " + q.e); const f = document.getElementById("eqty"); if (f) f.focus(); return; }
      setP(order, `${s.pk}.qty`, q.v); wizardView.err = ""; pos++; save(); return render();
    }
    if (s.more) {
      setP(order, s.p, raw); order.wins = String(raw).startsWith("Добавить") ? Math.max(order.wins || 1, s.win + 1) : s.win;
      pos++; save(); return render();
    }
    if (s.t === "form") return submitForm(s);
    if (s.t === "pair") {
      const ids = ["inp", "inp2"], rs = s.pair.map((x, k) => parse({ t: "num", min: s.min || 10 }, (document.getElementById(ids[k]) || {}).value));
      const bad = rs.findIndex(r => r.e);
      if (bad >= 0) { const m = s.pair[bad][1] + ": " + rs[bad].e; wizardView.err = m; const el = document.getElementById("err"); if (el) el.textContent = m; const f = document.getElementById(ids[bad]); if (f) f.focus(); return; }
      let qr = null; if (s.qtyP) { qr = parse({ t: "int", min: 1, max: 999 }, (document.getElementById("inp3") || {}).value); if (qr.e) { const m = (s.qtyLab || "Количество") + ": " + qr.e; wizardView.err = m; const el = document.getElementById("err"); if (el) el.textContent = m; const f = document.getElementById("inp3"); if (f) f.focus(); return; } }
      wizardView.err = ""; s.pair.forEach(([p], k) => setP(order, p, rs[k].v)); if (qr) setP(order, s.qtyP, qr.v); pos++; save(); return render();
    }
    if (s.t === "fscreen") {
      if (!(order.stops > 0) || !(order.width > 0)) { const m = "Нажмите «Этажность и ширина проёма» и внесите количество остановок и ширину проёма"; wizardView.err = m; const el = document.getElementById("err"); if (el) el.textContent = m; return; }
      const miss = OPEN.filter(x => !partOk(x[0])).map(x => ({ top: "верхнее", left: "левое", right: "правое" }[x[0]]));
      if (miss.length) { const m = "Внесите размеры: " + miss.join(", "); wizardView.err = m; const el = document.getElementById("err"); if (el) el.textContent = m; return; }
      wizardView.err = ""; pos++; save(); return render();
    }
    if (s.dlscr) {
      const bad = (m, id) => { wizardView.err = m; const el = document.getElementById("err"); if (el) el.textContent = m; const f = document.getElementById(id); if (f) f.focus(); };
      const pk = s.pk, g = p => parse({ t: "num", min: 1 }, getP(order, p) == null ? "" : String(getP(order, p)));
      if (s.ent === 1) { const r = parse({ t: "int", min: 1, max: 50 }, getP(order, "entrances") == null ? "" : String(getP(order, "entrances"))); if (r.e) return bad("Сколько подъездов: " + r.e, "d_n"); order.entrances = r.v; }
      const needD = getP(order, `${pk}.door.need`) === "Да", needH = getP(order, `${pk}.hatch.need`) === "Да";
      if (!needD && !needH) return bad("Включите хотя бы дверь или люк", "");
      if (needD) for (const [k, lab, id, mn, it] of [["h", "Дверь, высота проёма", "dd_h", 100], ["w", "Дверь, ширина проёма", "dd_w", 100], ["qty", "Количество дверей", "dd_q", 1, 1]]) { const r = parse(it ? { t: "int", min: 1, max: 999 } : { t: "num", min: mn }, String(getP(order, `${pk}.door.${k}`) == null ? "" : getP(order, `${pk}.door.${k}`))); if (r.e) return bad(lab + ": " + r.e, id); setP(order, `${pk}.door.${k}`, r.v); }
      if (needH) for (const [k, lab, id, mn, it] of [["h", "Люк, высота проёма", "hh_h", 100], ["w", "Люк, ширина проёма", "hh_w", 100], ["qty", "Количество люков", "hh_q", 1, 1]]) { const r = parse(it ? { t: "int", min: 1, max: 999 } : { t: "num", min: mn }, String(getP(order, `${pk}.hatch.${k}`) == null ? "" : getP(order, `${pk}.hatch.${k}`))); if (r.e) return bad(lab + ": " + r.e, id); setP(order, `${pk}.hatch.${k}`, r.v); }
      wizardView.err = ""; pos++; save(); return render();
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
    const bortCard = () => `<div class="card sec-card"><h3>Бортики</h3>${["speed_limiter", "main_drive"].map(key => {
      const d = SUB[key], it = order.cable[key];
      return `<div class="bort-row"><b>${esc(d.title.replace("Бортики ", "Бортики "))}</b>${it ? `<div class="item"><span>${esc(it.h + "×" + it.w + "×" + it.l + " мм, " + it.qty + " шт.")}</span><button data-del="${key}:0" aria-label="Удалить">×</button></div>` : `<p class="hint">Не требуется</p><button class="btn sec" data-add="${key}">Добавить</button>`}</div>`;
    }).join("")}</div>`;
    shell("Что ещё нужно в заявку", 1,
      `<p class="hint">Обрамления внесены: ${order.stops ? (same() ? order.stops + " эт., одинаковые" : order.stops + " эт.") : "—"}. Добавьте остальное, если нужно.</p>` + sec("thresholds") + sec("nashchelnik") + bortCard(),
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
      `${supplyLink() ? `<button class="btn sec" data-a="supply_open">Открыть чат: ${esc(supply.app)}</button>` : ""}<button class="btn" data-a="send" disabled id="sendBtn">Отправить в снабжение</button><button class="btn sec" data-a="download">Скачать PDF</button>${order.kind === "win" ? `<button class="btn sec" data-a="addwin">Добавить ещё окно (другой размер или открывание)</button>` : ""}<button class="btn ghost" data-a="${isSimple() ? "back" : "hub"}">${isSimple() ? "Изменить ответы" : "Назад к разделам"}</button>`);
    try {
      const full = exportOrder();
      const canv = await PDFGEN.buildPages(full);
      const cityOf = ad => { const f = String(ad || "").split(",")[0].trim().replace(/^(г\.?|гор\.?|город)\s*/i, "").trim(); return String(ad || "").includes(",") ? f : ""; };
      const data = { app: "zamer-dsh", version: 1, kind: order.kind, city: cityOf(full.address), address: full.address, contact: full.contact, stamp: full.stamp, order: full };
      pdfCache = { blob: PDFGEN.makePdf(canv, full.address, data), name: fileName(), data };
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
        await navigator.share({ files: [file], title: pdfCache.title || order.address, text: "Заявка: " + (pdfCache.title || order.address) });
        sMeasReg(); return showDone("sent");
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    download(); sMeasReg(); showDone("saved");
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
  function showDone(kind) { sheetPush(); ominous("toll"); goal(kind === "sent" ? "sent" : "saved"); doneKind = kind; view = "done"; save(); liftClose(); }
  function liftClose() {
    const axm = pdfCache && pdfCache.axis, n = Math.max(1, axm ? ax.n : order.kind === "dl" ? (order.entrances || 1) : order.kind === "win" ? winItems().length : (order.stops || 1)), unit = axm ? "этажей" : order.kind === "dl" ? "подъездов" : order.kind === "win" ? "окон" : "этажей";
    const finish = () => { $app.style.transition = "none"; $app.style.transform = ""; render(); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return confetti(); }
    const L = document.createElement("div"); L.id = "lift"; L.className = "open ride";
    L.innerHTML = `<div class="head"><i>▲</i><b>1</b></div><div class="door l"><b class="st"></b><i class="pk"></i></div><div class="door r"><b class="st"></b><i class="pk"></i></div><div class="tag"><span>заказано ${unit}: ${n}</span></div>`;
    document.body.appendChild(L); void L.offsetWidth;
    const b = L.querySelector("b"), T = [], at = (ms, f) => T.push(setTimeout(f, ms));
    let iv = 0, done = false;
    const end = () => { if (done) return; done = true; T.forEach(clearTimeout); clearInterval(iv); finish(); L.classList.add("open"); confetti(); setTimeout(() => L.remove(), 2800); };
    L.addEventListener("click", () => { if (!done) end(); });
    at(40, () => { L.classList.remove("open"); L.querySelector(".tag").style.opacity = 1; });            // двери закрываются
    at(1900, () => {                                                                                       // кабина уезжает вверх
      $app.style.transition = "transform 1.6s cubic-bezier(.55,0,.85,.45)"; $app.style.transform = "translateY(-118%)";
      let c = 1; iv = setInterval(() => { c = Math.min(n, c + Math.max(1, Math.ceil(n / 12))); b.textContent = c; if (c >= n) clearInterval(iv); }, 120);
    });
    at(3700, () => { finish(); });                                                                         // новый экран за закрытыми дверями
    at(4300, () => { L.classList.add("open"); confetti(); setTimeout(() => L.remove(), 2800); done = true; });
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
  const APP_VERSION = "V.2-07";
  function menuView() {
    shell("Меню", null, `<div class="card">${LIM && acc.session ? `<div class="sum"><span><b>${esc(acc.name || "Аккаунт")}</b> (номер ${esc(acc.id)})</span><span>Осталось замеров: ${left()}</span></div>` : ""}<button class="btn sec" data-a="home">На главный экран</button><button class="btn sec" data-a="close">Вернуться к заявке</button><button class="btn sec" data-a="snd">${sndOn ? "🔊 Звуки: включены" : "🔇 Звуки: выключены"}</button><button class="btn sec" data-a="supply">Связь со снабжением</button><button class="btn sec" data-a="install">Инструкция по установке</button><button class="btn sec" data-a="refresh">Обновить приложение</button><button class="btn sec danger" data-a="new">Начать новую заявку</button>${LIM && acc.session ? `<button class="btn sec" data-a="logout">Выйти из аккаунта</button>` : ""}</div><p class="ver">Версия приложения: <b>${APP_VERSION}</b></p>`, "", { menu: false });
  }

  /* ---------- тестовый замер по осям ---------- */
  const AX_HD = 75, AX_FR = 80, AX_OFF = AX_HD + AX_FR / 2, AX_DSTD = 130, AX_ZSTD = 20;
  const axFresh = () => ({ n: 0, diff: false, B: "", V: "", A: "", Dm: "std", D: "", Zm: "std", Z: "", F: {}, W: {}, address: "", contact: "",
    P: { w: "", h: "", sw: "", sh: "", sdiff: false, ral: "7035", tab: true, tabFloor: "all", tabH: "", tabW: "", bm: "std", by: "", bh: "", bw: "" } });
  let ax = (() => { try { const s = JSON.parse(localStorage.getItem("zamer_axis")); return s ? Object.assign(axFresh(), s, { P: Object.assign(axFresh().P, s.P || {}) }) : axFresh(); } catch (e) { return axFresh(); } })();
  const axSave = () => { try { localStorage.setItem("zamer_axis", JSON.stringify(ax)); } catch (e) {} };
  const nm = v => { const x = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(x) ? x : NaN; };
  const axD = () => ax.Dm === "std" ? AX_DSTD : nm(ax.D), axZ = () => ax.Zm === "std" ? AX_ZSTD : nm(ax.Z);
  const axBf = i => ax.diff ? nm(ax.F[i]) : nm(ax.B);
  const axWf = i => ax.P.sdiff ? { w: nm((ax.W[i] || {}).w), h: nm((ax.W[i] || {}).h) } : { w: nm(ax.P.sw), h: nm(ax.P.sh) };
  const axDepth = b => Math.round((b + nm(ax.A) - nm(ax.V) - AX_OFF) * 10) / 10;
  const axBcnt = () => { let c = 0; for (let i = 1; i <= ax.n; i++) if (nm(ax.F[i]) > 0) c++; return c; };
  const axWcnt = () => { let c = 0; for (let i = 1; i <= ax.n; i++) { const w = axWf(i); if (w.w > 0 && w.h > 0) c++; } return c; };
  const axRal = () => "RAL " + ax.P.ral;
  function axMissing() {
    const m = [], P = ax.P;
    if (!ax.address.trim()) m.push("Адрес объекта"); if (!ax.contact.trim()) m.push("Контактное лицо и телефон");
    if (!(ax.n > 0)) m.push("Количество этажей");
    if (!ax.diff && !(nm(ax.B) > 0)) m.push("Б — от оси до стены"); if (ax.diff && ax.n > 0 && axBcnt() < ax.n) m.push("Б по этажам: введено " + axBcnt() + " из " + ax.n);
    if (!(nm(ax.V) > 0)) m.push("В — от оси до головы"); if (!(nm(ax.A) > 0)) m.push("А — толщина стены");
    if (!(axD() > 0)) m.push("Ширина обрамления (полка)"); if (!(axZ() >= 0)) m.push("Загиб");
    if (!(nm(P.w) > 0 && nm(P.h) > 0)) m.push("Портал: ширина и высота");
    if (!P.sdiff && !(nm(P.sw) > 0 && nm(P.sh) > 0)) m.push("Строительный проём: ширина и высота"); if (P.sdiff && ax.n > 0 && axWcnt() < ax.n) m.push("Проём по этажам: введено " + axWcnt() + " из " + ax.n);
    if (P.tab && !(nm(P.tabH) > 0 && nm(P.tabW) > 0)) m.push("Отверстие под табло: высота и ширина");
    if (P.bm === "own" && !(nm(P.by) > 0)) m.push("Кнопка: высота от пола");
    if (!(nm(P.bh) > 0 && nm(P.bw) > 0)) m.push("Отверстие под кнопку: высота и ширина");
    return m;
  }
  function axWarn() {
    const w = [], V = nm(ax.V), A = nm(ax.A), P = ax.P; let bad = 0;
    for (let i = 1; i <= ax.n; i++) { const b = axBf(i); if (!(b > 0 && V > 0 && A > 0)) continue; const d = axDepth(b); if (d <= 0 || d < A || V + AX_HD + AX_FR < b) bad++; }
    if (bad) w.push(ax.diff ? "На " + bad + " эт. размеры не сходятся: проверьте Б, В и А." : "Размеры не сходятся: проверьте Б, В и А.");
    for (let i = 1; i <= Math.max(1, ax.n); i++) { const s = axWf(i); if (nm(P.w) > 0 && s.w > 0 && nm(P.w) > s.w) { w.push("Портал шире строительного проёма."); break; } }
    return w;
  }
  function axPlan() {
    const AXY = 450, B = (ax.diff ? nm(ax.F[1]) : nm(ax.B)) || 900, V = nm(ax.V) || 760, A = nm(ax.A) || 200, P = ax.P;
    const W1 = (P.sdiff ? axWf(1).w : nm(P.sw)) || 1000, PW0 = nm(P.w) || 900, D = axD() || 130, Zk = Math.max(6, (axZ() || 20) * .36);
    const k = Math.min(.36, 354 / (B + A)), inY = AXY - B * k, outY = Math.min(inY - 26, AXY - (B + A) * k), fr = AXY - V * k, hd = fr - AX_HD * k,
      ctr = AXY - (V + AX_HD + AX_FR - AX_FR / 2) * k, tip = AXY - (V + AX_HD + AX_FR) * k;
    const hw = Math.max(70, Math.min(W1 * k / 2, 235)), x1 = 360 - hw, x2 = 360 + hw, pw = Math.min(PW0 * k / 2, hw - 4), p1 = 360 - pw, p2 = 360 + pw, dk = D * k;
    const hx1 = Math.max(115, p1 - 40), hx2 = Math.min(605, p2 + 40), bx = Math.min(hx2 + 22, 598), axx = x1 - dk - 20;
    const arr = (x, y1, y2) => `<path d="M${x} ${y1}V${y2}M${x - 4} ${y1 - 9}l4 9 4-9M${x - 4} ${y2 + 9}l4-9 4 9" class="dm"/>`;
    const svg =
      `<rect x="60" y="${outY}" width="600" height="${560 - outY}" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.4"/><rect x="60" y="${outY}" width="600" height="${560 - outY}" fill="url(#axh)"/>` +
      `<rect x="110" y="${inY}" width="500" height="${520 - inY}" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.4"/>` +
      `<rect x="${x1 + 1}" y="${outY - 3}" width="${x2 - x1 - 2}" height="${inY - outY + 5}" fill="var(--surface)"/><path d="M${x1} ${outY}V${inY}M${x2} ${outY}V${inY}" stroke="var(--ink)" stroke-width="2.4"/>` +
      `<path d="M${x1 - dk} ${outY - 6 + Zk}V${outY - 6}H${p1}V${ctr}M${x2 + dk} ${outY - 6 + Zk}V${outY - 6}H${p2}V${ctr}" stroke="var(--accent)" stroke-width="3.4" fill="none"/>` +
      `<rect x="${p1 - 4}" y="${tip}" width="8" height="${hd - tip}" fill="var(--accent)" opacity=".55" stroke="var(--ink)" stroke-width="1.4"/><rect x="${p2 - 4}" y="${tip}" width="8" height="${hd - tip}" fill="var(--accent)" opacity=".55" stroke="var(--ink)" stroke-width="1.4"/>` +
      `<rect x="${hx1}" y="${hd}" width="${hx2 - hx1}" height="${AX_HD * k}" rx="5" fill="var(--soft)" stroke="var(--ink)" stroke-width="2.2"/><text x="360" y="${hd + AX_HD * k / 2 + 5}" text-anchor="middle" class="lb" letter-spacing="2">ГОЛОВА ДШ 75</text>` +
      `<line x1="95" y1="${AXY}" x2="625" y2="${AXY}" stroke="var(--ink)" stroke-width="1.4" stroke-dasharray="14 5 3 5"/><circle cx="150" cy="${AXY}" r="8" class="dm"/><circle cx="570" cy="${AXY}" r="8" class="dm"/>` +
      `<text x="360" y="${AXY - 8}" text-anchor="middle" class="lb">ось направляющих</text>` + arr(130, AXY, inY) + arr(205, AXY, fr) + arr(axx, outY, inY) +
      `<path d="M${x1 - dk} 40H${x1}M${x1 - dk + 8} 36l-9 4 9 4M${x1 - 8} 36l9 4-9 4" class="dm"/>` +
      `<path d="M${bx} ${fr}V${hd}M${bx - 4} ${fr - 8}l4 8 4-8M${bx - 4} ${hd + 8}l4-8 4 8" class="dm"/><path d="M${bx} ${hd}V${tip}M${bx - 4} ${hd - 8}l4 8 4-8M${bx - 4} ${tip + 8}l4-8 4 8" class="dm" style="stroke:var(--accent)"/>` +
      `<text x="${bx + 6}" y="${fr - AX_HD * k / 2 + 4}" class="lb">75</text><text x="${bx + 6}" y="${hd - AX_FR / 2 * k + 4}" class="lb" style="fill:var(--accent)">80</text>` +
      `<text x="${x2 + 4}" y="${outY + (inY - outY) / 2 + 4}" class="lb" style="font-size:11px">проём ${W1}</text>`;
    const pos = { B: [94, (AXY + inY) / 2 - 10], V: [238, (AXY + fr) / 2 + 22], A: [Math.max(axx, 92), (outY + inY) / 2], P: [360, (outY + inY) / 2 + 4], D: [x1 - dk / 2, 40], Z: [x2 + dk / 2, 40] };
    return { svg, pos };
  }
  const axFmtN = n => { const m = n % 10, h = n % 100; return n + " " + (m === 1 && h !== 11 ? "этаж" : m >= 2 && m <= 4 && (h < 12 || h > 14) ? "этажа" : "этажей"); };
  const axSet = (id, v) => { const e = document.getElementById(id); if (e) e.innerHTML = v; };
  function axRows() {
    const rows = [], V = nm(ax.V), A = nm(ax.A);
    for (let i = 1; i <= ax.n; i++) { const b = axBf(i), w = axWf(i);
      rows.push({ floor: i, w: w.w > 0 ? w.w : "", h: w.h > 0 ? w.h : "", B: b > 0 ? b : "", depth: b > 0 && V > 0 && A > 0 ? axDepth(b) : "", D: axD(), Z: axZ(), qty: 1, color: axRal() }); }
    return rows;
  }
  function axUpdate() {
    const g = document.getElementById("axplan"); if (!g) return;
    const pl = axPlan(); g.innerHTML = pl.svg;
    Object.entries(pl.pos).forEach(([k, [x, y]]) => { const e = document.getElementById("axp_" + k); if (e) { e.style.left = (x / 7.2).toFixed(1) + "%"; e.style.top = (y / 6).toFixed(1) + "%"; } });
    const P = ax.P, setP = (k, t, done) => { const e = document.getElementById("axp_" + k); if (e) { e.textContent = t; e.classList.toggle("done", !!done); } };
    setP("B", ax.diff ? "Б " + axBcnt() + "/" + (ax.n || "?") : "Б " + (ax.B || "?"), ax.diff ? ax.n > 0 && axBcnt() === ax.n : !!ax.B);
    setP("V", "В " + (ax.V || "?"), !!ax.V); setP("A", "А " + (ax.A || "?"), !!ax.A);
    setP("D", "Д " + (axD() || "?"), ax.Dm !== "std"); setP("Z", "загиб " + (axZ() >= 0 ? axZ() : "?"), ax.Zm !== "std");
    setP("P", "Портал", nm(P.w) > 0 && nm(P.h) > 0);
    const bd = document.getElementById("axbadge"); if (bd) bd.textContent = ax.n > 0 ? axFmtN(ax.n) : "этажей: ?";
    const ni = document.getElementById("ax_n"); if (ni && document.activeElement !== ni) ni.value = ax.n || "";
    const dt = document.getElementById("ax_difft"); if (dt) { dt.classList.toggle("on", ax.diff); dt.setAttribute("aria-checked", ax.diff); }
    const fl = document.getElementById("ax_fl"); if (fl) { fl.hidden = !ax.diff; fl.querySelector("small").textContent = "Введено " + axBcnt() + " из " + (ax.n || "?"); }
    // результат
    const V = nm(ax.V), A = nm(ax.A), r = document.getElementById("axres"); if (!r) return;
    const warn = axWarn().map(t => `<div class="axmsg w">${esc(t)}</div>`).join("");
    if (!(V > 0 && A > 0) || !(ax.n > 0)) { r.innerHTML = `<div class="axmsg n">Введите количество этажей, Б, В и А. Глубина посчитается сама.</div>`; return; }
    let h = "";
    if (!ax.diff) {
      const b = nm(ax.B);
      h = b > 0 ? `<div class="axbig"><b>${axDepth(b)}</b><span>мм, на всех этажах</span></div><div class="axfm">Б + А − В − ${AX_OFF} = ${b} + ${A} − ${V} − ${AX_OFF}</div><div class="axfm">(голова ${AX_HD} + ½ рамки ${AX_FR / 2})</div>` : `<div class="axmsg n">Введите Б.</div>`;
    } else {
      let rows = "";
      for (let i = 1; i <= ax.n; i++) { const b = nm(ax.F[i]); rows += b > 0 ? `<div><span>${i}</span><span>${b}</span><b>${axDepth(b)}</b></div>` : `<div><span>${i}</span><span>—</span><span class="dim">не введено</span></div>`; }
      h = `<div class="axtbl"><div class="hd"><span>Этаж</span><span>Б, мм</span><span>Глубина</span></div>${rows}</div>`;
    }
    r.innerHTML = h + warn;
  }
  function axisView() {
    if (!ax.address && order.address) ax.address = order.address; if (!ax.contact && order.contact) ax.contact = order.contact;
    const pill = (k, a) => `<button class="axp" id="axp_${k}" data-a="${a}"></button>`;
    shell("Тестовый замер", null, `<div class="card"><span class="chip">Тестовая функция · обрамление по осям</span>
      <label class="plab">Адрес объекта</label><div class="field"><input id="ax_addr" value="${esc(ax.address)}" autocomplete="off" placeholder="Город, улица, дом"></div>
      <label class="plab">Контактное лицо и телефон</label><div class="field"><input id="ax_cont" value="${esc(ax.contact)}" autocomplete="off" placeholder="Имя, телефон"></div>
      <div class="axrow"><div><b>Сколько этажей?</b><small>Число остановок лифта</small></div><div class="axstep"><button type="button" data-a="ax_nm" aria-label="Меньше">−</button><input id="ax_n" inputmode="numeric" value="${ax.n || ""}" placeholder="0" aria-label="Количество этажей"><button type="button" data-a="ax_np" aria-label="Больше">+</button></div></div>
      <button type="button" class="tgl" id="ax_difft" role="switch" data-a="ax_diff"><span>Расстояние Б разное по этажам</span><i class="sw2"><b></b></i></button>
      <button type="button" class="axlist" id="ax_fl" data-a="ax_FL" hidden><span><b>Б по этажам</b><small></small></span><i>›</i></button></div>
    <div class="card"><h2 class="q" style="font-size:18px">Нажмите на размер на плане</h2><p class="hint">План перестраивается по вашим размерам. Табло, кнопка и цвет вводятся в окне «Портал».</p>
      <div class="axst"><svg viewBox="0 0 720 600" aria-hidden="true"><defs><pattern id="axh" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="var(--line)" stroke-width="2.5"/></pattern></defs><g id="axplan"></g></svg>
      ${pill("B", "ax_B")}${pill("V", "ax_V")}${pill("A", "ax_A")}${pill("D", "ax_D")}${pill("Z", "ax_Z")}${pill("P", "ax_P")}<div class="axbadge" id="axbadge"></div></div></div>
    <div class="card"><h2 class="q" style="font-size:18px">Глубина обрамления до центра рамки</h2><div id="axres"></div></div>`,
      `<button class="btn" data-a="ax_go">Проверить и сформировать бланк</button><button class="btn ghost" data-a="home">На главный экран</button>`, { menu: false });
    const bind = (id, f) => { const e = document.getElementById(id); if (e) e.oninput = () => { f(e.value); axSave(); }; };
    bind("ax_addr", v => ax.address = v); bind("ax_cont", v => ax.contact = v);
    bind("ax_n", v => { const x = parseInt(v.replace(/\D/g, ""), 10); ax.n = isFinite(x) ? Math.min(60, x) : 0; axUpdate(); });
    axUpdate();
  }
  let axOv = null, axKey = "", axUnlocked = false;
  function axClose() { if (axOv) { axOv.remove(); axOv = null; } axKey = ""; axUpdate(); }
  const axFld = (path, label, val, ph) => `<div><label class="axl">${label}</label><div class="field"><input data-ax="${path}" inputmode="decimal" placeholder="${ph || "0"}" value="${esc(val == null ? "" : val)}" autocomplete="off"><span class="axu">мм</span></div></div>`;
  const axSeg = (path, cur, items) => `<div class="axseg">${items.map(([v, t]) => `<button type="button" data-axs="${path}|${v}" class="${String(cur) === String(v) ? "on" : ""}">${t}</button>`).join("")}</div>`;
  function axSetPath(path, v) {
    const p = path.split("."); let o = ax;
    for (let i = 0; i < p.length - 1; i++) { if (o[p[i]] == null) o[p[i]] = {}; o = o[p[i]]; }
    o[p[p.length - 1]] = v;
  }
  function axOpen(key) {
    const P = ax.P; let h = "";
    const T = { B: ["Б — от оси до стены", "Расстояние от оси направляющих до внутренней грани стены, одинаковое на всех этажах.", "B"],
      V: ["В — от оси до головы", "От оси направляющих до лицевой стороны головы ДШ.", "V"], A: ["А — толщина стены", "Толщина стены в месте проёма.", "A"] };
    if (key === "B" && ax.diff) return axOpen("FL");
    if (T[key]) h = `<h3>${T[key][0]}</h3><p>${T[key][1]}</p>${axFld(T[key][2], "Размер", ax[T[key][2]])}`;
    else if (key === "D" || key === "Z") {
      const isD = key === "D", m = isD ? ax.Dm : ax.Zm;
      h = `<h3>${isD ? "Ширина обрамления (полка по стене)" : "Загиб обрамления"}</h3>${axSeg(isD ? "Dm" : "Zm", m, [["std", "Стандарт " + (isD ? AX_DSTD : AX_ZSTD) + " мм"], ["own", "Свой размер"]])}` +
        (m === "own" ? axFld(isD ? "D" : "Z", "Свой размер", isD ? ax.D : ax.Z) : `<p>Стандарт для всех этажей.</p>`);
    } else if (key === "FL" || key === "WL") {
      const W = key === "WL", cnt = W ? axWcnt() : axBcnt();
      h = `<h3>${W ? "Строительный проём по этажам" : "Б по этажам"}</h3><p>${W ? "Ширина и высота строительного проёма, мм." : "Расстояние от оси направляющих до стены, мм."}</p><div class="axprog"><i style="width:${ax.n ? 100 * cnt / ax.n : 0}%"></i></div><div class="axfl">`;
      for (let i = 1; i <= ax.n; i++) {
        const ok = W ? (axWf(i).w > 0 && axWf(i).h > 0) : nm(ax.F[i]) > 0;
        h += W ? `<div class="axfr"><label>Этаж ${i}${ok ? " ✓" : ""}</label><div class="axtwo"><div class="field"><input data-ax="W.${i}.w" inputmode="decimal" placeholder="Ширина" value="${esc((ax.W[i] || {}).w || "")}"></div><div class="field"><input data-ax="W.${i}.h" inputmode="decimal" placeholder="Высота" value="${esc((ax.W[i] || {}).h || "")}"></div></div></div>`
          : `<div class="axfr"><label>Этаж ${i}${ok ? " ✓" : ""}</label><div class="field"><input data-ax="F.${i}" inputmode="decimal" placeholder="0" value="${esc(ax.F[i] || "")}"><span class="axu">мм</span></div></div>`;
      }
      h += `</div><button class="btn sec" type="button" data-axsame="${key}">Всем как у 1-го</button>`;
    } else if (key === "P") {
      let fo = `<option value="all">На всех этажах</option>`; for (let i = 1; i <= ax.n; i++) fo += `<option value="${i}"${String(P.tabFloor) === String(i) ? " selected" : ""}>Этаж ${i}</option>`;
      h = `<h3>Портал и оснащение</h3>
        <div class="axsec"><b>Портал</b><div class="axtwo">${axFld("P.w", "Ширина портала", P.w)}${axFld("P.h", "Высота портала", P.h)}</div></div>
        <div class="axsec"><b>Строительный проём</b><button type="button" class="tgl${P.sdiff ? "" : " on"}" role="switch" aria-checked="${!P.sdiff}" data-axt="P.sdiff"><span>Одинаковый на всех этажах</span><i class="sw2"><b></b></i></button>` +
        (P.sdiff ? `<button type="button" class="axlist" data-axo="WL"><span><b>Проём по этажам</b><small>Введено ${axWcnt()} из ${ax.n || "?"}</small></span><i>›</i></button>` : `<div class="axtwo">${axFld("P.sw", "Ширина проёма", P.sw)}${axFld("P.sh", "Высота проёма", P.sh)}</div>`) + `</div>
        <div class="axsec"><b>Цвет окраски</b>${axSeg("P.ral", P.ral, [["7035", "RAL 7035<br><small>стандартно</small>"], ["7038", "RAL 7038"]])}</div>
        <div class="axsec"><b>Табло</b>${axSeg("P.tab", String(P.tab), [["true", "Есть"], ["false", "Нет"]])}` +
        (P.tab ? `<label class="axl">На каком этаже</label><select class="axsel" data-axsel="P.tabFloor">${fo}</select><div class="axtwo">${axFld("P.tabH", "Высота отверстия под табло", P.tabH)}${axFld("P.tabW", "Ширина отверстия под табло", P.tabW)}</div>` : `<p>Табло не заказывается.</p>`) + `</div>
        <div class="axsec"><b>Кнопка вызова</b><label class="axl">Размер от пола</label>${axSeg("P.bm", P.bm, [["std", "ГОСТ 1000 мм"], ["own", "Свой размер"]])}` +
        (P.bm === "own" ? axFld("P.by", "Высота от пола", P.by) : "") + `<div class="axtwo">${axFld("P.bh", "Высота отверстия под кнопку", P.bh)}${axFld("P.bw", "Ширина отверстия под кнопку", P.bw)}</div></div>`;
    }
    const keep = axOv ? axOv.querySelector(".sheetbox").scrollTop : 0;
    if (!axOv) { axOv = document.createElement("div"); axOv.className = "sheet"; document.body.appendChild(axOv);
      axOv.addEventListener("click", ev => {
        if (ev.target === axOv || ev.target.closest("[data-axclose]")) return axClose();
        const s = ev.target.closest("[data-axs]"), t = ev.target.closest("[data-axt]"), o = ev.target.closest("[data-axo]"), sm = ev.target.closest("[data-axsame]");
        if (s) { const i = s.dataset.axs.lastIndexOf("|"), v = s.dataset.axs.slice(i + 1); axSetPath(s.dataset.axs.slice(0, i), v === "true" ? true : v === "false" ? false : v); axSave(); return axOpen(axKey); }
        if (t) { const p = t.dataset.axt.split("."); axSetPath(t.dataset.axt, !ax[p[0]][p[1]]); axSave(); axOpen(axKey); if (ax.P.sdiff && !axWcnt() && ax.n) axOpen("WL"); return; }
        if (o) return axOpen(o.dataset.axo);
        if (sm) { if (sm.dataset.axsame === "WL") { const f = ax.W[1]; if (!f || !(nm(f.w) > 0)) return; for (let i = 2; i <= ax.n; i++) ax.W[i] = { w: f.w, h: f.h }; } else { const f = ax.F[1]; if (!(nm(f) > 0)) return; for (let i = 2; i <= ax.n; i++) ax.F[i] = f; } axSave(); axOpen(axKey); }
      });
      axOv.addEventListener("input", ev => { const e = ev.target; if (!e.dataset.ax) return; const v = e.value.replace(/[^\d.,]/g, ""); if (v !== e.value) e.value = v; axSetPath(e.dataset.ax, v); axSave(); axUpdate();
        const pr = axOv.querySelector(".axprog i"); if (pr && ax.n) pr.style.width = (100 * (axKey === "WL" ? axWcnt() : axBcnt()) / ax.n) + "%";
        const row = e.closest(".axfr"); if (row) { const lb = row.querySelector("label"), ok = axKey === "WL" ? (() => { const p = e.dataset.ax.split("."), w = axWf(+p[1]); return w.w > 0 && w.h > 0; })() : nm(e.value) > 0; lb.textContent = lb.textContent.replace(" ✓", "") + (ok ? " ✓" : ""); }
        const sm = axOv.querySelector(".axlist small"); if (sm) sm.textContent = "Введено " + axWcnt() + " из " + (ax.n || "?"); });
      axOv.addEventListener("change", ev => { const e = ev.target; if (e.dataset.axsel) { axSetPath(e.dataset.axsel, e.value); axSave(); axUpdate(); } });
      axOv.addEventListener("keydown", ev => { if (ev.key === "Enter" && ev.target.dataset && ev.target.dataset.ax) { const ins = [...axOv.querySelectorAll("input[data-ax]")], k = ins.indexOf(ev.target); ev.preventDefault(); if (ins[k + 1]) ins[k + 1].focus(); else if (axKey === "WL") axOpen("P"); else axClose(); } });
    }
    axKey = key;
    const back = key === "WL" ? "P" : "";
    axOv.innerHTML = `<div class="sheetbox scroll" role="dialog" aria-modal="true">${h}<button class="btn" type="button" ${back ? `data-axo="${back}"` : "data-axclose"}>Готово</button></div>`;
    axOv.querySelector(".sheetbox").scrollTop = keep;
    if (T[key] || key === "D" || key === "Z") { const i = axOv.querySelector("input[data-ax]"); if (i) i.focus(); }
    axUpdate();
  }
  function axExport() {
    const P = ax.P, stamp = dateLong(new Date(), true), D = axD(), V = nm(ax.V), A = nm(ax.A), openings = [];
    for (let i = 1; i <= ax.n; i++) {
      const b = axBf(i), w = axWf(i), d = b > 0 && V > 0 && A > 0 ? axDepth(b) : "";
      openings.push({ floor: i, width: w.w > 0 ? w.w : "", C: w.h > 0 ? w.h : "", top_A: D, top_H: d, left_H: d, left_B: D, right_H: d, right_B: D, qty: 1 });
    }
    const common = { bend_mode: "Без учёта загиба", bend: axZ(), color: axRal(),
      ind_floor: P.tab ? (P.tabFloor === "all" ? "На всех этажах" : "Этаж " + P.tabFloor) : "Нет табло", ind_size: P.tab ? nm(P.tabH) + "×" + nm(P.tabW) : "",
      btn_all: "На всех этажах", btn_floors: "", btn_side: "", btn_height: P.bm === "std" ? 1000 : nm(P.by), btn_size: nm(P.bh) + "×" + nm(P.bw) };
    return { stamp, address: ax.address.trim(), contact: ax.contact.trim(), worker: acc.name || "", scheme: "А", stops: ax.n, dsh_same: !ax.diff && !P.sdiff, common,
      thresholds: [], nashchelnik: [], cable: {}, openings };
  }
  async function axrevView() {
    const full = axExport();
    shell("Проверка заявки", 1, `<div class="card"><div class="sum"><span><b>Адрес:</b> ${esc(full.address)}</span><span><b>Контакт:</b> ${esc(full.contact)}</span><span><b>Этажей:</b> ${full.stops}</span><span><b>Глубина (Н):</b> ${ax.diff ? "по этажам, " + full.openings.map(r => r.top_H).join(", ") : full.openings[0] ? full.openings[0].top_H + " мм на всех этажах" : "—"}</span><span><b>Цвет:</b> ${esc(axRal())}</span></div></div><div class="card"><p class="hint" id="gen">Формирую бланк…</p><div class="pages" id="pages"></div></div>`,
      `${supplyLink() ? `<button class="btn sec" data-a="supply_open">Открыть чат: ${esc(supply.app)}</button>` : ""}<button class="btn" data-a="send" disabled id="sendBtn">Отправить в снабжение</button><button class="btn sec" data-a="download">Скачать PDF</button><button class="btn ghost" data-a="back">Изменить размеры</button>`, { menu: false });
    try {
      const canv = await PDFGEN.buildPages(full);
      const f = String(full.address).split(",")[0].trim().replace(/^(г\.?|гор\.?|город)\s*/i, "").trim(), city = full.address.includes(",") ? f : "";
      const data = { app: "zamer-dsh", version: 1, kind: "frame", city, address: full.address, contact: full.contact, stamp: full.stamp, order: full };
      const nameAddr = full.address.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Заявка";
      pdfCache = { blob: PDFGEN.makePdf(canv, full.address, data), name: "Обрамления - " + nameAddr + ".pdf", data, axis: true, title: full.address };
      const box = document.getElementById("pages"); if (!box) return;
      box.innerHTML = canv.map(c => `<img alt="Страница бланка" src="${c.toDataURL("image/jpeg", 0.6)}">`).join("");
      document.getElementById("gen").textContent = `Страниц: ${canv.length}. Проверьте и отправьте.`;
      document.getElementById("sendBtn").disabled = false;
    } catch (e) { const g = document.getElementById("gen"); if (g) g.textContent = "Не удалось сформировать бланк: " + e.message; }
  }
  function axAct(a) {
    if (a === "ax_nm") { ax.n = Math.max(0, (ax.n || 0) - 1); axSave(); return axUpdate(); }
    if (a === "ax_np") { ax.n = Math.min(60, (ax.n || 0) + 1); axSave(); return axUpdate(); }
    if (a === "ax_diff") { ax.diff = !ax.diff; axSave(); axUpdate(); if (ax.diff && ax.n > 0 && !axBcnt()) axOpen("FL"); return; }
    if (a === "ax_go") {
      const m = axMissing();
      if (m.length) {
        axOv = document.createElement("div"); axOv.className = "sheet"; document.body.appendChild(axOv);
        axOv.addEventListener("click", ev => { if (ev.target === axOv || ev.target.closest("[data-axclose]")) axClose(); });
        axOv.innerHTML = `<div class="sheetbox scroll" role="dialog" aria-modal="true"><h3>Не всё заполнено</h3><p>Чтобы собрать бланк, добавьте:</p><ul class="axmiss">${m.map(t => `<li>${esc(t)}</li>`).join("")}</ul><button class="btn" type="button" data-axclose>Вернуться к размерам</button></div>`;
        return;
      }
      view = "axrev"; return render();
    }
    if (/^ax_[BVADZP]$/.test(a) || a === "ax_FL") return axOpen(a.slice(3));
  }

  /* ---------- СТРОЙЛИФТКОМПЛЕКС: вход для сотрудников (монтажники, электрики, строители, прораб, руководитель, снабжение, ПТО, бухгалтер) ---------- */
  const S_ST = ["Начало работ", "Приёмка оборудования", "Демонтаж старого оборудования", "Монтаж направляющих", "Монтаж порталов ДШ", "Замена кабины", "Замена противовеса", "Электроразводка шахты", "Механоналадка", "Пусконаладочные работы", "Установка оборудования МП", "Замена лебёдки", "Запуск лифта"];
  const S_RN = { mon: "Монтажник", el: "Электрик", bld: "Строитель", pro: "Прораб", boss: "Руководитель", acc: "Бухгалтер", sup: "Снабжение", pto: "Отдел ПТО" };
  const S_KINDS = ["Двери шахты", "Люки", "Окна", "Обрамления", "Диспетчерская связь", "Расходники", "Электрика", "Стройматериалы"];
  const S_SUP = ["Получено", "Принято", "Пришло на объект"];
  const sTabsFor = r => ({ mon: ["Объекты", "Снабжение", "История"], el: ["Объекты", "Снабжение"], bld: ["Объекты", "Снабжение"], pro: ["Проверка", "Назначения", "Объекты", "ПТО", "Отчёты", "Сотрудники"], boss: ["Сводка", "Проверка", "Назначения", "Снабжение", "Финансы", "ПТО", "Отчёты", "Сотрудники"], acc: ["Финансы"], sup: ["Заявки"], pto: ["ПТО"] }[r] || []);
  const sTabs = () => sU && sU.dev ? ["Сотрудники"].concat(sTabsFor("boss").filter(t => t !== "Сотрудники")) : sTabsFor(sU.role);
  const sRoleName = () => sU.dev ? "Разработчик" : S_RN[sU.role];
  let sU = (() => { try { return JSON.parse(sessionStorage.getItem("zamer_slk")) || JSON.parse(localStorage.getItem("zamer_slk_rem")); } catch (e) { return null; } })();
  let sD = null, sTab = "", sBusy = false, sErr = "", sOpen = null, sPend = {}, sFlt = "", sPf = "Все", sWhy = "Неверная дата", sFin = null, sRep = null, sRper = "day", sRfrom = "", sRto = "";
  let sNr = { kind: "", addr: "", what: "" }, sHand = null, sAdd = null, sNu = { st: "монтажник", err: "", ok: "" }, sMoney = false, sSf = "Все";
  const sToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const sF = iso => iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) : "";
  const sDiff = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);
  const sH = h => (h || 0) + (sD ? Math.floor((Date.now() - sD.t) / 36e5) : 0);
  const sMoney$ = n => Number(n || 0).toLocaleString("ru-RU").replace(/ /g, " ");
  const sUrl = () => window.RABOTA_SHEET || "";
  const S_ERR = { pw: "Неверная фамилия или пароль", lock: "Слишком много неверных попыток. Подождите 15 минут", token: "Неверное секретное слово в sheet.js", role: "Для вашей роли это закрыто", forbidden: "Этот подъезд вам не назначен", busy: "Отчёт уже ждёт подтверждения", empty: "Отметьте хотя бы один этап", notready: "Заходить рано: лебёдка ещё не заменена", order: "Сначала нужен предыдущий шаг", done: "Это уже отправлено", people: "Проверьте фамилии: сотрудник с такой ролью не найден", dup: "Такая запись уже есть", pct: "Процент от 0 до 100", gone: "Отчёт уже обработан", bad: "Проверьте введённые данные", same: "Это тот же сотрудник" };
  async function sApi(action, body) {
    if (!sUrl()) throw new Error("Таблица ещё не подключена");
    const b = Object.assign({ token: window.RABOTA_TOKEN || "", action }, sU ? { fio: sU.fio, pw: sU.pw } : {}, body || {});
    let r; try { r = await fetch(sUrl(), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(b) }); } catch (e) { throw new Error("Нет связи с таблицей. Проверьте интернет"); }
    const j = await r.json();
    if (!j.ok) { const e = new Error(S_ERR[j.error] || j.error || "Ошибка таблицы"); e.code = j.error; throw e; }
    return j;
  }
  function sLogout(keep) { slkMeas = null; sStaff = null; sEd = null; sU = null; sD = null; sFin = null; sRep = null; sOpen = null; sPend = {}; sHand = null; sAdd = null; try { sessionStorage.removeItem("zamer_slk"); localStorage.removeItem("zamer_slk_rem"); } catch (e) {} if (!keep) { view = "home"; render(); } }
  async function sLoad(silent) {
    if (!sU) return; sBusy = true; sErr = ""; if (!silent && view === "slk") render();
    try { const j = await sApi("load"); sD = j; sD.t = Date.now(); sNotify(); }
    catch (e) { sErr = e.message; if (e.code === "pw" || e.code === "lock") { sLogout(true); sErr = e.message; view = "home"; } }
    sBusy = false; if (view === "slk" || view === "home") render();
  }
  function sNotify() {
    if (sU && (sU.role === "sup" || sU.role === "boss")) {
      let sr = {}; try { sr = JSON.parse(localStorage.getItem("zamer_slk_seenreq") || "{}"); } catch (e) {}
      const nw = sNewReqs().filter(r => !sr[r.id]);
      if (nw.length) { nw.forEach(r => { sr[r.id] = 1; }); try { localStorage.setItem("zamer_slk_seenreq", JSON.stringify(sr)); } catch (e) {} chime([660, 880], 0.06, 0.4, 0.06); setTimeout(() => toast(nw.length > 1 ? "Новых заявок: " + nw.length : "Новая заявка: " + nw[0].kind + ", " + nw[0].addr + (nw[0].ent ? ", п." + nw[0].ent : "")), 400); }
      return;
    }
    if (sU && (sU.role === "mon" || sU.role === "el" || sU.role === "bld")) {
      let sa = {}; try { sa = JSON.parse(localStorage.getItem("zamer_slk_seenacc") || "{}"); } catch (e) {}
      const ac = ((sD && sD.reqs) || []).filter(r => r.s === 1 && !sa[r.id]);
      if (ac.length) { ac.forEach(r => { sa[r.id] = 1; }); try { localStorage.setItem("zamer_slk_seenacc", JSON.stringify(sa)); } catch (e) {} chime([660, 880], 0.06, 0.4, 0.06); setTimeout(() => toast(ac.length > 1 ? "Снабжение приняло заявок: " + ac.length : "Снабжение приняло: " + ac[0].kind + ", " + ac[0].addr), 400); }
    }
    if (!sU || (sU.role !== "el" && sU.role !== "bld")) return;
    let seen = {}; try { seen = JSON.parse(localStorage.getItem("zamer_slk_seen") || "{}"); } catch (e) {}
    const fresh = (sD.lifts || []).filter(l => l.ready && !seen[sU.fio + "|" + l.key]);
    if (fresh.length) { fresh.forEach(l => { seen[sU.fio + "|" + l.key] = 1; }); try { localStorage.setItem("zamer_slk_seen", JSON.stringify(seen)); } catch (e) {} chime([660, 880], 0.06, 0.4, 0.06); setTimeout(() => toast("Можно заходить на объект: " + fresh.map(l => l.addr + ", п." + l.ent).join("; ")), 400); }
  }
  setInterval(() => { if (sU && (sU.role === "sup" || sU.role === "boss") && view === "slk" && !document.hidden && !sBusy) sLoad(true); }, 60000);
  async function sCall(action, body, msg) {
    toast("Сохраняем…");
    try { const j = await sApi(action, body); await sLoad(true); toast(msg || "Готово ✓"); return j; }
    catch (e) { toast(e.message); return null; }
  }
  function sQuickSheet(l) {
    let kind = "", what = ""; const o = document.createElement("div"); o.className = "sheet";
    const draw = () => { o.innerHTML = `<div class="sheetbox scroll" role="dialog" aria-modal="true"><h3>Короткая заявка</h3><p class="hint">${esc(l.addr)}, подъезд ${esc(l.ent)}</p><p class="hint" style="margin:8px 0 4px">Что нужно</p><div class="rchips">${S_KINDS.map((k, n) => `<button class="${kind === k ? "on" : ""}" data-k="${n}">${k}</button>`).join("")}</div><label class="plab" style="margin-top:8px">Подробности и количество</label><div class="field"><input id="qw" autocomplete="off" value="${esc(what)}" placeholder="Например, кабель 5×2,5, 100 м"></div><p class="err" id="qe"></p><button class="btn" data-q="go" ${kind ? "" : "disabled"}>Отправить в снабжение</button><button class="btn ghost" data-q="no">Закрыть</button></div>`; };
    draw();
    o.addEventListener("input", ev => { if (ev.target.id === "qw") what = ev.target.value; });
    o.addEventListener("click", async ev => {
      const b = ev.target.closest("[data-k]"); if (b) { what = (o.querySelector("#qw") || {}).value || what; kind = S_KINDS[+b.dataset.k]; draw(); return; }
      if (ev.target === o || ev.target.closest("[data-q=no]")) return o.remove();
      if (ev.target.closest("[data-q=go]")) { const e = o.querySelector("#qe"); e.textContent = "Отправляем…";
        try { await sApi("req_new", { kind, addr: l.addr, ent: l.ent, what, src: "короткая заявка" }); o.remove(); await sLoad(true); toast("Заявка отправлена в снабжение ✓"); render(); }
        catch (er) { e.textContent = er.message; } }
    });
    document.body.appendChild(o);
  }
  function sMeasSummary() {
    const lines = [kindName() + ". " + (order.address || "")]; if (order.contact) lines.push("Контакт: " + order.contact);
    try {
      if (order.kind === "win") winItems().forEach(w => lines.push("Окно " + w.n + ": " + [w.kindName, (w.w || "?") + "×" + (w.h || "?") + " мм", w.hinge ? "петли " + w.hinge : "", w.qty ? w.qty + " шт." : "", w.ebb ? "отлив " + w.ebb.l + "×" + w.ebb.w : ""].filter(Boolean).join(", ")));
      else if (order.kind === "frame") { const o = exportOrder(); lines.push("Остановок: " + (o.stops || "?") + (o.scheme ? ", схема " + o.scheme : "")); }
      else lines.push("Подъездов в заявке: " + (order.entrances || 1));
    } catch (e) {}
    lines.push("Полный бланк PDF отправлен в чат снабжения."); return lines.join("\n").slice(0, 1800);
  }
  async function sMeasReg() {
    if (!slkMeas || !sU || !pdfCache || pdfCache.slkReg) return; pdfCache.slkReg = 1;
    const KM = { dl: "Замер: двери и люки", win: "Замер: окна", frame: "Замер: обрамления" };
    const body = { kind: KM[order.kind] || KM.frame, addr: slkMeas.addr, ent: slkMeas.ent, what: kindName() + ", бланк PDF", comp: sMeasSummary(), src: "заявка с размерами" };
    try { await sApi("req_new", body); toast("Заявка передана в снабжение ✓"); sLoad(true); }
    catch (e) { pdfCache.slkReg = 0; toast("Заявка в таблицу не ушла: " + e.message + ". Нажмите «Отправить» ещё раз"); }
  }
  function sLoginSheet() {
    const o = document.createElement("div"); o.className = "sheet";
    o.innerHTML = `<div class="sheetbox" role="dialog" aria-modal="true"><h3>Вход для сотрудников</h3><p>Фамилия и личный пароль. Их записал прораб или руководитель в таблице, лист «Доступ».</p><div class="field"><input id="sfio" autocomplete="off" autocapitalize="words" placeholder="Фамилия"></div><div class="field"><input id="spw" type="password" autocomplete="off" autocapitalize="off" placeholder="Пароль"></div><label class="srem"><input type="checkbox" id="srem"> Запомнить на этом телефоне</label><p class="err" id="sloge"></p><button class="btn" type="button" id="slogok">Войти</button><button class="btn ghost" type="button" id="slogno">Отмена</button></div>`;
    document.body.appendChild(o);
    const go = async () => {
      const fio = o.querySelector("#sfio").value.trim(), pw = o.querySelector("#spw").value.trim(), er = o.querySelector("#sloge"); if (!fio || !pw) { er.textContent = "Введите фамилию и пароль"; return; }
      er.textContent = "Проверяем…";
      try { sU = null; const tmp = { fio, pw }; sU = tmp; const j = await sApi("login"); sU = { fio: j.user.fio, pw, role: j.user.role, brig: j.user.brig || "", dev: !!j.user.dev };
        try { sessionStorage.setItem("zamer_slk", JSON.stringify(sU)); if (o.querySelector("#srem").checked) localStorage.setItem("zamer_slk_rem", JSON.stringify(sU)); } catch (e) {}
        sD = null; sTab = sTabs()[0]; sOpen = null; o.remove(); wail(); view = "slk"; render(); sLoad(); }
      catch (e) { sU = null; er.textContent = e.message; o.querySelector("#spw").value = ""; }
    };
    o.querySelector("#slogok").onclick = go; o.querySelector("#slogno").onclick = () => o.remove();
    o.querySelector("#spw").onkeydown = ev => { if (ev.key === "Enter") go(); };
    o.addEventListener("click", ev => { if (ev.target === o) o.remove(); });
    setTimeout(() => o.querySelector("#sfio").focus(), 60);
  }

  /* --- мелкие части интерфейса --- */
  const sBdg = (cls, t) => `<span class="sb ${cls}">${esc(t)}</span>`;
  const sWait = h => { h = sH(h); return h >= 24 ? sBdg("bad", `Эскалация руководителю (${h} ч)`) : h >= 12 ? sBdg("warn", `Напоминание прорабу (${h} ч)`) : sBdg("wait", `Ожидает подтверждения (${h} ч)`); };
  const sRepB = l => !l.rep ? sBdg("no", "нет отчёта") : l.rep.st === "ok" ? sBdg("ok", "Подтверждено") : l.rep.st === "back" ? sBdg("bad", "Возвращено: " + l.rep.why) : sWait(l.rep.h);
  const sCrewB = c => c.st === "wait" ? sWait(c.h) + ` <small class="hint">${c.kind === "out" ? "сделали" : "зашли"} ${sF(c.date)}</small>` : c.st === "back" ? sBdg("bad", "Возвращено: " + c.why) : c.out ? sBdg("ok", "Сделано " + sF(c.out) + " · подтверждено") : c.in ? sBdg("ok", "Зашли " + sF(c.in) + " · подтверждено") : sBdg("no", "—");
  const sGate = l => l.ready ? sBdg("ok", "Можно заходить") : sBdg("warn", "Ждём лебёдку");
  const sNote = (t, c) => `<div class="snote ${c || ""}">${t}</div>`;
  const sDays = l => l.start ? Math.max(1, sDiff(l.start, sToday()) + 1) : 0;
  const sLeft = l => l.due ? sDiff(sToday(), l.due) : "—";
  const sCnt = l => `<div class="scnt"><div><b>${sDays(l) || "—"}</b><small>день на объекте</small></div><div><b>${sLeft(l)}</b><small>дней осталось</small></div><div><b>${l.pto ? sF(l.pto) : "—"}</b><small>ПТО назначено</small></div></div>`;
  const sRows = (l) => (l.hist ? l.hist.split("\n").filter(Boolean) : []);
  const sReqBtns = i => `<div class="sreqrow"><button class="btn sec" data-a="s:mreq:${i}">Заявка с размерами</button><button class="btn sec" data-a="s:qreq:${i}">Короткая заявка</button></div>`;
  function sLiftCard(l, i, act, extra) {
    return `<div class="rhouse"><div class="rh1"><b>${esc(l.addr)} · п.${esc(l.ent)}</b><span>${l.pct}%</span></div><p class="hint">${esc(l.city)} · ${esc(l.brig)} · монтажник ${esc(l.mon)} · сдать до ${sF(l.due) || "—"}</p><div class="rbar"><i style="width:${l.pct}%"></i></div>${extra || ""}${act ? `<button class="btn sec" data-a="${act}">${act.startsWith("s:open") ? "Открыть этапы" : "Подробнее"}</button>` : ""}</div>`;
  }
  const sTabBar = () => sTabs().length < 2 ? "" : `<div class="stabs">${sTabs().map(t => `<button class="${sTab === t ? "on" : ""}" data-a="s:tab:${t}">${t}${t === "Проверка" && sD && sPending().length ? " (" + sPending().length + ")" : ""}${(t === "Снабжение" || t === "Заявки") && sD && (sU.role === "sup" || sU.role === "boss") && sNewReqs().length ? " (" + sNewReqs().length + ")" : ""}</button>`).join("")}</div>`;
  const sNewReqs = () => ((sD && sD.reqs) || []).filter(r => r.s === 0);
  function sPending() {
    const o = []; if (!sD) return o;
    (sD.lifts || []).forEach((l, i) => {
      if (l.rep && l.rep.st === "wait") o.push({ i, type: "mon", id: l.rep.id, h: sH(l.rep.h), l, txt: Object.keys((l.rep.data || {}).changes || {}).map(k => (+k + 1) + ". " + S_ST[k] + " " + sF(l.rep.data.changes[k])), who: "Монтажник " + l.mon + " · " + l.brig });
      ["el", "bld"].forEach(r => { const c = l[r + "R"]; if (c && c.st === "wait") o.push({ i, type: r, id: c.id, h: sH(c.h), l, txt: [(c.kind === "out" ? "Работы выполнены " : "Зашли на объект ") + sF(c.date)], who: S_RN[r] + " " + l[r] }); });
    });
    return o;
  }

  /* --- вкладки --- */
  function sReqForm() {
    const addrs = [...new Set((sD.lifts || []).map(l => l.addr))];
    return `<div class="card"><b>Новая заявка</b><p class="hint" style="margin:6px 0 4px">Что нужно</p><div class="rchips">${S_KINDS.map(k => `<button class="${sNr.kind === k ? "on" : ""}" data-a="s:nrk:${S_KINDS.indexOf(k)}">${k}</button>`).join("")}</div><p class="hint" style="margin:8px 0 4px">Объект</p><div class="rchips">${addrs.map((a, i) => `<button class="${sNr.addr === a ? "on" : ""}" data-a="s:nra:${i}">${esc(a)}</button>`).join("")}</div><label class="plab" style="margin-top:8px">Подробности и количество</label><div class="field"><input id="snrw" data-sf="nrw" autocomplete="off" value="${esc(sNr.what)}" placeholder="Например, кабель 5×2,5, 100 м"></div><button class="btn" style="margin-top:10px" data-a="s:nrsend" ${sNr.kind && sNr.addr ? "" : "disabled"}>Отправить в снабжение</button></div>`;
  }
  function sReqCard(x, i, mode) {
    const LBL = ["Получено", "Принято", "На объекте"], steps = LBL.map((l, k) => `<span class="${k <= x.s ? "on" : ""}">${l}</span>`).join("");
    let btn = "";
    if (mode === "sup" && x.s === 0) btn = `<button class="btn" data-a="s:racc:${i}">Проверил: принять заявку</button>`;
    if (mode === "own" && x.s === 1) btn = `<button class="btn" data-a="s:rarr:${i}">Пришло на объект</button>`;
    if (x.s === 2) btn = sNote("Материал на объекте ✓", "ok");
    const where = (x.city ? esc(x.city) + ", " : "") + esc(x.addr) + (x.ent ? ", подъезд " + esc(x.ent) : "");
    const acc = x.s >= 1 && x.accBy ? sNote("Снабжение приняло заявку: " + esc(x.accBy.replace(/^снабжение /i, "")) + (x.accAt ? ", " + esc(x.accAt) : ""), "ok") : x.s === 0 && mode === "own" ? sNote("Ждёт, пока снабжение примет заявку.") : "";
    return `<div class="card sreq"><div class="rq1"><b>${esc(x.kind)}</b>${x.num ? `<span class="rqn">№ ${esc(x.num)}</span>` : ""}</div><p class="rqm">${esc(x.by)}${x.brig ? " · " + esc(x.brig) : ""} · ${esc(x.at)}</p><p class="rqw">${esc(x.what)}</p><p class="rqm">${where}${x.src ? " · " + esc(x.src) : ""}</p>${x.comp ? `<details class="scomp"><summary>Размеры и состав</summary><p>${esc(x.comp).replace(/\n/g, "<br>")}</p></details>` : ""}${acc}<div class="ssteps">${steps}</div>${btn}</div>`;
  }
  function sReqTab(mode) {
    const rs = sD.reqs || [];
    const head = mode === "sup" ? (sNewReqs().length ? sNote("🔔 Новых заявок: " + sNewReqs().length + ". Проверьте и нажмите «Проверил: принять заявку», чтобы подтвердить приём.", "bad") : "") + sNote("Здесь все заявки. Бригады и сотрудники видят только свои.", "ok") + `<div class="rchips">${["Все", ...new Set(rs.map(r => r.brig))].map((b, i) => `<button class="${sSf === b ? "on" : ""}" data-a="s:sf:${i}">${esc(b)}</button>`).join("")}</div>` : sNote(sU.role === "mon" ? `Вы видите заявки бригады «${esc(sU.brig)}».` : "Вы видите только свои заявки.") + sReqForm();
    const list = rs.map((x, i) => ({ x, i })).filter(o => mode !== "sup" || sSf === "Все" || o.x.brig === sSf);
    return head + (list.length ? list.map(o => sReqCard(o.x, o.i, mode)).join("") : `<div class="card"><p class="hint">Заявок пока нет.</p></div>`);
  }
  function sMonObjects() {
    const ls = sD.lifts || []; if (!ls.length) return `<div class="card"><p class="hint">Вам пока не назначены подъезды. Их назначает прораб.</p></div>`;
    return ls.map((l, i) => { const mine = sRows(l).filter(t => t.includes("→ " + sU.fio + ","));
      return sLiftCard(l, i, `s:open:${i}`, sCnt(l) + `<div style="margin:4px 0 8px">${sRepB(l)}</div>` + mine.map(t => sNote(esc(t))).join("") + sReqBtns(i)); }).join("") + `<p class="hint">Видны только подъезды, назначенные вам прорабом.</p>`;
  }
  function sSubObjects() {
    const ls = sD.lifts || [], me = sU.role; if (!ls.length) return `<div class="card"><p class="hint">Вам пока не назначены подъезды.</p></div>`;
    return sNote("Заходить на объект можно после замены лебёдки: придёт уведомление. Отчёты «зашли» и «сделали» подтверждает прораб.") + ls.map((l, i) => {
      const c = l[me + "R"], mine = sRows(l).filter(t => t.includes("→ " + sU.fio + ","));
      let act = "";
      if (!l.ready) act = sNote("Ждите: лебёдка ещё не заменена.");
      else if (c.st === "wait") act = sNote(`Отчёт «${c.kind === "out" ? "работы выполнены" : "зашли"} ${sF(c.date)}» у прораба, ждёт подтверждения (${sH(c.h)} ч).`);
      else if (c.st === "back") act = sNote("Прораб вернул отчёт: " + esc(c.why) + ".", "bad") + `<button class="btn" style="margin-top:8px" data-a="s:crew:${i}:${c.kind === "out" ? "out" : "in"}">Отправить снова</button>`;
      else if (!c.in) act = sNote("🔔 Можно заходить на объект (с " + sF(l.readyDate) + ")", "ok") + `<button class="btn" style="margin-top:8px" data-a="s:crew:${i}:in">Зашли на объект</button>`;
      else if (!c.out) act = `<p class="hint">Зашли ${sF(c.in)} (подтверждено прорабом)</p><button class="btn" data-a="s:crew:${i}:out">Работы выполнены</button>`;
      else act = sNote(`Зашли ${sF(c.in)} · сделано ${sF(c.out)} · подтверждено прорабом ✓`, "ok");
      return `<div class="rhouse${l.ready ? " hot" : ""}"><div class="rh1"><b>${esc(l.addr)} · п.${esc(l.ent)}</b>${sGate(l)}</div><p class="hint">${esc(l.city)} · монтаж: ${esc(l.brig)} · сдать до ${sF(l.due) || "—"}</p>${mine.map(t => sNote(esc(t))).join("")}${act}${sReqBtns(i)}</div>`;
    }).join("");
  }
  function sHistory() {
    const done = (sD.lifts || []).filter(l => l.st[12]);
    return (done.length ? done.map(l => `<div class="card"><div class="rh1"><b>${esc(l.city)}, ${esc(l.addr)} · п.${esc(l.ent)}</b><span class="hint">сдан ${sF(l.st[12])}</span></div><p class="hint" style="margin:2px 0">${l.start ? Math.max(1, sDiff(l.start, l.st[12]) + 1) + " дн. на замену" : ""}</p></div>`).join("") : `<div class="card"><p class="hint">Сданных подъездов пока нет.</p></div>`)
      + sNote("Деньги в истории показываются только по запросу.") + `<button class="btn sec" data-a="s:money">Запросить мои выплаты</button>` + (sMoney ? sNote("Запрос записан в журнал. Ответ даст бухгалтер.", "ok") : "");
  }
  function sCheckTab() {
    const p = sPending(), late = p.filter(x => x.h >= 12);
    return (late.length ? sNote(`Напоминание: ${late.length} отчёт(а) ждут подтверждения больше 12 часов.`, "bad") : "") + (p.length ? p.map(x => `<div class="rhouse hot"><div class="rh1"><b>${esc(x.l.addr)} · п.${esc(x.l.ent)}</b>${sWait(x.h)}</div><p class="hint">${esc(x.who)}</p>${x.txt.map(t => `<div class="srow">${esc(t)}</div>`).join("")}${x.type === "mon" && (x.l.rep.data.changes || {})[11] ? sNote("После «Принять» электрик " + esc(x.l.el) + " и строитель " + esc(x.l.bld) + " получат уведомление «можно заходить».", "ok") : ""}<p class="hint" style="margin:8px 0 4px">Вернуть, причина:</p><div class="rchips">${["Неверная дата", "Не хватает акта", "Этап не завершён"].map(w => `<button class="${sWhy === w ? "on" : ""}" data-a="s:why:${["Неверная дата", "Не хватает акта", "Этап не завершён"].indexOf(w)}">${w}</button>`).join("")}</div><div class="srow2"><button class="btn warn" data-a="s:dec:${x.id}:0">Вернуть</button><button class="btn" data-a="s:dec:${x.id}:1">Принять</button></div></div>`).join("") : `<div class="card"><b>Новых отчётов нет</b><p class="hint">Отчёты монтажников, электриков и строителей появятся здесь.</p></div>`);
  }
  function sHandForm() {
    const h = sHand; if (!h) return "";
    const l = sD.lifts[h.i], cur = l[h.role], cands = (sD.users || []).filter(u => u.role === h.role && u.fio !== cur);
    return `<div class="rhouse hot"><b>Замена: ${S_RN[h.role].toLowerCase()}, ${esc(l.addr)} · п.${esc(l.ent)}</b><p class="hint">Сейчас: ${esc(cur)}. Кто продолжит:</p><div class="rchips">${cands.map((u, k) => `<button class="${h.nw === u.fio ? "on" : ""}" data-a="s:hn:${k}">${esc(u.fio)}</button>`).join("")}</div><label class="plab">Сколько уже сделал ${esc(cur)} на этом подъезде, %</label><div class="field"><input id="shp" data-sf="hp" inputmode="numeric" value="${esc(h.pct)}" placeholder="Например, 60"></div><label class="plab">Комментарий</label><div class="field"><input id="shc" data-sf="hc" autocomplete="off" value="${esc(h.comment)}" placeholder="Что сделано, что осталось"></div>${h.err ? `<p class="err">${esc(h.err)}</p>` : ""}<div class="srow2"><button class="btn sec" data-a="s:hno">Отмена</button><button class="btn" data-a="s:hok">Заменить</button></div></div>`;
  }
  function sAddForm() {
    const a = sAdd; if (!a) return "";
    const opt = (r, cur) => `<option value="">— выбрать —</option>` + (sD.users || []).filter(u => u.role === r).map(u => `<option${u.fio === cur ? " selected" : ""}>${esc(u.fio)}</option>`).join("");
    const rows = a.ents.map((e, i) => `<div class="srow3"><b>п.${i + 1}</b><select data-se="${i}:mon">${opt("mon", e.mon)}</select><select data-se="${i}:el">${opt("el", e.el)}</select><select data-se="${i}:bld">${opt("bld", e.bld)}</select></div>`).join("");
    return `<div class="rhouse hot"><b>Новый дом</b><label class="plab">Город</label><div class="field"><input data-sf="acity" autocomplete="off" value="${esc(a.city)}"></div><label class="plab">Регион России</label><div class="field"><input data-sf="areg" list="s_regs" autocomplete="off" value="${esc(a.reg)}"></div><datalist id="s_regs">${(sD.regions || []).map(r => `<option value="${esc(r)}">`).join("")}</datalist><label class="plab">Адрес (улица, дом)</label><div class="field"><input data-sf="aaddr" autocomplete="off" value="${esc(a.addr)}"></div><label class="plab">Сколько подъездов (лифтов)</label><div class="field"><input id="san" data-sf="an" inputmode="numeric" maxlength="2" value="${esc(a.n)}"></div><label class="plab">Сдать до</label><div class="field"><input type="date" data-sf="adue" value="${esc(a.due)}"></div>${a.ents.length ? `<p class="hint" style="margin:10px 0 4px">Заполнить всем подъездам сразу:</p><div class="srow3"><b></b><select data-sall="mon">${opt("mon", "")}</select><select data-sall="el">${opt("el", "")}</select><select data-sall="bld">${opt("bld", "")}</select></div><div class="srow3 sh"><b></b><small>Монтажник</small><small>Электрик</small><small>Строитель</small></div>${rows}` : ""}${a.err ? `<p class="err">${esc(a.err)}</p>` : ""}<div class="srow2"><button class="btn sec" data-a="s:addno">Отмена</button><button class="btn" data-a="s:${a.ents.length ? "addok" : "addn"}">${a.ents.length ? "Создать дом" : "Далее: назначить людей"}</button></div></div>`;
  }
  function sAssignTab() {
    const ls = sD.lifts || [];
    const line = (l, i, r) => `<div class="srow4"><span class="hint">${S_RN[r]}</span><b>${esc(l[r])}</b><button class="btn sec sm" data-a="s:hand:${i}:${r}">Заменить</button></div>`;
    return sHandForm() + sAddForm() + (sAdd ? "" : `<button class="btn" data-a="s:addh">+ Добавить дом</button>`) + sNote("Каждый подъезд отдельной строкой. При замене монтажника, электрика или строителя указывается, сколько процентов сделал прежний: старые записи остаются.")
      + ls.map((l, i) => `<div class="rhouse"><b>${esc(l.city)}, ${esc(l.addr)} · п.${esc(l.ent)}</b>${line(l, i, "mon")}${line(l, i, "el")}${line(l, i, "bld")}<label class="plab">Сдать до</label><div class="field"><input type="date" data-sdue="${i}" value="${esc(l.due)}"></div>${sRows(l).map(t => `<p class="hint" style="margin:4px 0 0">${esc(t)}</p>`).join("")}</div>`).join("");
  }
  function sAllObjects() {
    const ls = sD.lifts || [];
    return ls.map((l, i) => sLiftCard(l, i, `s:open:${i}`, `<div class="hint">Монтаж: ${sRepB(l)}</div><div class="hint" style="margin-top:4px">Электрик ${esc(l.el)}: ${sCrewB(l.elR)}</div><div class="hint" style="margin:4px 0 8px">Строитель ${esc(l.bld)}: ${sCrewB(l.bldR)}</div>` + sRows(l).map(t => `<p class="hint" style="margin:0 0 4px">${esc(t)}</p>`).join(""))).join("") || `<div class="card"><p class="hint">Подъездов нет.</p></div>`;
  }
  function sPtoTab() {
    const ls = (sD.lifts || []).map((l, i) => ({ l, i })), cities = ["Все", ...new Set(ls.map(o => o.l.city))], vis = ls.filter(o => sPf === "Все" || o.l.city === sPf);
    return `<p class="hint">Город</p><div class="rchips">${cities.map((c, k) => `<button class="${sPf === c ? "on" : ""}" data-a="s:pf:${k}">${esc(c)}</button>`).join("")}</div>` + vis.map(o => `<div class="rhouse"><div class="rh1"><b>${esc(o.l.addr)} · п.${esc(o.l.ent)}</b>${o.l.decl ? sBdg("ok", "Декларация получена") : o.l.pto ? sBdg("wait", "ПТО назначено") : sBdg("no", "не назначено")}</div><p class="hint">${esc(o.l.city)} · готово ${o.l.pct}%</p><div class="sgrid"><div><label class="plab">Дата проведения ПТО</label><div class="field"><input type="date" data-spto="${o.i}:pto" value="${esc(o.l.pto)}"></div></div><div><label class="plab">Декларация получена</label><div class="field"><input type="date" data-spto="${o.i}:decl" value="${esc(o.l.decl)}"></div></div></div></div>`).join("") + sNote("Дата ПТО сразу видна монтажнику и прорабу в карточке подъезда.");
  }
  const sGen = () => { for (;;) { let p = String(10000000 + Math.floor(Math.random() * 90000000)); if (!/(\d)\1\1/.test(p) && new Set(p).size >= 6 && !/0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210/.test(p)) return p; } };
  let sStaff = null, sStaffLoading = false, sEd = null, sShowPw = false;
  async function sLoadStaff() { sStaffLoading = true; try { sStaff = (await sApi("users_full")).list; } catch (e) { sErr = e.message; sStaff = []; } sStaffLoading = false; if (view === "slk") render(); }
  const S_STATUSES_ALL = ["монтажник", "электрик", "строитель", "прораб", "руководитель", "бухгалтер", "снабжение", "ПТО"];
  const sStatuses = () => sU.dev ? S_STATUSES_ALL : S_STATUSES_ALL.slice(0, 3);
  function sStaffForm(pre, st, v) {
    return `<p class="hint" style="margin:6px 0 4px">Статус</p><div class="rchips">${sStatuses().map((r, i) => `<button class="${st === r ? "on" : ""}" data-a="s:${pre}st:${i}">${r}</button>`).join("")}</div><label class="plab">Фамилия</label><div class="field"><input id="${pre}f" autocomplete="off" autocapitalize="words" value="${esc(v.fio || "")}"></div><label class="plab">Бригада (монтажникам, электрикам, строителям)</label><div class="field"><input id="${pre}b" list="s_brs" autocomplete="off" placeholder="Бригада 1" value="${esc(v.brig || "")}"></div><label class="plab">Почта Google (только если работает в таблице на компьютере)</label><div class="field"><input id="${pre}e" autocomplete="off" inputmode="email" value="${esc(v.email || "")}"></div><label class="plab">Пароль (от 6 символов)</label><div class="field"><input id="${pre}p" autocomplete="off" autocapitalize="off" value="${esc(v.pw || "")}"></div><button class="btn sec" style="margin-top:8px" data-a="s:${pre}gen">Придумать пароль</button>`;
  }
  function sStaffTab() {
    if (!sStaff) return `<div class="card"><p class="hint">Загружаем список сотрудников…</p></div>`;
    const brs = [...new Set(sStaff.map(u => u.brig).filter(Boolean))];
    const add = `<div class="rhouse hot"><b>Добавить сотрудника</b>${sStaffForm("nu", sNu.st, sNu)}${sNu.err ? `<p class="err">${esc(sNu.err)}</p>` : ""}${sNu.ok ? sNote(esc(sNu.ok), "ok") : ""}<button class="btn" style="margin-top:8px" data-a="s:nuadd">Дать доступ</button></div><datalist id="s_brs">${brs.map(b => `<option value="${esc(b)}">`).join("")}</datalist>`;
    const list = sStaff.map((u, i) => sEd && sEd.r === u.r
      ? `<div class="rhouse hot"><b>Изменить: ${esc(u.fio)}</b>${u.dev ? sNote("Статус разработчика не меняется. Здесь можно сменить пароль и фамилию.") + `<label class="plab">Фамилия для входа</label><div class="field"><input id="edf" value="${esc(sEd.fio)}"></div><label class="plab">Пароль</label><div class="field"><input id="edp" autocomplete="off" autocapitalize="off" value="${esc(sEd.pw)}"></div><input type="hidden" id="edb" value="${esc(sEd.brig)}"><input type="hidden" id="ede" value="${esc(sEd.email)}"><button class="btn sec" style="margin-top:8px" data-a="s:edgen">Придумать пароль</button>` : sStaffForm("ed", sEd.st, sEd)}${sEd.err ? `<p class="err">${esc(sEd.err)}</p>` : ""}<div class="srow2"><button class="btn sec" data-a="s:edno">Отмена</button><button class="btn" data-a="s:edok">Сохранить</button></div></div>`
      : `<div class="rhouse"><div class="rh1"><b>${esc(u.fio)}</b>${u.dev ? sBdg("ok", "разработчик") : sBdg("wait", u.st)}</div><p class="hint">${u.brig ? esc(u.brig) + " · " : ""}пароль: <b>${sShowPw ? esc(u.pw) : "••••••••"}</b></p><div class="srow2"><button class="btn sec" data-a="s:ed:${i}">Изменить</button>${u.dev ? "" : `<button class="btn warn" data-a="s:del:${i}">Удалить</button>`}</div></div>`).join("");
    return sNote(sU.dev ? "Здесь вы даёте доступ всем остальным: фамилия, статус и пароль. Человек входит в приложении по фамилии и этому паролю. Всё сразу записывается в таблицу, лист «Доступ»." : "Здесь вы даёте доступ монтажникам, электрикам и строителям: фамилия, бригада и пароль. Человек входит по фамилии и этому паролю.") + add + `<button class="btn sec" data-a="s:showpw">${sShowPw ? "Скрыть пароли" : "Показать пароли"}</button>` + list;
  }
  const sRead = id => ((document.getElementById(id) || {}).value || "").trim();
  function sFinCalc(f) {
    const pool = Object.assign({}, f.pay), o = { rows: [], br: {}, city: {}, all: 0 };
    f.rows.forEach((r, i) => { const t = (+r.work || 0) + (+r.road || 0) + (+r.flat || 0) + (+r.scrap || 0), left = pool[r.brig] || 0, c = Math.min(t, left); pool[r.brig] = left - c; o.rows[i] = { t, c, l: t - c }; const b = o.br[r.brig] = o.br[r.brig] || { tot: 0, left: 0 }; b.tot += t; b.left += t - c; o.city[r.city] = (o.city[r.city] || 0) + t - c; o.all += t - c; });
    Object.keys(f.pay).forEach(b => { o.br[b] = o.br[b] || { tot: 0, left: 0 }; });
    return o;
  }
  function sFinTab() {
    if (!sFin) return `<div class="card"><p class="hint">Загружаем финансы…</p></div>`;
    const c = sFinCalc(sFin), brs = Object.keys(sFin.pay);
    let out = sNote("Бригаде выдаётся одна сумма. Приложение раскидывает её по адресам по очереди, поэтому остаток виден по каждому адресу.");
    out += `<div class="card"><b>Выдано бригадам одной суммой, ₽</b>${brs.map((b, i) => `<div class="rh1" style="margin-top:6px"><span>${esc(b)}</span><span class="hint">осталось <b data-o="bl:${i}">${sMoney$(c.br[b].left)}</b> ₽</span></div><div class="field"><input inputmode="numeric" data-sfp="${i}" value="${sFin.pay[b]}"></div>`).join("")}<div class="field" style="margin-top:8px"><input id="snb" placeholder="+ новая бригада" autocomplete="off"></div><button class="btn sec" style="margin-top:6px" data-a="s:fbr">Добавить бригаду</button></div>`;
    out += sFin.rows.map((r, i) => `<div class="rhouse"><div class="sgrid"><div><label class="plab">Бригада</label><div class="field"><select data-sff="${i}:brig">${brs.map(b => `<option${b === r.brig ? " selected" : ""}>${esc(b)}</option>`).join("")}</select></div></div><div><label class="plab">Город</label><div class="field"><input data-sff="${i}:city" value="${esc(r.city)}"></div></div></div><label class="plab">Адрес</label><div class="field"><input data-sff="${i}:addr" value="${esc(r.addr)}"></div><div class="sgrid">${[["work", "Работы"], ["road", "Дорога"], ["flat", "Квартира"], ["scrap", "Металлолом"]].map(([k, n]) => `<div><label class="plab">${n}, ₽</label><div class="field"><input inputmode="numeric" data-sff="${i}:${k}" value="${r[k]}"></div></div>`).join("")}</div><p class="hint" style="margin-top:6px">Начислено <b data-o="t${i}">${sMoney$(c.rows[i].t)}</b> · покрыто <b data-o="c${i}">${sMoney$(c.rows[i].c)}</b> · остаток <b data-o="l${i}">${sMoney$(c.rows[i].l)}</b> ₽</p></div>`).join("");
    out += `<button class="btn sec" data-a="s:frow">+ Добавить адрес</button><div class="card"><b>Остаток по городам</b>${Object.keys(c.city).map((k, i) => `<div class="rh1" style="margin-top:6px"><span>${esc(k)}</span><b data-o="ct:${i}">${sMoney$(c.city[k])} ₽</b></div>`).join("") || `<p class="hint">Пока нет строк.</p>`}</div><div class="card hot"><div class="rh1"><b>Всего к выплате</b><b data-o="all">${sMoney$(c.all)} ₽</b></div></div><button class="btn" data-a="s:fsave">Сохранить в таблицу</button>`;
    return out;
  }
  function sUpdFin() {
    const c = sFinCalc(sFin), brs = Object.keys(sFin.pay), m = { all: sMoney$(c.all) + " ₽" };
    sFin.rows.forEach((r, i) => { m["t" + i] = sMoney$(c.rows[i].t); m["c" + i] = sMoney$(c.rows[i].c); m["l" + i] = sMoney$(c.rows[i].l); });
    brs.forEach((b, i) => { m["bl:" + i] = sMoney$(c.br[b].left); }); Object.keys(c.city).forEach((k, i) => { m["ct:" + i] = sMoney$(c.city[k]) + " ₽"; });
    document.querySelectorAll("[data-o]").forEach(el => { if (m[el.dataset.o] != null) el.textContent = m[el.dataset.o]; });
  }
  function sSummary() {
    const ls = sD.lifts || [], p = sPending(), esc24 = p.filter(x => x.h >= 24), avg = ls.length ? Math.round(ls.reduce((a, l) => a + l.pct, 0) / ls.length) : 0;
    const grp = key => { const g = {}; ls.forEach(l => { const k = l[key] || "—"; const o = g[k] = g[k] || { n: 0, done: 0, pct: 0 }; o.n++; o.pct += l.pct; if (l.st[12]) o.done++; }); return g; };
    const bars = g => Object.keys(g).sort().map(k => { const o = g[k], v = Math.round(o.pct / o.n); return `<div class="rhb"><span>${esc(k)}</span><div><i style="width:${v}%;background:var(--accent)"></i></div><b>${v}%</b></div><p class="hint" style="margin:-2px 0 6px 92px">сдано ${o.done} из ${o.n}</p>`; }).join("");
    return (esc24.length ? sNote(`Начальнику участка: ${esc24.length} отчёт(а) не подтверждены прорабом больше 24 часов: ${esc24.map(x => esc(x.l.addr) + ", п." + esc(x.l.ent)).join("; ")}.`, "bad") : "")
      + `<div class="rsum"><div><b>${ls.length}</b><small>подъездов</small></div><div><b>${avg}%</b><small>средний прогресс</small></div><div><b>${p.length}</b><small>ждут подтверждения</small></div></div>`
      + `<div class="card"><h3 class="rh3">Бригады: готовность</h3>${bars(grp("brig"))}</div><div class="card"><h3 class="rh3">По регионам</h3>${bars(grp("reg"))}</div><div class="card"><h3 class="rh3">По городам</h3>${bars(grp("city"))}</div>`
      + (sFin ? `<div class="card hot"><div class="rh1"><b>Остаток к выплате</b><b>${sMoney$(sFinCalc(sFin).all)} ₽</b></div></div>` : "");
  }
  function sRepHtml(r) {
    if (!r) return `<div class="card"><p class="hint">Нажмите «Сформировать сейчас».</p></div>`;
    const per = sRper, perN = { day: "за сегодня", week: "за неделю", month: "за месяц", custom: "за выбранный период" }[per], none = per === "day" && !r.stages.length && !r.crew.reduce((a, c) => a + c.finished, 0);
    return `<div class="card hot"><b>Отчёт ${perN}</b><p class="hint" style="margin:2px 0 0">${sF(r.from)}${r.from !== r.to ? " — " + sF(r.to) : ""} · сформирован ${new Date(r.made).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p></div>`
      + (none ? sNote("За сегодня окончаний этапов нет. Ежедневный отчёт по расписанию в такие дни не формируется.") : "")
      + `<div class="rsum"><div><b>${r.done}</b><small>подъездов сдано</small></div><div><b>${r.stages.length}</b><small>этапов выполнено</small></div><div><b>${r.avg}%</b><small>средний прогресс</small></div></div>`
      + `<div class="card"><h3 class="rh3">Окончания этапов</h3>${r.stages.length ? r.stages.map(s => `<p class="hint" style="margin:0 0 4px">${esc(s.brig)}: ${esc(s.addr)}, п.${esc(s.ent)} — <b>${esc(s.stage)}</b> (${sF(s.date)})</p>`).join("") : `<p class="hint">Нет.</p>`}</div>`
      + `<div class="card"><h3 class="rh3">Бригады</h3><div class="stbl"><table><tr><th>Бригада</th><th>Этапов</th><th>Сдано</th><th>В работе</th></tr>${r.byBrig.map(b => `<tr><td>${esc(b.brig)}</td><td>${b.stages}</td><td>${b.done}</td><td>${b.work}</td></tr>`).join("")}</table></div></div>`
      + `<div class="card"><h3 class="rh3">Электрики и строители</h3><p class="hint" style="margin:0 0 4px">Доля = закончили ÷ закреплённых подъездов (только подтверждённое прорабом).</p><div class="stbl"><table><tr><th>Фамилия</th><th>Закреп.</th><th>Зашли</th><th>Закончили</th><th>Доля</th></tr>${r.crew.map(c => `<tr><td>${esc(c.fio)}<br><small>${c.role === "el" ? "электрик" : "строитель"}</small></td><td>${c.assigned}</td><td>${c.entered}</td><td>${c.finished}</td><td><b>${c.share}%</b></td></tr>`).join("")}</table></div></div>`
      + `<div class="card"><h3 class="rh3">Ожидают подтверждения, просрочка, замены</h3><p class="hint" style="margin:0 0 4px">Ждут: ${r.pending.length}${r.late ? ", дольше 12 ч: " + r.late : ""}.</p><p class="hint" style="margin:0 0 4px">Просрочен срок сдачи: ${r.overdue.length ? r.overdue.map(o => esc(o.addr) + ", п." + esc(o.ent) + " (" + o.days + " дн.)").join("; ") : "нет"}.</p><p class="hint" style="margin:0">Замены: ${r.replaces.length ? r.replaces.map(esc).join("; ") : "нет"}.</p></div>`
      + (r.money ? `<div class="card"><h3 class="rh3">Деньги</h3><p class="hint" style="margin:0">Остаток к выплате: <b>${sMoney$(r.money.all)} ₽</b> · ${r.money.br.map(b => esc(b.brig) + " " + sMoney$(b.left)).join(" · ")}</p></div>` : "")
      + `<p class="hint">По расписанию: ежедневный в 18:00 (если были окончания), еженедельный по понедельникам, ежемесячный 1-го числа. Они сохраняются на листе «Отчёты» в таблице.</p>`;
  }
  function sRepTab() {
    return `<div class="rchips">${[["day", "День"], ["week", "Неделя"], ["month", "Месяц"], ["custom", "Свой период"]].map(([k, n]) => `<button class="${sRper === k ? "on" : ""}" data-a="s:rper:${k}">${n}</button>`).join("")}</div>`
      + (sRper === "custom" ? `<div class="sgrid"><div><label class="plab">С</label><div class="field"><input type="date" data-sf="rfrom" value="${esc(sRfrom)}"></div></div><div><label class="plab">По</label><div class="field"><input type="date" data-sf="rto" value="${esc(sRto)}"></div></div></div>` : "")
      + `<button class="btn" data-a="s:rnow">Сформировать сейчас</button>` + sRepHtml(sRep);
  }

  /* --- карточка подъезда: этапы --- */
  function sLiftDetail() {
    const l = (sD.lifts || [])[sOpen]; if (!l) { sOpen = null; return slkView(); }
    const direct = sU.role === "pro" || sU.role === "boss", pend = sPend[l.key] = sPend[l.key] || {}, locked = l.rep && l.rep.st === "wait";
    const rows = S_ST.map((n, i) => {
      const d = l.st[i], p = pend[i], on = !!(d || p);
      return `<div class="rrow${on ? " on" : ""}"><button class="rchk" data-a="s:tg:${i}" ${!direct && (d || locked) ? "disabled" : ""} aria-pressed="${on}">${on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ""}</button><span class="rn"><i>${i + 1}.</i> ${esc(n)}</span>${direct ? `<input class="rdate" type="date" value="${d || ""}" data-sdir="${i}" aria-label="Дата: ${esc(n)}">` : d ? `<span class="hint">${sF(d)}</span>` : p ? `<input class="rdate" type="date" value="${p}" data-spend="${i}">` : ""}</div>`;
    }).join("");
    const np = Object.keys(pend).length;
    return `<div class="rcard"><div class="rring" style="--p:${l.pct}"><b>${l.pct}%</b></div><div class="rinfo"><b>${esc(l.addr)}</b><span>${esc(l.city)} · подъезд ${esc(l.ent)} · ${esc(l.brig)}</span><span>Электрик ${esc(l.el)} · строитель ${esc(l.bld)}</span></div></div>${sCnt(l)}`
      + (l.rep && l.rep.st === "ok" && !direct ? sNote("Прораб подтвердил отчёт ✓", "ok") : "") + (l.rep && l.rep.st === "back" && !direct ? sNote("Отчёт возвращён: " + esc(l.rep.why) + ". Исправьте и отправьте снова.", "bad") : "") + (locked && !direct ? sNote(`Отчёт у прораба, ждёт подтверждения (${sH(l.rep.h)} ч).`) : "")
      + `<div class="rlist">${rows}</div>` + (direct ? sNote("Вы вносите дату напрямую: она сразу попадает в таблицу, подтверждение не нужно.") : sNote("Нажмите на квадрат: этап отмечен сегодняшней датой. Отметки уйдут прорабу, в таблицу они попадут после его подтверждения. После этапа «Замена лебёдки» электрик и строитель подъезда получат уведомление."));
  }

  function slkView() {
    if (!sU) { view = "home"; return render(); }
    const sub = sRoleName() + (sU.brig ? " · " + sU.brig : "");
    let body;
    if (!sD) body = sErr ? `<div class="card"><p class="err">${esc(sErr)}</p></div>` : `<div class="card"><p class="hint">Загружаем данные из таблицы…</p></div>`;
    else if (sOpen !== null) body = sLiftDetail();
    else {
      const t = sTab, r = sU.role, m = {
        "Объекты": () => r === "mon" ? sMonObjects() : r === "el" || r === "bld" ? sSubObjects() : sAllObjects(), "Снабжение": () => r === "boss" ? sReqTab("sup") : sReqTab("own"), "Заявки": () => sReqTab("sup"), "История": sHistory, "Проверка": sCheckTab, "Назначения": sAssignTab,
        "ПТО": sPtoTab, "Сотрудники": sStaffTab, "Финансы": sFinTab, "Сводка": sSummary, "Отчёты": sRepTab
      };
      body = sTabBar() + (sErr ? `<p class="err">${esc(sErr)}</p>` : "") + (m[t] || m[sTabs()[0]])();
    }
    const crew = sU.role === "mon" || sU.role === "el" || sU.role === "bld" || sU.role === "pro" || sU.role === "boss";
    let foot = "";
    if (sD && sOpen !== null) { const l = sD.lifts[sOpen], np = Object.keys(sPend[l.key] || {}).length; const direct = sU.role === "pro" || sU.role === "boss"; foot = direct ? `<button class="btn ghost" data-a="s:close">К списку</button>` : `<button class="btn" data-a="s:send" ${np && !(l.rep && l.rep.st === "wait") ? "" : "disabled"}>Отправить прорабу${np ? " (" + np + ")" : ""}</button><button class="btn ghost" data-a="s:close">К моим объектам</button>`; }
    else foot = `<button class="btn" data-a="s:reload">${sBusy ? "Обновляем…" : "Обновить данные"}</button>${crew ? `<button class="btn sec" data-a="sec_claim">Составление рекламации</button>` : ""}${window.RABOTA_TABLE_URL && (sU.role === "pro" || sU.role === "boss") ? `<a class="btn sec" href="${esc(window.RABOTA_TABLE_URL)}" target="_blank" rel="noopener">Открыть Google-таблицу</a>` : ""}<button class="btn ghost" data-a="s:logout">Выйти</button>`;
    shell(sU.fio + " · " + sub, null, body, foot, { menu: false });
    if (sD && sTab === "Сотрудники" && !sStaff && !sStaffLoading) sLoadStaff();
    if (sD && sU.role === "boss" && sTab === "Сводка" && !sFin && !sFin_loading) sLoadFin();
    if (sD && (sU.role === "acc" || (sU.role === "boss" && sTab === "Финансы")) && !sFin && !sFin_loading) sLoadFin();
  }
  let sFin_loading = false;
  async function sLoadFin() { sFin_loading = true; try { sFin = await sApi("fin_get"); } catch (e) { sErr = e.message; } sFin_loading = false; if (view === "slk") render(); }
  function sAct(a) {
    const p = a.split(":"), c = p[0];
    if (c === "enter") { if (sU) { view = "slk"; render(); if (!sD) sLoad(); return; } return sLoginSheet(); }
    if (c === "logout") return sLogout();
    if (c === "reload") { sFin = null; sStaff = null; return sLoad(); }
    if (c === "tab") { sTab = p[1]; sOpen = null; sErr = ""; render(); return window.scrollTo(0, 0); }
    if (c === "open") { sOpen = +p[1]; render(); return window.scrollTo(0, 0); }
    if (c === "close") { sOpen = null; return render(); }
    if (c === "tg") {
      const l = sD.lifts[sOpen], i = +p[1];
      if (sU.role === "pro" || sU.role === "boss") return sCall("setstage", { key: l.key, i, iso: l.st[i] ? "" : sToday() }, "Дата записана в таблицу ✓");
      const pend = sPend[l.key] = sPend[l.key] || {}; if (pend[i]) delete pend[i]; else pend[i] = sToday(); return render();
    }
    if (c === "send") { const l = sD.lifts[sOpen], ch = sPend[l.key] || {}; return sCall("send_mon", { key: l.key, changes: ch }, "Отчёт отправлен прорабу ✓").then(j => { if (j) { delete sPend[l.key]; sOpen = null; render(); } }); }
    if (c === "crew") { const l = sD.lifts[+p[1]]; return sCall("send_crew", { key: l.key, kind: p[2] }, "Отчёт отправлен прорабу ✓"); }
    if (c === "why") { sWhy = ["Неверная дата", "Не хватает акта", "Этап не завершён"][+p[1]]; return render(); }
    if (c === "dec") return sCall("decide", { id: p[1], ok: p[2] === "1", why: sWhy }, p[2] === "1" ? "Принято ✓" : "Возвращено");
    if (c === "mback") { slkMeas = null; order = fresh(); pdfCache = null; save(); view = "slk"; return render(); }
    if (c === "mreq") { const l = (sD.lifts || [])[+p[1]]; if (!l) return; if (hasDraft() && !confirm("На телефоне есть незаконченная заявка из раздела замеров. Начать новую? Текущие ответы будут удалены.")) return; slkMeas = { addr: l.addr, ent: l.ent, city: l.city }; order = fresh(); pos = 0; sub = null; pdfCache = null; view = "meas"; wail(); return render(); }
    if (c === "qreq") { const l = (sD.lifts || [])[+p[1]]; if (l) sQuickSheet(l); return; }
    if (c === "nrk") { sNr.kind = S_KINDS[+p[1]]; return render(); }
    if (c === "nra") { sNr.addr = [...new Set(sD.lifts.map(l => l.addr))][+p[1]]; return render(); }
    if (c === "nrsend") return sCall("req_new", { kind: sNr.kind, addr: sNr.addr, what: sNr.what }, "Заявка отправлена в снабжение ✓").then(() => { sNr = { kind: "", addr: "", what: "" }; render(); });
    if (c === "racc") return sCall("req_accept", { id: sD.reqs[+p[1]].id }, "Заявка принята ✓");
    if (c === "rarr") return sCall("req_arrived", { id: sD.reqs[+p[1]].id }, "Отмечено: пришло на объект ✓");
    if (c === "sf") { const bs = ["Все", ...new Set((sD.reqs || []).map(r => r.brig))]; sSf = bs[+p[1]]; return render(); }
    if (c === "pf") { const cs = ["Все", ...new Set((sD.lifts || []).map(l => l.city))]; sPf = cs[+p[1]]; return render(); }
    if (c === "money") return sCall("askmoney", {}, "Запрос записан ✓").then(() => { sMoney = true; render(); });
    if (c === "hand") { const l = sD.lifts[+p[1]]; sHand = { i: +p[1], role: p[2], nw: "", pct: p[2] === "mon" ? String(l.pct) : "", comment: "", err: "" }; return render(); }
    if (c === "hn") { const l = sD.lifts[sHand.i], cands = sD.users.filter(u => u.role === sHand.role && u.fio !== l[sHand.role]); sHand.nw = cands[+p[1]].fio; return render(); }
    if (c === "hno") { sHand = null; return render(); }
    if (c === "hok") {
      const h = sHand, l = sD.lifts[h.i]; h.pct = (document.getElementById("shp") || {}).value || ""; h.comment = (document.getElementById("shc") || {}).value || "";
      if (!h.nw) { h.err = "Выберите, кто продолжит работу"; return render(); }
      if (!/^\d{1,3}$/.test(h.pct.trim()) || +h.pct > 100) { h.err = "Впишите процент от 0 до 100: сколько сделал прежний"; return render(); }
      return sCall("replace", { key: l.key, role: h.role, nw: h.nw, pct: h.pct.trim(), comment: h.comment.trim() }, "Замена записана ✓").then(j => { if (j) { sHand = null; render(); } });
    }
    if (c === "addh") { sAdd = { city: "", reg: "", addr: "", n: "", due: "", ents: [], err: "" }; return render(); }
    if (c === "addno") { sAdd = null; return render(); }
    if (c === "addn") {
      const a = sAdd, n = parseInt(a.n, 10);
      if (!a.city.trim() || !a.addr.trim()) { a.err = "Укажите город и адрес"; return render(); }
      if (!(n >= 1 && n <= 40)) { a.err = "Число подъездов от 1 до 40"; return render(); }
      a.err = ""; a.ents = Array.from({ length: n }, () => ({ mon: "", el: "", bld: "" })); return render();
    }
    if (c === "addok") {
      const a = sAdd; if (a.ents.some(e => !e.mon || !e.el || !e.bld)) { a.err = "Назначьте монтажника, электрика и строителя на каждый подъезд"; return render(); }
      return sCall("addhouse", { city: a.city.trim(), reg: a.reg.trim(), addr: a.addr.trim(), due: a.due, ents: a.ents }, "Дом добавлен в таблицу ✓").then(j => { if (j) { sAdd = null; render(); } });
    }
    if (c === "pf2") return;
    if (c === "rper") { sRper = p[1]; sRep = null; return render(); }
    if (c === "rnow") return sApi("report", { per: sRper, from: sRfrom, to: sRto }).then(j => { sRep = j.report; render(); }).catch(e => toast(e.message));
    if (c === "nust") { sNu.fio = sRead("nuf"); sNu.brig = sRead("nub"); sNu.email = sRead("nue"); sNu.pw = sRead("nup"); sNu.st = sStatuses()[+p[1]]; return render(); }
    if (c === "nugen") { sNu.fio = sRead("nuf"); sNu.brig = sRead("nub"); sNu.email = sRead("nue"); sNu.pw = sGen(); return render(); }
    if (c === "nuadd") {
      const fio = sRead("nuf"), brig = sRead("nub"), email = sRead("nue"), pw = sRead("nup"); Object.assign(sNu, { fio, brig, email, pw });
      if (!fio || pw.length < 6) { sNu.err = "Впишите фамилию и пароль (от 6 символов)"; sNu.ok = ""; return render(); }
      return sCall("user_add", { nfio: fio, nstatus: sNu.st, npw: pw, nbrig: brig, nemail: email }, "Доступ выдан, записано в таблицу ✓").then(j => { if (j) { sNu = { st: sNu.st, ok: fio + " (" + sNu.st + ") добавлен(а). Пароль: " + pw + ". Передайте его человеку лично." }; sStaff = null; render(); } else { sNu.err = "Не получилось: такая фамилия уже есть или данные неверны"; sNu.ok = ""; render(); } });
    }
    if (c === "showpw") { sShowPw = !sShowPw; return render(); }
    if (c === "ed") { const u = sStaff[+p[1]]; sEd = { r: u.r, orig: u.fio, fio: u.fio, st: sStatuses().includes(u.st) ? u.st : "монтажник", pw: u.pw, brig: u.brig, email: u.email, err: "" }; return render(); }
    if (c === "edno") { sEd = null; return render(); }
    if (c === "edst") { Object.assign(sEd, { fio: sRead("edf"), brig: sRead("edb"), email: sRead("ede"), pw: sRead("edp"), st: sStatuses()[+p[1]] }); return render(); }
    if (c === "edgen") { Object.assign(sEd, { fio: sRead("edf"), brig: sRead("edb"), email: sRead("ede"), pw: sGen() }); return render(); }
    if (c === "edok") {
      const o = { fio: sRead("edf"), brig: sRead("edb"), email: sRead("ede"), pw: sRead("edp") };
      if (!o.fio || o.pw.length < 6) { sEd.err = "Впишите фамилию и пароль (от 6 символов)"; Object.assign(sEd, o); return render(); }
      const orig = sEd.orig; toast("Сохраняем…");
      return sApi("user_edit", { r: sEd.r, nfio: o.fio, nstatus: sEd.st, npw: o.pw, nbrig: o.brig, nemail: o.email }).then(async () => {
        if (orig === sU.fio) { sU.fio = o.fio; sU.pw = o.pw; try { sessionStorage.setItem("zamer_slk", JSON.stringify(sU)); if (localStorage.getItem("zamer_slk_rem")) localStorage.setItem("zamer_slk_rem", JSON.stringify(sU)); } catch (e) {} }
        sEd = null; sStaff = null; await sLoad(true); toast("Изменения записаны в таблицу ✓");
      }).catch(e => { sEd.err = e.code === "dup" ? "Такая фамилия уже есть" : e.message; Object.assign(sEd, o); render(); });
    }
    if (c === "del") {
      const u = sStaff[+p[1]]; if (!confirm("Закрыть доступ и удалить: " + u.fio + "?")) return;
      return sApi("user_del", { r: u.r }).then(() => { sStaff = null; toast("Удалено ✓"); sLoad(true); }).catch(e => {
        if (e.code === "assigned" && confirm(u.fio + " закреплён за подъездами. Всё равно удалить? Подъезды останутся без этого сотрудника, замените его на вкладке «Назначения».")) return sApi("user_del", { r: u.r, force: 1 }).then(() => { sStaff = null; toast("Удалено ✓"); sLoad(true); });
        toast(e.message); });
    }
    if (c === "fbr") { const n = (document.getElementById("snb") || {}).value.trim(); if (n && !(n in sFin.pay)) { sFin.pay[n] = 0; } return render(); }
    if (c === "frow") { sFin.rows.push({ brig: Object.keys(sFin.pay)[0] || "", city: "", addr: "", work: 0, road: 0, flat: 0, scrap: 0, cmt: "" }); return render(); }
    if (c === "fsave") return sCall("fin_set", { rows: sFin.rows, pay: sFin.pay }, "Финансы сохранены в таблице ✓").then(() => { sFin = null; sLoadFin(); });
  }
  $app.addEventListener("input", e => {
    const t = e.target, d = t.dataset || {};
    if (d.sf === "nrw") sNr.what = t.value;
    else if (d.sf && sAdd && ["acity", "areg", "aaddr", "an", "adue"].includes(d.sf)) sAdd[{ acity: "city", areg: "reg", aaddr: "addr", an: "n", adue: "due" }[d.sf]] = t.value;
    else if (d.sf === "rfrom") sRfrom = t.value; else if (d.sf === "rto") sRto = t.value;
    else if (d.sfp !== undefined && sFin) { sFin.pay[Object.keys(sFin.pay)[+d.sfp]] = Number(t.value.replace(/\D/g, "")) || 0; sUpdFin(); }
    else if (d.sff !== undefined && sFin) { const [i, k] = d.sff.split(":"); sFin.rows[+i][k] = ["work", "road", "flat", "scrap"].includes(k) ? Number(t.value.replace(/\D/g, "")) || 0 : t.value; if (k === "city" || k === "brig") { /* пересчёт без перерисовки */ } sUpdFin(); }
  });
  $app.addEventListener("change", e => {
    const t = e.target, d = t.dataset || {};
    if (d.sff !== undefined && sFin && d.sff.endsWith(":brig")) { sFin.rows[+d.sff.split(":")[0]].brig = t.value; render(); return; }
    if (d.se !== undefined && sAdd) { const [i, k] = d.se.split(":"); sAdd.ents[+i][k] = t.value; return; }
    if (d.sall !== undefined && sAdd) { sAdd.ents.forEach(en => { en[d.sall] = t.value; }); return render(); }
    if (d.spend !== undefined) { const l = sD.lifts[sOpen]; (sPend[l.key] = sPend[l.key] || {})[+d.spend] = t.value || sToday(); return render(); }
    if (d.sdir !== undefined) { const l = sD.lifts[sOpen]; return sCall("setstage", { key: l.key, i: +d.sdir, iso: t.value }, "Дата записана в таблицу ✓"); }
    if (d.sdue !== undefined) { const l = sD.lifts[+d.sdue]; return sCall("assign", { key: l.key, due: t.value }, "Срок записан ✓"); }
    if (d.spto !== undefined) { const [i, k] = d.spto.split(":"), l = sD.lifts[+i], o = { key: l.key, pto: l.pto, decl: l.decl }; o[k] = t.value; return sCall("pto_set", o, "Записано в таблицу ✓"); }
  });

  /* ---------- диспетчер ---------- */
  function render() {
    if (view === "home") return homeView();
    if (view === "menu") return menuView();
    if (view === "done") return doneView();
    if (view === "soon") return soonView();
    if (view === "work") return workView();
    if (view === "claim") return claimView();
    if (view === "meas") return measView();
    if (view === "axis") return axisView();
    if (view === "axrev") return axrevView();
    if (view === "cv") return cvView();
    if (view === "slk") return slkView();
    if (view === "supply") return supplyView();
    if (view === "login") return loginView();
    if (view === "nocredits") return nocreditsView();
    if (view === "review") return reviewView();
    if (sub) return subView();
    if (view === "hub") return hubView();
    return wizardView();
  }
  /* ---------- звуки ---------- */
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
  /* мягкие деловые звуки: стеклянный тик, мелодичные колокольчики */
  function acNow() { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); return AC.currentTime; }
  function note(f, t0, dur, vol, wet) {
    const o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), g2 = AC.createGain();
    o.type = "sine"; o.frequency.value = f; o2.type = "sine"; o2.frequency.value = f * 2.005; g2.gain.value = 0.18;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(wet ? dest() : AC.destination);
    o.start(t0); o2.start(t0); o.stop(t0 + dur + 0.05); o2.stop(t0 + dur + 0.05);
  }
  function chime(freqs, step, dur, vol) { try { const t = acNow(); freqs.forEach((f, k) => note(f, t + k * step, dur, vol, true)); } catch (e) {} }
  function creak() { if (!sndOn) return; try { const t = acNow(); note(1760, t, 0.08, 0.05, false); note(2637, t + 0.008, 0.06, 0.022, false); } catch (e) {} }   // мягкий тик при нажатии
  function moan() { if (!sndOn) return; chime([784, 1175], 0.07, 0.5, 0.07); }                                  // подтверждение
  function wail() { if (!sndOn) return; chime([523, 659, 784], 0.06, 0.55, 0.06); }                              // открытие раздела
  function ominous(kind) { if (!sndOn || kind !== "toll") return; chime([523, 659, 784, 1047, 1319], 0.11, 0.9, 0.075); }   // успех: восходящий перезвон
  function spook() {}
  document.addEventListener("pointerdown", e => { if (e.target.closest("button,a.btn")) creak(); }, true);
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
  /* ---------- автоматическая таблица (Google Apps Script) ---------- */
  function sheetFlags(d) {
    const o = d.order || {}, f = { "Двери": false, "Люки": false, "Окна": false, "Обрамления": false, "Нащельники": false, "Рифлёнки": false, "Бортики": false };
    if (d.kind === "dl") (o.items || []).forEach(it => { if (it.door && it.door.need === "Да") f["Двери"] = true; if (it.hatch && it.hatch.need === "Да") f["Люки"] = true; });
    else if (d.kind === "win") f["Окна"] = !!(o.items && o.items.length);
    else if (d.kind === "axis") f["Обрамления"] = true;
    else { f["Обрамления"] = !!((o.openings && o.openings.length) || o.stops); f["Нащельники"] = !!(o.nashchelnik && o.nashchelnik.length); f["Рифлёнки"] = !!(o.thresholds && o.thresholds.length); f["Бортики"] = !!(o.cable && Object.keys(o.cable).length); }
    return f;
  }
  function sheetQueue() { try { return JSON.parse(localStorage.getItem("zamer_queue")) || []; } catch (e) { return []; } }
  function sheetSave(q) { try { localStorage.setItem("zamer_queue", JSON.stringify(q.slice(-200))); } catch (e) {} }
  async function sheetFlush() {
    if (!window.ZAMER_SHEET) return;
    let q = sheetQueue(); if (!q.length) return;
    const left = [];
    for (const p of q) {
      try { await fetch(window.ZAMER_SHEET, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ token: window.ZAMER_TOKEN || "" }, p)) }); }
      catch (e) { left.push(p); }
    }
    sheetSave(left);
  }
  function sheetPush() {
    if (!window.ZAMER_SHEET || !pdfCache || !pdfCache.data) return;
    const d = pdfCache.data, p = { id: d.kind + "|" + d.address + "|" + d.stamp, kind: d.kind, city: d.city, address: d.address, stamp: d.stamp, flags: sheetFlags(d) };
    const q = sheetQueue(); if (!q.some(x => x.id === p.id)) { q.push(p); sheetSave(q); }
    sheetFlush();
  }
  addEventListener("online", sheetFlush); setTimeout(sheetFlush, 3000);
  function goal(n) { try { if (window.ym) ym(113845787, "reachGoal", n); } catch (e) {} }
  function act(a) {
    if (a.startsWith("s:")) return sAct(a.slice(2));
    if (/^sec_(win|door|frame|claim)$/.test(a) || a === "download") goal(a);
    if (/^ax_/.test(a)) return axAct(a);
    if (a === "sec_axis") {
      if (axUnlocked) { wail(); view = "axis"; return render(); }
      const o = document.createElement("div"); o.className = "sheet";
      o.innerHTML = `<div class="sheetbox" role="dialog" aria-modal="true"><h3>Тестовый замер</h3><p>Функция в разработке. Введите пароль для входа.</p><div class="field"><input id="axpw" type="password" inputmode="numeric" autocomplete="off" placeholder="Пароль"></div><p class="err" id="axpwe"></p><button class="btn" type="button" id="axpwok">Войти</button><button class="btn ghost" type="button" id="axpwno">Отмена</button></div>`;
      document.body.appendChild(o);
      const go = () => { const v = o.querySelector("#axpw").value.trim(); if (v === "2008") { axUnlocked = true; o.remove(); wail(); view = "axis"; render(); } else { o.querySelector("#axpwe").textContent = "Неверный пароль"; o.querySelector("#axpw").value = ""; o.querySelector("#axpw").focus(); } };
      o.querySelector("#axpwok").onclick = go; o.querySelector("#axpwno").onclick = () => o.remove();
      o.querySelector("#axpw").onkeydown = ev => { if (ev.key === "Enter") go(); };
      o.addEventListener("click", ev => { if (ev.target === o) o.remove(); });
      setTimeout(() => o.querySelector("#axpw").focus(), 60); return;
    }
    if (a === "next") { if (sub) return subNext(); const l = buildList(), s = l[pos]; return advance(s, readValue(s)); }
    if (a === "back") {
      if (view === "axis") { view = "meas"; return render(); }
      if (view === "axrev") { view = "axis"; return render(); }
      if (view === "soon") { view = /^claim_/.test(soonView.what) ? "claim" : "home"; return render(); }
      if (view === "meas" && slkMeas) { slkMeas = null; order = fresh(); pdfCache = null; save(); view = "slk"; return render(); }
      if (view === "meas" || view === "cv") { view = "home"; return render(); }
      if (view === "slk") { if (sOpen !== null) { sOpen = null; return render(); } view = "home"; return render(); }
      if (view === "work" || view === "claim") { view = sU ? "slk" : "home"; return render(); }
      if (sub) { sub = null; return render(); }
      if (view === "hub") { view = "wizard"; pos = buildList().length - 1; }
      else if (view === "review") { if (isSimple()) { view = "wizard"; pos = buildList().length - 1; } else view = "hub"; }
      else if (pos > 0) pos--; else view = slkMeas ? "meas" : "home";
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
    if (a === "finish") { if (pdfCache && pdfCache.axis) { ax = axFresh(); axSave(); } order = fresh(); pos = 0; sub = null; pdfCache = null; view = slkMeas ? "slk" : "home"; slkMeas = null; save(); return render(); }
    if (a === "backrev") { view = pdfCache && pdfCache.axis ? "axrev" : "review"; save(); return render(); }
    if (a === "login" || a === "dologin") return startLogin();
    if (a === "opencopy") return openCopy();
    if (a === "floors") {
      const n = order.stops || 0, cols = OPEN.flatMap(x => x[3]);
      const o = document.createElement("div"); o.className = "sheet";
      const head = `<tr><th>Эт.</th>${cols.map(([k, lab]) => `<th>${esc(k.replace("top_", "Верх ").replace("left_", "Лев ").replace("right_", "Прав ").replace(/ A$/, " А").replace(/ H$/, " Н").replace(/ B$/, " В"))}</th>`).join("")}</tr>`;
      let rows = "";
      for (let f = 2; f <= n; f++) rows += `<tr><td><b>${f}</b></td>${cols.map(([k]) => `<td><input inputmode="numeric" data-f="${f}" data-k="${k}" value="${esc(String((order.ops[f] || {})[k] || ""))}"></td>`).join("")}</tr>`;
      o.innerHTML = `<div class="sheetbox scroll" role="dialog" aria-modal="true"><h3>Размеры по этажам 2–${n}</h3><p class="hint">Как в бланке: впишите все размеры сразу, мм. Этаж 1 уже заполнен.</p><div class="ftab"><table>${head}${rows}</table></div><p class="err" id="ferr"></p><button class="btn" data-a="floorsave">Сохранить</button><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`;
      o.addEventListener("click", ev => {
        if (ev.target === o || ev.target.closest("[data-a=mailclose]")) { o.remove(); return; }
        if (ev.target.closest("[data-a=floorsave]")) {
          const ins = [...o.querySelectorAll("input")], bad = ins.find(i => i.value.trim() && !(Number(i.value.replace(",", ".")) > 0));
          if (bad) { o.querySelector("#ferr").textContent = "Только числа больше нуля"; bad.focus(); return; }
          ins.forEach(i => { if (i.value.trim()) { order.ops[i.dataset.f] = order.ops[i.dataset.f] || {}; order.ops[i.dataset.f][i.dataset.k] = Number(i.value.replace(",", ".")); } });
          o.remove(); save(); toast && toast("Размеры сохранены");
          const l = buildList(); pos = l.length; view = "hub"; save(); render();
        }
      });
      document.body.appendChild(o); return;
    }
    if (a === "hint") {
      const o = document.createElement("div"); o.className = "sheet";
      o.innerHTML = `<div class="sheetbox" role="dialog" aria-modal="true"><h3>Сечение I – I</h3>${sectionPic()}<p>Н — глубина, В — ширина бокового обрамления.</p><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`;
      o.addEventListener("click", ev => { if (ev.target === o || ev.target.closest("[data-a=mailclose]")) o.remove(); });
      document.body.appendChild(o); return;
    }
    if (a === "mail") {
      const E = "stroyliftkompleks@yandex.ru", o = document.createElement("div"); o.className = "sheet";
      o.innerHTML = `<div class="sheetbox" role="dialog" aria-modal="true"><h3>Предложения по работе приложения</h3><p>Пишите на почту, будем рады любым идеям и замечаниям:</p><div class="mailaddr">${E}</div><p class="hint" style="margin:0 0 10px">Разработчик: <b>Кащеев Виктор Петрович</b></p><p class="hint ipn" style="margin:0 0 12px">© 2026 Кащеев Виктор Петрович. Все права защищены. Приложение «Замер ДШ», его программный код, оформление и тексты являются объектом авторских прав. Копирование, распространение и переработка без письменного согласия автора запрещены.</p><a class="btn" href="mailto:${E}?subject=Предложение по приложению «Замер ДШ»">Написать письмо</a><button class="btn sec" data-copy="${E}">Скопировать адрес</button><button class="btn sec" data-a="job_cv">Нужна работа монтажником? Анкета</button><button class="btn ghost" data-a="mailclose">Закрыть</button></div>`;
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
    if (a === "home") { view = slkMeas ? "slk" : "home"; slkMeas = null; return render(); }
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
    if (a === "download") { if (LIM && !order.paid && !acc.tickets.length) return charge().then(ok => { if (ok) { download(); sMeasReg(); toast("Файл сохранён"); } }); charge(); download(); sMeasReg(); return toast("Файл сохранён"); }
    if (a === "addwin") { order.wins = Math.max(1, order.wins || 1) + 1; const nl = buildList(); const k = nl.findIndex(x => x.win === order.wins && x.first); pos = k < 0 ? nl.length - 1 : k; view = "wizard"; save(); return render(); }
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
      pos += 1; save(); return render();
    }
  }
  $app.addEventListener("input", e => { const t = e.target, p = t && t.dataset && t.dataset.live; if (!p) return; const r = parse({ t: "num", min: 1 }, t.value); if (!r.e) setP(order, p, r.v); });
  let menuReturn = "home";
  $app.addEventListener("click", e => {
    const fp = e.target.closest("[data-fpart],[data-gap]");
    if (fp) { const s = buildList()[pos]; if (s && (s.t === "fscreen" || s.fscr)) { snapForm(s); if (fp.dataset.gap) openGap(fp.dataset.gap); else openPart(s.floor || 1, fp.dataset.fpart); } return; }
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
    if (b.dataset.seg) { const [p, v] = b.dataset.seg.split("|"); setP(order, p, v); if (p === "dl_same") { save(); return render(); } if (/\.hinge$/.test(p)) { save(); const ls = buildList()[pos]; if (ls && ls.pic === "door") { document.querySelectorAll(".pic .hd").forEach(c => c.setAttribute("cx", v === "Справа" ? 106 : 162)); document.querySelectorAll(".pic .hgL").forEach(g => { g.style.display = v === "Справа" ? "none" : ""; }); document.querySelectorAll(".pic .hgR").forEach(g => { g.style.display = v === "Справа" ? "" : "none"; }); } else return render(); } b.parentNode.querySelectorAll("button").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); }); save(); return; }
    if (b.dataset.tg) { const v = getP(order, b.dataset.tg) === "Да" ? "Нет" : "Да"; setP(order, b.dataset.tg, v); b.classList.toggle("on", v === "Да"); b.setAttribute("aria-checked", v === "Да"); save(); if (/\.ebb\.need$|^need_(door|hatch)$|\.(door|hatch)\.need$/.test(b.dataset.tg)) return render(); return; }
    if (b.dataset.q) { const i = document.getElementById("inp"); if (i) { i.value = b.dataset.q; return act("next"); } }
    if (b.dataset.bendm) { order.common = order.common || {}; order.common.bend_mode = b.dataset.bendm; save(); return render(); }
    if (b.dataset.dsh) { order.dsh_same = b.dataset.dsh; order.ops = order.ops || {}; save(); return render(); }
    if (b.dataset.colpick) { setP(order, "common.color", b.dataset.colpick); document.querySelectorAll("[data-colpick]").forEach(x => x.classList.toggle("on", x === b)); save(); return; }
    if (b.dataset.cvs) { b.classList.toggle("on"); cvData.skills = [...document.querySelectorAll("[data-cvs].on")].map(x => x.dataset.cvs); return; }
    if (b.dataset.cvtg) { const on = !b.classList.contains("on"); b.classList.toggle("on", on); b.setAttribute("aria-checked", on); cvData.trip = on ? "Да" : "Нет"; return; }
    if (b.dataset.supp) { supplyView.app = b.dataset.supp; document.querySelectorAll("[data-supp]").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); }); return; }
    if (b.dataset.a) return act(b.dataset.a);
    if (b.dataset.pick !== undefined) {
      const l = buildList(), s = l[pos];
      if (s.sch) { order.scheme = b.dataset.pick; document.querySelectorAll(".sch").forEach(x => x.classList.toggle("on", x === b)); save(); return; }
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
