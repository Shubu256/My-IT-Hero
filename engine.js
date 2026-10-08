/* My IT Hero — tax engine and ITR selector (browser edition).
   Port of myithero/tax/engine.py and itr_select.py. All money is BigInt paise
   (exact integer arithmetic, no binary floating point). Rules come only from
   ITH_DATA.rules[AY] — nothing year-specific is hard-coded here.
   Estimate only: the e-Filing portal's own computation is authoritative. */
(function (root) {
  "use strict";
  const Z = 0n;
  const P = 100n; // paise per rupee

  // ---------------------------------------------------------------- money helpers
  function toPaise(x) {
    if (x === null || x === undefined || x === "") return Z;
    if (typeof x === "bigint") return x * P;
    let s = String(x).trim();
    let neg = false;
    if (s.startsWith("-")) { neg = true; s = s.slice(1); }
    if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") return Z;
    const [i, f = ""] = s.split(".");
    let p = BigInt(i || "0") * P + BigInt((f + "00").slice(0, 2) || "0");
    if (f.length > 2 && Number(f[2]) >= 5) p += 1n; // half-up beyond 2dp
    return neg ? -p : p;
  }
  const max = (a, b) => (a > b ? a : b);
  const min = (a, b) => (a < b ? a : b);
  const abs = (a) => (a < Z ? -a : a);
  function divHalfUp(n, d) { // d > 0
    const neg = n < Z; const q = abs(n) / d; const r = abs(n) % d;
    const out = r * 2n >= d ? q + 1n : q;
    return neg ? -out : out;
  }
  function rateMilli(rate) { return BigInt(Math.round(Number(rate) * 1000)); } // 12.5% -> 12500
  function pct(amount, rate) { return divHalfUp(amount * rateMilli(rate), 100000n); }
  function roundTo(x, rupees) { const n = BigInt(rupees) * P; return divHalfUp(x, n) * n; }
  function floorTo(x, rupees) { const n = BigInt(rupees) * P; return x >= Z ? (x / n) * n : -(((-x + n - 1n) / n) * n); }
  function rupeesStr(x) { return divHalfUp(x, P).toString(); }
  function R(n) { return BigInt(n) * P; } // rupee number -> paise

  function slabTax(income, slabs) {
    income = max(Z, income);
    let tax = Z, lower = Z;
    for (const s of slabs) {
      const upper = s.upto === null ? null : R(s.upto);
      if (income <= lower) break;
      const top = upper === null ? income : min(income, upper);
      tax += pct(top - lower, s.rate);
      if (upper === null) break;
      lower = upper;
    }
    return tax;
  }

  function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return { y, m, d, t: Date.UTC(y, m - 1, d) }; }
  function addDays(s, n) { const d = new Date(parseDate(s).t + n * 86400000); return d.toISOString().slice(0, 10); }
  function monthsOrPart(start, end) {
    const a = parseDate(start), b = parseDate(end);
    if (b.t < a.t) return 0;
    let months = (b.y - a.y) * 12 + (b.m - a.m);
    if (b.d >= a.d) months += 1;
    return months > 0 ? Math.max(months, 1) : 1;
  }
  function fmtDate(s) { const d = parseDate(s); return `${String(d.d).padStart(2, "0")} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.m - 1]} ${d.y}`; }
  function inrPlain(p) { // paise -> "1,50,000" (rupees)
    let s = rupeesStr(abs(p));
    if (s.length > 3) { let h = s.slice(0, -3); const t = s.slice(-3); const g = []; while (h.length > 2) { g.unshift(h.slice(-2)); h = h.slice(0, -2); } if (h) g.unshift(h); s = g.join(",") + "," + t; }
    return s;
  }

  // ---------------------------------------------------------------- calculator
  function compute(values, regime, ay, today, profile) {
    profile = profile || { entity: "IND_RES" };
    const isHUF = profile.entity === "HUF";
    if (regime !== "new" && regime !== "old") throw new Error("regime must be 'new' or 'old'");
    const RU = root.ITH_DATA.rules[ay];
    const reg = RU.regimes[regime];
    const v = values;
    const lines = [], warnings = [];
    const todayStr = today || new Date().toISOString().slice(0, 10);
    const m = (k) => max(Z, toPaise(v[k]));
    const line = (key, label, amount, note, kind) => { lines.push({ key, label, amount: rupeesStr(amount), note: note || null, kind: kind || "amount" }); return amount; };
    const warn = (code, message, severity) => warnings.push({ code, message, severity: severity || "warning" });

    // profile
    let band = "below_60", age = 0;
    if (isHUF) { /* HUF: no age bands */ }
    else if (!v.dob) warn("DOB_MISSING", "Date of birth is missing — slabs for taxpayers below 60 were used.");
    else {
      const ref = parseDate(addDays(RU.fy_end, 1)), d = parseDate(v.dob);
      age = ref.y - d.y - ((ref.m < d.m || (ref.m === d.m && ref.d < d.d)) ? 1 : 0);
      band = age >= 80 ? "80_plus" : age >= 60 ? "60_to_79" : "below_60";
    }
    const slabsFor = (b) => reg.slabs[b] || reg.slabs.all_ages;
    const resident = ["RES", "RNOR"].includes(v.residential_status || "RES");
    if (!resident && band !== "below_60") {
      // Senior / super-senior slabs are for resident individuals only (SRC-ITD-NRI-AY2627)
      warn("NR_SENIOR_SLABS", "Senior-citizen slabs apply only to residents; general slabs were used.", "info");
      band = "below_60";
    }
    if (!v.residential_status) warn("RES_STATUS_MISSING", "Residential status not entered — treated as Resident.", "warning");
    line("regime", reg.name, Z, "Age band: " + band.replace(/_/g, " "), "info");

    // salary
    const gross = m("salary_17_1") + m("perquisites_17_2") + m("profits_17_3");
    line("gross_salary", "Gross salary (17(1) + 17(2) + 17(3))", gross);
    let exempt = m("exempt_allowances");
    if (exempt && !reg.allows_exempt_allowances) { warn("EXEMPT_ALLOWANCE_NOT_ALLOWED", "Exempt allowances u/s 10 (e.g. HRA) are not allowed in the new regime and were ignored.", "info"); exempt = Z; }
    exempt = min(exempt, gross);
    line("exempt_allowances", "Less: exempt allowances u/s 10", exempt);
    const net = gross - exempt;
    const std = gross > Z ? min(R(reg.standard_deduction_salary), net) : Z;
    line("std_deduction", "Less: standard deduction u/s 16(ia)", std, reg.standard_deduction_verification);
    let pt = m("professional_tax");
    if (pt && !reg.allows_professional_tax) { warn("PT_NOT_ALLOWED", "Professional tax u/s 16(iii) is not deductible in the new regime and was ignored.", "info"); pt = Z; }
    pt = min(pt, max(Z, net - std));
    line("professional_tax", "Less: professional tax u/s 16(iii)", pt);
    const sal = line("income_salary", "Income from salary", max(Z, net - std - pt), null, "subtotal");

    // house property
    const t = v.hp_type || "none";
    const interest = m("hp_interest_24b");
    let hp = Z;
    if (t === "let") {
      const nav = max(Z, m("hp_rent") - m("hp_municipal_tax"));
      const std30 = pct(nav, RU.house_property.standard_deduction_pct);
      hp = nav - std30 - interest;
      line("hp_nav", "Net annual value (rent − municipal tax)", nav);
      line("hp_std", "Less: 30% standard deduction u/s 24(a)", std30);
      line("hp_interest", "Less: interest on borrowed capital u/s 24(b)", interest);
    } else if (t === "self") {
      let allowed = Z;
      if (reg.allows_self_occupied_interest) allowed = min(interest, R(reg.self_occupied_interest_max));
      else if (interest) warn("SOP_INTEREST_NOT_ALLOWED", "Home-loan interest on a self-occupied property is not deductible in the new regime and was ignored.", "info");
      line("hp_interest", "Less: interest on self-occupied property u/s 24(b)", allowed);
      hp = -allowed;
    } else if (interest || m("hp_rent")) {
      warn("HP_TYPE_MISSING", "House-property amounts were entered but the property type is 'none'. Choose self-occupied or let-out.", "error");
    }
    if (hp < Z) {
      if (reg.allows_hp_loss_setoff_other_heads) {
        const cap = R(reg.hp_loss_setoff_max);
        if (-hp > cap) { warn("HP_LOSS_CF", `House-property loss above ₹${inrPlain(cap)} cannot be set off this year; the excess may be carried forward (needs ITR-2/ITR-3).`, "warning"); hp = -cap; }
      } else { warn("HP_LOSS_NEW", "In the new regime a house-property loss cannot be set off against other heads; it was taken as nil here.", "warning"); hp = Z; }
    }
    line("income_hp", "Income from house property", hp, null, "subtotal");

    // other sources
    const fp = m("os_family_pension");
    const fpDed = min(divHalfUp(fp, 3n), R(reg.family_pension_deduction_max));
    const osParts = m("os_savings_interest") + m("os_deposit_interest") + m("os_dividend") + m("os_other");
    if (fp) line("fp_deduction", "Less: family pension deduction u/s 57(iia)", fpDed, reg.family_pension_verification);
    const os = line("income_os", "Income from other sources", osParts + fp - fpDed, null, "subtotal");

    // capital gains + business
    const stcg = m("cg_stcg_111a"), ltcg112a = m("cg_ltcg_112a"), ltcg112 = m("cg_ltcg_112"), stcgOther = m("cg_stcg_other");
    const cgTotal = stcg + ltcg112a + ltcg112 + stcgOther;
    line("income_cg", "Capital gains (all)", cgTotal, null, "subtotal");
    const bp = m("bp_presumptive") + m("bp_regular");
    line("income_bp", "Business / profession", bp, null, "subtotal");
    const gti = max(Z, sal + hp + os + cgTotal + bp);
    line("gross_total_income", "Gross total income", gti, null, "total");

    // deductions
    const special = stcg + ltcg112a + ltcg112;
    const lim = RU.deduction_limits, allowed = new Set(reg.allowed_deductions), senior = band !== "below_60";
    const out = {}; const notAllowed = new Set();
    for (const key of ["d_80c", "d_80ccd1b", "d_80ccd2", "d_80cch", "d_80d_self", "d_80d_parents", "d_80e", "d_80g", "d_80jjaa", "d_80ia_group"]) {
      const amt = m(key);
      if (!amt) continue;
      if (!allowed.has(key)) { notAllowed.add(lim[key].section); continue; }
      let cap = lim[key].max === undefined || lim[key].max === null ? null : R(lim[key].max);
      if (key === "d_80d_self" && senior) cap = R(lim[key].max_senior);
      if (key === "d_80d_parents" && [true, "true", "1", 1].includes(v.parents_senior)) cap = R(lim[key].max_senior);
      if (key === "d_80ccd2") {
        let base = m("basic_da");
        if (!base) { base = m("salary_17_1"); warn("BASIC_DA_MISSING", "Basic + DA not entered; the 14% cap for 80CCD(2) was estimated on salary u/s 17(1). Please verify.", "warning"); }
        cap = pct(base, lim[key].max_pct_of_salary);
      }
      out[key] = cap === null ? amt : min(amt, cap);
      if (cap !== null && amt > cap) warn("CAP_" + key.toUpperCase(), `${lim[key].section}: claimed ₹${inrPlain(amt)}, limited to ₹${inrPlain(cap)}.`, "info");
    }
    if (notAllowed.size) warn("DEDUCTIONS_NOT_ALLOWED", `Not allowed in the ${regime} regime and ignored: ${[...notAllowed].sort().join(", ")}.`, "info");
    if (allowed.has("d_80tta") && !senior) out.d_80tta = min(m("os_savings_interest"), R(lim.d_80tta.max));
    if (allowed.has("d_80ttb") && senior) out.d_80ttb = min(m("os_savings_interest") + m("os_deposit_interest"), R(lim.d_80ttb.max));
    let ded = Object.values(out).reduce((a, b) => a + b, Z);
    const gtiNormal = gti - special;
    if (ded > gtiNormal) { warn("DEDUCTIONS_CAPPED", "Chapter VI-A deductions cannot exceed gross total income (excluding special-rate capital gains); they were limited.", "info"); ded = max(Z, gtiNormal); }
    for (const [k, a] of Object.entries(out)) line(k, "Deduction u/s " + lim[k].section, a, lim[k].verification);
    line("total_deductions", "Total deductions (Chapter VI-A)", ded, null, "subtotal");

    const ti = roundTo(max(Z, gti - ded), RU.rounding.total_income_nearest);
    line("total_income", "Total income (rounded to nearest ₹10)", ti, null, "total");
    if (m("agri_income") > R(5000)) warn("AGRI_PARTIAL_INTEGRATION", "Agricultural income above ₹5,000 affects the rate of tax (partial integration). This is NOT computed — REQUIRES REVIEW.", "warning");

    const cg = RU.capital_gains;
    function baseTax(normalIncome, st, l112a, l112) {
      const slabs = slabsFor(band);
      const be = slabs[0].rate === 0 ? R(slabs[0].upto) : Z;
      let ltcgTaxable = max(Z, l112a - R(cg.ltcg_112a_exemption));
      let adj = Z;
      if (resident && normalIncome < be) {
        let short = be - normalIncome;
        let use = min(st, short); st -= use; short -= use; adj += use;
        use = min(l112, short); l112 -= use; short -= use; adj += use;
        use = min(ltcgTaxable, short); ltcgTaxable -= use; short -= use; adj += use;
      }
      const nt = slabTax(normalIncome, slabs);
      const sp = pct(st, cg.stcg_111a_rate) + pct(ltcgTaxable, cg.ltcg_112a_rate) + pct(l112, cg.ltcg_112_other_rate);
      return [nt, sp, adj];
    }
    const normalIncome = max(Z, ti - special);
    const [normalTax, specialTax, adj] = baseTax(normalIncome, stcg, ltcg112a, ltcg112);
    if (adj) line("be_adjustment", "Unused basic exemption adjusted against special-rate gains", adj, "UNVERIFIED — REQUIRES REVIEW (order of adjustment)");
    line("tax_normal", "Tax on income at slab rates", normalTax);
    line("tax_special", "Tax on special-rate income (111A / 112A / 112)", specialTax, cg.verification);

    const rb = reg.rebate_87a;
    let rebate = Z, relief87 = Z;
    if (resident && !isHUF) {
      const rebateBase = rb.excludes_special_rate_tax ? normalTax : normalTax + specialTax;
      if (ti <= R(rb.income_limit)) rebate = min(rebateBase, R(rb.max_rebate));
      else if (rb.marginal_relief) {
        const excess = ti - R(rb.income_limit);
        if (normalTax > excess) { relief87 = normalTax - excess; if (special) warn("MR_SPECIAL", "Marginal relief with special-rate income present — UNVERIFIED — REQUIRES REVIEW.", "warning"); }
      }
      if (special && rb.excludes_special_rate_tax && (rebate || ti <= R(rb.income_limit))) warn("REBATE_SPECIAL", "Rebate u/s 87A was not applied to tax on special-rate capital gains. Confirm on the portal.", "info");
    }
    line("rebate_87a", "Less: rebate u/s 87A", rebate, rb.verification);
    if (relief87) line("marginal_relief_87a", "Less: marginal relief (income just above rebate limit)", relief87);
    const taxAfter = max(Z, normalTax + specialTax - rebate - relief87);
    let normalAfter, specialAfter;
    if (rb.excludes_special_rate_tax) { normalAfter = max(Z, normalTax - rebate - relief87); specialAfter = taxAfter - normalAfter; }
    else {
      const tot = normalTax + specialTax;
      normalAfter = tot ? divHalfUp(taxAfter * normalTax, tot) : taxAfter;
      specialAfter = taxAfter - normalAfter;
    }
    const surRate = (inc) => { let r = 0; for (const s of reg.surcharge) if (inc > R(s.above)) r = s.rate; return r; };
    const surcharge = (inc, nt, st) => { const r = surRate(inc); return [pct(nt, r) + pct(st, Math.min(r, RU.special_surcharge_cap_rate)), r]; };
    let [sur, srate] = surcharge(ti, normalAfter, specialAfter);
    let mr = Z;
    if (srate > 0) {
      const th = reg.surcharge.filter((s) => ti > R(s.above)).map((s) => R(s.above)).reduce((a, b) => max(a, b));
      const ok = th > special;
      const [nt, st] = baseTax(ok ? max(Z, th - special) : Z, ok ? stcg : Z, ok ? ltcg112a : Z, ok ? ltcg112 : Z);
      const [surTh] = surcharge(th, nt, st);
      const limit = nt + st + surTh + (ti - th);
      if (taxAfter + sur > limit) mr = min(sur, taxAfter + sur - limit);
    }
    line("surcharge", `Surcharge @ ${srate}%`, sur, reg.surcharge_verification);
    if (mr) line("marginal_relief_surcharge", "Less: marginal relief on surcharge", mr);
    sur -= mr;
    const cess = pct(taxAfter + sur, RU.cess_rate);
    line("cess", `Health & Education Cess @ ${RU.cess_rate}%`, cess);
    let grossTax = taxAfter + sur + cess;
    // Alternate Minimum Tax (s.115JC) — old regime, profit-linked deductions / 10AA / 35AD claimed
    const amtBase = (out.d_80ia_group || Z) + m("amt_addbacks");
    if (regime === "old" && amtBase > Z && RU.amt) {
      const ati = ti + amtBase;
      if (ati > R(RU.amt.threshold_ind_huf_aop)) {
        const amtTax = pct(ati, RU.amt.rate);
        const [amtSur] = surcharge(ati, amtTax, Z);
        const amtTotal = amtTax + amtSur + pct(amtTax + amtSur, RU.cess_rate);
        line("amt", `Alternate Minimum Tax @ ${RU.amt.rate}% of adjusted total income ₹${inrPlain(ati)}`, amtTotal, RU.amt.verification);
        if (amtTotal > grossTax) { warn("AMT_APPLIES", "AMT u/s 115JC is higher than normal tax and becomes payable. The excess can be carried forward as AMT credit (Schedule AMTC).", "warning"); grossTax = amtTotal; }
      }
    }
    const liability = roundTo(grossTax, RU.rounding.tax_nearest);
    line("total_tax_liability", "Total tax liability (rounded to nearest ₹10)", liability, null, "total");

    // taxes paid
    const tds = m("tds_salary") + m("tds_other"), tcs = m("tcs");
    const advQ = [1, 2, 3, 4].map((i) => m("advance_tax_q" + i));
    const adv = advQ.reduce((a, b) => a + b, Z), sat = m("self_assessment_tax");
    line("tds", "TDS", tds); line("tcs", "TCS", tcs); line("advance_tax", "Advance tax", adv); line("self_assessment_tax", "Self-assessment tax", sat);

    // interest & fee
    const filing = v.filing_date || todayStr;
    const due = dueDateFor(RU, v, profile);
    if ((m("bp_regular") || m("bp_presumptive")) && (v.audit_required === undefined || v.audit_required === null || v.audit_required === ""))
      warn("AUDIT_UNKNOWN", "Answer whether your accounts are audited — audited cases have a later due date (21 Nov 2026).", "warning");
    const it = RU.interest;
    const assessed = max(Z, liability - tds - tcs);
    let i234a = Z, i234b = Z, i234c = Z;
    const after = (a, b) => parseDate(a).t > parseDate(b).t;
    if (after(filing, due)) {
      const base = floorTo(max(Z, assessed - adv), 100);
      i234a = pct(base, it.s234a_rate_pct_per_month * monthsOrPart(addDays(due, 1), filing));
    }
    const ayStart = addDays(RU.fy_end, 1);
    const thr = R(it.advance_tax_threshold);
    if (assessed >= thr && adv < pct(assessed, it.s234b_paid_pct_required)) {
      i234b = pct(floorTo(assessed - adv, 100), it.s234b_rate_pct_per_month * monthsOrPart(ayStart, filing));
    }
    if (assessed >= thr) {
      let cum = Z;
      it.s234c_schedule.forEach((sch, idx) => {
        cum += advQ[idx];
        const need = pct(assessed, sch.cum_pct);
        if (cum < pct(assessed, sch.min_pct) || (sch.min_pct === sch.cum_pct && cum < need))
          i234c += pct(floorTo(need - cum, 100), it.s234c_rate_pct_per_month * sch.months);
      });
      if (special || m("os_dividend")) warn("234C_CG", "Interest u/s 234C ignores the relief for capital gains/dividends that arose after an instalment date — may be overstated. REQUIRES REVIEW.", "warning");
    }
    const interestTotal = roundTo(i234a + i234b + i234c, 1);
    line("interest_234a", "Interest u/s 234A (late filing)", i234a, it.verification);
    line("interest_234b", "Interest u/s 234B (advance-tax shortfall)", i234b, it.verification);
    line("interest_234c", "Interest u/s 234C (deferment of instalments)", i234c, it.verification);

    let fee = Z;
    const lf = RU.late_fee_234f;
    if (after(filing, due)) {
      const be = R(slabsFor(band)[0].upto);
      if (gti <= be) warn("234F_BELOW_LIMIT", "Income appears to be below the basic exemption limit, so the late fee was not applied. REQUIRES REVIEW.", "info");
      else fee = ti <= R(lf.small_income_limit) ? R(lf.fee_small_income) : R(lf.fee);
      const last = RU.deadlines.belated_return_last_date;
      if (after(filing, last)) warn("PAST_BELATED", `The planned filing date is after the last date for a belated return (${fmtDate(last)}). Only an updated return (ITR-U) may be possible.`, "error");
      else warn("BELATED", `The original due date (${fmtDate(due)}) has passed. This would be a belated return u/s 139(4).`, "warning");
    }
    line("fee_234f", "Late filing fee u/s 234F", fee, lf.verification);
    const netAmt = roundTo(liability + interestTotal + fee - tds - tcs - adv - sat, 10);
    line("refund_or_payable", netAmt > Z ? "Tax payable" : netAmt < Z ? "Refund due" : "Nothing payable", abs(netAmt), null, "total");

    const s = rupeesStr;
    const summary = {
      gross_total_income: s(gti), total_deductions: s(ded), total_income: s(ti), tax_normal: s(normalTax), tax_special: s(specialTax),
      rebate_87a: s(rebate + relief87), surcharge: s(sur), cess: s(cess), total_tax_liability: s(liability), tds: s(tds), tcs: s(tcs),
      advance_tax: s(adv), self_assessment_tax: s(sat), interest_234: s(interestTotal), fee_234f: s(fee), net: s(netAmt),
      status: netAmt > Z ? "payable" : netAmt < Z ? "refund" : "nil", income_salary: s(sal), income_hp: s(hp), income_os: s(os),
      income_cg: s(cgTotal), income_bp: s(bp), std_deduction: s(std), age, age_band: band, filing_date: filing, due_date: due,
      refund_or_payable: s(abs(netAmt)),
    };
    return { assessment_year: ay, regime, summary, lines, warnings, disclaimer: "Estimate only. The e-Filing portal's computation is authoritative." };
  }

  // ---------------------------------------------------------------- due dates
  const truthy = (x) => [true, 1, "1", "true", "True", "yes"].includes(x);
  function dueDateFor(RU, v, profile) {
    const dl = RU.deadlines; const e = (profile && profile.entity) || "IND_RES";
    if (truthy(v.tp_required)) return dl.due_date_139_1_transfer_pricing || dl.due_date_139_1_audit;
    const auditedByNature = e === "COMPANY" || e === "TRUST" && profile.subtype !== "BUSINESS_TRUST" && profile.subtype !== "UNREGISTERED" && profile.subtype !== "PRIVATE_DISCRETIONARY" || e === "POLITICAL";
    if (truthy(v.audit_required) || auditedByNature) return dl.due_date_139_1_audit;
    const business = toPaise(v.bp_regular) > Z || toPaise(v.bp_presumptive) > Z || ["FIRM", "COOP_AOP"].includes(e) && toPaise(v.turnover) > Z;
    if (business) return dl.due_date_139_1_non_audit_business || dl.due_date_139_1_non_audit;
    return dl.due_date_139_1_non_audit;
  }

  // ---------------------------------------------------------------- ITR selector
  function selectItr(v, ay, totalIncome) {
    const L = root.ITH_DATA.rules[ay].itr_limits;
    const b = (x) => [true, 1, "1", "true", "True", "yes"].includes(x);
    const res = v.residential_status || null;
    const hpCount = v.hp_count ? Number(v.hp_count) : ((v.hp_type || "none") !== "none" ? 1 : 0);
    const keys = ["salary_17_1", "perquisites_17_2", "profits_17_3", "hp_rent", "os_savings_interest", "os_deposit_interest", "os_dividend", "os_family_pension", "os_other",
      "cg_ltcg_112a", "cg_stcg_111a", "cg_stcg_other", "cg_ltcg_112", "bp_presumptive", "bp_regular"];
    const ti = totalIncome !== undefined && totalIncome !== null ? toPaise(totalIncome) : keys.reduce((a, k) => a + toPaise(v[k]), Z);
    const fl = {}; ["is_director", "has_unlisted_shares", "has_foreign_assets", "has_foreign_income", "has_bf_losses", "tds_194n", "esop_deferred"].forEach((k) => (fl[k] = b(v[k])));
    const ltcg112a = toPaise(v.cg_ltcg_112a);
    const otherCg = toPaise(v.cg_stcg_111a) + toPaise(v.cg_stcg_other) + toPaise(v.cg_ltcg_112);
    const presumptive = toPaise(v.bp_presumptive), regular = toPaise(v.bp_regular), agri = toPaise(v.agri_income);
    const lakh = (n) => "₹" + inrPlain(R(n));
    const common = [];
    if (res === null) common.push("residential status is not entered (ITR-1/ITR-4 need 'Resident')");
    else if (res !== "RES") common.push("you are not a Resident (ordinarily resident)");
    if (fl.is_director) common.push("you were a company director");
    if (fl.has_unlisted_shares) common.push("you held unlisted equity shares");
    if (fl.has_foreign_assets) common.push("you have foreign assets / signing authority abroad");
    if (fl.has_foreign_income) common.push("you have income from outside India");
    if (fl.has_bf_losses) common.push("you have losses brought / carried forward");
    if (fl.tds_194n) common.push("TDS was deducted u/s 194N");
    if (fl.esop_deferred) common.push("you deferred tax on ESOPs");
    if (otherCg > Z) common.push("you have capital gains other than LTCG u/s 112A");
    if (ltcg112a > R(L.itr1_ltcg112a_limit)) common.push(`LTCG u/s 112A exceeds ${lakh(L.itr1_ltcg112a_limit)}`);
    if (agri > R(L.itr1_agri_limit)) common.push(`agricultural income exceeds ${lakh(L.itr1_agri_limit)}`);
    const r1 = [...common];
    if (ti > R(L.itr1_income_limit)) r1.push(`total income exceeds ${lakh(L.itr1_income_limit)}`);
    if (hpCount > L.itr1_max_house_properties) r1.push(`more than ${L.itr1_max_house_properties} house properties`);
    if (presumptive || regular) r1.push("you have business/professional income");
    const r4 = [...common];
    if (ti > R(L.itr4_income_limit)) r4.push(`total income exceeds ${lakh(L.itr4_income_limit)}`);
    if (hpCount > L.itr4_max_house_properties) r4.push(`more than ${L.itr4_max_house_properties} house property (limit UNVERIFIED — REQUIRES REVIEW)`);
    if (regular) r4.push("you have business income that is not presumptive");
    if (!presumptive) r4.push("you have no presumptive business income (ITR-4 is for 44AD/44ADA/44AE)");
    const r2 = (presumptive || regular) ? ["you have business/professional income"] : [];
    let rec, why;
    if (!r1.length) { rec = "ITR-1"; why = ["Resident individual", `total income within ${lakh(L.itr1_income_limit)}`, "income only from salary/pension, up to two house properties, other sources and LTCG u/s 112A within limit"]; }
    else if (!r4.length) { rec = "ITR-4"; why = ["Resident individual with presumptive business/professional income", `total income within ${lakh(L.itr4_income_limit)}`]; }
    else if (!r2.length) { rec = "ITR-2"; why = ["No business/professional income", "not eligible for ITR-1 because " + r1.join("; ")]; }
    else { rec = "ITR-3"; why = ["You have business/professional income and are not eligible for ITR-4"]; }
    const rejected = {};
    if (rec !== "ITR-1") rejected["ITR-1"] = r1;
    if (rec !== "ITR-4") rejected["ITR-4"] = r4.length ? r4 : ["a simpler form applies"];
    if (rec !== "ITR-2") rejected["ITR-2"] = r2.length ? r2 : ["a simpler form applies"];
    if (rec !== "ITR-3") rejected["ITR-3"] = ["a simpler form applies"];
    const missing = [];
    if (res === null) missing.push("residential_status");
    for (const k of ["is_director", "has_unlisted_shares", "has_foreign_assets", "has_bf_losses"]) if (v[k] === undefined || v[k] === null || v[k] === "") missing.push(k);
    return { recommended: rec, why, rejected, unanswered_questions: missing,
      note: missing.length ? "Recommendation is provisional until every eligibility question is answered." : null,
      source: L.source, verification: L.verification };
  }

  root.ITHEngine = { compute, selectItr, slabTax, toPaise, rupeesStr, pct, roundTo, monthsOrPart, dueDateFor, divHalfUp, floorTo, R, inrPlain, parseDate, addDays, fmtDate, max, min, abs, Z, P };
  if (typeof module !== "undefined") module.exports = root.ITHEngine;
})(typeof window !== "undefined" ? window : globalThis);
