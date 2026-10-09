/* Upload → read → fill My Return automatically.
   Form 16 Part A / Part B and Form 12BA are read with dedicated readers; everything they contain is
   combined and written into My Return (never over a value you typed). Then the page asks only the
   questions the documents cannot answer and sends you on to the calculation. */
(async function () {
  const { api, el, shell, showError, toast, inr, displayValue } = ITH;
  const s = await shell({ auth: true });
  if (!s) return;
  const drop = document.getElementById("drop");
  const input = document.getElementById("file");
  const status = document.getElementById("upload-status");
  const report = el("section", { id: "autofill", class: "stack", "aria-live": "polite" });
  status.after(report);
  const docsBox = document.getElementById("docs");
  const docsTitle = docsBox.previousElementSibling;
  const intro = document.querySelector("#main > .notice.info");
  if (intro) intro.replaceChildren(el("p", null, "Upload your ", el("strong", { text: "Form 16 (Part A and Part B)" }), " and ", el("strong", { text: "Form 12BA" }),
    " together — they are read inside this browser (nothing is uploaded anywhere) and My Return is filled automatically. Anything the documents can't tell us is asked below. Values you typed yourself are never overwritten. Document records are removed after ",
    el("span", { id: "ret-days", text: "30" }), " days unless you choose to keep them in Account."));

  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => uploadAll(Array.from(e.dataTransfer.files)));
  input.addEventListener("change", () => { const files = Array.from(input.files); input.value = ""; uploadAll(files); });

  async function uploadAll(files) {
    if (!files.length) return;
    let structured = 0;
    for (const f of files) {
      const line = el("div", { class: "notice info" }, el("p", { text: `Reading ${f.name}…` }));
      status.prepend(line);
      if (f.size > 10 * 1024 * 1024) { line.className = "notice error"; line.firstChild.textContent = `${f.name}: larger than 10 MB. Upload a smaller file.`; continue; }
      const fd = new FormData(); fd.append("file", f);
      try {
        const r = await api("POST", "/api/documents", fd, { progress: (msg) => { line.firstChild.textContent = `${f.name}: ${msg}`; } });
        const d = r.document;
        if (d.structured) structured += 1;
        line.className = "notice " + (d.structured ? "success" : "info");
        line.firstChild.textContent = d.structured ? `${f.name}: read as ${d.doc_label} — ${d.extractions.length} value(s).`
          : `${f.name}: read as ${d.doc_label}. ${d.extractions.length} value(s) found — review them in the list below.`;
      } catch (e) {
        line.className = "notice error";
        line.firstChild.textContent = `${f.name}: ${e.body ? e.body.message + " " + (e.body.user_action || "") : e.message}`;
      }
    }
    if (structured) await runAutofill();
    load();
  }

  // ------------------------------------------------------------ auto-fill report
  async function runAutofill(btn) {
    if (btn) ITH.busy(btn, true, "Filling…");
    try { const r = await api("POST", "/api/autofill", {}); showReport(r); if (window.ITHFlow) ITHFlow.render(true); toast(r.filled.length ? `${r.filled.length} value(s) added to My Return.` : "My Return is up to date with your documents."); }
    catch (e) { showError(report, e); }
    finally { if (btn) ITH.busy(btn, false); }
  }
  const dv = (v, t) => (t === "money" ? inr(v) : displayValue(v, t) || String(v));
  function showReport(r) {
    const rows = r.filled.concat(r.unchanged_fields || []);
    const parts = [];
    parts.push(el("div", { class: "af-head" },
      el("div", null, el("h2", { text: "My Return was filled from your documents" }),
        el("p", { class: "muted", text: `${r.documents.length} document(s): ${r.documents.map((d) => d.label).join(", ")}. Return: ${r.profile.label} (${r.profile.category_short}).` })),
      el("button", { class: "btn secondary small", type: "button", text: "Fill again from documents", onclick: (e) => runAutofill(e.target) })));
    if (r.regime) parts.push(el("div", { class: "notice info" }, el("p", null, el("strong", { text: `Tax regime: ${r.regime.value === "new" ? "New regime (s.115BAC)" : "Old regime"}` }),
      ` — your Form 16 says you ${r.regime.value === "old" ? "opted out of" : "did not opt out of"} the new regime${r.regime.changed ? " (your return was switched to match)" : ""}. You can still compare both on the Tax calculation page.`)));
    if (rows.length) parts.push(el("div", { class: "table-wrap" }, el("table", null,
      el("thead", null, el("tr", null, ...["Field in My Return", "Value", "From", ""].map((h) => el("th", { text: h })))),
      el("tbody", null, ...rows.map((x) => el("tr", null,
        el("td", { text: x.display_name }), el("td", { class: x.data_type === "money" ? "num" : "", text: dv(x.value, x.data_type) }),
        el("td", { class: "muted", text: (x.source || "—") + (x.page ? `, p.${x.page}` : "") + (x.combined ? " (added up across employers)" : "") }),
        el("td", null, el("span", { class: "chip " + (x.verified === false ? "review" : "verified"), text: x.verified === false ? "Check" : r.filled.includes(x) ? "Filled" : "Already there" }))))))));
    if (r.conflicts.length) parts.push(el("div", { class: "notice warning" }, el("p", null, el("strong", { text: "You typed different values for these fields. " }), "We kept yours — choose for each:"),
      ...r.conflicts.map((c) => el("div", { class: "btn-row", style: "align-items:center" },
        el("span", { text: `${c.display_name}: yours ${dv(c.current, c.data_type)} · document ${dv(c.value, c.data_type)}` }),
        el("button", { class: "btn small", type: "button", text: "Use the document value", onclick: async (e) => {
          try { await api("POST", "/api/autofill/use-document", { fields: [c.field_id] }); e.target.closest(".btn-row").remove(); toast(`${c.display_name} updated.`); } catch (err) { showError(null, err); } } })))));
    if (r.checks.length) parts.push(el("div", null, el("h3", { text: "Cross-checks between your documents" }),
      el("ul", { class: "af-checks" }, ...r.checks.map((c) => el("li", { class: c.ok ? "ok" : "bad" }, el("span", { class: "mark", text: c.ok ? "✓" : "✗" }), el("span", null, el("strong", { text: c.label + ": " }), c.detail))))));
    for (const w of r.warnings) parts.push(el("div", { class: "notice warning" }, el("p", { text: w })));
    const perq = r.employers.flatMap((e) => e.perquisites.map((p) => ({ ...p, employer: e.name })));
    if (perq.length) parts.push(el("details", { class: "doc-detail" }, el("summary", { text: `Perquisites by nature (Form 12BA) — ${perq.length} line(s), needed for the portal's drop-down` }),
      el("div", { class: "table-wrap" }, el("table", null, el("thead", null, el("tr", null, ...["Nature", "Value", "Recovered", "Taxable"].map((h) => el("th", { text: h })))),
        el("tbody", null, ...perq.map((p) => el("tr", null, el("td", { text: p.nature }), el("td", { class: "num", text: inr(p.value) }), el("td", { class: "num", text: inr(p.recovered) }), el("td", { class: "num", text: inr(p.chargeable) }))))))));
    if (r.questions && r.questions.length) parts.push(questions(r.questions));
    parts.push(el("div", { class: "btn-row" },
      el("a", { class: "btn", href: "my-return.html", text: "Next: check My Return →" }),
      el("a", { class: "btn secondary", href: "tax-calculation.html", text: "Go straight to the tax calculation" })));
    report.replaceChildren(el("div", { class: "panel stack" }, ...parts));
    report.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function questions(qs) {
    const form = el("form", { class: "stack", novalidate: true });
    const grid = el("div", { class: "af-q" });
    for (const q of qs) {
      let inp;
      if (q.data_type === "bool") inp = el("select", { name: q.field_id }, el("option", { value: "", text: "Choose…" }), el("option", { value: "false", text: "No" }), el("option", { value: "true", text: "Yes" }));
      else if (q.data_type === "date") inp = el("input", { type: "date", name: q.field_id });
      else inp = el("input", { type: "text", name: q.field_id, inputmode: q.data_type === "money" || q.data_type === "account" || q.data_type === "mobile" ? "numeric" : null, autocomplete: q.field_id === "email" ? "email" : q.field_id === "mobile" ? "tel" : "off" });
      grid.append(el("label", null, el("span", { text: q.display_name }), inp, q.help ? el("span", { class: "help", text: q.help }) : null));
    }
    const msg = el("div");
    form.append(el("h3", { text: "A few things your documents can't tell us" }),
      el("p", { class: "muted", text: "Answer what applies and save — they decide whether ITR-1 can be used and complete the return. Leave anything you don't have; you can fill it later in My Return." }),
      grid, msg, el("div", { class: "btn-row" }, el("button", { class: "btn", type: "submit", text: "Save answers" })));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); const btn = form.querySelector("button[type=submit]"); ITH.busy(btn, true, "Saving…");
      const values = {}; for (const x of form.querySelectorAll("[name]")) if (x.value !== "") values[x.name] = x.value;
      try {
        if (!Object.keys(values).length) { toast("Nothing to save."); return; }
        await api("PUT", "/api/return/fields", { values });
        toast("Saved to My Return."); for (const k of Object.keys(values)) { const f = form.querySelector(`[name="${k}"]`); f.closest("label").remove(); }
        const c = await api("GET", "/api/calc/compare");
        msg.replaceChildren(el("div", { class: "notice success" }, el("p", null, `Recommended form now: `, el("strong", { text: c.itr.recommended }), `. Tax liability ${inr(c[c.selected].total_tax_liability)}; ${c[c.selected].status === "refund" ? "refund" : c[c.selected].status === "payable" ? "payable" : "nothing payable"} ${c[c.selected].status === "nil" ? "" : inr(c[c.selected].refund_or_payable)}.`)));
      } catch (err) { showError(msg, err); }
      finally { ITH.busy(btn, false); }
    });
    return form;
  }

  // ------------------------------------------------------------ per-document detail (still reviewable value by value)
  const dlg = document.getElementById("conflict-dlg");
  function askConflict(details) {
    return new Promise((resolve) => {
      document.getElementById("conflict-text").textContent =
        `Your return has ${ITH.displayValue(details.current, "money") || details.current}, but this document shows ${ITH.displayValue(details.document, "money") || details.document}. Which value is correct? We won't choose for you.`;
      const done = (v) => { dlg.close(); resolve(v); };
      document.getElementById("use-doc").onclick = () => done(true);
      document.getElementById("keep-mine").onclick = () => done(false);
      dlg.showModal();
    });
  }
  async function accept(ex, inputEl, replace) {
    try {
      await api("POST", `/api/extractions/${ex.id}/accept`, { value: inputEl.value, replace: !!replace });
      toast(`${ex.display_name} added to your return.`);
      load();
    } catch (e) {
      if (e.body && e.body.error_code === "CONFLICT") {
        if (await askConflict(e.body.details)) accept(ex, inputEl, true);
        else { await api("POST", `/api/extractions/${ex.id}/reject`, {}); load(); }
      } else showError(null, e);
    }
  }
  const STATUS_CHIP = { accepted: ["In My Return", "verified"], rejected: ["Rejected", "missing"], combined: ["Added up across employers", "verified"], info: ["Zero — not needed", "neutral"] };
  async function load() {
    try {
      const r = await api("GET", "/api/documents");
      const rd = document.getElementById("ret-days"); if (rd) rd.textContent = r.retention_days;
      if (!r.documents.length) { docsBox.replaceChildren(el("p", { class: "muted", text: "No documents yet. Start with Form 16 Part A, Part B and Form 12BA from your employer." })); return; }
      docsTitle.textContent = "What was read from each document";
      docsBox.replaceChildren(...r.documents.map((d) => {
        const rows = d.extractions.map((x) => {
          const inp = el("input", { type: "text", value: x.normalized_value ?? x.raw_value ?? "", "aria-label": "Value for " + x.display_name });
          const low = x.confidence < 0.8;
          const vstat = { valid: ["Valid", "verified"], low_confidence: ["Low confidence", "review"], invalid: ["Invalid", "error"] }[x.validation_status] || [x.validation_status, "neutral"];
          const st = STATUS_CHIP[x.status];
          return el("tr", null,
            el("td", null, el("strong", { text: x.display_name }), x.note ? el("div", { class: "muted", text: x.note }) : null, x.message && x.status === "pending" ? el("div", { class: "field-error", text: x.message }) : null),
            el("td", { text: x.page ?? "—" }),
            el("td", { text: x.raw_value ?? "—" }),
            el("td", { text: x.normalized_value ?? "—" }),
            el("td", null, el("span", { class: "conf" + (low ? " low" : ""), text: Math.round(x.confidence * 100) + "%" })),
            el("td", null, el("span", { class: "chip " + vstat[1], text: vstat[0] })),
            el("td", null, x.status === "pending" ? el("div", { class: "ex-actions" }, inp,
              el("button", { class: "btn small", type: "button", text: "Accept", onclick: () => accept(x, inp) }),
              el("button", { class: "btn small secondary", type: "button", text: "Reject", onclick: async () => { await api("POST", `/api/extractions/${x.id}/reject`, {}); load(); } }))
              : el("span", { class: "chip " + (st ? st[1] : "neutral"), text: st ? st[0] : x.status })));
        });
        const pending = d.extractions.filter((x) => x.status === "pending").length;
        return el("article", { class: "doc" },
          el("div", { class: "doc-head" },
            el("div", null, el("h3", { text: d.name }), el("div", { class: "muted", text: `${d.doc_label}${d.structured ? " (read with the dedicated reader)" : ` (${Math.round((d.doc_type_confidence || 0) * 100)}% sure)`} · ${d.pages} page(s) · auto-delete ${new Date(d.expires_at * 1000).toLocaleDateString("en-IN")}` })),
            el("button", { class: "btn small danger", type: "button", text: "Delete document", onclick: async () => {
              if (!confirm(`Delete ${d.name}? Values already in My Return stay there.`)) return;
              try { await api("DELETE", `/api/documents/${d.id}`); toast("Document deleted."); load(); } catch (e) { showError(null, e); } } })),
          ...(d.warnings || []).map((w) => el("div", { class: "notice warning" }, el("p", { text: w }))),
          rows.length ? el("details", { class: "doc-detail", open: pending ? true : null }, el("summary", { text: `${d.extractions.length} value(s) read${pending ? ` — ${pending} waiting for you` : ""}` }),
            el("div", { class: "table-wrap" }, el("table", null,
              el("thead", null, el("tr", null, ...["Field", "Page", "Extracted", "Normalised", "Confidence", "Validation", "Status"].map((h) => el("th", { text: h })))),
              el("tbody", null, ...rows))))
            : el("p", { class: "muted", text: "No values could be read automatically. Enter the figures from this document in My Return." }));
      }));
      // show the last auto-fill result when coming back to this page
      if (!report.childElementCount && r.documents.some((d) => d.structured)) {
        const ds = await api("GET", "/api/doc-summary");
        if (ds.summary) report.replaceChildren(el("div", { class: "notice success" }, el("p", null,
          el("strong", { text: "My Return is filled from your Form 16 / Form 12BA. " }), `${ds.structured_documents} document(s) used. `,
          el("button", { class: "btn small secondary", type: "button", text: "Show the details / fill again", onclick: (e) => runAutofill(e.target) }), " ",
          el("a", { class: "btn small", href: "my-return.html", text: "Next: check My Return →" }))));
        else report.replaceChildren(el("div", { class: "notice info" }, el("p", null, "Your Form 16 / 12BA were read but not yet put into My Return. ",
          el("button", { class: "btn small", type: "button", text: "Fill My Return now", onclick: (e) => runAutofill(e.target) }))));
      }
    } catch (e) { showError(docsBox, e); }
  }
  load();
})();
