/* One page per taxpayer category. Everything shown is generated from the AY rule data
   (assets/rules-data.js) and calculated by assets/entities.js — no rates are typed here. */
(async function () {
  "use strict";
  const { api, el, inr, shell, showError, chip, fieldErrors, toast, displayValue } = ITH;
  const s = await shell();
  const CODE = document.getElementById("cat-title").dataset.category;
  const D = await api("GET", "/api/categories");
  const C = D.categories[CODE];
  const today = new Date().toISOString().slice(0, 10);
  document.title = C.label + " — my IT Hero";
  document.getElementById("cat-crumb").textContent = C.short;
  document.getElementById("cat-sub").textContent = `AY ${D.assessment_year} (income earned in FY ${D.financial_year}). Portal status: ${C.portal_status}. ITR forms: ${C.itr_forms.join(", ")}.`;

  const pctTxt = (r) => (r === 0 ? "Nil" : `${r}%`);
  const lakh = (n) => inr(n);
  const dateTxt = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const table = (head, rows) => el("div", { class: "table-wrap" }, el("table", null,
    el("thead", null, el("tr", null, ...head.map((h, i) => el("th", { class: i && /rate|tax|surcharge/i.test(h) ? "" : null, text: h })))),
    el("tbody", null, ...rows.map((r) => el("tr", null, ...r.map((c) => el("td", null, c)))))));
  function slabRows(slabs) {
    let lower = 0;
    return slabs.map((x) => { const r = [x.upto === null ? `Above ${lakh(lower)}` : lower === 0 ? `Up to ${lakh(x.upto)}` : `${lakh(lower + 1)} – ${lakh(x.upto)}`, pctTxt(x.rate)]; lower = x.upto || lower; return r; });
  }
  const surTxt = (tbl) => tbl.length ? tbl.map((x) => `${x.rate}% above ${lakh(x.above)}`).join("; ") : "Nil";
  const NEW = D.regimes.new, OLD = D.regimes.old, DL = D.deadlines;

  // ------------------------------------------------------------ who
  const who = document.getElementById("cat-who");
  who.append(el("dt", { text: "Covers" }), el("dd", null, el("ul", { class: "tight" }, ...Object.values(C.subtypes).map((v) => el("li", { text: v })))));
  who.append(el("dt", { text: "ITR forms" }), el("dd", { text: C.itr_forms.join(", ") }), el("dt", { text: "Portal status" }), el("dd", { text: C.portal_status }));
  if (C.regime_form) who.append(el("dt", { text: "Regime choice" }), el("dd", { text: C.regime_form }));

  // ------------------------------------------------------------ due dates
  const audited = ["COMPANY", "TRUST", "POLITICAL"].includes(CODE);
  const dateRows = [];
  if (["IND_RES", "IND_NR", "HUF"].includes(CODE)) {
    dateRows.push(["Salary, pension, house property, capital gains, other sources (ITR-1 / ITR-2)", DL.due_date_139_1_non_audit]);
    dateRows.push(["Business or profession, accounts not audited (ITR-3 / ITR-4)", DL.due_date_139_1_non_audit_business]);
  }
  if (["FIRM", "COOP_AOP"].includes(CODE)) {
    dateRows.push(["Accounts not audited, with business income (ITR-4 / ITR-5)", DL.due_date_139_1_non_audit_business]);
    dateRows.push(["Accounts not audited, no business income", DL.due_date_139_1_non_audit]);
  }
  dateRows.push([audited ? "Return (accounts audited) — 31 Oct 2026 extended by CBDT" : "Accounts audited (s.44AB or another law) — 31 Oct 2026 extended by CBDT", DL.due_date_139_1_audit]);
  dateRows.push(["Transfer pricing cases (Form 3CEB)", DL.due_date_139_1_transfer_pricing]);
  dateRows.push(["Belated return u/s 139(4) / revised return u/s 139(5)", DL.belated_return_last_date]);
  document.getElementById("cat-dates").append(
    table(["Case", "Due date", "Today"], dateRows.map(([a, d]) => [a, dateTxt(d), el("span", { class: "chip " + (d < today ? "warning" : "verified"), text: d < today ? "Passed" : "Open" })])),
    el("p", { class: "muted", text: "Status: " + DL.verification + ". Filing after the due date attracts the s.234F fee and s.234A interest." }));

  // ------------------------------------------------------------ rates
  const rates = document.getElementById("cat-rates");
  const note = (t) => el("p", { class: "muted", text: t });
  const sub = (t) => el("h3", { text: t });
  if (["IND_RES", "IND_NR", "HUF"].includes(CODE)) {
    const grid = el("div", { class: "grid-2" },
      el("div", null, sub("New regime (default, s.115BAC)"), table(["Income", "Rate"], slabRows(NEW.slabs.all_ages))),
      el("div", null, sub("Old regime" + (CODE === "IND_RES" ? " — below 60" : "")), table(["Income", "Rate"], slabRows(OLD.slabs.below_60))));
    rates.append(grid);
    if (CODE === "IND_RES") rates.append(el("div", { class: "grid-2" },
      el("div", null, sub("Old regime — 60 to 79 (resident)"), table(["Income", "Rate"], slabRows(OLD.slabs["60_to_79"]))),
      el("div", null, sub("Old regime — 80 and above (resident)"), table(["Income", "Rate"], slabRows(OLD.slabs["80_plus"])))));
    const facts = [
      ["Standard deduction (salary / pension)", CODE === "HUF" ? "Not applicable — an HUF has no salary" : `${lakh(NEW.standard_deduction_salary)} new / ${lakh(OLD.standard_deduction_salary)} old`],
      ["Rebate u/s 87A", CODE === "HUF" ? "Not available to HUFs" : CODE === "IND_NR" ? "Not available to non-residents; available to RNOR (who are residents)" : `Up to ${lakh(NEW.rebate_87a.max_rebate)} if income ≤ ${lakh(NEW.rebate_87a.income_limit)} (new); ${lakh(OLD.rebate_87a.max_rebate)} if ≤ ${lakh(OLD.rebate_87a.income_limit)} (old)`],
      ["Surcharge", `New: ${surTxt(NEW.surcharge)}. Old: ${surTxt(OLD.surcharge)}. Max 15% on 111A/112/112A gains and dividends.`],
      ["Health & Education Cess", `${D.cess_rate}% of tax + surcharge`],
      ["Special-rate gains", `STCG 111A ${D.capital_gains.stcg_111a_rate}%; LTCG 112A ${D.capital_gains.ltcg_112a_rate}% above ${lakh(D.capital_gains.ltcg_112a_exemption)}; LTCG 112 ${D.capital_gains.ltcg_112_other_rate}%`],
      ["AMT", `${D.amt.rate}% of adjusted total income above ${lakh(D.amt.threshold_ind_huf_aop)} when profit-linked deductions (80-IA etc.) are claimed in the old regime`],
    ];
    if (CODE === "IND_NR") facts.unshift(["Senior-citizen slabs", "Residents only — NRs use the general slabs at any age (official NRI page)"]);
    if (CODE === "HUF") facts.unshift(["Deductions (old regime)", "80C ₹1,50,000, 80D, 80DD, 80DDB, 80G, 80GGA, 80GGC, 80TTA — no 80CCD, no standard deduction"]);
    rates.append(table(["Item", "AY 2026-27"], facts));
  } else if (CODE === "COMPANY") {
    rates.append(table(["Option", "Rate", "Surcharge", "MAT"], [
      ["Domestic — turnover ≤ ₹400 crore in the reference year", `${C.domestic_rate_small}%`, surTxt(C.surcharge_domestic), `${C.mat_rate}% of book profit`],
      ["Domestic — other", `${C.domestic_rate}%`, surTxt(C.surcharge_domestic), `${C.mat_rate}% of book profit`],
      ["Section 115BA (Form 10-IB)", `${C.rate_115BA}%`, surTxt(C.surcharge_domestic), `${C.mat_rate}% of book profit`],
      ["Section 115BAA (Form 10-IC)", `${C.rate_115BAA}%`, `${C.surcharge_concessional}% flat`, "Not applicable"],
      ["Section 115BAB — new manufacturing (Form 10-ID)", `${C.rate_115BAB_business}% on manufacturing income, ${C.rate_115BAB_other}% on other income`, `${C.surcharge_concessional}% flat`, "Not applicable"],
      ["Foreign company", `${C.foreign_rate}% (50% on pre-1976 approved royalty / FTS)`, surTxt(C.surcharge_foreign), `${C.mat_rate}% where applicable`],
    ]), note(`Cess ${D.cess_rate}% on tax + surcharge. Under 115BAA/115BAB, profit-linked deductions (80-IA, 80-IAB, 80-IAC, 80-IB…) are not allowed; 80JJAA and 80M are. Reference year for the 25% test: ${C.domestic_rate_small_turnover_year}.`));
  } else if (CODE === "FIRM") {
    rates.append(table(["Item", "AY 2026-27"], [["Tax rate", `${C.rate}% flat (firm and LLP)`], ["Surcharge", surTxt(C.surcharge) + " with marginal relief"], ["Cess", `${D.cess_rate}%`],
      ["AMT (s.115JC)", `${C.amt_rate}% of adjusted total income when profit-linked deductions or 10AA / 35AD are claimed`],
      ["Presumptive taxation", "44AD / 44ADA / 44AE for a resident firm; not for LLPs. ITR-4 if total income ≤ ₹50 lakh"],
      ["Partners", "Interest and remuneration to partners are deductible within s.40(b) limits; partners' share of profit is exempt u/s 10(2A)"]]));
  } else if (CODE === "COOP_AOP") {
    rates.append(el("div", { class: "grid-2" },
      el("div", null, sub("Co-operative society — normal rates"), table(["Income", "Rate"], slabRows(C.coop_slabs)), note(`Surcharge ${surTxt(C.coop_surcharge)}. Options: 115BAD ${C.rate_115BAD}% (Form 10-IF), 115BAE ${C.rate_115BAE}% new manufacturing co-op (Form 10-IFA), both with ${C.surcharge_concessional}% flat surcharge. AMT ${C.coop_amt_rate}% on normal rates.`)),
      el("div", null, sub("AOP / BOI / AJP — new regime (default)"), table(["Income", "Rate"], slabRows(NEW.slabs.all_ages)),
        note(`Old regime slabs: ${slabRows(OLD.slabs.below_60).map((r) => r.join(" ")).join("; ")}. Maximum marginal rate (${C.mmr_rate}% + surcharge) if members' shares are indeterminate, or determinate with any member's income above the exemption limit. Surcharge capped at ${C.aop_company_members_surcharge_cap}% when all members are companies. AMT ${C.aop_amt_rate}% above ${lakh(C.aop_amt_threshold)}.`))),
      table(["Local authority", "AY 2026-27"], [["Tax rate", `${C.local_authority_rate}%`], ["Surcharge", surTxt(C.local_authority_surcharge)], ["ITR", "ITR-5 (ITR-7 if income is exempt u/s 10 and filing is not compulsory)"]]));
  } else if (CODE === "TRUST") {
    rates.append(table(["Rule", "AY 2026-27"], [
      ["Charitable / religious trust (s.11) or 10(23C) fund", `Income applied to the objects (at least ${C.application_pct}% including accumulation) is exempt; ${C.accumulation_pct}% may be accumulated without conditions; more can be set apart u/s 11(2) with Form 10`],
      ["Taxable balance", "Taxed as an AOP (slab rates; regime choice) — REQUIRES REVIEW"],
      ["Anonymous donations (s.115BBC)", `${C.anonymous_rate}% on anonymous donations above the greater of ${lakh(C.anonymous_floor)} or ${C.anonymous_pct}% of total donations`],
      ["Specified income (s.115BBI)", `${C.specified_income_rate}% (application outside India, benefits to specified persons, unapplied income)`],
      ["Unregistered / non-exempt trust", "Taxed as an AOP; ITR-5"],
      ["Private discretionary trust", "Maximum marginal rate (30% + surcharge + cess)"],
      ["Audit / forms", "Form 10B (income > ₹5 crore, foreign contributions or application outside India) or 10BB; Form 10, 9A, 10BD as applicable"],
    ]));
  } else if (CODE === "POLITICAL") {
    rates.append(table(["Entity", "Rule", "Return"], [
      ["Political party", "Income from house property, other sources, capital gains and voluntary contributions is exempt u/s 13A if books are kept, contributions above ₹20,000 are recorded, accounts are audited and the Form 24A report is filed with the Election Commission", "ITR-7 u/s 139(4B) — Schedule PP"],
      ["Electoral trust", `Voluntary contributions exempt u/s 13B if at least ${C.electoral_trust_distribution_pct}% is distributed to registered political parties`, "ITR-7 — Schedule ET"],
      ["Research association, news agency, other s.10 entities", "Income exempt under the relevant clause of s.10 subject to approval and conditions", "ITR-7 u/s 139(4C)"],
      ["University / college / institution u/s 35", "Exempt subject to approval and conditions", "ITR-7 u/s 139(4D)"],
      ["If conditions fail", "Income taxed as an AOP (estimated here at the maximum marginal rate) — REQUIRES REVIEW", "ITR-7"],
    ]));
  }

  // ------------------------------------------------------------ every combination
  const optLabel = (o) => o.label;
  const matrixRows = [];
  const dueTxt = (sub, opt) => {
    if (CODE === "COMPANY" || CODE === "POLITICAL" || CODE === "TRUST" && !["UNREGISTERED", "PRIVATE_DISCRETIONARY", "BUSINESS_TRUST"].includes(sub)) return dateTxt(DL.due_date_139_1_audit) + " (audited)";
    if (["IND_RES", "IND_NR", "HUF"].includes(CODE)) return `${dateTxt(DL.due_date_139_1_non_audit)} (no business) / ${dateTxt(DL.due_date_139_1_non_audit_business)} (business, no audit) / ${dateTxt(DL.due_date_139_1_audit)} (audited)`;
    return `${dateTxt(DL.due_date_139_1_non_audit_business)} (no audit) / ${dateTxt(DL.due_date_139_1_audit)} (audited)`;
  };
  const rateFor = (sub, opt) => {
    switch (CODE) {
      case "IND_RES": case "IND_NR": case "HUF": return opt === "new" ? "Slabs 0–30% (₹4 lakh nil band)" : sub === "NR" || CODE === "HUF" ? "Slabs 0–30% (₹2.5 lakh nil band)" : "Slabs 0–30% (₹2.5 / ₹3 / ₹5 lakh nil band by age)";
      case "COMPANY": return sub === "FOREIGN" ? `${C.foreign_rate}%` : { normal: `${C.domestic_rate_small}% / ${C.domestic_rate}%`, "115BA": `${C.rate_115BA}%`, "115BAA": `${C.rate_115BAA}%`, "115BAB": `${C.rate_115BAB_business}% / ${C.rate_115BAB_other}%` }[opt];
      case "FIRM": return `${C.rate}%`;
      case "COOP_AOP": return sub === "COOP" ? { normal: "10% / 20% / 30%", "115BAD": `${C.rate_115BAD}%`, "115BAE": `${C.rate_115BAE}%` }[opt] : sub === "LOCAL_AUTHORITY" ? `${C.local_authority_rate}%` : (opt === "new" ? "New slabs, or 30% MMR" : "Old slabs, or 30% MMR");
      case "TRUST": return sub === "PRIVATE_DISCRETIONARY" || sub === "BUSINESS_TRUST" ? "30% MMR" : `Exempt if applied; balance at AOP ${opt} slabs; 30% on 115BBC / 115BBI`;
      case "POLITICAL": return "Exempt if conditions met; otherwise AOP rates";
    }
    return "";
  };
  const surFor = (sub, opt) => {
    if (CODE === "COMPANY") return sub === "FOREIGN" ? surTxt(C.surcharge_foreign) : ["115BAA", "115BAB"].includes(opt) ? "10% flat" : surTxt(C.surcharge_domestic);
    if (CODE === "FIRM") return surTxt(C.surcharge);
    if (CODE === "COOP_AOP" && sub === "COOP") return ["115BAD", "115BAE"].includes(opt) ? "10% flat" : surTxt(C.coop_surcharge);
    if (CODE === "COOP_AOP" && sub === "LOCAL_AUTHORITY") return surTxt(C.local_authority_surcharge);
    return opt === "old" ? "10–37% above ₹50 lakh" : "10–25% above ₹50 lakh";
  };
  const itrFor = (sub) => {
    switch (CODE) {
      case "IND_RES": return "ITR-1 / ITR-2 / ITR-3 / ITR-4";
      case "IND_NR": return "ITR-2 / ITR-3";
      case "HUF": return sub === "RES" ? "ITR-2 / ITR-3 / ITR-4" : "ITR-2 / ITR-3";
      case "COMPANY": return "ITR-6";
      case "FIRM": return sub === "LLP" ? "ITR-5" : "ITR-4 (presumptive, ≤ ₹50 lakh) / ITR-5";
      case "COOP_AOP": return "ITR-5";
      case "TRUST": return ["CHARITABLE", "FUND_10_23C"].includes(sub) ? "ITR-7" : "ITR-5";
      case "POLITICAL": return "ITR-7";
    }
  };
  for (const [sub, subLabel] of Object.entries(C.subtypes)) for (const o of D.options[CODE][sub]) matrixRows.push([subLabel, optLabel(o), rateFor(sub, o.key), surFor(sub, o.key), itrFor(sub), dueTxt(sub, o.key)]);
  const mt = document.getElementById("cat-matrix");
  mt.append(el("thead", null, el("tr", null, ...["Type", "Option", "Rate", "Surcharge", "ITR form", "Due date"].map((h) => el("th", { text: h })))),
    el("tbody", null, ...matrixRows.map((r) => el("tr", null, ...r.map((c) => el("td", { text: c }))))));

  // ------------------------------------------------------------ portal steps
  const portal = document.getElementById("cat-portal");
  [
    "Sign in at incometax.gov.in › e-File › Income Tax Returns › File Income Tax Return.",
    `Select Assessment Year ${D.assessment_year}, mode Online, status '${C.portal_status}' and the ITR form (${C.itr_forms.join(" / ")}).`,
    "Tick the reason for filing (taxable income above the exemption limit, a seventh-proviso condition, or other).",
    C.regime_form ? `Choose the regime in the return (${C.regime_form}).` : "Confirm the tax option and the related form (10-IB / 10-IC / 10-ID / 10-IF / 10-IFA) in Part A-GEN where applicable.",
    "Check pre-filled data against your worksheet, pay any balance, submit and e-verify within 30 days.",
  ].forEach((t) => portal.append(el("li", { text: t })));
  document.getElementById("cat-source").textContent = `Source: ${C.source}. Status: ${C.verification}.`;

  // ------------------------------------------------------------ actions / active profile
  const actions = document.getElementById("cat-actions");
  const status = document.getElementById("cat-status");
  const formPanel = document.getElementById("cat-form-panel"), calcPanel = document.getElementById("cat-calc-panel"), helperPanel = document.getElementById("cat-helper-panel");
  if (!s.user) {
    actions.append(el("a", { class: "btn", href: "signup.html", text: "Create an account to start" }));
    [formPanel, calcPanel, helperPanel].forEach((p) => p.classList.add("hidden"));
    return;
  }
  const P = await api("GET", "/api/profiles");
  const active = P.profiles.find((p) => p.id === P.active);
  const mine = P.profiles.filter((p) => p.entity === CODE);
  const subSel = el("select", { id: "start-subtype", "aria-label": "Type" }, ...Object.entries(C.subtypes).map(([k, v]) => el("option", { value: k, text: v })));
  const startBtn = el("button", { class: "btn" + (active.entity === CODE ? " secondary" : ""), type: "button", text: active.entity === CODE ? "Start another return of this type" : "Start a return in this category" });
  startBtn.addEventListener("click", async () => {
    try { await api("POST", "/api/profiles", { entity: CODE, subtype: subSel.value, label: "", copy_contact: true }); toast("Return started."); location.reload(); } catch (e) { showError(null, e); }
  });
  actions.append(subSel, startBtn);
  if (active.entity !== CODE) {
    status.append(el("div", { class: "notice info" }, el("p", null, `Your open return is "${active.label}" (${active.category_short}). `,
      ...(mine.length ? ["Switch to: ", ...mine.map((p) => el("button", { class: "btn small secondary", type: "button", text: p.label, onclick: async () => { await api("POST", `/api/profiles/${p.id}/activate`, {}); location.reload(); } }))] : ["Start a return here to enter figures for this category."]))));
    [formPanel, calcPanel, helperPanel].forEach((p) => p.classList.add("hidden"));
    return;
  }
  // subtype switch for the open return
  const subNow = el("select", { "aria-label": "Type of the open return" }, ...Object.entries(C.subtypes).map(([k, v]) => el("option", { value: k, text: v, selected: k === active.subtype })));
  subNow.addEventListener("change", async () => { await api("PATCH", `/api/profiles/${active.id}`, { subtype: subNow.value }); location.reload(); });
  const optNow = el("select", { "aria-label": "Tax option" }, ...active.options.map((o) => el("option", { value: o.key, text: o.label, selected: o.key === active.option })));
  optNow.addEventListener("change", async () => { try { await api("POST", "/api/return/regime", { regime: optNow.value }); load(); toast("Option saved."); } catch (e) { showError(null, e); } });
  status.append(el("div", { class: "notice info" }, el("p", null, el("strong", { text: `Open return: ${active.label}. ` }), "Type ", subNow, " Option ", optNow)));

  // ------------------------------------------------------------ quick form
  const QUICK = {
    IND_RES: ["dob", "salary_17_1", "os_deposit_interest", "os_savings_interest", "bp_presumptive", "bp_regular", "turnover", "is_profession", "audit_required", "tds_salary", "tds_other", "fr_current_account_deposits", "fr_foreign_travel", "fr_electricity", "fr_savings_deposits"],
    IND_NR: ["rs_days_py", "rs_days_4py", "rs_days_7py", "rs_nr_years_10", "rs_citizen_or_pio", "rs_left_for_employment", "rs_indian_income_above_15l", "rs_liable_tax_elsewhere", "residential_status", "dob", "salary_17_1", "os_deposit_interest", "os_dividend", "hp_type", "hp_rent", "cg_stcg_111a", "cg_ltcg_112a", "tds_other"],
    HUF: ["residential_status", "os_deposit_interest", "os_dividend", "hp_type", "hp_rent", "hp_interest_24b", "cg_ltcg_112a", "bp_presumptive", "bp_regular", "audit_required", "d_80c", "d_80d_self", "tds_other", "fr_foreign_travel", "fr_electricity"],
    COMPANY: ["company_option", "turnover_2324", "turnover", "bp_regular", "os_other", "cg_stcg_111a", "cg_ltcg_112a", "book_profit", "d_80ia_group", "d_80jjaa", "d_80m", "d_80g", "tp_required", "tds_other", "advance_tax_q1", "advance_tax_q2", "advance_tax_q3", "advance_tax_q4"],
    FIRM: ["residential_status", "bp_presumptive", "bp_regular", "turnover", "is_profession", "audit_required", "os_other", "cg_ltcg_112a", "d_80ia_group", "amt_addbacks", "d_80g", "has_bf_losses", "tds_other", "advance_tax_q4"],
    TRUST: ["trust_income", "trust_applied", "trust_accumulated", "trust_corpus", "trust_total_donations", "trust_anonymous", "trust_specified_income", "bp_regular", "os_other", "amt_addbacks", "tds_other"],
    COOP_AOP: ["coop_option", "aop_shares_determinate", "aop_member_above_be", "aop_members_only_companies", "bp_regular", "turnover", "audit_required", "os_other", "d_80p", "d_80ia_group", "amt_addbacks", "d_80g", "tds_other"],
    POLITICAL: ["pp_books", "pp_donation_records", "pp_audited", "pp_form24a", "pp_voluntary_contributions", "et_distributed", "s10_conditions_met", "trust_total_donations", "os_other", "bp_regular", "tds_other"],
  }[CODE];
  const ENUM_LABELS = { RES: "Resident", RNOR: "Resident but not ordinarily resident", NR: "Non-resident", none: "No house property", self: "Self-occupied", let: "Let out" };
  const form = document.getElementById("cat-form");
  let ret;
  function inputFor(f) {
    const id = "q-" + f.field_id;
    if (f.data_type === "bool") return el("select", { id, name: f.field_id }, el("option", { value: "", text: "Not answered" }), el("option", { value: "false", text: "No", selected: f.value === "false" }), el("option", { value: "true", text: "Yes", selected: f.value === "true" }));
    if (f.data_type.startsWith("enum:")) return el("select", { id, name: f.field_id }, el("option", { value: "", text: "Select" }), ...f.data_type.slice(5).split("|").map((o) => el("option", { value: o, text: ENUM_LABELS[o] || o, selected: f.value === o })));
    const v = f.value == null ? "" : f.data_type === "date" ? f.value : displayValue(f.value, f.data_type);
    return el("input", { id, name: f.field_id, type: f.data_type === "date" ? "date" : "text", value: v, inputmode: ["money", "int"].includes(f.data_type) ? "numeric" : null, autocomplete: "off" });
  }
  async function load() {
    ret = await api("GET", "/api/return");
    const byId = Object.fromEntries(ret.fields.map((f) => [f.field_id, f]));
    const fields = QUICK.map((k) => byId[k]).filter(Boolean);
    form.replaceChildren(...fields.map((f) => el("div", { class: "frow" },
      el("div", { class: "field" }, el("label", { for: "q-" + f.field_id }, f.display_name, el("span", { class: "hint", text: f.help })), inputFor(f)),
      el("div"), el("div", { class: "side" }, chip(f.status)))), el("div", { class: "btn-row" }, el("button", { class: "btn", type: "submit", text: "Save and recalculate" })));
    document.getElementById("cat-form-note").replaceChildren(el("p", { class: "muted", text: `These are the main inputs for a ${C.short.toLowerCase()} return. Everything else (PAN, bank, taxes paid, house property…) is in My Return.` }));
    await calcNow();
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values = {};
    for (const f of ret.fields) {
      if (!form.elements[f.field_id]) continue;
      const v = form.elements[f.field_id].value;
      const before = f.value == null ? "" : f.data_type === "date" ? f.value : displayValue(f.value, f.data_type);
      if (v !== before) values[f.field_id] = v;
    }
    if (values.company_option || values.coop_option) values._opt = values.company_option || values.coop_option;
    const opt = values._opt; delete values._opt;
    try {
      if (Object.keys(values).length) await api("PUT", "/api/return/fields", { values });
      if (opt) await api("POST", "/api/return/regime", { regime: opt });
      fieldErrors(form, null); toast("Saved."); if (opt) location.reload(); else load();
    } catch (err) { fieldErrors(form, err.body && err.body.details); showError(null, err); }
  });

  // ------------------------------------------------------------ calculation + helper
  async function calcNow() {
    const box = document.getElementById("cat-calc"), helper = document.getElementById("cat-helper");
    try {
      const cmp = await api("GET", "/api/calc/compare");
      const c = await api("GET", "/api/calc");
      const sm = c.summary;
      const result = sm.status === "refund" ? "Estimated refund" : sm.status === "payable" ? "Estimated tax payable" : "Nothing payable";
      box.replaceChildren(
        el("div", { class: "stats" },
          el("div", { class: "stat result" }, el("div", { class: "k", text: result }), el("div", { class: "v", text: inr(sm.refund_or_payable) })),
          el("div", { class: "stat" }, el("div", { class: "k", text: "Total tax liability" }), el("div", { class: "v", text: inr(sm.total_tax_liability) })),
          el("div", { class: "stat" }, el("div", { class: "k", text: "Recommended ITR" }), el("div", { class: "v", text: c.itr.recommended })),
          el("div", { class: "stat" }, el("div", { class: "k", text: "Due date" }), el("div", { class: "v", text: dateTxt(sm.due_date) }))),
        ...c.warnings.map((w) => el("div", { class: "notice " + (w.severity === "info" ? "info" : w.severity) }, el("p", { text: w.message }))),
        el("div", { class: "table-wrap" }, el("table", null, el("thead", null, el("tr", null, el("th", { text: "Step" }), el("th", { class: "num", text: "Amount" }))),
          el("tbody", null, ...c.lines.map((l) => el("tr", { class: l.kind }, el("td", { text: l.label }), el("td", { class: "num", text: l.kind === "info" ? (l.note || "") : inr(l.amount) })))))),
        el("p", { class: "muted", text: c.disclaimer }));
      // helper: residency (NRI), else options comparison + ITR reasoning + filing requirement
      const parts = [];
      if (CODE === "IND_NR") {
        document.getElementById("cat-helper-title").textContent = "Residential status check (section 6)";
        const rs = await api("GET", "/api/residency");
        parts.push(rs.status ? el("p", null, "Based on your answers you are ", el("strong", { text: { RES: "Resident (ordinarily resident)", RNOR: "Resident but Not Ordinarily Resident (RNOR)", NR: "Non-resident (NR)" }[rs.status] }), ".") : el("p", { class: "muted", text: "Enter your days in India below to check your status." }),
          el("ul", null, ...rs.reasons.map((r) => el("li", { text: r }))));
        if (rs.status && rs.status !== (byIdValue("residential_status"))) parts.push(el("div", { class: "notice warning" }, el("p", { text: `Your return says '${byIdValue("residential_status") || "not set"}'. Update the residential status field if this result is right${rs.status === "RES" ? " — residents should use the Individual — Resident category." : "."}` })));
      } else document.getElementById("cat-helper-title").textContent = cmp.options.length > 1 ? "Which option costs less?" : "ITR form and filing requirement";
      if (cmp.options.length > 1) parts.push(el("div", { class: "table-wrap" }, el("table", null,
        el("thead", null, el("tr", null, el("th", { text: "Option" }), el("th", { class: "num", text: "Total tax" }), el("th", { class: "num", text: "Refund (−) / payable" }))),
        el("tbody", null, ...cmp.options.map((o) => el("tr", { class: o.key === cmp.selected ? "total" : "" }, el("td", { text: o.label + (o.key === cmp.selected ? " (selected)" : "") }), el("td", { class: "num", text: inr(o.summary.total_tax_liability) }), el("td", { class: "num", text: inr(o.summary.net) })))))),
        el("p", { text: cmp.lower === "equal" ? "All options give the same tax on these figures." : `Lowest tax: ${cmp.options.find((o) => o.key === cmp.lower).label} — ${inr(cmp.difference)} less than the next option. Check the conditions and forms before choosing.` }));
      parts.push(el("p", null, el("strong", { text: `${c.itr.recommended}: ` }), c.itr.why.join("; ")));
      const rej = Object.entries(c.itr.rejected || {}).filter(([, v]) => v && v.length);
      if (rej.length) parts.push(el("ul", { class: "muted" }, ...rej.map(([k, v]) => el("li", null, el("strong", { text: k + ": " }), v.join("; ")))));
      parts.push(el("div", { class: "notice " + (c.filing_requirement.required ? "warning" : "info") }, el("p", null, el("strong", { text: c.filing_requirement.required ? "Filing is compulsory. " : "Filing is optional. " }), c.filing_requirement.reasons.join(" "))));
      helper.replaceChildren(...parts);
    } catch (e) { showError(box, e); }
  }
  const byIdValue = (k) => { const f = ret && ret.fields.find((x) => x.field_id === k); return f ? f.value : null; };
  load();
})();
