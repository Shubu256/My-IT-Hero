/* My IT Hero — taxpayer categories (browser edition).
   Tax engine for Company, Firm/LLP, Co-operative society / AOP / BOI / AJP / Local authority,
   Trust / Institution and Political party / specified entities; ITR selection for every
   category; residential-status test (s.6) and filing-requirement check (s.139(1)).
   All rates come from ITH_DATA.rules[AY].entities — nothing year-specific is hard-coded.
   Individuals and HUFs use ITHEngine.compute (individual engine) with a profile. */
(function (root) {
  "use strict";
  const E = root.ITHEngine;
  const { toPaise, rupeesStr, pct, roundTo, monthsOrPart, dueDateFor, floorTo, R, inrPlain, parseDate, addDays, fmtDate, max, min, abs, Z } = E;
  const truthy = (x) => [true, 1, "1", "true", "True", "yes"].includes(x);
  const UNV = "UNVERIFIED — REQUIRES REVIEW";

  function categories(ay) { return root.ITH_DATA.rules[ay].entities; }

  /* Which choices exist for a profile: [{key, label}]. Individuals/HUF/AOP/BOI/AJP: new/old regime.
     Company: normal/115BA/115BAA/115BAB (domestic). Co-op: normal/115BAD/115BAE. Others: a single "normal". */
  function optionsFor(profile, ay) {
    const ent = categories(ay)[profile.entity];
    const regimes = [{ key: "new", label: "New tax regime (s.115BAC, default)" }, { key: "old", label: "Old tax regime" }];
    switch (profile.entity) {
      case "IND_RES": case "IND_NR": case "HUF": return regimes;
      case "COMPANY": return profile.subtype === "FOREIGN" ? [{ key: "normal", label: "Foreign company — 35%" }] : Object.entries(ent.options).map(([key, label]) => ({ key, label }));
      case "COOP_AOP":
        if (profile.subtype === "COOP") return Object.entries(ent.options).map(([key, label]) => ({ key, label }));
        if (profile.subtype === "LOCAL_AUTHORITY") return [{ key: "normal", label: "Local authority — 30%" }];
        return regimes;
      case "TRUST": return ["UNREGISTERED", "CHARITABLE", "FUND_10_23C"].includes(profile.subtype) ? regimes : [{ key: "normal", label: "Maximum marginal rate" }];
      case "POLITICAL": return regimes;
      default: return [{ key: "normal", label: "Normal rates" }];
    }
  }
  function defaultOption(profile, values, ay) {
    if (profile.entity === "COMPANY") return profile.subtype === "FOREIGN" ? "normal" : (values.company_option || "normal");
    if (profile.entity === "COOP_AOP" && profile.subtype === "COOP") return values.coop_option || "normal";
    return optionsFor(profile, ay)[0].key;
  }

  // ------------------------------------------------------------------ dispatcher
  function computeFor(profile, values, option, ay, today) {
    profile = profile || { entity: "IND_RES" };
    const opts = optionsFor(profile, ay).map((o) => o.key);
    option = option || defaultOption(profile, values, ay);
    if (!opts.includes(option)) option = opts[0];
    let res;
    if (["IND_RES", "IND_NR", "HUF"].includes(profile.entity)) res = E.compute(values, option, ay, today, profile);
    else res = computeEntity(profile, values, option, ay, today);
    res.profile = profile; res.option = option;
    res.option_label = (optionsFor(profile, ay).find((o) => o.key === option) || {}).label;
    res.options = optionsFor(profile, ay);
    res.filing_requirement = filingRequirement(profile, values, res, ay);
    return res;
  }

  // ------------------------------------------------------------------ non-individual engine
  function computeEntity(profile, values, option, ay, today) {
    const RU = root.ITH_DATA.rules[ay];
    const ENT = RU.entities;
    const v = values, e = profile.entity, sub = profile.subtype;
    const lines = [], warnings = [];
    const todayStr = today || new Date().toISOString().slice(0, 10);
    const m = (k) => max(Z, toPaise(v[k]));
    const line = (key, label, amount, note, kind) => { lines.push({ key, label, amount: rupeesStr(amount), note: note || null, kind: kind || "amount" }); return amount; };
    const warn = (code, message, severity) => warnings.push({ code, message, severity: severity || "warning" });
    const cat = ENT[e];
    line("category", `${cat.label} — ${cat.subtypes[sub] || sub}`, Z, (optionsFor(profile, ay).find((o) => o.key === option) || {}).label, "info");
    const resident = (v.residential_status || "RES") !== "NR";
    if (e === "COMPANY" && sub === "FOREIGN" && v.residential_status === "RES") warn("FCO_RES", "A foreign company is usually non-resident; check residential status (place of effective management).", "info");

    // ---- heads of income
    let hp = Z;
    const t = v.hp_type || "none", interest = m("hp_interest_24b");
    if (t === "let") {
      const nav = max(Z, m("hp_rent") - m("hp_municipal_tax")); const std30 = pct(nav, RU.house_property.standard_deduction_pct);
      hp = nav - std30 - interest;
      line("hp_nav", "Net annual value (rent − municipal tax)", nav); line("hp_std", "Less: 30% standard deduction u/s 24(a)", std30); line("hp_interest", "Less: interest u/s 24(b)", interest);
    } else if (t === "self" && interest) warn("HP_SELF_ENTITY", "Only individuals and HUFs can have a self-occupied property; the interest was ignored.", "info");
    if (hp < Z) { warn("HP_LOSS_ENTITY", "House-property loss is set off up to ₹2,00,000 against other heads here; any excess may be carried forward.", "info"); hp = max(hp, -R(200000)); }
    line("income_hp", "Income from house property", hp, null, "subtotal");
    const os = m("os_savings_interest") + m("os_deposit_interest") + m("os_dividend") + m("os_other");
    line("income_os", "Income from other sources", os, null, "subtotal");
    const stcg = m("cg_stcg_111a"), ltcg112a = m("cg_ltcg_112a"), ltcg112 = m("cg_ltcg_112"), stcgOther = m("cg_stcg_other");
    const cgTotal = stcg + ltcg112a + ltcg112 + stcgOther;
    line("income_cg", "Capital gains (all)", cgTotal, null, "subtotal");
    let bpBusiness = m("bp_regular"), bpPresumptive = e === "FIRM" ? m("bp_presumptive") : Z;
    if (e === "FIRM" && sub === "LLP" && bpPresumptive) { warn("LLP_PRESUMPTIVE", "Presumptive taxation (44AD/44ADA) is not available to an LLP; the amount was treated as normal business income.", "warning"); bpBusiness += bpPresumptive; bpPresumptive = Z; }
    const bp = bpBusiness + bpPresumptive;
    line("income_bp", "Profits and gains of business or profession", bp, null, "subtotal");

    // ---- trusts / political parties: exemptions before GTI
    let exemptNote = null, trustTaxable = Z, flatSpecial = Z, flatSpecialRate = null, mmr = false;
    if (e === "TRUST") {
      const income = m("trust_income");
      line("trust_income", "Income from property held for charitable / religious purposes", income);
      if (["CHARITABLE", "FUND_10_23C"].includes(sub)) {
        const applied = m("trust_applied"), accum = m("trust_accumulated"), stat15 = pct(income, cat.accumulation_pct);
        line("trust_applied", "Less: applied to charitable purposes", min(applied, income));
        line("trust_accum_15", `Less: statutory accumulation (${cat.accumulation_pct}%)`, min(stat15, max(Z, income - applied)), cat.verification);
        line("trust_accum_11_2", "Less: accumulated / set apart u/s 11(2) (Form 10)", min(accum, max(Z, income - applied - stat15)));
        trustTaxable = max(Z, income - applied - stat15 - accum);
        if (applied + accum < pct(income, cat.application_pct)) warn("TRUST_85", `Less than ${cat.application_pct}% of income was applied or accumulated; the shortfall is taxable.`, "warning");
        if (m("trust_corpus")) line("trust_corpus", "Corpus donations (exempt, reported in Schedule VC)", m("trust_corpus"), null, "info");
        const anon = m("trust_anonymous"), floor = max(R(cat.anonymous_floor), pct(m("trust_total_donations"), cat.anonymous_pct));
        const anonTaxable = max(Z, anon - floor);
        if (anon) line("anon_taxable", `Anonymous donations above the greater of ₹1 lakh or ${cat.anonymous_pct}% of donations (s.115BBC)`, anonTaxable, cat.verification);
        trustTaxable = max(Z, trustTaxable - anonTaxable);
        flatSpecial = anonTaxable + m("trust_specified_income");
        if (m("trust_specified_income")) line("trust_115bbi", "Specified income u/s 115BBI (violations)", m("trust_specified_income"), cat.verification);
        flatSpecialRate = cat.anonymous_rate;
        line("trust_taxable", "Taxable income after exemption u/s 11 / 10(23C)", trustTaxable, null, "subtotal");
      } else {
        trustTaxable = income;
        if (sub === "PRIVATE_DISCRETIONARY") mmr = true;
        if (sub === "BUSINESS_TRUST") warn("BUSINESS_TRUST", "Business trusts and investment funds pass most income through to unit-holders; only income retained is estimated here at the maximum marginal rate. REQUIRES REVIEW.", "warning"), mmr = true;
      }
    }
    let politicalExempt = false;
    if (e === "POLITICAL") {
      const vc = m("pp_voluntary_contributions");
      if (sub === "POLITICAL_PARTY") {
        const ok = ["pp_books", "pp_donation_records", "pp_audited", "pp_form24a"].every((k) => truthy(v[k]));
        politicalExempt = ok;
        line("pp_contributions", "Voluntary contributions received", vc, null, "info");
        if (ok) { exemptNote = "Income from house property, other sources, capital gains and voluntary contributions is exempt u/s 13A (conditions met)."; warn("S13A_OK", exemptNote, "info"); }
        else { warn("S13A_FAIL", "One or more s.13A conditions are not met, so the party's income is taxable (estimated at the maximum marginal rate as an AOP). REQUIRES REVIEW.", "error"); trustTaxable = vc; mmr = true; }
      } else if (sub === "ELECTORAL_TRUST") {
        const dist = m("et_distributed");
        const okEt = vc === Z || dist >= pct(vc, ENT.POLITICAL.electoral_trust_distribution_pct);
        line("et", `Contributions received / distributed (${ENT.POLITICAL.electoral_trust_distribution_pct}% must be distributed)`, dist, `received ₹${inrPlain(vc)}`, "info");
        if (okEt) { politicalExempt = true; warn("S13B_OK", "Voluntary contributions are exempt u/s 13B (95% distributed). Other income remains taxable.", "info"); }
        else { warn("S13B_FAIL", "Less than 95% of contributions were distributed; contributions are treated as taxable (maximum marginal rate). REQUIRES REVIEW.", "error"); trustTaxable = vc; mmr = true; }
      } else {
        if (truthy(v.s10_conditions_met)) { politicalExempt = true; warn("S10_OK", "Income is treated as exempt because the conditions of the relevant section 10 / 35 clause are met.", "info"); }
        else warn("S10_FAIL", "Exemption conditions not confirmed — income is taxed at normal AOP rates.", "warning");
      }
    }

    let gti = max(Z, hp + os + cgTotal + bp + trustTaxable + flatSpecial);
    if (e === "POLITICAL" && politicalExempt) {
      if (sub === "POLITICAL_PARTY") gti = max(Z, bp);
      else if (sub === "ELECTORAL_TRUST") gti = max(Z, hp + os + cgTotal + bp);
      else gti = Z;
    }
    line("gross_total_income", "Gross total income", gti, null, "total");

    // ---- deductions allowed
    const lim = RU.deduction_limits;
    let allowed = [];
    if (e === "COMPANY") allowed = option === "115BAA" || option === "115BAB" ? ["d_80jjaa", "d_80m"] : option === "115BA" ? ["d_80g", "d_80jjaa", "d_80m"] : ["d_80g", "d_80jjaa", "d_80ia_group", "d_80m"];
    else if (e === "FIRM") allowed = ["d_80g", "d_80jjaa", "d_80ia_group"];
    else if (e === "COOP_AOP" && sub === "COOP") allowed = option === "normal" ? ["d_80g", "d_80jjaa", "d_80ia_group", "d_80p"] : ["d_80jjaa"];
    else if (e === "COOP_AOP") allowed = option === "new" ? ["d_80jjaa"] : option === "old" ? ["d_80g", "d_80jjaa", "d_80ia_group"] : ["d_80g", "d_80jjaa", "d_80ia_group"];
    const special = stcg + ltcg112a + ltcg112;
    const dedOut = {}; const ignored = [];
    for (const k of ["d_80g", "d_80jjaa", "d_80ia_group", "d_80m", "d_80p"]) {
      const a = m(k); if (!a) continue;
      if (!allowed.includes(k)) { ignored.push(lim[k] ? lim[k].section : k); continue; }
      dedOut[k] = a;
    }
    if (ignored.length) warn("DEDUCTIONS_NOT_ALLOWED", `Not allowed for this category / option and ignored: ${ignored.join(", ")}.`, "info");
    let ded = Object.values(dedOut).reduce((a, b) => a + b, Z);
    if (ded > gti - special) { warn("DEDUCTIONS_CAPPED", "Deductions cannot exceed gross total income excluding special-rate gains; they were limited.", "info"); ded = max(Z, gti - special); }
    for (const [k, a] of Object.entries(dedOut)) line(k, "Deduction u/s " + lim[k].section, a, lim[k].verification);
    line("total_deductions", "Total deductions (Chapter VI-A)", ded, null, "subtotal");
    const ti = roundTo(max(Z, gti - ded), RU.rounding.total_income_nearest);
    line("total_income", "Total income (rounded to nearest ₹10)", ti, null, "total");

    // ---- tax at normal / special rates
    const cg = RU.capital_gains;
    let normalIncome = max(Z, ti - special - flatSpecial);
    const ltcgTaxable = max(Z, ltcg112a - R(cg.ltcg_112a_exemption));
    const specialTax = pct(stcg, cg.stcg_111a_rate) + pct(ltcgTaxable, cg.ltcg_112a_rate) + pct(ltcg112, cg.ltcg_112_other_rate) + (flatSpecialRate ? pct(flatSpecial, flatSpecialRate) : Z);
    let normalTax = Z, rateNote = "", surTable = [], flatSur = null, capSpecial = RU.special_surcharge_cap_rate;
    const slabTaxOf = (inc, slabs) => E.slabTax(inc, slabs);
    if (e === "COMPANY") {
      if (sub === "FOREIGN") { normalTax = pct(normalIncome, cat.foreign_rate); rateNote = `${cat.foreign_rate}% (foreign company)`; surTable = cat.surcharge_foreign; capSpecial = 100; }
      else if (option === "115BAA") { normalTax = pct(normalIncome, cat.rate_115BAA); rateNote = "22% u/s 115BAA"; flatSur = cat.surcharge_concessional; }
      else if (option === "115BAB") {
        const busi = min(normalIncome, bpBusiness); normalTax = pct(busi, cat.rate_115BAB_business) + pct(normalIncome - busi, cat.rate_115BAB_other);
        rateNote = "15% on manufacturing business income, 22% on other income (s.115BAB)"; flatSur = cat.surcharge_concessional;
      } else if (option === "115BA") { normalTax = pct(normalIncome, cat.rate_115BA); rateNote = "25% u/s 115BA"; surTable = cat.surcharge_domestic; capSpecial = 100; }
      else {
        const t23 = toPaise(v.turnover_2324);
        const small = v.turnover_2324 !== undefined && v.turnover_2324 !== null && v.turnover_2324 !== "" && t23 <= R(cat.domestic_rate_small_turnover_limit);
        if (v.turnover_2324 === undefined || v.turnover_2324 === null || v.turnover_2324 === "") warn("TURNOVER_2324", "Turnover of the reference year is not entered — 30% was used. Companies with turnover up to ₹400 crore pay 25%.", "warning");
        const rate = small ? cat.domestic_rate_small : cat.domestic_rate;
        normalTax = pct(normalIncome, rate); rateNote = `${rate}% (domestic company${small ? ", turnover ≤ ₹400 crore" : ""})`; surTable = cat.surcharge_domestic; capSpecial = 100;
      }
      if (sub === "FOREIGN" && option !== "normal") warn("FCO_OPTION", "Concessional options apply to domestic companies only.", "info");
    } else if (e === "FIRM") { normalTax = pct(normalIncome, cat.rate); rateNote = `${cat.rate}% (firm / LLP)`; surTable = cat.surcharge; capSpecial = 100; }
    else if (e === "COOP_AOP" && sub === "LOCAL_AUTHORITY") { normalTax = pct(normalIncome, cat.local_authority_rate); rateNote = "30% (local authority)"; surTable = cat.local_authority_surcharge; capSpecial = 100; }
    else if (e === "COOP_AOP" && sub === "COOP") {
      if (option === "115BAD") { normalTax = pct(normalIncome, cat.rate_115BAD); rateNote = "22% u/s 115BAD"; flatSur = cat.surcharge_concessional; }
      else if (option === "115BAE") { const busi = min(normalIncome, bpBusiness); normalTax = pct(busi, cat.rate_115BAE) + pct(normalIncome - busi, cat.rate_115BAD); rateNote = "15% on manufacturing income, 22% on other income (s.115BAE)"; flatSur = cat.surcharge_concessional; warn("115BAE_OTHER", "Under 115BAE, income not derived from manufacturing is taken at 22% here — REQUIRES REVIEW.", "info"); }
      else { normalTax = slabTaxOf(normalIncome, cat.coop_slabs); rateNote = "Co-operative slabs 10% / 20% / 30%"; surTable = cat.coop_surcharge; capSpecial = 100; }
    } else {
      // AOP / BOI / AJP, trusts and political parties taxed as AOP
      const reg = RU.regimes[option === "old" ? "old" : "new"];
      const shareRule = e === "COOP_AOP" && ["AOP", "BOI"].includes(sub);
      if (shareRule && (!truthy(v.aop_shares_determinate) || truthy(v.aop_member_above_be))) {
        mmr = true;
        warn("AOP_MMR", !truthy(v.aop_shares_determinate) ? "Members' shares are indeterminate or unknown, so income is taxed at the maximum marginal rate." : "A member's income exceeds the basic exemption limit, so the AOP/BOI is taxed at the maximum marginal rate.", "warning");
      }
      if (mmr) { normalTax = pct(normalIncome, cat.mmr_rate || ENT.COOP_AOP.mmr_rate); rateNote = `Maximum marginal rate ${ENT.COOP_AOP.mmr_rate}%`; }
      else { normalTax = slabTaxOf(normalIncome, reg.slabs.below_60 || reg.slabs.all_ages); rateNote = `${option === "old" ? "Old" : "New"}-regime slab rates (as AOP)`; }
      surTable = reg.surcharge;
      if (e === "COOP_AOP" && sub === "AOP" && truthy(v.aop_members_only_companies)) surTable = surTable.filter((s) => s.rate <= ENT.COOP_AOP.aop_company_members_surcharge_cap);
      if (e === "TRUST" || e === "POLITICAL") warn("AOP_RATES_TRUST", "Taxable income of trusts / political parties is estimated at AOP rates — REQUIRES REVIEW.", "info");
    }
    line("tax_normal", `Tax on income at normal rates — ${rateNote}`, normalTax, cat.verification);
    line("tax_special", "Tax on special-rate income (111A / 112A / 112" + (flatSpecialRate ? " / 115BBC / 115BBI" : "") + ")", specialTax, cg.verification);
    const taxBefore = normalTax + specialTax;

    // ---- surcharge with marginal relief
    let sur = Z, srate = 0;
    if (flatSur !== null) { sur = pct(taxBefore, flatSur); srate = flatSur; }
    else {
      for (const s of surTable) if (ti > R(s.above)) srate = s.rate;
      sur = pct(normalTax, srate) + pct(specialTax, Math.min(srate, capSpecial));
      if (srate > 0) {
        const th = surTable.filter((s) => ti > R(s.above)).map((s) => R(s.above)).reduce((a, b) => max(a, b));
        const lower = surTable.filter((s) => th > R(s.above)).map((s) => s.rate).reduce((a, b) => Math.max(a, b), 0);
        const ratio = ti > Z ? th * 1000000000000n / ti : Z; // tax at threshold, approximated proportionally for flat-rate entities
        const taxAtTh = mmr || ["COMPANY", "FIRM"].includes(e) || sub === "LOCAL_AUTHORITY" ? (taxBefore * ratio) / 1000000000000n : (e === "COOP_AOP" && sub === "COOP" ? slabTaxOf(th, ENT.COOP_AOP.coop_slabs) : slabTaxOf(th, RU.regimes[option === "old" ? "old" : "new"].slabs.below_60 || RU.regimes.new.slabs.all_ages));
        const limit = taxAtTh + pct(taxAtTh, lower) + (ti - th);
        if (taxBefore + sur > limit) { const mr = min(sur, taxBefore + sur - limit); line("marginal_relief_surcharge", "Less: marginal relief on surcharge", mr); sur -= mr; }
      }
    }
    line("surcharge", `Surcharge @ ${srate}%`, sur, flatSur !== null ? "Flat 10% for the concessional option" : null);
    const cess = pct(taxBefore + sur, RU.cess_rate);
    line("cess", `Health & Education Cess @ ${RU.cess_rate}%`, cess);
    let grossTax = taxBefore + sur + cess;

    // ---- MAT (companies) / AMT (non-corporate)
    if (e === "COMPANY" && !cat.mat_not_for.includes(option) && m("book_profit") > Z) {
      const bpf = m("book_profit"); const matTax = pct(bpf, cat.mat_rate);
      let ms = 0; for (const s of (sub === "FOREIGN" ? cat.surcharge_foreign : cat.surcharge_domestic)) if (bpf > R(s.above)) ms = s.rate;
      const matTotal = matTax + pct(matTax, ms) + pct(matTax + pct(matTax, ms), RU.cess_rate);
      line("mat", `MAT @ ${cat.mat_rate}% of book profit ₹${inrPlain(bpf)} (s.115JB)`, matTotal, cat.verification);
      if (matTotal > grossTax) { warn("MAT_APPLIES", "MAT is higher than tax at normal rates and becomes payable. The difference is MAT credit (Schedule MATC), usable in later years.", "warning"); grossTax = matTotal; }
    } else if (e === "COMPANY" && cat.mat_not_for.includes(option)) warn("NO_MAT", `MAT does not apply under section ${option}.`, "info");
    const amtBase = (dedOut.d_80ia_group || Z) + (["FIRM", "COOP_AOP", "TRUST"].includes(e) ? m("amt_addbacks") : Z);
    const amtEligible = (e === "FIRM") || (e === "COOP_AOP" && (sub === "COOP" ? option === "normal" : sub !== "LOCAL_AUTHORITY" && option === "old"));
    if (amtEligible && amtBase > Z) {
      const ati = ti + amtBase;
      const threshold = e === "FIRM" || sub === "COOP" ? Z : R(RU.amt.threshold_ind_huf_aop);
      if (ati > threshold) {
        const rate = sub === "COOP" ? RU.amt.rate_coop : RU.amt.rate;
        const amtTax = pct(ati, rate); let as = 0; for (const s of surTable) if (ati > R(s.above)) as = s.rate;
        const amtTotal = amtTax + pct(amtTax, as) + pct(amtTax + pct(amtTax, as), RU.cess_rate);
        line("amt", `AMT @ ${rate}% of adjusted total income ₹${inrPlain(ati)} (s.115JC)`, amtTotal, RU.amt.verification);
        if (amtTotal > grossTax) { warn("AMT_APPLIES", "AMT is higher than normal tax and becomes payable; the excess is AMT credit (Schedule AMTC).", "warning"); grossTax = amtTotal; }
      }
    }
    const liability = roundTo(grossTax, RU.rounding.tax_nearest);
    line("total_tax_liability", "Total tax liability (rounded to nearest ₹10)", liability, null, "total");

    // ---- taxes paid, interest, fee (same rules for every person)
    const tds = m("tds_other"), tcs = m("tcs");
    const advQ = [1, 2, 3, 4].map((i) => m("advance_tax_q" + i)); const adv = advQ.reduce((a, b) => a + b, Z), sat = m("self_assessment_tax");
    line("tds", "TDS", tds); line("tcs", "TCS", tcs); line("advance_tax", "Advance tax", adv); line("self_assessment_tax", "Self-assessment tax", sat);
    const filing = v.filing_date || todayStr;
    const due = dueDateFor(RU, v, profile);
    const it = RU.interest; const assessed = max(Z, liability - tds - tcs);
    const after = (a, b) => parseDate(a).t > parseDate(b).t;
    let i234a = Z, i234b = Z, i234c = Z;
    if (after(filing, due)) i234a = pct(floorTo(max(Z, assessed - adv), 100), it.s234a_rate_pct_per_month * monthsOrPart(addDays(due, 1), filing));
    const thr = R(it.advance_tax_threshold);
    if (assessed >= thr && adv < pct(assessed, it.s234b_paid_pct_required)) i234b = pct(floorTo(assessed - adv, 100), it.s234b_rate_pct_per_month * monthsOrPart(addDays(RU.fy_end, 1), filing));
    if (assessed >= thr) {
      let cum = Z;
      it.s234c_schedule.forEach((sch, idx) => {
        cum += advQ[idx]; const need = pct(assessed, sch.cum_pct);
        if (cum < pct(assessed, sch.min_pct) || (sch.min_pct === sch.cum_pct && cum < need)) i234c += pct(floorTo(need - cum, 100), it.s234c_rate_pct_per_month * sch.months);
      });
    }
    const interestTotal = roundTo(i234a + i234b + i234c, 1);
    line("interest_234a", "Interest u/s 234A (late filing)", i234a, it.verification);
    line("interest_234b", "Interest u/s 234B (advance-tax shortfall)", i234b, it.verification);
    line("interest_234c", "Interest u/s 234C (deferment of instalments)", i234c, it.verification);
    let fee = Z; const lf = RU.late_fee_234f;
    if (after(filing, due)) {
      fee = ti <= R(lf.small_income_limit) ? R(lf.fee_small_income) : R(lf.fee);
      const last = RU.deadlines.belated_return_last_date;
      if (after(filing, last)) warn("PAST_BELATED", `The planned filing date is after the last date for a belated return (${fmtDate(last)}).`, "error");
      else warn("BELATED", `The due date (${fmtDate(due)}) has passed. This would be a belated return u/s 139(4).`, "warning");
    } else warn("ON_TIME", `Due date for this category: ${fmtDate(due)}.`, "info");
    line("fee_234f", "Late filing fee u/s 234F", fee, lf.verification);
    const netAmt = roundTo(liability + interestTotal + fee - tds - tcs - adv - sat, 10);
    line("refund_or_payable", netAmt > Z ? "Tax payable" : netAmt < Z ? "Refund due" : "Nothing payable", abs(netAmt), null, "total");
    const s = rupeesStr;
    const summary = {
      gross_total_income: s(gti), total_deductions: s(ded), total_income: s(ti), tax_normal: s(normalTax), tax_special: s(specialTax), rebate_87a: "0",
      surcharge: s(sur), cess: s(cess), total_tax_liability: s(liability), tds: s(tds), tcs: s(tcs), advance_tax: s(adv), self_assessment_tax: s(sat),
      interest_234: s(interestTotal), fee_234f: s(fee), net: s(netAmt), status: netAmt > Z ? "payable" : netAmt < Z ? "refund" : "nil",
      income_salary: "0", income_hp: s(hp), income_os: s(os), income_cg: s(cgTotal), income_bp: s(bp), std_deduction: "0",
      age: null, age_band: null, filing_date: filing, due_date: due, refund_or_payable: s(abs(netAmt)),
    };
    return { assessment_year: ay, regime: option, summary, lines, warnings, disclaimer: "Estimate only. The e-Filing portal's computation is authoritative." };
  }

  // ------------------------------------------------------------------ ITR selection for every category
  function selectItrFor(profile, values, ay, totalIncome) {
    const RU = root.ITH_DATA.rules[ay]; const L = RU.itr_limits; const e = profile.entity, sub = profile.subtype, v = values;
    const src = RU.entities[e].source, ver = RU.entities[e].verification;
    const done = (rec, why, rejected) => ({ recommended: rec, why, rejected, unanswered_questions: [], note: null, source: src, verification: ver,
      portal_status: RU.entities[e].portal_status });
    if (e === "IND_RES" || e === "IND_NR") {
      const r = E.selectItr(v, ay, totalIncome); r.portal_status = "Individual";
      if (e === "IND_NR" && (v.residential_status || "") === "RES") r.note = (r.note ? r.note + " " : "") + "Your residential status is 'Resident' — use the Individual — Resident category instead.";
      return r;
    }
    if (e === "HUF") {
      const r = E.selectItr(v, ay, totalIncome);
      if (r.recommended === "ITR-1") {
        const presumptive = toPaise(v.bp_presumptive) > Z;
        r.recommended = presumptive ? "ITR-4" : "ITR-2";
        r.rejected["ITR-1"] = ["ITR-1 is only for individuals"];
        delete r.rejected[r.recommended];
        r.why = r.recommended === "ITR-2" ? ["HUF without business or professional income", "ITR-1 is not available to HUFs"] : r.why;
      } else if (r.rejected["ITR-1"]) r.rejected["ITR-1"].unshift("ITR-1 is only for individuals");
      r.portal_status = "HUF";
      return r;
    }
    const ti = totalIncome !== undefined ? toPaise(totalIncome) : Z;
    if (e === "COMPANY") return done("ITR-6", ["Companies (domestic and foreign) file ITR-6 unless they claim exemption u/s 11"], { "ITR-7": ["Only for companies claiming exemption u/s 11 / required to file u/s 139(4A)-(4D)"], "ITR-5": ["Not for companies"] });
    if (e === "FIRM") {
      const blocks = [];
      if (sub === "LLP") blocks.push("ITR-4 is not available to LLPs");
      if ((v.residential_status || "RES") !== "RES") blocks.push("the firm is not resident");
      if (!(toPaise(v.bp_presumptive) > Z)) blocks.push("no presumptive income (44AD/44ADA/44AE)");
      if (toPaise(v.bp_regular) > Z) blocks.push("business income is not presumptive");
      if (ti > R(L.itr4_income_limit)) blocks.push(`total income exceeds ₹${inrPlain(R(L.itr4_income_limit))}`);
      if (toPaise(v.cg_stcg_111a) + toPaise(v.cg_stcg_other) + toPaise(v.cg_ltcg_112) > Z) blocks.push("capital gains other than LTCG u/s 112A");
      if (toPaise(v.cg_ltcg_112a) > R(L.itr1_ltcg112a_limit)) blocks.push("LTCG u/s 112A above ₹1.25 lakh");
      if (truthy(v.has_bf_losses)) blocks.push("losses brought / carried forward");
      if (toPaise(v.agri_income) > R(L.itr1_agri_limit)) blocks.push("agricultural income above ₹5,000");
      if (!blocks.length) return done("ITR-4", ["Resident firm (not LLP) with presumptive income", "total income within ₹50 lakh"], { "ITR-5": ["ITR-4 is simpler and allowed; ITR-5 may be used instead (ITR-4 is optional)"] });
      return done("ITR-5", ["Firms and LLPs file ITR-5 when ITR-4 is not available"], { "ITR-4": blocks });
    }
    if (e === "TRUST") {
      if (["CHARITABLE", "FUND_10_23C"].includes(sub)) return done("ITR-7", [sub === "CHARITABLE" ? "Trust claiming exemption u/s 11 — return u/s 139(4A)" : "Fund / institution u/s 10(23C) — return u/s 139(4C)"], { "ITR-5": ["Not for persons required to file u/s 139(4A)/(4C)"] });
      return done("ITR-5", [sub === "BUSINESS_TRUST" ? "Business trusts and investment funds are listed as AOP/BOI sub-statuses in ITR-5 for AY 2026-27" : "Trusts not eligible for ITR-7 file ITR-5 (taxed as AOP)"], { "ITR-7": ["Only for 139(4A)/(4B)/(4C)/(4D) filers"] });
    }
    if (e === "COOP_AOP") return done("ITR-5", [`${RU.entities.COOP_AOP.subtypes[sub]} files ITR-5`], { "ITR-7": ["Only if required to file u/s 139(4A)-(4D) or claiming unconditional exemption"], "ITR-6": ["Only for companies"] });
    if (e === "POLITICAL") {
      const sec = { POLITICAL_PARTY: "139(4B)", ELECTORAL_TRUST: "139(4A)", SECTION_10: "139(4C)", UNIVERSITY_35: "139(4D)" }[sub];
      return done("ITR-7", [`Return furnished u/s ${sec}` + (sub === "POLITICAL_PARTY" ? " — Schedule PP" : sub === "ELECTORAL_TRUST" ? " — Schedule ET" : "")], { "ITR-5": ["Not for persons required to file u/s 139(4A)/(4B)/(4D)"] });
    }
    return done("ITR-5", ["Default for other persons"], {});
  }

  // ------------------------------------------------------------------ residential status (s.6) — individuals
  function residentialStatus(v) {
    const n = (k) => (v[k] === undefined || v[k] === null || v[k] === "" ? null : Number(v[k]));
    const days = n("rs_days_py"), d4 = n("rs_days_4py"), d7 = n("rs_days_7py"), nr10 = n("rs_nr_years_10");
    const citizen = truthy(v.rs_citizen_or_pio), left = truthy(v.rs_left_for_employment), hi = truthy(v.rs_indian_income_above_15l), taxedElsewhere = truthy(v.rs_liable_tax_elsewhere);
    if (days === null) return { status: null, reasons: ["Enter the number of days you were in India during FY 2025-26."] };
    const reasons = [];
    let resident = false;
    if (days >= 182) { resident = true; reasons.push(`${days} days in India (182 or more)`); }
    else {
      let threshold = 60;
      if (left) threshold = 182;
      else if (citizen) threshold = hi ? 120 : 182;
      if (threshold < 182 && days >= threshold && d4 !== null && d4 >= 365) { resident = true; reasons.push(`${days} days (≥ ${threshold}) this year and ${d4} days (≥ 365) in the 4 years before`); }
      else reasons.push(`${days} days does not meet the ${threshold === 182 ? "182-day" : threshold + "-day + 365-day"} test${citizen ? " applicable to Indian citizens / PIOs" : ""}`);
      if (!resident && hi && citizen && threshold === 120 && days >= 120 && d4 !== null && d4 >= 365) resident = true;
    }
    let deemed = false;
    if (!resident && citizen && hi && !taxedElsewhere) { deemed = true; reasons.push("Deemed resident u/s 6(1A): Indian citizen with Indian income above ₹15 lakh and not liable to tax in any other country"); }
    if (!resident && !deemed) return { status: "NR", reasons };
    // ordinarily resident?
    if (deemed) return { status: "RNOR", reasons: reasons.concat(["Deemed residents are 'not ordinarily resident'"]) };
    if (citizen && hi && days >= 120 && days < 182) return { status: "RNOR", reasons: reasons.concat(["Citizen / PIO visiting India with Indian income above ₹15 lakh and 120–181 days is RNOR"]) };
    if (nr10 !== null && nr10 >= 9) return { status: "RNOR", reasons: reasons.concat([`Non-resident in ${nr10} of the 10 preceding years (9 or more)`]) };
    if (d7 !== null && d7 <= 729) return { status: "RNOR", reasons: reasons.concat([`${d7} days in India in the 7 preceding years (729 or less)`]) };
    if (nr10 === null || d7 === null) return { status: "RES", reasons: reasons.concat(["Enter the 10-year and 7-year history to check RNOR status; treated as ordinarily resident for now"]) };
    return { status: "RES", reasons: reasons.concat(["Not RNOR: fewer than 9 non-resident years and more than 729 days in the 7 preceding years"]) };
  }

  // ------------------------------------------------------------------ is filing compulsory?
  function filingRequirement(profile, v, res, ay) {
    const RU = root.ITH_DATA.rules[ay]; const e = profile.entity; const reasons = [];
    if (RU.filing_requirement.always_file.includes(e)) return { required: true, reasons: [`Every ${RU.entities[e].short.toLowerCase()} must file a return, even with a loss or nil income (s.139(1)).`] };
    const gti = toPaise(res.summary.gross_total_income);
    const slabs = RU.regimes[res.regime === "old" ? "old" : "new"].slabs;
    let be = R((slabs.all_ages || slabs.below_60)[0].upto);
    if (["IND_RES", "IND_NR"].includes(e) && res.regime === "old" && res.summary.age_band && slabs[res.summary.age_band]) be = R(slabs[res.summary.age_band][0].upto);
    if (e === "COOP_AOP" && profile.subtype === "COOP") be = Z;
    if (["TRUST", "POLITICAL"].includes(e)) {
      const before = toPaise(v.trust_income) + toPaise(v.pp_voluntary_contributions) + toPaise(res.summary.income_hp) + toPaise(res.summary.income_os) + toPaise(res.summary.income_cg) + toPaise(res.summary.income_bp);
      if (before > be) reasons.push(`Income before exemption (₹${inrPlain(before)}) exceeds the basic exemption limit — return compulsory u/s ${e === "POLITICAL" && profile.subtype === "POLITICAL_PARTY" ? "139(4B)" : "139(4A)/(4C)/(4D)"}`);
    } else if (gti > be) reasons.push(`Gross total income ₹${inrPlain(gti)} exceeds the basic exemption limit ₹${inrPlain(be)}`);
    if (["IND_RES", "IND_NR", "HUF"].includes(e)) {
      const senior = res.summary.age_band && res.summary.age_band !== "below_60" && (v.residential_status || "RES") !== "NR";
      const tdsTcs = toPaise(v.tds_salary) + toPaise(v.tds_other) + toPaise(v.tcs);
      for (const c of RU.filing_requirement.seventh_proviso) {
        if (c.field === "tds_tcs_total") { const lim = R(senior ? c.atleast_senior : c.atleast); if (tdsTcs >= lim) reasons.push(c.label); continue; }
        if (c.when === "business" && truthy(v.is_profession)) continue;
        if (c.when === "profession" && !truthy(v.is_profession)) continue;
        const val = toPaise(v[c.field]);
        if ((c.above !== undefined && val > R(c.above)) || (c.atleast !== undefined && val >= R(c.atleast))) reasons.push(c.label + " (seventh proviso to s.139(1))");
      }
    }
    return { required: reasons.length ? true : false, reasons: reasons.length ? reasons : ["Income is within the exemption limit and no seventh-proviso condition is met — filing is optional (it is still needed to claim a refund or carry forward a loss)."] };
  }

  root.ITHEntities = { categories, optionsFor, defaultOption, computeFor, computeEntity, selectItrFor, residentialStatus, filingRequirement };
  if (typeof module !== "undefined") module.exports = root.ITHEntities;
})(typeof window !== "undefined" ? window : globalThis);
