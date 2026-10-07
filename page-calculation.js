(async function () {
  const { api, el, inr, shell, showError } = ITH;
  const s = await shell({ auth: true });
  if (!s) return;
  const err = document.getElementById("calc-err");
  let cmp;
  try { cmp = await api("GET", "/api/calc/compare"); } catch (e) { showError(err, e); return; }
  const rows = [["Gross total income", "gross_total_income"], ["Deductions", "total_deductions"], ["Total income", "total_income"],
    ["Tax at slab rates", "tax_normal"], ["Tax on special-rate income", "tax_special"], ["Rebate u/s 87A (incl. marginal relief)", "rebate_87a"],
    ["Surcharge", "surcharge"], ["Cess", "cess"], ["Total tax liability", "total_tax_liability"], ["Taxes paid (TDS + TCS + advance + self-assessment)", null],
    ["Interest u/s 234A/B/C", "interest_234"], ["Late fee u/s 234F", "fee_234f"], ["Refund (−) / payable", "net"]];
  const paid = (x) => Number(x.tds) + Number(x.tcs) + Number(x.advance_tax) + Number(x.self_assessment_tax);
  document.querySelector("#compare tbody").replaceChildren(...rows.map(([label, k]) =>
    el("tr", { class: ["total_tax_liability", "net"].includes(k) ? "total" : "" }, el("td", { text: label }),
      el("td", { class: "num", text: inr(k ? cmp.new[k] : paid(cmp.new)) }), el("td", { class: "num", text: inr(k ? cmp.old[k] : paid(cmp.old)) }))));
  document.getElementById("compare-note").textContent = cmp.lower === "equal" ? "Both regimes give the same tax." :
    `The ${cmp.lower} regime costs ${inr(cmp.difference)} less in tax on these figures. Your return currently uses the ${cmp.selected} regime — change it on the ${cmp.lower === "new" ? "New" : "Old"} Regime page.`;

  const itr = cmp.itr;
  document.getElementById("itr").replaceChildren(
    el("p", null, el("strong", { text: itr.recommended }), " — why it applies:"),
    el("ul", null, ...itr.why.map((w) => el("li", { text: w }))),
    el("p", { class: "muted", text: "Why other forms were not chosen:" }),
    el("ul", null, ...Object.entries(itr.rejected).map(([k, v]) => el("li", null, el("strong", { text: k + ": " }), v.join("; ") || "—"))),
    itr.unanswered_questions.length ? el("div", { class: "notice warning" }, el("p", null, itr.note + " ", el("a", { href: "my-return.html#sec-flags", text: "Answer the eligibility questions" }))) : null,
    el("p", { class: "muted", text: "Rule status: " + itr.verification }));

  const sel = document.getElementById("bd-regime");
  sel.value = cmp.selected;
  sel.addEventListener("change", breakdown);
  async function breakdown() {
    try {
      const c = await api("GET", "/api/calc?regime=" + sel.value);
      document.getElementById("warn-list").replaceChildren(...c.warnings.map((w) =>
        el("div", { class: "notice " + (w.severity === "info" ? "info" : w.severity) }, el("p", { text: w.message }))));
      document.querySelector("#breakdown tbody").replaceChildren(...c.lines.map((l) =>
        el("tr", { class: l.kind }, el("td", { text: l.label }), el("td", { class: "num", text: l.kind === "info" ? "" : inr(l.amount) }),
          el("td", { class: "muted", text: l.kind === "info" ? (l.note || "") : (l.note || "") }))));
    } catch (e) { showError(err, e); }
  }
  breakdown();
})();
