/* Рисование бланков на canvas и упаковка в PDF без внешних библиотек.
   Геометрия повторяет form_pdf.py (единицы pt, ось Y вверх). */
(function () {
  const K = 72 / 200, PWpx = 2338, PHpx = 1653, PW = PWpx * K, PH = PHpx * K;
  const SANS = 'Arial, Roboto, "Liberation Sans", "Helvetica Neue", sans-serif';
  const SERIF = '"Times New Roman", "Liberation Serif", Georgia, serif';
  const ROW_Y = [812, 844, 880, 916, 952, 988, 1024, 1059, 1095, 1130, 1166, 1201, 1237, 1272, 1308, 1344, 1380, 1416];
  const COL = { n: [131, 254], width: [261, 362], top_A: [478, 593], top_H: [594, 709], left_H: [989, 1152], left_B: [1153, 1315],
    right_H: [1485, 1648], right_B: [1649, 1827], C: [1834, 1936], qty: [1943, 2032], color: [2039, 2163] };
  const ADDR = [124, 258, 474, 420], CONT = [124, 500, 474, 660];
  const CHOICE = { "А": [708, 217, 820, 257], "В": [1319, 217, 1430, 257] };
  const ROWS_PER_PAGE = 17;
  const X = p => p * K, Y = p => PH - p * K;
  const fmt = v => (v === null || v === undefined || v === "") ? "" : String(v).replace(".", ",");

  function newPage() {
    const c = document.createElement("canvas"); c.width = PWpx; c.height = PHpx;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, PWpx, PHpx);
    x.setTransform(1 / K, 0, 0, -1 / K, 0, PHpx);
    x.fillStyle = "#000"; x.strokeStyle = "#000"; x.lineWidth = 1; x.setLineDash([]); x.lineJoin = "miter";
    return { c, x };
  }
  const fontStr = (size, bold, serif) => `${bold ? "bold " : ""}${size / K}px ${serif ? SERIF : SANS}`;
  function tw(x, s, size, bold, serif) {
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.font = fontStr(size, bold, serif);
    const w = x.measureText(s).width * K; x.restore(); return w;
  }
  function T(x, s, px, py, o = {}) {
    const { size = 10, bold = false, align = "left", serif = false } = o;
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.font = fontStr(size, bold, serif);
    x.textAlign = align; x.textBaseline = "alphabetic"; x.fillStyle = o.color || "#000";
    x.fillText(s, px / K, (PH - py) / K); x.restore();
  }
  function fit(x, s, cx, cy, maxw, size = 10.5, minsize = 5.5, bold = false) {
    while (size > minsize && tw(x, s, size, bold) > maxw) size -= 0.5;
    T(x, s, cx, cy - size * 0.35, { size, align: "center", bold });
  }
  function wrap(x, s, size, w) {
    const out = [];
    for (const para of String(s).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        let t = line ? line + " " + word : word;
        if (tw(x, t, size) <= w) { line = t; continue; }
        if (line) out.push(line);
        line = word;
        while (tw(x, line, size) > w && line.length > 1) {
          let n = line.length - 1; while (n > 1 && tw(x, line.slice(0, n), size) > w) n--;
          out.push(line.slice(0, n)); line = line.slice(n);
        }
      }
      out.push(line);
    }
    return out;
  }
  function boxText(x, box, s, size = 11) {
    const w = (box[2] - box[0]) * K - 8, h = (box[3] - box[1]) * K - 6;
    let lines;
    for (;;) { lines = wrap(x, s, size, w); if (lines.length * size * 1.2 <= h || size <= 6) break; size -= 0.5; }
    const top = Y(box[1]) - 4 - size;
    lines.forEach((ln, i) => T(x, ln, X(box[0]) + 4, top - i * size * 1.2, { size }));
  }
  function header(x, order) {
    boxText(x, ADDR, order.address || ""); boxText(x, CONT, order.contact || "");
    const b = CHOICE[order.scheme];
    if (b) T(x, "X", X((b[0] + b[2]) / 2), Y((b[1] + b[3]) / 2) - 7, { size: 20, bold: true, align: "center" });
  }
  const line = (x, a, b, c, d) => { x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); };
  const tri = (x, p) => { x.beginPath(); x.moveTo(p[0][0], p[0][1]); x.lineTo(p[1][0], p[1][1]); x.lineTo(p[2][0], p[2][1]); x.closePath(); x.fill(); };
  function arrowH(x, x1, x2, y, s = 4) {
    line(x, x1, y, x2, y);
    for (const [xe, d] of [[x1, 1], [x2, -1]]) tri(x, [[xe, y], [xe + d * s * 1.8, y + s * .6], [xe + d * s * 1.8, y - s * .6]]);
  }
  function arrowV(x, px, y1, y2, s = 4) {
    line(x, px, y1, px, y2);
    for (const [ye, d] of [[y1, 1], [y2, -1]]) tri(x, [[px, ye], [px + s * .6, ye + d * s * 1.8], [px - s * .6, ye + d * s * 1.8]]);
  }
  function arrowAny(x, x1, y1, x2, y2, s = 4) {
    line(x, x1, y1, x2, y2);
    const a = Math.atan2(y2 - y1, x2 - x1);
    for (const [xe, ye, ang] of [[x1, y1, a], [x2, y2, a + Math.PI]])
      tri(x, [[xe, ye], ...[.35, -.35].map(k => [xe + s * 1.9 * Math.cos(ang + k), ye + s * 1.9 * Math.sin(ang + k)])]);
  }
  const rectS = (x, a, b, w, h) => { x.beginPath(); x.rect(a, b, w, h); x.stroke(); };

  function stampTop(x, order) {
    if (order.stamp) T(x, "Заявка от: " + order.stamp, PW - 40, PH - 22, { size: 9, align: "right", color: "#333" });
  }
  function page1(img, order, rows, start) {
    const { c, x } = newPage();
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(img, 0, 0, PWpx, PHpx); x.restore();
    header(x, order); stampTop(x, order);
    const color = (order.common || {}).color;
    rows.forEach((o, i) => {
      const cy = Y((ROW_Y[i] + ROW_Y[i + 1]) / 2);
      const vals = Object.assign({}, o, { n: o.floor !== undefined ? o.floor : start + i + 1, color });
      for (const [key, [x1, x2]] of Object.entries(COL))
        fit(x, fmt(vals[key]), X((x1 + x2) / 2), cy, (x2 - x1) * K - 4, key === "color" ? 9 : 11);
    });
    const cm = order.common;
    if (cm) {
      const text = `Примечание: ширина проёма указана в графе «проём». Размеры указаны ${String(cm.bend_mode || "").toLowerCase()}, размер загиба ${fmt(cm.bend)} мм.`;
      let y = Y(1450);
      for (const ln of wrap(x, text, 9, (2163 - 131) * K)) { T(x, ln, X(131), y, { size: 9 }); y -= 11; }
    }
    return c;
  }

  function appendix(order) {
    const { c, x } = newPage(); const cm = order.common || {};
    stampTop(x, order);
    T(x, "Заявка на изготовление обрамлений ДШ. Общие параметры", PW / 2, PH - 50, { size: 14, bold: true, serif: true, align: "center" });
    T(x, "Адрес объекта: " + (order.address || ""), 40, PH - 80, { size: 10.5 });
    T(x, "Контактное лицо: " + (order.contact || ""), 40, PH - 97, { size: 10.5 });
    const noInd = String(cm.ind_floor || "").toLowerCase() === "нет табло";
    const rows = [
      ["Количество остановок", order.stops],
      ["Размеры по этажам", order.dsh_same ? "одинаковые на всех этажах" : "индивидуально для каждого этажа"],
      ["Цвет окраски (RAL)", cm.color],
      ["Размеры обрамлений указаны", cm.bend_mode],
      ["Размер загиба, мм", cm.bend],
      ["Табло индикации", cm.ind_floor],
      ["Размер отверстия под табло (высота×ширина), мм", noInd ? "—" : cm.ind_size],
      ["Кнопка вызова ставится", cm.btn_all === "Не на всех этажах" ? "на этажах: " + cm.btn_floors : "на всех этажах"],
      ["Кнопка вызова: с какой стороны", cm.btn_side],
      ["Кнопка вызова: расстояние от пола, мм", cm.btn_height],
      ["Размер отверстия под кнопку вызова (высота×ширина), мм", cm.btn_size]];
    const x0 = 40, y0 = PH - 125, w1 = 380, w2 = 220, rh = 30;
    rows.forEach(([name, val], i) => {
      const y = y0 - (i + 1) * rh;
      rectS(x, x0, y, w1, rh); rectS(x, x0 + w1, y, w2, rh);
      T(x, name, x0 + 8, y + rh / 2 - 4, { size: 11 });
      fit(x, fmt(val), x0 + w1 + w2 / 2, y + rh / 2, w2 - 10, 12);
    });
    return c;
  }

  const dimLabel = (n, v) => (v !== undefined && v !== null && v !== "") ? `${n} ${fmt(v)} мм` : `${n}, мм`;
  function field(x, px, py, label, value, unit, lw = 44) {
    T(x, label, px, py, { size: 10 });
    const lx = px + tw(x, label, 10) + 4;
    x.lineWidth = .7; line(x, lx, py - 2, lx + lw, py - 2);
    if (value !== undefined && value !== null && value !== "") T(x, fmt(value), lx + lw / 2, py, { size: 10, align: "center" });
    T(x, unit, lx + lw + 4, py, { size: 10 }); x.lineWidth = 1;
  }
  function thresholdBlock(x, px, ytop, t) {
    t = t || {};
    T(x, "Пороги (рифлёнка)", px, PH - ytop, { size: 11, bold: true });
    const bx = px + 100, by = PH - (ytop + 80), bw = 190, bh = 38;
    x.lineWidth = 1.2; rectS(x, bx, by, bw, bh); x.lineWidth = .4;
    x.save(); x.beginPath(); x.rect(bx, by, bw, bh); x.clip();
    for (let k = -bh; k < bw + bh; k += 9) { line(x, bx + k, by, bx + k + bh, by + bh); line(x, bx + k, by + bh, bx + k + bh, by); }
    x.restore(); x.lineWidth = 1;
    const hy = by + 9;
    for (const hx of [bx + 12, bx + bw / 2, bx + bw - 12]) { x.fillStyle = "#fff"; x.beginPath(); x.arc(hx, hy, 3.2, 0, 7); x.fill(); x.stroke(); x.fillStyle = "#000"; }
    line(x, bx + bw - 12, hy, bx + bw - 2, by + bh + 12); line(x, bx + bw - 2, by + bh + 12, bx + bw + 12, by + bh + 12);
    T(x, "Ø6", bx + bw + 14, by + bh + 9, { size: 9 });
    x.lineWidth = .7;
    line(x, bx, by + bh + 3, bx, by + bh + 20); line(x, bx + bw, by + bh + 3, bx + bw, by + bh + 20);
    arrowH(x, bx, bx + bw - 30, by + bh + 16);
    T(x, dimLabel("Длина", t.length), bx + 4, by + bh + 21, { size: 10 });
    line(x, bx - 3, by, bx - 18, by); line(x, bx - 3, by + bh, bx - 18, by + bh);
    arrowV(x, bx - 14, by, by + bh);
    T(x, dimLabel("Ширина", t.width), bx - 20, by + bh / 2 - 4, { size: 10, align: "right" });
    x.lineWidth = 1;
    field(x, px + 100, by - 22, "Кол-во отверстий Ø6:", t.holes, "шт.", 30);
    field(x, px + 100, by - 40, "Количество:", t.qty, "шт.", 30);
  }
  function nashchBlock(x, px, ytop, t) {
    t = t || {};
    T(x, "Нащельник", px, PH - ytop, { size: 11, bold: true });
    const bx = px + 90, by = PH - (ytop + 80), bw = 190, bh = 30;
    x.lineWidth = 1.2; rectS(x, bx, by, bw, bh); x.lineWidth = .7;
    line(x, bx, by + bh + 3, bx, by + bh + 20); line(x, bx + bw, by + bh + 3, bx + bw, by + bh + 20);
    arrowH(x, bx, bx + bw, by + bh + 16);
    T(x, dimLabel("Длина", t.length), bx + bw / 2, by + bh + 21, { size: 10, align: "center" });
    line(x, bx - 3, by, bx - 18, by); line(x, bx - 3, by + bh, bx - 18, by + bh);
    arrowV(x, bx - 14, by, by + bh);
    T(x, dimLabel("Ширина", t.width), bx - 20, by + bh / 2 - 4, { size: 10, align: "right" });
    x.lineWidth = 1;
    field(x, px + 90, by - 22, "Количество:", t.qty, "шт.", 30);
  }
  function guardBlock(x, px, ytop, title, t) {
    t = t || {};
    T(x, title, px, PH - ytop, { size: 11, bold: true });
    const fw = 90, fh = 64, dx = 38, dy = 30, fx = px + 92, fy = PH - (ytop + 30) - fh - 22, bxo = fx + dx, byo = fy + dy;
    x.lineWidth = 1.4; rectS(x, fx, fy, fw, fh);
    line(x, fx, fy + fh, bxo, byo + fh); line(x, bxo, byo + fh, bxo + fw, byo + fh);
    line(x, fx + fw, fy + fh, bxo + fw, byo + fh); line(x, bxo + fw, byo + fh, bxo + fw, byo); line(x, fx + fw, fy, bxo + fw, byo);
    x.setLineDash([3, 3]); x.lineWidth = .8;
    line(x, fx, fy, bxo, byo); line(x, bxo, byo, bxo + fw, byo); line(x, bxo, byo, bxo, byo + fh);
    x.setLineDash([]); x.lineWidth = .7;
    line(x, fx - 3, fy, fx - 20, fy); line(x, fx - 3, fy + fh, fx - 20, fy + fh);
    arrowV(x, fx - 16, fy, fy + fh);
    T(x, dimLabel("Высота", t.h), fx - 22, fy + fh / 2 - 4, { size: 10, align: "right" });
    line(x, fx, fy - 3, fx, fy - 15); line(x, fx + fw, fy - 3, fx + fw, fy - 15);
    arrowH(x, fx, fx + fw, fy - 12);
    T(x, dimLabel("Ширина", t.w), fx + fw / 2, fy - 26, { size: 10, align: "center" });
    const ox = 12, oy = -12;
    arrowAny(x, fx + fw + ox, fy + oy, bxo + fw + ox, byo + oy);
    line(x, fx + fw + 2, fy - 2, fx + fw + ox, fy + oy); line(x, bxo + fw + 2, byo - 2, bxo + fw + ox, byo + oy);
    T(x, dimLabel("Длина", t.l), bxo + fw + ox + 6, byo + oy - 12, { size: 10 });
    x.lineWidth = 1;
    field(x, px + 92, fy - 46, "Количество:", t.qty, "шт.", 30);
  }
  function page2(order, thr, nsh, cable) {
    const { c, x } = newPage();
    stampTop(x, order);
    T(x, "Заявка на изготовление", PW / 2 + 40, PH - 58, { size: 14, bold: true, serif: true, align: "center" });
    T(x, "Адрес объекта:", X(62), Y(240), { size: 11, bold: true, serif: true });
    T(x, "Контактное лицо на объекте:", X(62), Y(477), { size: 11, bold: true, serif: true });
    for (const b of [ADDR, CONT]) rectS(x, X(b[0]), Y(b[3]), (b[2] - b[0]) * K, (b[3] - b[1]) * K);
    header(x, Object.assign({}, order, { scheme: "" }));
    thresholdBlock(x, 195, 100, thr); nashchBlock(x, 520, 100, nsh);
    if (cable) { guardBlock(x, 195, 300, "Бортики ограничителя скорости", cable.speed_limiter); guardBlock(x, 520, 300, "Бортики главного привода", cable.main_drive); }
    return c;
  }


  /* ---------- Бланк замера дверей и люков ---------- */
  const ACC = "#1b6fa8", INKC = "#15212c", MUT = "#5b6b79", LN = "#c9d3dc", SOFTC = "#f1f5f8", TINTC = "#e3eef7", AMB = "#fde3bd", AMBL = "#c9801a";
  function rr(x, px, yt, w, h, r, fill, stroke, lw) {
    x.beginPath();
    if (x.roundRect) x.roundRect(px, PH - yt - h, w, h, r); else x.rect(px, PH - yt - h, w, h);
    if (fill) { x.fillStyle = fill; x.fill(); }
    if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || 1; x.stroke(); }
  }
  const cell = (v) => (v === undefined || v === null || v === "") ? "" : fmt(v);
  function openingDL(x, ox, yt, w, h, hatch, cas, vals) {
    const y = PH - (yt + h), t = 7;
    x.fillStyle = TINTC; x.fillRect(ox, y, w, h);
    x.save(); x.beginPath(); x.rect(ox, y, w, h); x.clip(); x.strokeStyle = "#b7cde0"; x.lineWidth = .6;
    for (let k = -h; k < w + h; k += 9) line(x, ox + k, y, ox + k + h, y + h);
    x.restore();
    x.strokeStyle = INKC; x.lineWidth = 1.8; x.strokeRect(ox, y, w, h);
    x.fillStyle = AMB; x.strokeStyle = AMBL; x.lineWidth = 1;
    const L = cas.l, Tp = cas.t, R = cas.r, B = cas.b;
    if (L) { x.fillRect(ox - t, y - (B ? t : 0), t, h + (Tp ? t : 0) + (B ? t : 0)); x.strokeRect(ox - t, y - (B ? t : 0), t, h + (Tp ? t : 0) + (B ? t : 0)); }
    if (R) { x.fillRect(ox + w, y - (B ? t : 0), t, h + (Tp ? t : 0) + (B ? t : 0)); x.strokeRect(ox + w, y - (B ? t : 0), t, h + (Tp ? t : 0) + (B ? t : 0)); }
    if (Tp) { x.fillRect(ox - (L ? t : 0), y + h, w + (L ? t : 0) + (R ? t : 0), t); x.strokeRect(ox - (L ? t : 0), y + h, w + (L ? t : 0) + (R ? t : 0), t); }
    if (B) { x.fillRect(ox - (L ? t : 0), y - t, w + (L ? t : 0) + (R ? t : 0), t); x.strokeRect(ox - (L ? t : 0), y - t, w + (L ? t : 0) + (R ? t : 0), t); }
    if (hatch) { x.fillStyle = INKC; x.beginPath(); x.arc(ox + w - 12, y + h / 2, 2.6, 0, 7); x.fill(); }
    const sx = L ? 9 : 0, by = B ? 7 : 0;
    x.strokeStyle = MUT; x.lineWidth = .6;
    line(x, ox - 4 - sx, y + h, ox - 26 - sx, y + h); line(x, ox - 4 - sx, y, ox - 26 - sx, y);
    x.strokeStyle = ACC; x.fillStyle = ACC; arrowV(x, ox - 20 - sx, y, y + h);
    x.strokeStyle = MUT; x.lineWidth = .6;
    line(x, ox, y - 4 - by, ox, y - 24 - by); line(x, ox + w, y - 4 - by, ox + w, y - 24 - by);
    x.strokeStyle = ACC; x.fillStyle = ACC; arrowH(x, ox, ox + w, y - 18 - by);
    T(x, "Высота" + (vals.h ? " " + fmt(vals.h) : ""), ox - 30 - sx, PH - yt - h / 2 - 3, { size: 10, bold: true, align: "right", color: ACC });
    T(x, "Ширина" + (vals.w ? " " + fmt(vals.w) : ""), ox + w / 2, PH - (yt + h + 33 + by), { size: 10, bold: true, align: "center", color: ACC });
  }
  function row(x, bx, yt, bw, rh, label, val, unit, hint) {
    rr(x, bx, yt, bw, rh, 6, SOFTC, LN, .8);
    T(x, label, bx + 12, PH - (yt + rh / 2 + 4), { size: label.length > 20 ? 9.5 : 10.5, bold: true, color: INKC });
    if (hint) { T(x, hint, bx + bw - 12, PH - (yt + rh / 2 + 3.5), { size: 8, align: "right", color: MUT }); return; }
    x.strokeStyle = MUT; x.lineWidth = .9; line(x, bx + 190, PH - (yt + rh - 6), bx + bw - 34, PH - (yt + rh - 6));
    if (val !== "" && val !== undefined) T(x, String(val), bx + 190 + (bw - 34 - 190) / 2, PH - (yt + rh - 9), { size: 11.5, bold: true, align: "center", color: INKC });
    T(x, unit, bx + bw - 12, PH - (yt + rh / 2 + 4), { size: 9.5, align: "right", color: MUT });
  }
  function checks(x, bx, yt, bw, rh, title, opts, on, x0, step) {
    rr(x, bx, yt, bw, rh, 6, SOFTC, LN, .8);
    T(x, title, bx + 12, PH - (yt + rh / 2 + 4), { size: 10.5, bold: true, color: INKC });
    opts.forEach(([key, lab], k) => {
      const cx = bx + x0 + k * step, cy = yt + rh / 2 - 6;
      rr(x, cx, cy, 12, 12, 2, "#fff", INKC, 1);
      if (on[key]) { x.strokeStyle = ACC; x.lineWidth = 2; x.beginPath(); x.moveTo(cx + 2.5, PH - cy - 6.5); x.lineTo(cx + 5.2, PH - cy - 9.5); x.lineTo(cx + 10, PH - cy - 2.5); x.stroke(); }
      T(x, lab, cx + 18, PH - (yt + rh / 2 + 4), { size: 10, color: INKC });
    });
  }
  function dlCard(x, cx0, top, w, h, num, title, hatch, d, mult) {
    rr(x, cx0, top, w, h, 10, "#fff", LN, 1);
    x.fillStyle = ACC; x.beginPath(); x.arc(cx0 + 24, PH - (top + 24), 11, 0, 7); x.fill();
    T(x, String(num), cx0 + 24, PH - (top + 28), { size: 12, bold: true, align: "center", color: "#fff" });
    T(x, title, cx0 + 44, PH - (top + 29), { size: 15, bold: true, color: INKC });
    x.strokeStyle = LN; x.lineWidth = 1; line(x, cx0 + 14, PH - (top + 42), cx0 + w - 14, PH - (top + 42));
    if (!d || d.need !== "Да") {
      T(x, "Не требуется", cx0 + w / 2, PH - (top + h / 2 + 8), { size: 20, bold: true, align: "center", color: "#a3b0bc" });
      return;
    }
    const dw = hatch ? 76 : 54, dh = hatch ? 76 : 84;
    const cas = hatch ? { l: 1, t: 1, r: 1, b: 1 } : { l: d.cas.l, t: d.cas.t, r: d.cas.r };
    openingDL(x, cx0 + (w - dw) / 2 + 12, top + 58, dw, dh, hatch, cas, { h: d.h, w: d.w });
    const bx = cx0 + 18, bw = w - 36, rh = 24, gap = 4;
    let yt = top + 58 + dh + 38 + (hatch ? 7 : 0);
    row(x, bx, yt, bw, rh, "Высота строительного проёма", cell(d.h), "мм"); yt += rh + gap;
    row(x, bx, yt, bw, rh, "Ширина строительного проёма", cell(d.w), "мм"); yt += rh + gap;
    const rh2 = hatch ? [d.h - 10, d.w - 10] : [d.h - 20, d.w - 40];
    row(x, bx, yt, bw, rh, hatch ? "Размер люка (В × Ш)" : "Размер двери (В × Ш)", "", "", "\u200b");
    // значение расчёта крупно справа
    T(x, `${fmt(rh2[0])} × ${fmt(rh2[1])} мм`, bx + 168, PH - (yt + rh / 2 + 4), { size: 11.5, bold: true, color: ACC });
    yt += rh + gap;
    if (!hatch) { checks(x, bx, yt, bw, rh, "Петли", [["l", "слева"], ["r", "справа"]], { l: d.hinge === "Слева", r: d.hinge === "Справа" }, 118, 82); yt += rh + gap; }
    if (hatch) row(x, bx, yt, bw, rh, "Наличник", "", "", "всегда, со всех четырёх сторон");
    else checks(x, bx, yt, bw, rh, "Наличник", [["l", "слева"], ["t", "сверху"], ["r", "справа"]], d.cas, 118, 82);
    yt += rh + gap;
    row(x, bx, yt, bw, rh, "Количество", d.qty * mult, "шт.");
    if (mult > 1) T(x, `по ${d.qty} в каждом из ${mult} подъездов`, bx + 12, PH - (yt + rh + 11), { size: 8, color: MUT });
  }
  function dlPage(order, item) {
    const { c, x } = newPage(), M = 30;
    x.fillStyle = ACC; x.fillRect(0, PH - 6, PW, 6);
    T(x, "Бланк замера дверей и люков", M, PH - 50, { size: 22, bold: true, color: INKC });
    T(x, "Машинное помещение лифта", M, PH - 66, { size: 10, color: MUT });
    rr(x, PW - M - 170, 32, 170, 26, 13, "#e3eef7", ACC, 1);
    T(x, item.label, PW - M - 85, PH - 49, { size: 11, bold: true, align: "center", color: ACC });
    const f = (px, yt, w, label, val) => {
      x.strokeStyle = LN; x.lineWidth = .9; line(x, px, PH - yt, px + w, PH - yt);
      if (val) T(x, val, px + 2, PH - (yt - 4), { size: 11.5, bold: true, color: INKC });
      T(x, label, px, PH - (yt + 11), { size: 8, color: MUT });
    };
    const cw = (PW - 2 * M - 40) / 3;
    f(M, 98, PW - 2 * M, "Адрес объекта", order.address);
    f(M, 128, cw + 60, "Контактное лицо на объекте, телефон", order.contact);
    f(M + cw + 80, 128, cw - 20, "Дата и время заявки", order.stamp || new Date().toLocaleDateString("ru-RU"));
    f(M + 2 * cw + 80, 128, PW - M - (M + 2 * cw + 80), "Замерщик", order.worker);
    const top = 150, ch = 356, cwid = (PW - 2 * M - 18) / 2;
    dlCard(x, M, top, cwid, ch, 1, "Проём двери", false, item.door, item.mult);
    dlCard(x, M + cwid + 18, top, cwid, ch, 2, "Люк", true, item.hatch, item.mult);
    T(x, "Все размеры в миллиметрах. Размер изделия рассчитывается из строительного проёма.", M, PH - 585, { size: 7.5, color: MUT });
    return c;
  }

  const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

  async function buildPages(order) {
    if (order.kind === "dl") return order.items.map(it => dlPage(order, it));
    const img = await loadImg("form_p1.jpg");
    const pages = [], ops = order.openings || [];
    const thr = order.thresholds || [], nsh = order.nashchelnik || [];
    const cable = order.cable && Object.keys(order.cable).length ? order.cable : null;
    if (ops.length || !(thr.length || nsh.length || cable))
      for (let s = 0; s < Math.max(ops.length, 1); s += ROWS_PER_PAGE) pages.push(page1(img, order, ops.slice(s, s + ROWS_PER_PAGE), s));
    if (order.common) pages.push(appendix(order));
    const n = Math.max(thr.length, nsh.length, cable ? 1 : 0);
    for (let i = 0; i < n; i++) pages.push(page2(order, thr[i], nsh[i], i === 0 ? cable : null));
    return pages;
  }

  /* --- минимальный писатель PDF: каждая страница — JPEG --- */
  function dataUrlToBytes(u) { const b = atob(u.split(",")[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function makePdf(canvases, title) {
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const add = d => { const u = typeof d === "string" ? enc.encode(d) : d; parts.push(u); len += u.length; };
    const obj = (n, body) => { offs[n] = len; add(`${n} 0 obj\n`); add(body); add("\nendobj\n"); };
    const N = canvases.length, W = PW.toFixed(2), H = PH.toFixed(2);
    add("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Count ${N} /Kids [${canvases.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`);
    canvases.forEach((cv, i) => {
      const p = 3 + i * 3, jpg = dataUrlToBytes(cv.toDataURL("image/jpeg", 0.92));
      obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${p + 1} 0 R >> >> /Contents ${p + 2} 0 R >>`);
      offs[p + 1] = len; add(`${p + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
      add(jpg); add("\nendstream\nendobj\n");
      const cs = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
      obj(p + 2, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
    });
    const tt = Array.from(enc.encode(title || "")).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const infoN = 3 + N * 3;
    obj(infoN, `<< /Title <FEFF${Array.from(title || "").map(ch => ch.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase()}> >>`);
    const xref = len; add(`xref\n0 ${infoN + 1}\n0000000000 65535 f \n`);
    for (let i = 1; i <= infoN; i++) add(String(offs[i]).padStart(10, "0") + " 00000 n \n");
    add(`trailer\n<< /Size ${infoN + 1} /Root 1 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: "application/pdf" });
  }

  window.PDFGEN = { buildPages, makePdf };
})();
