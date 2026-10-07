(async function () {
  const { api, el, inr, shell, showError, chip, fieldErrors } = ITH;
  const regime = location.pathname.includes("old") ? "old" : "new";
  const other = regime === "new" ? "old" : "new";
  const s = await shell();
  const R = await api("GET", "/api/rules?regime=" + regime);
  document.title = R.name + " — my IT Hero";
  document.getElementById("regime-title").textContent = regime === "new" ? "New Tax Regime" : "Old Tax Regime";
  document.getElementById("regime-sub").textContent = `${R.name}. Assessment Year ${R.assessment_year}, for income earned in FY ${R.financial_year}.`;
  const oth = document.getElementById("other-regime");
  oth.href = "tax-calculation.html"; oth.textContent = "Compare both regimes";

  // slabs
  const bands = Object.entries(R.slabs);
  const tb = document.querySelector("#slabs tbody");
  const label = { all_ages: "All ages", below_60: "Below 60 years", "60_to_79": "60 to 79 years", "80_plus": "80 years and above" };
  bands.forEach(([band, slabs]) => {
    if (bands.length > 1) tb.append(el("tr", { class: "info" }, el("td", { colspan: "2", text: label[band] })));
    let lower = 0;
    slabs.forEach((x) => {
      const range = x.upto === null ? `Above ${inr(lower)}` : lower === 0 ? `Up to ${inr(x.upto)}` : `${inr(lower + 1)} – ${inr(x.upto)}`;
      tb.append(el("tr", null, el("td", { text: range }), el("td", { class: "num", text: x.rate === 0 ? "Nil" : x.rate + "%" })));
      lower = x.upto || lower;
    });
  });
  document.getElementById("slab-note").textContent = `Source status: ${R.slab_verification}. Health & Education Cess ${R.cess_rate}% applies on tax plus surcharge.`;

  const allows = document.getElementById("allows");
  const row = (k, v, note) => [el("dt", { text: k }), el("dd", null, v, note ? el("div", { class: "muted", text: note }) : null)];
  const sur = R.surcharge.map((x) => `${x.rate}% above ${inr(x.above)}`).join("; ");
  allows.replaceChildren(...[
    row("Standard deduction (salary/pension)", inr(R.standard_deduction), R.standard_deduction_verification),
    row("Rebate u/s 87A", `Up to ${inr(R.rebate.max_rebate)} if total income is ${inr(R.rebate.income_limit)} or less` + (R.rebate.marginal_relief ? ", with marginal relief just above the limit" : ""), R.rebate.verification),
    row("Surcharge", sur),
    row("Deductions allowed", R.allowed_deductions.map((x) => x.section + (x.max ? ` (max ${inr(x.max)})` : "")).join(", ")),
    row("HRA / exempt allowances", R.allows_exempt_allowances ? "Allowed" : "Not allowed"),
    row("Professional tax", R.allows_professional_tax ? "Allowed" : "Not allowed"),
    row("Home-loan interest, self-occupied", R.allows_self_occupied_interest ? "Allowed up to ₹2,00,000" : "Not allowed (let-out property interest is allowed)"),
    row("Special-rate capital gains", `STCG u/s 111A ${R.special_rates.stcg_111a_rate}%; LTCG u/s 112A ${R.special_rates.ltcg_112a_rate}% above ${inr(R.special_rates.ltcg_112a_exemption)}`, R.special_rates.verification),
  ].flat());

  const useBtn = document.getElementById("use-regime");
  if (!s.user) {
    useBtn.classList.add("hidden");
    document.getElementById("signin-needed").classList.remove("hidden");
    document.getElementById("calc-panel").classList.add("hidden");
    return;
  }
  useBtn.addEventListener("click", async () => {
    try { await api("POST", "/api/return/regime", { regime }); ITH.toast("Your return now uses the " + regime + " regime."); load(); }
    catch (e) { showError(null, e); }
  });

  const form = document.getElementById("regime-form");
  async function load() {
    const ret = await api("GET", "/api/return");
    const byId = Object.fromEntries(ret.fields.map((f) => [f.field_id, f]));
    document.getElementById("regime-status").replaceChildren(el("div", { class: "notice " + (ret.regime === regime ? "info" : "warning") },
      el("p", { text: ret.regime === regime ? "Your return currently uses this regime." : `Your return currently uses the ${ret.regime} regime. The calculation below shows what you'd pay under the ${regime} regime.` })));
    useBtn.disabled = ret.regime === regime;
    form.replaceChildren(...R.inputs.map((inp) => {
      const f = byId[inp.field_id] || {};
      const id = "f-" + inp.field_id;
      let input;
      if (inp.data_type.startsWith("enum:")) {
        input = el("select", { id, name: inp.field_id }, el("option", { value: "", text: "Select" }),
          ...inp.data_type.slice(5).split("|").map((o) => el("option", { value: o, text: { none: "No house property", self: "Self-occupied", let: "Let out" }[o] || o, selected: f.value === o })));
      } else {
        input = el("input", { id, name: inp.field_id, type: "text", inputmode: inp.data_type === "money" ? "decimal" : null, value: f.value ? ITH.displayValue(f.value, inp.data_type) : "" });
      }
      return el("div", { class: "frow" },
        el("div", { class: "field" }, el("label", { for: id, text: inp.display_name }, el("span", { class: "hint", text: inp.help })), input),
        el("div"), el("div", { class: "side" }, chip(f.status)));
    }), el("div", { class: "btn-row" }, el("button", { class: "btn", type: "submit", text: "Save and recalculate" })));
    calc();
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values = {};
    R.inputs.forEach((inp) => { values[inp.field_id] = form.elements[inp.field_id].value; });
    try { await api("PUT", "/api/return/fields", { values }); fieldErrors(form, null); ITH.toast("Saved."); load(); }
    catch (err) { fieldErrors(form, err.body && err.body.details); showError(null, err); }
  });

  async function calc() {
    const box = document.getElementById("calc");
    try {
      const c = await api("GET", "/api/calc?regime=" + regime);
      const table = el("table", null, el("thead", null, el("tr", null, el("th", { text: "Step" }), el("th", { class: "num", text: "Amount" }))),
        el("tbody", null, ...c.lines.filter((l) => l.kind !== "info").map((l) => el("tr", { class: l.kind }, el("td", { text: l.label }), el("td", { class: "num", text: inr(l.amount) })))));
      box.replaceChildren(
        ...c.warnings.map((w) => el("div", { class: "notice " + (w.severity === "info" ? "info" : w.severity) }, el("p", { text: w.message }))),
        el("div", { class: "table-wrap" }, table),
        el("p", { class: "muted", text: c.disclaimer }));
    } catch (e) { showError(box, e); }
  }
  load();
})();
