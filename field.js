/* Удобство ввода в поле: панель над клавиатурой (назад / вперёд / микрофон / Далее) и голосовой ввод размеров. */
(function () {
  const W = { ноль: 0, один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900 };
  function words(t) {
    let total = 0, cur = 0, seen = false, frac = null;
    for (const w of t.split(/\s+/)) {
      if (!w) continue;
      if (/^(запятая|точка|целых|целая|целое)$/.test(w)) { frac = ""; continue; }
      if (frac !== null) { if (w in W) { frac += String(W[w]); seen = true; } else if (/^\d+$/.test(w)) frac += w; continue; }
      if (/^\d+$/.test(w)) { cur += +w; seen = true; continue; }
      if (w === "полторы" || w === "полтора") { cur += 1.5; seen = true; continue; }
      if (/^тысяч/.test(w)) { total += (cur || 1) * 1000; cur = 0; seen = true; continue; }
      if (w in W) { cur += W[w]; seen = true; }
    }
    if (!seen) return null;
    const n = total + cur;
    return frac ? parseFloat(n + "." + frac) : n;
  }
  function parseSpoken(s) {
    s = String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[,;!?]/g, m => m === "," ? "," : " ").trim();
    const digits = s.replace(/(\d)\s+(?=\d{3}\b)/g, "$1").replace(",", ".");
    const m = digits.match(/^\d+(\.\d+)?$/); if (m) return parseFloat(m[0]);
    const mm = digits.match(/\d+(\.\d+)?/); if (mm && !/[а-я]/.test(digits)) return parseFloat(mm[0]);
    return words(digits.replace(/\./g, " точка "));
  }
  window.ZF = { parseSpoken };

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let bar, cur = null, rec = null, hideT = 0;
  const isNum = e => e && e.tagName === "INPUT" && /numeric|decimal/.test(e.getAttribute("inputmode") || "");
  const isField = e => e && (e.tagName === "TEXTAREA" || (e.tagName === "INPUT" && !/checkbox|radio|button/.test(e.type)));
  function scope(e) { return e.closest(".sheetbox") || document.getElementById("app"); }
  function inputs(e) { return [...scope(e).querySelectorAll("input,textarea")].filter(i => i.offsetParent && !i.disabled && isField(i)); }
  function make() {
    bar = document.createElement("div"); bar.id = "kbar"; bar.hidden = true;
    bar.innerHTML = `<button type="button" data-k="prev" aria-label="Предыдущее поле">‹</button><button type="button" data-k="next" aria-label="Следующее поле">›</button>${SR ? `<button type="button" data-k="mic" aria-label="Голосовой ввод">🎤</button>` : ""}<span class="kst"></span><button type="button" data-k="go" class="go">Далее</button>`;
    document.body.appendChild(bar);
    bar.addEventListener("pointerdown", e => e.preventDefault());   // фокус остаётся в поле
    bar.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b || !cur) return;
      const list = inputs(cur), i = list.indexOf(cur), k = b.dataset.k;
      if (k === "prev" && list[i - 1]) list[i - 1].focus();
      else if (k === "next" && list[i + 1]) list[i + 1].focus();
      else if (k === "mic") listen();
      else if (k === "go") {
        if (list[i + 1]) { list[i + 1].focus(); return; }
        const sc = scope(cur), btn = sc.querySelector("[data-a=gsave],[data-a=partsave],[data-a=floorsave],[data-a=copysave]") || document.querySelector("[data-a=next]");
        cur.blur(); if (btn) btn.click();
      }
    });
  }
  function place() {
    if (!bar) return; const v = window.visualViewport;
    const kb = v ? Math.max(0, window.innerHeight - v.height - v.offsetTop) : 0;
    bar.style.bottom = kb + "px";
  }
  function setLast(e) { const list = inputs(e), i = list.indexOf(e); bar.querySelector("[data-k=go]").textContent = list[i + 1] ? "Далее ›" : "Готово"; bar.querySelector("[data-k=prev]").disabled = i <= 0; bar.querySelector("[data-k=next]").disabled = i >= list.length - 1; const m = bar.querySelector("[data-k=mic]"); if (m) m.style.display = isNum(e) ? "" : "none"; }
  function listen() {
    if (!SR || !cur) return;
    const st = bar.querySelector(".kst");
    if (rec) { try { rec.stop(); } catch (_) {} return; }
    const target = cur; rec = new SR(); rec.lang = "ru-RU"; rec.interimResults = false; rec.maxAlternatives = 3;
    bar.classList.add("rec"); st.textContent = "Говорите размер…";
    rec.onresult = ev => {
      let v = null, heard = "";
      for (const a of ev.results[0]) { heard = heard || a.transcript; v = parseSpoken(a.transcript); if (v != null) { heard = a.transcript; break; } }
      if (v == null) { st.textContent = "Не понял: «" + heard + "»"; return; }
      target.value = String(v).replace(".", ","); target.dispatchEvent(new Event("input", { bubbles: true }));
      st.textContent = "Записано: " + target.value;
    };
    rec.onerror = ev => { st.textContent = ev.error === "not-allowed" ? "Нет доступа к микрофону" : "Не удалось распознать"; };
    rec.onend = () => { rec = null; bar.classList.remove("rec"); setTimeout(() => { if (!bar.classList.contains("rec")) st.textContent = ""; }, 2200); };
    try { rec.start(); } catch (err) { rec = null; bar.classList.remove("rec"); }
  }
  document.addEventListener("focusin", e => {
    if (!isField(e.target) || !matchMedia("(pointer:coarse)").matches) return; if (!bar) make();
    clearTimeout(hideT); cur = e.target; bar.hidden = false; setLast(cur); place();
    document.documentElement.classList.add("kb");
    setTimeout(() => { try { cur.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} }, 260);
  });
  document.addEventListener("focusout", () => { hideT = setTimeout(() => { if (bar) bar.hidden = true; document.documentElement.classList.remove("kb"); cur = null; }, 160); });
  if (window.visualViewport) { visualViewport.addEventListener("resize", place); visualViewport.addEventListener("scroll", place); }
})();
