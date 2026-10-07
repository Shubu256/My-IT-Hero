/* My IT Hero — shared frontend helpers. No tax is calculated in the browser:
   every figure shown comes from the server API. All DOM text is set with
   textContent (never innerHTML with data) to prevent XSS. */
(function () {
  "use strict";

  const NAV_IN = [
    ["/dashboard", "Home"], ["/new-regime", "New Regime"], ["/old-regime", "Old Regime"], ["/upload", "Upload Documents"],
    ["/my-return", "My Return"], ["/tax-calculation", "Tax Calculation"], ["/itr-mapping", "ITR Mapping"],
    ["/downloads", "Downloads"], ["/account", "Account"],
  ];
  const NAV_OUT = [["/", "Home"], ["/new-regime", "New Regime"], ["/old-regime", "Old Regime"], ["/where-do-i-enter-this", "Where do I enter this?"],
    ["/signin", "Sign in"], ["/signup", "Create account"]];

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  class ApiError extends Error {
    constructor(body, status) { super(body.message || "Request failed"); this.body = body; this.status = status; }
  }

  let csrfReady = null;
  function ensureCsrf() {
    if (getCookie("ith_csrf")) return Promise.resolve();
    if (!csrfReady) csrfReady = fetch("/api/auth/csrf", { credentials: "same-origin" });
    return csrfReady;
  }

  async function api(method, path, body, opts = {}) {
    await ensureCsrf();
    const init = { method, credentials: "same-origin", headers: { "X-CSRF-Token": getCookie("ith_csrf") } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
    const res = await fetch(path, init);
    let data;
    try { data = await res.json(); } catch (e) { data = { success: false, message: "Unexpected response from the server.", error_code: "BAD_RESPONSE" }; }
    if (!res.ok || data.success === false) {
      if ((data.error_code === "AUTH_REQUIRED" || data.error_code === "SESSION_EXPIRED") && !opts.noRedirect) {
        location.href = "/signin?next=" + encodeURIComponent(location.pathname) + (data.error_code === "SESSION_EXPIRED" ? "&expired=1" : "");
      }
      throw new ApiError(data, res.status);
    }
    return data;
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  }

  function inr(v, withSymbol = true) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Math.round(Number(v));
    if (!isFinite(n)) return String(v);
    const s = Math.abs(n).toString();
    let out = s;
    if (s.length > 3) {
      let head = s.slice(0, -3); const tail = s.slice(-3); const g = [];
      while (head.length > 2) { g.unshift(head.slice(-2)); head = head.slice(0, -2); }
      if (head) g.unshift(head);
      out = g.join(",") + "," + tail;
    }
    return (n < 0 ? "-" : "") + (withSymbol ? "₹" : "") + out;
  }

  function displayValue(value, type) {
    if (value === null || value === undefined || value === "") return "";
    if (type === "money") return inr(value, false);
    if (type === "bool") return value === "true" ? "Yes" : "No";
    if (type === "date") { const [y, m, d] = String(value).split("-"); return d ? `${d}/${m}/${y}` : value; }
    return String(value);
  }

  /* A value presented like a filled form field, with a Copy button.
     Copies the plain value the portal expects (no ₹, no commas for money). */
  function copyBox(value, type) {
    const shown = displayValue(value, type);
    const plain = type === "money" && value !== "" && value != null ? String(Math.round(Number(value))) : type === "date" ? shown : String(value ?? "");
    const box = el("span", { class: "copybox" + (shown ? "" : " empty") });
    const val = el("span", { class: "val", text: shown ? (type === "money" ? "₹ " + shown : shown) : "Not entered" });
    box.append(val);
    if (shown) {
      const b = el("button", { type: "button", "aria-label": "Copy value " + plain, text: "Copy" });
      b.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(plain); }
        catch (e) { const r = document.createRange(); r.selectNodeContents(val); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand("copy"); }
        box.classList.add("copied"); b.textContent = "Copied";
        setTimeout(() => { box.classList.remove("copied"); b.textContent = "Copy"; }, 1600);
      });
      box.append(b);
    }
    return box;
  }

  const STATUS_CLASS = { "Verified": "verified", "Needs Review": "review", "Missing": "missing", "Warning": "warning", "Error": "error" };
  function chip(status) {
    if (!status) return null;
    return el("span", { class: "chip " + (STATUS_CLASS[status] || "neutral"), text: status });
  }

  let toastTimer;
  function toast(msg, kind) {
    let t = document.querySelector(".toast");
    if (!t) { t = el("div", { class: "toast", role: "status", "aria-live": "polite" }); document.body.append(t); }
    t.className = "toast" + (kind === "error" ? " error" : "");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 3800);
  }

  function showError(container, err) {
    const b = err.body || { message: String(err) };
    const n = el("div", { class: "notice error", role: "alert" }, el("p", null, el("strong", { text: b.message || "Something went wrong." }), b.user_action ? " " + b.user_action : ""));
    if (container) { container.replaceChildren(n); } else toast(b.message || "Something went wrong.", "error");
    return n;
  }

  function fieldErrors(form, details) {
    form.querySelectorAll(".field-error").forEach((n) => n.remove());
    form.querySelectorAll("[aria-invalid]").forEach((n) => n.removeAttribute("aria-invalid"));
    if (!details) return;
    const map = details.errors || details;
    for (const [k, msg] of Object.entries(map)) {
      const input = form.querySelector(`[name="${CSS.escape(k)}"]`);
      if (!input) continue;
      input.setAttribute("aria-invalid", "true");
      const e = el("div", { class: "field-error", text: msg, id: "err-" + k });
      input.setAttribute("aria-describedby", "err-" + k);
      (input.closest(".field") || input.parentElement).append(e);
    }
  }

  let meCache;
  async function me() {
    if (meCache !== undefined) return meCache;
    try { const r = await api("GET", "/api/auth/me", undefined, { noRedirect: true }); meCache = r.user; ITH.sessionExpired = r.session_expired; } catch (e) { meCache = null; }
    return meCache;
  }

  async function shell(opts = {}) {
    const user = await me();
    if (opts.auth && !user) { location.href = "/signin?next=" + encodeURIComponent(location.pathname) + (ITH.sessionExpired ? "&expired=1" : ""); return null; }
    const header = document.getElementById("app-header");
    let meta = { active_ay: "2026-27", financial_year: "2025-26" };
    try { meta = await api("GET", "/api/meta"); } catch (e) { /* offline */ }
    if (header) {
      const items = user ? NAV_IN.concat(user.is_admin ? [["/admin", "Admin"]] : []) : NAV_OUT;
      const here = location.pathname.replace(/\/$/, "") || "/";
      const nav = el("nav", { class: "nav", "aria-label": "Main" },
        items.map(([href, label]) => el("a", { href, text: label, "aria-current": (href === here || (href === "/itr-mapping" && here === "/where-do-i-enter-this")) ? "page" : null })));
      header.replaceChildren(el("div", { class: "topbar" + (user ? " long" : "") }, el("div", { class: "topbar-inner" },
        el("a", { class: "wordmark", href: user ? "/dashboard" : "/" }, el("span", { class: "mark", "aria-hidden": "true", text: "IT" }), "my IT Hero"),
        el("span", { class: "ay-pill", title: "Assessment Year being prepared", text: `AY ${meta.active_ay} (FY ${meta.financial_year})` }),
        nav)));
      const cur = nav.querySelector('[aria-current="page"]');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "center" });
    }
    const footer = document.getElementById("app-footer");
    if (footer) {
      footer.replaceChildren(el("div", { class: "inner" },
        el("p", { text: "This application prepares and estimates information for tax filing. It does not constitute professional tax advice. My IT Hero is not affiliated with the Income Tax Department and cannot file your return." }),
        el("nav", { "aria-label": "Legal" }, [["/privacy", "Privacy Policy"], ["/terms", "Terms of Use"], ["/disclaimer", "Tax Disclaimer"], ["/data-retention", "Data Retention"],
          ["https://www.incometax.gov.in/iec/foportal/", "Open Income Tax e-Filing Portal"]].map(([h, t]) =>
          el("a", h.startsWith("http") ? { href: h, text: t, target: "_blank", rel: "noopener noreferrer" } : { href: h, text: t })))));
    }
    return { user, meta };
  }

  function qs(name) { return new URLSearchParams(location.search).get(name); }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || "Working…"; }
    else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
  }

  function safeNext(n) { return n && /^\/[a-z0-9\-]*$/i.test(n) ? n : "/dashboard"; }

  window.ITH = { api, el, inr, copyBox, chip, toast, showError, fieldErrors, shell, me, qs, busy, displayValue, safeNext, ApiError };
})();
