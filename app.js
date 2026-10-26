(function () {
  "use strict";
  const $app = document.getElementById("app");
  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- состояние ---------- */
  const fresh = () => ({ common: {}, ops: {}, thresholds: [], nashchelnik: [], cable: {} });
  let order = fresh(), pos = 0, view = "home", sub = null, pdfCache = null, flash = "";
  const save = () => { try { localStorage.setItem("zamer", JSON.stringify({ order, pos, view })); } catch (e) {} };
  try {
    const s = JSON.parse(localStorage.getItem("zamer") || "null");
    if (s && s.order) { order = Object.assign(fresh(), s.order); pos = s.pos || 0; view = s.view === "wizard" || s.view === "hub" ? "home" : "home"; }
  } catch (e) {}
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
    { p: "common.ind_size", t: "num", unit: mm, sec: "Общие параметры", q: "Размер отверстия под табло", hint: "Размер в миллиметрах", when: o => (o.common.ind_floor || "") !== "Нет табло" },
    { p: "common.bend_mode", t: "choice", sec: "Общие параметры", q: "Размеры обрамлений указаны", ch: ["С учётом загиба", "Без учёта загиба"] },
    { p: "common.bend", t: "num", unit: mm, sec: "Общие параметры", q: "Размер загиба", hint: "В миллиметрах", max: 500 },
    { p: "common.btn_all", t: "choice", sec: "Кнопка вызова", q: "Кнопка вызова ставится", ch: ["На всех этажах", "Не на всех этажах"] },
    { p: "common.btn_floors", t: "floors", sec: "Кнопка вызова", q: "На каких этажах кнопка вызова", hint: "Через запятую или диапазон: 1, 3, 5-7", ph: "1, 3, 5-7", when: o => o.common.btn_all === "Не на всех этажах" },
    { p: "common.btn_side", t: "choice", sec: "Кнопка вызова", q: "С какой стороны кнопка вызова", ch: ["Слева", "Справа"] },
    { p: "common.btn_height", t: "num", unit: mm, sec: "Кнопка вызова", q: "Расстояние от пола до кнопки", hint: "В миллиметрах" },
    { p: "common.btn_size", t: "num", unit: mm, sec: "Кнопка вызова", q: "Размер отверстия под кнопку", hint: "Один раз для всей заявки" },
    { p: "common.color", t: "color", sec: "Общие параметры", q: "Цвет окраски", hint: "Выберите или введите номер RAL" },
    { p: "stops", t: "int", min: 1, max: 100, sec: "Обрамление ДШ", q: "Количество остановок", hint: "Сколько этажей обслуживает лифт", unit: "шт." },
    { p: "width", t: "num", unit: mm, sec: "Обрамление ДШ", q: "Ширина проёма", hint: "Применяется ко всей заявке" },
    { p: "C", t: "num", unit: mm, sec: "Обрамление ДШ", q: "Размер С", hint: "Применяется ко всей заявке" },
    { p: "dsh_same", t: "choice", sec: "Обрамление ДШ", q: "Размеры обрамлений на этажах", hint: "Если на всех этажах одинаковые, вводим один раз.", ch: ["Одинаковые на всех этажах", "Индивидуально по этажам"] }
  ];
  const OPEN = [
    ["top_A", "Верхнее обрамление: размер А"], ["top_H", "Верхнее обрамление: размер Н (высота)"],
    ["left_H", "Левое боковое: размер Н"], ["left_B", "Левое боковое: размер В"],
    ["right_H", "Правое боковое: размер Н"], ["right_B", "Правое боковое: размер В"]
  ];
  const same = () => order.dsh_same === "Одинаковые на всех этажах";
  function buildList() {
    const l = SETUP.filter(s => !s.when || s.when(order));
    const floors = same() ? [1] : Array.from({ length: order.stops || 0 }, (_, i) => i + 1);
    floors.forEach(f => {
      const sec = same() ? "Обрамление, все этажи" : `Этаж ${f} из ${order.stops}`;
      OPEN.forEach(([k, q], i) => l.push({ p: `ops.${f}.${k}`, t: "num", unit: mm, sec, q, hint: i === 0 ? "Измерьте и введите в миллиметрах" : "", floor: f, first: i === 0 }));
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
  function homeView() {
    $app.innerHTML = `<main style="padding-top:max(28px,env(safe-area-inset-top))"><div class="hero"><img src="icon-192.png" alt=""><h2>Замер обрамлений ДШ</h2><p>Пошаговый опросник. Заполняет ваш бланк и отправляет снабжению.</p></div>
    <div class="card"><div class="sum"><span>✓ Работает без сети</span><span>✓ Заявка сохраняется на телефоне</span><span>✓ Готовый бланк PDF одним нажатием</span></div></div></main>
    <footer class="act">${hasDraft() ? `<button class="btn" data-a="resume">Продолжить: ${esc((order.address || "заявка").slice(0, 28))}</button><button class="btn sec" data-a="new">Новая заявка</button>` : `<button class="btn" data-a="new">Начать заявку</button>`}</footer>`;
  }
  function wizardView() {
    const list = buildList(); if (pos >= list.length) { view = "hub"; save(); return render(); }
    const s = list[pos], val = getP(order, s.p), err = wizardView.err || "";
    let body = `<div class="card"><span class="chip">${esc(s.sec)}</span><h2 class="q">${esc(s.q)}</h2>${s.hint ? `<p class="hint">${esc(s.hint)}</p>` : ""}`;
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
    return `<div class="field">${inner}${s.unit ? `<span class="u">${s.unit}</span>` : ""}</div>`;
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
        return toast("Готово");
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    download(); toast("Файл сохранён. Отправьте его из папки «Загрузки»");
  }
  function download() {
    if (!pdfCache) return;
    const u = URL.createObjectURL(pdfCache.blob), a = document.createElement("a");
    a.href = u; a.download = pdfCache.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  }

  function menuView() {
    shell("Меню", null, `<div class="card"><button class="btn sec" data-a="close">Вернуться к заявке</button><button class="btn sec danger" data-a="new">Начать новую заявку</button></div>`, "", { menu: false });
  }

  /* ---------- диспетчер ---------- */
  function render() {
    if (view === "home") return homeView();
    if (view === "menu") return menuView();
    if (view === "review") return reviewView();
    if (sub) return subView();
    if (view === "hub") return hubView();
    return wizardView();
  }
  function act(a) {
    if (a === "next") { if (sub) return subNext(); const l = buildList(), s = l[pos]; return advance(s, readValue(s)); }
    if (a === "back") {
      if (sub) { if (sub.i > 0) sub.i--; else sub = null; return render(); }
      if (view === "hub") { view = "wizard"; pos = buildList().length - 1; }
      else if (view === "review") view = "hub";
      else if (pos > 0) pos--; else view = "home";
      wizardView.err = ""; save(); return render();
    }
    if (a === "new") { if (hasDraft() && !confirm("Начать новую заявку? Текущие ответы будут удалены.")) return; order = fresh(); pos = 0; view = "wizard"; sub = null; save(); return render(); }
    if (a === "resume") { view = "wizard"; const n = buildList().length; if (order.stops && pos >= n) view = "hub"; return render(); }
    if (a === "menu") { menuReturn = view; view = "menu"; return render(); }
    if (a === "close") { view = menuReturn === "menu" ? "home" : menuReturn; return render(); }
    if (a === "review") { view = "review"; save(); return render(); }
    if (a === "hub") { view = "hub"; return render(); }
    if (a === "send") return share();
    if (a === "download") { download(); return toast("Файл сохранён"); }
    if (a === "copyprev") {
      const l = buildList(), s = l[pos], f = s.floor; order.ops[f] = Object.assign({}, order.ops[f - 1]);
      pos += OPEN.length + 1; save(); return render();
    }
  }
  let menuReturn = "home";
  $app.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
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
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  render();
})();
