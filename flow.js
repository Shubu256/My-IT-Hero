/* Guided filing flow: a five-step bar at the top of the Upload, My Return, Tax calculation,
   Downloads and ITR mapping pages, and a "Next step" bar at the bottom. Reads progress from
   this browser's My IT Hero storage (nothing leaves the device). */
(function (root) {
  "use strict";
  const STEPS = [
    { key: "upload", page: "upload.html", title: "Upload documents", hint: "Form 16 Part A & B, Form 12BA, certificates" },
    { key: "return", page: "my-return.html", title: "Check My Return", hint: "Values filled from your documents" },
    { key: "calc", page: "tax-calculation.html", title: "Tax calculation", hint: "Slabs, rebate, TDS, refund / payable" },
    { key: "downloads", page: "downloads.html", title: "Download return", hint: "PDF or Word worksheet" },
    { key: "portal", page: "itr-mapping.html", title: "Enter on the portal", hint: "Where each value goes" },
  ];
  const ALIASES = { "where-do-i-enter-this.html": "itr-mapping.html" };

  function currentIndex() {
    let f = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    f = ALIASES[f] || f;
    return STEPS.findIndex((s) => s.page === f);
  }
  function progress() {
    try {
      const st = root.ITHLocal && root.ITHLocal._load ? root.ITHLocal._load() : null;
      if (!st || !st.session || !st.users[st.session.userId]) return null;
      const uid = st.session.userId;
      const ay = root.ITH_DATA ? root.ITH_DATA.active : Object.keys((st.returns || {})[uid] || {})[0];
      const b = ((st.returns || {})[uid] || {})[ay];
      const ret = b && b.profiles ? b.profiles[b.active] : null;
      const docs = ((st.documents || {})[uid] || []).filter((d) => !ret || !d.profile_id || d.profile_id === ret.id);
      const outs = ((st.outputs || {})[uid] || []).filter((o) => !ret || o.profile_id === ret.id);
      const filled = ret ? Object.values(ret.fields || {}).filter((r) => r && r.value !== null && r.value !== "").length : 0;
      return { docs: docs.length, filled, outputs: outs.length, label: ret ? ret.label : "", hasSummary: !!(ret && ret.doc_summary) };
    } catch (e) { return null; }
  }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === null || v === undefined || v === false) continue; if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v); }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  }
  function render(refresh) {
    const i = currentIndex(); if (i < 0) return;
    const main = document.getElementById("main"); if (!main) return;
    if (refresh) main.querySelectorAll(".flow-bar, .flow-next").forEach((n) => n.remove());
    if (main.querySelector(".flow-bar")) return;
    const p = progress(); if (!p) return; // signed out: the page itself shows the sign-in prompt
    const done = [p.docs > 0, p.filled >= 3, false, p.outputs > 0, false];
    const sub = [p.docs ? `${p.docs} document${p.docs === 1 ? "" : "s"}` : STEPS[0].hint, p.filled ? `${p.filled} value${p.filled === 1 ? "" : "s"} filled` : STEPS[1].hint, STEPS[2].hint,
      p.outputs ? `${p.outputs} file${p.outputs === 1 ? "" : "s"} ready` : STEPS[3].hint, STEPS[4].hint];
    const bar = el("nav", { class: "flow-bar", "aria-label": "Filing steps" },
      el("ol", null, ...STEPS.map((s, k) => el("li", { class: "flow-step" + (k === i ? " current" : "") + (done[k] && k !== i ? " done" : "") },
        el("a", { href: s.page, "aria-current": k === i ? "step" : null },
          el("span", { class: "flow-num", text: done[k] && k !== i ? "✓" : String(k + 1) }),
          el("span", { class: "flow-text" }, el("strong", { text: s.title }), el("span", { text: sub[k] })))))));
    main.prepend(bar);
    const prev = STEPS[i - 1], next = STEPS[i + 1];
    const foot = el("div", { class: "flow-next" },
      prev ? el("a", { class: "btn secondary", href: prev.page, text: "← " + prev.title }) : el("span"),
      next ? el("a", { class: "btn", href: next.page, text: `Next: ${next.title} →` })
        : el("a", { class: "btn", href: "https://www.incometax.gov.in/iec/foportal/", target: "_blank", rel: "noopener noreferrer", text: "Open the e-Filing portal ↗" }));
    main.append(foot);
  }
  root.ITHFlow = { render, STEPS, progress };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => render()); else render();
  }
})(typeof window !== "undefined" ? window : globalThis);
