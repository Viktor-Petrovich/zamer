(function () {
  "use strict";
  const $app = document.getElementById("app");
  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- состояние ---------- */
  const fresh = () => ({ paid: "",  common: {}, ops: {}, thresholds: [], nashchelnik: [], cable: {} });
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
        if (r.status === 401) { acc.session = ""; saveAcc(); throw new Error("auth"); }
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
  function buildList() {
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
    win: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/></svg>'
  };
  function greeting() {
    const h = new Date().getHours();
    const t = h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
    const n = (acc.name || "").split(" ")[0];
    return t + (n ? ", " + n : "") + "!";
  }
  function homeView() {
    const tile = (a, ic, title, sub, soon) => `<button class="tile${soon ? " soon" : ""}" data-a="${a}"><span class="ti">${SECT_ICON[ic]}</span><span class="tt"><b>${title}</b><small>${sub}</small></span>${soon ? `<em>в разработке</em>` : `<span class="go">›</span>`}</button>`;
    $app.innerHTML = `<main style="padding-top:max(24px,env(safe-area-inset-top))">
      <div class="hello"><img src="icon-192.png" alt=""><div><h2>${esc(greeting())}</h2><p>Выберите, что будем измерять сегодня</p></div></div>
      ${LIM && acc.session ? `<div class="chip" style="justify-self:start">Осталось замеров: ${left()}</div>` : ""}
      ${hasDraft() && !(LIM && !acc.session) ? `<button class="tile cont" data-a="resume"><span class="ti">${SECT_ICON.frame}</span><span class="tt"><b>Продолжить заявку</b><small>${esc((order.address || "").slice(0, 40))}</small></span><span class="go">›</span></button>` : ""}
      <div class="tiles">
        ${tile("sec_frame", "frame", "Замер обрамлений", "Двери шахты, пороги, нащельник, бортики", false)}
        ${tile("sec_door", "door", "Замер дверей и люков", "Машинное помещение лифта", true)}
        ${tile("sec_win", "win", "Замер окон", "Размеры и бланк заявки", true)}
      </div>
      <div class="card tips"><div class="sum"><span>✓ Работает без интернета</span><span>✓ Ответы сохраняются на телефоне</span><span>✓ Готовый бланк PDF в один клик</span></div></div>
      <p class="credit">Разработчик<br><b>Кащеев Виктор Петрович</b></p>
    </main>${LIM && !acc.session ? `<footer class="act"><button class="btn" data-a="login">Войти через Telegram</button></footer>` : ""}`;
  }
  function soonView() {
    const w = soonView.what === "win" ? "Замер окон" : "Замер дверей и люков";
    shell(w, null, `<div class="card" style="text-align:center;justify-items:center"><div class="soonico">${SECT_ICON[soonView.what === "win" ? "win" : "door"]}</div><h2 class="q">Этот раздел в разработке</h2><p class="hint">Мы готовим удобный опросник и бланк заявки. Скоро он появится в приложении, обновление придёт само.</p><p class="hint">А пока можно оформить замер обрамлений.</p></div>`,
      `<button class="btn" data-a="home">На главный экран</button>`, { back: true, menu: false });
  }
  function wizardView() {
    const list = buildList(); if (pos >= list.length) { view = "hub"; save(); return render(); }
    const s = list[pos], val = getP(order, s.p), err = wizardView.err || "";
    let body = `<div class="card"><span class="chip">${esc(s.sec)} · вопрос ${pos + 1} из ${list.length}</span><h2 class="q">${esc(s.q)}</h2>${s.hint ? `<p class="hint">${esc(s.hint)}</p>` : ""}`;
    body += controlHtml(s, val) + `<p class="err" id="err">${esc(err)}</p></div>`;
    let foot = s.t === "choice" || s.t === "scheme" ? "" : `<button class="btn" data-a="next">Далее</button>`;
    if (s.t === "scheme") foot = `<button class="btn" data-a="next">Далее</button>`;
    if (!same() && s.first && s.floor > 1) foot += `<button class="btn sec" data-a="copyprev">Все размеры как на этаже ${s.floor - 1}</button>`;
    shell(s.sec, pos / list.length, body, foot);
    bindInput(s);
  }
  function controlHtml(s, val) {
    if (s.t === "choice") return `<div class="choices">${s.ch.map(c => `<button class="choice${val === c ? " on" : ""}" data-pick="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
    if (s.t === "scheme") return `<div class="schemes">${["А", "В"].map(k => `<button class="sch${val === k ? " on" : ""}" data-pick="${k}"><img src="scheme_${k === "А" ? "A" : "B"}.png" alt="Схема ${k}">Схема ${k}</button>`).join("")}</div>`;
    if (s.t === "color") {
      const sw = [["7035", "#cbd0cc"], ["7040", "#9da3a6"], ["7016", "#383e42"], ["9003", "#f4f4f4"], ["9010", "#f1ede1"], ["9005", "#0e0e10"], ["9006", "#a5a5a5"], ["3020", "#cc0605"]];
      return `<div class="sw">${sw.map(([n, h]) => `<button data-pick="RAL ${n}" class="${val === "RAL " + n ? "on" : ""}"><i style="background:${h}"></i>RAL ${n}</button>`).join("")}</div><div class="field"><input id="inp" value="${esc(val && !sw.some(x => "RAL " + x[0] === val) ? val : "")}" placeholder="Другой цвет" autocomplete="off"></div>`;
    }
    const mode = s.t === "int" ? "numeric" : s.t === "num" ? "decimal" : s.t === "floors" ? "text" : "text";
    const inner = s.area ? `<textarea id="inp" rows="3" placeholder="${esc(s.ph || "")}">${esc(val || "")}</textarea>` : `<input id="inp" inputmode="${mode}" enterkeyhint="next" value="${esc(val == null ? "" : String(val).replace(".", ","))}" placeholder="${esc(s.ph || "")}" autocomplete="off">`;
    return `<div class="field">${inner}${s.unit ? `<span class="u">${s.unit}</span>` : ""}</div>` + (s.t === "dims" ? `<button class="btn sec" type="button" data-ins="*" style="font-size:26px">*</button><p class="hint" style="text-align:center">Нажмите *, чтобы поставить значок между высотой и шириной</p>` : "");
  }
  function bindInput(s) {
    const inp = document.getElementById("inp");
    if (inp) {
      setTimeout(() => inp.focus(), 60);
      inp.addEventListener("keydown", e => { if (e.key === "Enter" && !s.area) { e.preventDefault(); act("next"); } });
    }
  }
  function readValue(s) {
    if (s.t === "choice" || s.t === "scheme") return getP(order, s.p);
    const inp = document.getElementById("inp");
    if (s.t === "color") { const v = inp && inp.value.trim(); return v || getP(order, s.p); }
    return inp ? inp.value : "";
  }
  function advance(s, raw) {
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
    const c = order.common, rows = [
      ["Адрес", order.address], ["Контакт", order.contact], ["Схема", order.scheme], ["Остановок", order.stops],
      ["Ширина проёма / С", `${order.width} / ${order.C} мм`], ["Размеры", `${c.bend_mode}, загиб ${c.bend} мм`],
      ["Табло", c.ind_floor + (c.ind_floor === "Нет табло" ? "" : `, отв. ${c.ind_size} мм`)],
      ["Кнопка", `${c.btn_all === "Не на всех этажах" ? "эт. " + c.btn_floors + ", " : ""}${c.btn_side}, ${c.btn_height} мм от пола, отв. ${c.btn_size} мм`], ["Цвет", c.color]];
    return `<div class="card"><div class="sum">${rows.map(([a, b]) => `<span><b>${a}:</b> ${esc(b)}</span>`).join("")}</div></div>`;
  }
  async function reviewView() {
    shell("Проверка заявки", 1, summaryHtml() + `<div class="card"><p class="hint" id="gen">Формирую бланк…</p><div class="pages" id="pages"></div></div>`,
      `<button class="btn" data-a="send" disabled id="sendBtn">Отправить в снабжение</button><button class="btn sec" data-a="download">Скачать PDF</button><button class="btn ghost" data-a="hub">Назад к разделам</button>`);
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
  function exportOrder() {
    const o = { address: order.address, contact: order.contact, scheme: order.scheme, stops: order.stops, dsh_same: same(), common: order.common,
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
    return a + ".pdf";
  }
  async function share() {
    if (!pdfCache) return;
    const file = new File([pdfCache.blob], pdfCache.name, { type: "application/pdf" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: order.address, text: "Заявка: " + order.address });
        return toast("Заявка отправлена. Спасибо за работу!");
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    download(); toast("Файл сохранён. Отправьте его из папки «Загрузки»");
  }
  function download() {
    if (!pdfCache) return;
    const u = URL.createObjectURL(pdfCache.blob), a = document.createElement("a");
    a.href = u; a.download = pdfCache.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  }

  function loginView() {
    shell("Вход", null, `<div class="card"><h2 class="q">Вход через Telegram</h2><p class="hint">Приложение откроет Telegram. Нажмите там «Запустить» (Start), затем вернитесь сюда. Новым пользователям доступно бесплатных замеров: 10.</p>${loginWait ? `<p class="hint">Ждём подтверждения в Telegram…</p><a class="btn" style="text-decoration:none" href="${esc(loginWait)}">Открыть Telegram</a>` : ""}<p class="err">${esc(loginErr)}</p></div>`,
      loginWait ? "" : `<button class="btn" data-a="dologin">Войти через Telegram</button>`, { menu: false });
  }
  function nocreditsView() {
    shell("Замеры закончились", null, `<div class="card"><h2 class="q">Замеры закончились</h2><p class="hint">Чтобы продолжить, пополните баланс: напишите администратору${CFG.contact ? " (" + esc(CFG.contact) + ")" : ""} и назовите ваш номер: <b>${esc(acc.id)}</b>.</p><p class="hint">Заявка сохранена, после пополнения её можно отправить.</p></div>`,
      `<button class="btn" data-a="back2">Назад к заявке</button>`, { menu: false });
  }
  function menuView() {
    shell("Меню", null, `<div class="card">${LIM && acc.session ? `<div class="sum"><span><b>${esc(acc.name || "Аккаунт")}</b> (номер ${esc(acc.id)})</span><span>Осталось замеров: ${left()}</span></div>` : ""}<button class="btn sec" data-a="close">Вернуться к заявке</button><button class="btn sec" data-a="refresh">Обновить приложение</button><button class="btn sec danger" data-a="new">Начать новую заявку</button>${LIM && acc.session ? `<button class="btn sec" data-a="logout">Выйти из аккаунта</button>` : ""}</div>`, "", { menu: false });
  }

  /* ---------- диспетчер ---------- */
  function render() {
    if (view === "home") return homeView();
    if (view === "menu") return menuView();
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
      else if (view === "review") view = "hub";
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
    if (a === "login" || a === "dologin") return startLogin();
    if (a === "sec_door" || a === "sec_win") { soonView.what = a === "sec_win" ? "win" : "door"; view = "soon"; return render(); }
    if (a === "sec_frame") return act("new");
    if (a === "home") { view = "home"; return render(); }
    if (a === "back2") { view = "review"; return render(); }
    if (a === "logout") { if (!confirm("Выйти из аккаунта? Неотправленные замеры на телефоне будут возвращены на баланс при следующем входе.")) return; api("/api/release", { tickets: acc.tickets }).catch(() => {}); acc = { session: "", id: "", name: "", credits: null, tickets: [], redeem: acc.redeem }; saveAcc(); view = "home"; return render(); }
    if (a === "new") { if (LIM && !acc.session) { view = "home"; return render(); } if (hasDraft() && !confirm("Начать новую заявку? Текущие ответы будут удалены.")) return; order = fresh(); pos = 0; view = "wizard"; sub = null; save(); return render(); }
    if (a === "resume") { view = "wizard"; const n = buildList().length; if (order.stops && pos >= n) view = "hub"; return render(); }
    if (a === "menu") { menuReturn = view; view = "menu"; return render(); }
    if (a === "close") { view = menuReturn === "menu" ? "home" : menuReturn; return render(); }
    if (a === "review") { view = "review"; save(); return render(); }
    if (a === "hub") { view = "hub"; return render(); }
    if (a === "send") { if (LIM && !order.paid && !acc.tickets.length) return charge().then(ok => ok && share()); if (!LIM || order.paid || acc.tickets.length) { charge(); return share(); } return; }
    if (a === "download") { if (LIM && !order.paid && !acc.tickets.length) return charge().then(ok => { if (ok) { download(); toast("Файл сохранён"); } }); charge(); download(); return toast("Файл сохранён"); }
    if (a === "copyprev") {
      const l = buildList(), s = l[pos], f = s.floor; order.ops[f] = Object.assign({}, order.ops[f - 1]);
      pos += OPEN.length + 1; save(); return render();
    }
  }
  let menuReturn = "home";
  $app.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ins) { const i = document.getElementById("inp"); if (i) { const a = i.selectionStart == null ? i.value.length : i.selectionStart, z = i.selectionEnd == null ? a : i.selectionEnd; i.value = i.value.slice(0, a) + b.dataset.ins + i.value.slice(z); i.focus(); try { i.setSelectionRange(a + 1, a + 1); } catch (x) {} } return; }
    if (b.dataset.a) return act(b.dataset.a);
    if (b.dataset.pick !== undefined) {
      const l = buildList(), s = l[pos];
      if (s.t === "color") { setP(order, s.p, b.dataset.pick); const inp = document.getElementById("inp"); if (inp) inp.value = ""; return advance(s, b.dataset.pick); }
      setP(order, s.p, b.dataset.pick);
      if (s.t === "scheme") { document.querySelectorAll(".sch").forEach(x => x.classList.toggle("on", x === b)); save(); return; }
      b.parentNode.querySelectorAll(".choice").forEach(x => x.classList.toggle("on", x === b));
      save(); return setTimeout(() => advance(s, b.dataset.pick), 160);
    }
    if (b.dataset.add) { const d = SUB[b.dataset.add]; sub = { d, key: b.dataset.add, i: 0, vals: {}, err: "" }; return render(); }
    if (b.dataset.del) { const [k, i] = b.dataset.del.split(":"); if (SUB[k].cable) delete order.cable[k]; else order[SUB[k].list].splice(+i, 1); save(); return render(); }
  });
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
