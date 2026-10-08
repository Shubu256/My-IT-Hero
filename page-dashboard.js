(async function () {
  const { api, el, inr, shell, showError } = ITH;
  const s = await shell({ auth: true });
  if (!s) return;
  let d;
  try { d = await api("GET", "/api/dashboard"); } catch (e) { showError(document.getElementById("dash-err"), e); return; }
  document.getElementById("greet").textContent = d.profile.label;
  document.getElementById("ay-line").replaceChildren(`${d.profile.category} — ${d.profile.subtype_label}. Assessment Year ${d.assessment_year} (income earned 1 Apr 2025 – 31 Mar 2026). `,
    el("a", { href: d.profile.page, text: "Category page" }), " · ", el("a", { href: "taxpayer-categories.html", text: d.profiles.length > 1 ? `Switch return (${d.profiles.length})` : "Add another return (HUF, firm, company…)" }));
  const sm = d.summary;
  const result = sm.status === "refund" ? "Estimated refund" : sm.status === "payable" ? "Estimated tax payable" : "Nothing payable";
  const stat = (k, v, cls, href) => el(href ? "a" : "div", { class: "stat" + (cls ? " " + cls : ""), href, style: null },
    el("div", { class: "k", text: k }), el("div", { class: "v", text: v }));
  document.getElementById("stats").replaceChildren(
    stat(result, inr(sm.refund_or_payable), "result"),
    stat(["new", "old"].includes(d.regime) ? "Selected regime" : "Tax option", d.regime === "new" ? "New" : d.regime === "old" ? "Old" : d.regime === "normal" ? "Normal rates" : d.regime, null, ["new", "old"].includes(d.regime) ? (d.regime === "new" ? "new-regime.html" : "old-regime.html") : d.profile.page),
    stat("Due date", new Date(d.due_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), null, d.profile.page),
    stat("Recommended ITR", d.recommended_itr, null, "tax-calculation.html"),
    stat("Documents uploaded", String(d.documents), null, "upload.html"),
    stat("Fields requiring verification", String(d.needs_review + d.pending_suggestions), null, "my-return.html"),
  );
  document.querySelectorAll(".stats a.stat").forEach((a) => a.classList.add("linkish"));
  const done = d.progress.filter((p) => p.done).length;
  document.getElementById("bar").style.width = Math.round((done / d.progress.length) * 100) + "%";
  document.getElementById("progress").replaceChildren(...d.progress.map((p) =>
    el("li", { class: p.done ? "done" : "" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { text: p.label }), el("span", { class: "sr-only", text: p.done ? " (done)" : " (to do)" }))));
  const w = document.getElementById("warnings");
  const items = [];
  if (d.missing.length) items.push(el("div", { class: "notice error" }, el("p", null, el("strong", { text: "Missing: " }), d.missing.join(", "), " — ", el("a", { href: "my-return.html", text: "add in My Return" }))));
  if (d.pending_suggestions) items.push(el("div", { class: "notice warning" }, el("p", null, `${d.pending_suggestions} value(s) read from your documents are waiting for you to accept or reject. `, el("a", { href: "upload.html", text: "Review them" }))));
  items.push(el("div", { class: "notice " + (d.filing_requirement.required ? "warning" : "info") }, el("p", null, el("strong", { text: d.filing_requirement.required ? "Filing is compulsory. " : "Filing is optional. " }), d.filing_requirement.reasons.join(" "))));
  d.warnings.forEach((x) => items.push(el("div", { class: "notice " + (x.severity === "error" ? "error" : x.severity === "warning" ? "warning" : "info") }, el("p", { text: x.message }))));
  w.replaceChildren(...(items.length ? items : [el("p", { class: "muted", text: "No warnings right now." })]));

  async function gen(fmt, btn) {
    ITH.busy(btn, true, "Preparing…");
    try {
      const r = await api("POST", "/api/outputs", { format: fmt, regime: d.regime });
      ITH.downloadOutput(r.output.id);
      ITH.toast("Saved to Downloads: " + r.output.filename);
    } catch (e) { showError(null, e); } finally { ITH.busy(btn, false); }
  }
  document.getElementById("gen-pdf").addEventListener("click", (e) => gen("pdf", e.currentTarget));
  document.getElementById("gen-docx").addEventListener("click", (e) => gen("docx", e.currentTarget));
})();
