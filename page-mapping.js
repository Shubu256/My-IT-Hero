(async function () {
  const { api, el, shell, showError, chip, copyBox, inr } = ITH;
  const s = await shell();
  const list = document.getElementById("map-list");
  const q = document.getElementById("q");
  const itrSel = document.getElementById("itr-sel");
  const tags = ["salary", "TDS", "80C", "80D", "home loan", "interest", "capital gain", "dividend", "bank interest", "rent", "donation"];
  document.getElementById("tags").replaceChildren(...tags.map((t) => el("button", { type: "button", class: "tag", text: t, onclick: () => { q.value = t; run(); } })));
  document.getElementById("map-search").addEventListener("submit", (e) => { e.preventDefault(); run(); });
  itrSel.addEventListener("change", run);

  // ---- step-by-step walkthrough of the e-Filing portal, in the portal's own order, for this return
  async function walkthrough() {
    let m, cmp, ds;
    try { [m, cmp, ds] = await Promise.all([api("GET", "/api/mapping?q=&itr="), api("GET", "/api/calc/compare"), api("GET", "/api/doc-summary")]); } catch (e) { return; }
    const sm = cmp[cmp.selected], itr = m.itr, fr = cmp.filing_requirement, sum = ds.summary;
    const late = sm.due_date && sm.filing_date && sm.filing_date > sm.due_date;
    const fmtD = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    const ORDER = ["Personal Information", "Gross Total Income", "Total Deductions", "Tax Paid", "Total Tax Liability"];
    const groups = new Map();
    for (const f of m.fields) {
      if (f.value === null || f.value === undefined || f.value === "" || !f.schedule) continue;
      if (f.status === "Not used in this regime") continue;
      if (!groups.has(f.schedule)) groups.set(f.schedule, []);
      groups.get(f.schedule).push(f);
    }
    const sched = [...groups.keys()].sort((a, b) => ((ORDER.indexOf(a) + 1) || 99) - ((ORDER.indexOf(b) + 1) || 99));
    const rowsTable = (rows) => el("div", { class: "table-wrap" }, el("table", null,
      el("thead", null, el("tr", null, el("th", { text: "Portal field" }), el("th", { text: "Your value" }))),
      el("tbody", null, ...rows.map(([label, value, type, note]) => el("tr", null, el("td", null, el("span", { text: label }), note ? el("div", { class: "muted", text: note }) : null), el("td", null, copyBox(value, type)))))));
    const step = (n, title, path, ...body) => el("article", { class: "walk-step" }, el("h3", { text: `${n}. ${title}` }), path ? el("p", { class: "walk-path", text: path }) : null, ...body);
    const cards = []; let n = 1;
    cards.push(step(n++, "Start the return", "incometax.gov.in › Login › e-File › Income Tax Returns › File Income Tax Return",
      el("ol", { class: "plain-steps" },
        el("li", null, "Assessment Year: ", el("strong", { text: m.fields[0] ? m.fields[0].assessment_year : "2026-27" }), " · Mode of filing: ", el("strong", { text: "Online" })),
        el("li", null, "Status: ", el("strong", { text: cmp.itr.portal_status || cmp.profile.portal_status })),
        el("li", null, "ITR form: ", el("strong", { text: itr }), itr === m.recommended ? " (recommended for you)" : ""),
        el("li", null, "Filing section: ", el("strong", { text: late ? "139(4) — belated return" : "139(1) — on or before the due date" }), late ? ` (due date ${fmtD(sm.due_date)} has passed)` : ""),
        el("li", null, "Reason for filing: ", el("strong", { text: fr && fr.required ? "Taxable income is more than the basic exemption limit" : "Others / to claim a refund" })),
        el("li", null, "Tax regime: when asked 'Do you wish to opt out of the new tax regime?', answer ", el("strong", { text: cmp.selected === "old" ? "Yes" : "No" }), "."))));
    for (const sc of sched) {
      const fs = groups.get(sc);
      const body = [];
      const sections = [...new Set(fs.map((f) => f.section || ""))];
      for (const secName of sections) {
        const ENUM = { RES: "Resident", RNOR: "Resident but not Ordinarily Resident", NR: "Non-Resident", self: "Self-occupied", let: "Let out", none: "None" };
        const rows = fs.filter((f) => (f.section || "") === secName).map((f) => [f.portal_label || f.display_name, String(f.data_type).startsWith("enum") && ENUM[f.value] ? ENUM[f.value] : f.value,
          String(f.data_type).startsWith("enum") ? "text" : f.data_type, f.group === "computed" ? "Calculated — the portal computes this; check it matches" : null]);
        if (secName) body.push(el("h4", { text: secName }));
        body.push(rowsTable(rows));
        if (secName === "Salary" && sum) for (const e of sum.employers) {
          if (e.perquisites.length) body.push(el("p", { class: "muted", text: `Value of perquisites u/s 17(2) — ${e.name || "employer"}: click "Add" and pick each nature from the drop-down:` }),
            rowsTable(e.perquisites.map((p) => [p.nature, p.chargeable, "money", `Form 12BA: value ${inr(p.value)} − recovered ${inr(p.recovered)}`])));
          if (e.exemptions.length) body.push(el("p", { class: "muted", text: `Allowances exempt u/s 10 — ${e.name || "employer"}: pick each nature:` }), rowsTable(e.exemptions.map((x) => [x.label, x.amount, "money"])));
        }
      }
      if (sc === "Tax Paid" && sum) {
        const tds = sum.employers.filter((e) => e.tds !== null && e.tds !== undefined);
        if (tds.length) body.push(el("p", { class: "muted", text: "TDS on Salary — one row per employer (usually pre-filled from Form 26AS):" }),
          rowsTable(tds.flatMap((e) => [["TAN of the deductor", e.tan, "text"], ["Name of the deductor", e.name, "text"], ["Income chargeable under Salaries", e.income_salary !== null ? e.income_salary : e.amount_paid, "money"], ["Total tax deducted", e.tds, "money"]])));
      }
      cards.push(step(n++, sc, (fs[0].portal_path || "").replace(/ > (Personal Information|Gross Total Income|Total Deductions|Tax Paid|Total Tax Liability)$/, " › $1").replace(/ > /g, " › "), ...body));
    }
    const pay = Number(sm.net) > 0;
    cards.push(step(n++, "Confirm, pay and e-verify", null, el("ol", { class: "plain-steps" },
      el("li", null, "Compare the portal's Total Tax Liability with this page: ", el("strong", { text: inr(sm.total_tax_liability) }), ". Investigate any difference before submitting."),
      pay ? el("li", null, "Amount to pay: ", el("strong", { text: inr(sm.net) }), Number(sm.fee_234f) > 0 ? ` (includes the late fee u/s 234F of ${inr(sm.fee_234f)})` : "", ". Use 'Pay Now' (e-Pay Tax, minor head 300 — self-assessment), then add the challan under Tax Paid.")
        : el("li", null, sm.status === "refund" ? `Refund expected: ${inr(sm.refund_or_payable)} — make sure a pre-validated bank account is selected.` : "Nothing to pay."),
      el("li", null, "Preview and submit, then e-verify within 30 days (Aadhaar OTP, net banking or EVC). An unverified return is treated as not filed."))));
    const box = el("section", { class: "stack", id: "walkthrough" },
      el("div", { class: "af-head" }, el("div", null, el("h2", { text: `Your step-by-step on the e-Filing portal — ${itr}` }),
        el("p", { class: "muted", text: `${cmp.profile.label}: ${m.fields.filter((f) => f.value !== null && f.value !== "" && f.value !== undefined).length} values in portal order. ${sum ? "Includes the break-ups from your Form 16 / Form 12BA." : "Upload Form 16 / Form 12BA to add the salary break-ups."}` })),
        null),
      ...cards,
      el("h2", { class: "section-title", text: "Search any field" }));
    document.getElementById("map-search").closest("section").before(box);
  }

  function dl(pairs) {
    return el("dl", null, ...pairs.filter(([, v]) => v !== null && v !== undefined && v !== "").flatMap(([k, v]) => [el("dt", { text: k }), el("dd", null, v)]));
  }

  async function run() {
    list.replaceChildren(el("p", { class: "muted", text: "Loading…" }));
    try {
      if (!s.user) {
        const r = await api("GET", "/api/mapping/search?q=" + encodeURIComponent(q.value.trim()));
        document.getElementById("map-meta").textContent = "Sign in to see your own values with copy buttons.";
        list.replaceChildren(...r.results.map((f) => {
          const m = f.mappings.find((x) => !itrSel.value || x.itr_form === itrSel.value);
          return el("article", { class: "map-card" },
            el("div", null, el("h3", { text: f.display_name }), el("p", { class: "muted", text: f.help })),
            m ? dl([["ITR form", m.itr_form], ["Schedule", m.schedule], ["Portal section", m.section], ["Portal field", m.portal_label], ["Portal path", m.portal_path], ["Label status", m.verification]])
              : el("p", { class: "muted", text: "Not reported in this ITR form." }));
        }));
        return;
      }
      const r = await api("GET", `/api/mapping?q=${encodeURIComponent(q.value.trim())}&itr=${encodeURIComponent(itrSel.value)}`);
      if (!itrSel.dataset.filled) {
        const keep = itrSel.value;
        itrSel.replaceChildren(el("option", { value: "", text: "Recommended ITR" }), ...r.itr_forms.map((x) => el("option", { value: x, text: x })));
        itrSel.value = r.itr_forms.includes(keep) ? keep : ""; itrSel.dataset.filled = "1";
      }
      document.getElementById("map-meta").textContent =
        `${r.profile.label} (${r.profile.category_short}). Showing ${r.fields.length} field(s) for ${r.itr}${r.itr === r.recommended ? " (recommended for you)" : " — your recommended form is " + r.recommended}. Mapping version ${r.mapping_version}, last checked ${r.last_verified}.` + (r.stale ? " This mapping is marked stale for the current year." : "");
      if (!r.fields.length) { list.replaceChildren(el("p", { class: "muted", text: "Nothing matches. Try another word, or enter more values in My Return." })); return; }
      list.replaceChildren(...r.fields.map((f) => el("article", { class: "map-card" },
        el("div", null,
          el("h3", { text: f.display_name }),
          el("p", { class: "muted", text: f.help }),
          copyBox(f.value, f.data_type),
          el("div", { class: "tagline" }, chip(f.status === "Calculated" ? null : f.status) || el("span", { class: "chip neutral", text: f.status }))),
        dl([
          ["ITR form", f.itr_form], ["Schedule", f.schedule || "Not reported in this form"], ["Portal section", f.section], ["Portal field", f.portal_label],
          ["Portal path", f.portal_path], ["Source", f.source_document ? f.source_document + (f.source_page ? `, page ${f.source_page}` : "") : (f.value ? "Entered by you" : null)],
          ["Confidence", f.confidence != null && f.source_document && f.group !== "computed" ? Math.round(f.confidence * 100) + "%" : null],
          ["Label status", f.mapping_verification],
        ]))));
    } catch (e) { showError(list, e); }
  }
  if (s.user) await walkthrough();
  run();
})();
