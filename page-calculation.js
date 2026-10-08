(async function () {
  const { api, el, inr, shell, showError } = ITH;
  const s = await shell({ auth: true });
  if (!s) return;
  const err = document.getElementById("calc-err");
  let cmp;
  try { cmp = await api("GET", "/api/calc/compare"); } catch (e) { showError(err, e); return; }
  const P = cmp.profile;
  document.querySelector(".page-head p").textContent = `${P.label} — ${P.category} (${P.subtype_label}). Calculated in your browser from the values in My Return. The e-Filing portal's own computation is authoritative.`;
  const opts = cmp.options;
  const head = document.querySelector("#compare thead tr");
  head.replaceChildren(el("th", { text: "Item" }), ...opts.map((o) => el("th", { class: "num", text: o.label.replace(/ \(.*\)$/, "") })));
  document.querySelector("#compare").closest("section").querySelector("h2").textContent = opts.length > 1 ? "Compare your options" : "Summary";
  const rows = [["Gross total income", "gross_total_income"], ["Deductions", "total_deductions"], ["Total income", "total_income"],
    ["Tax at normal / slab rates", "tax_normal"], ["Tax on special-rate income", "tax_special"], ["Rebate u/s 87A (incl. marginal relief)", "rebate_87a"],
    ["Surcharge", "surcharge"], ["Cess", "cess"], ["Total tax liability", "total_tax_liability"], ["Taxes paid (TDS + TCS + advance + self-assessment)", null],
    ["Interest u/s 234A/B/C", "interest_234"], ["Late fee u/s 234F", "fee_234f"], ["Refund (−) / payable", "net"], ["Due date", "due_date"]];
  const paid = (x) => Number(x.tds) + Number(x.tcs) + Number(x.advance_tax) + Number(x.self_assessment_tax);
  const cell = (sm, k) => k === "due_date" ? new Date(sm.due_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : inr(k ? sm[k] : paid(sm));
  document.querySelector("#compare tbody").replaceChildren(...rows.filter(([, k]) => k !== "rebate_87a" || ["IND_RES", "IND_NR"].includes(P.entity)).map(([label, k]) =>
    el("tr", { class: ["total_tax_liability", "net"].includes(k) ? "total" : "" }, el("td", { text: label }), ...opts.map((o) => el("td", { class: "num", text: cell(o.summary, k) })))));
  const sel = opts.find((o) => o.key === cmp.selected) || opts[0];
  document.getElementById("compare-note").textContent = opts.length < 2 ? `This category has one way of computing tax: ${sel.label}.` :
    cmp.lower === "equal" ? "All options give the same tax on these figures." :
    `${opts.find((o) => o.key === cmp.lower).label} costs ${inr(cmp.difference)} less than the next option on these figures. Your return uses: ${sel.label}. Check eligibility conditions and forms before switching (on the ${P.category_short} page).`;

  const itr = cmp.itr;
  document.getElementById("itr").replaceChildren(
    el("p", null, el("strong", { text: itr.recommended }), ` — portal status '${itr.portal_status || P.portal_status}'. Why it applies:`),
    el("ul", null, ...itr.why.map((w) => el("li", { text: w }))),
    el("p", { class: "muted", text: "Why other forms were not chosen:" }),
    el("ul", null, ...Object.entries(itr.rejected).filter(([, v]) => v && v.length).map(([k, v]) => el("li", null, el("strong", { text: k + ": " }), v.join("; ")))),
    itr.unanswered_questions && itr.unanswered_questions.length ? el("div", { class: "notice warning" }, el("p", null, itr.note + " ", el("a", { href: "my-return.html#sec-flags", text: "Answer the eligibility questions" }))) : null,
    el("div", { class: "notice " + (cmp.filing_requirement.required ? "warning" : "info") }, el("p", null, el("strong", { text: cmp.filing_requirement.required ? "Filing is compulsory. " : "Filing is optional. " }), cmp.filing_requirement.reasons.join(" "))),
    el("p", { class: "muted", text: "Rule status: " + itr.verification }));

  const bd = document.getElementById("bd-regime");
  bd.replaceChildren(...opts.map((o) => el("option", { value: o.key, text: o.label })));
  bd.value = cmp.selected;
  bd.addEventListener("change", breakdown);
  async function breakdown() {
    try {
      const c = await api("GET", "/api/calc?regime=" + encodeURIComponent(bd.value));
      document.getElementById("warn-list").replaceChildren(...c.warnings.map((w) =>
        el("div", { class: "notice " + (w.severity === "info" ? "info" : w.severity) }, el("p", { text: w.message }))));
      document.querySelector("#breakdown tbody").replaceChildren(...c.lines.map((l) =>
        el("tr", { class: l.kind }, el("td", { text: l.label }), el("td", { class: "num", text: l.kind === "info" ? "" : inr(l.amount) }),
          el("td", { class: "muted", text: l.note || "" }))));
    } catch (e) { showError(err, e); }
  }
  breakdown();
})();
