/* Preparation worksheet generation in the browser — no external libraries.
   PDF: hand-built PDF 1.4 with standard Helvetica fonts (selectable text).
   DOCX: hand-built Office Open XML in an uncompressed ZIP (editable text).
   Never presented as an official return. */
(function (root) {
  "use strict";
  const WIDTHS = {"Helvetica": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500], "Helvetica-Bold": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556]}; // Helvetica / Helvetica-Bold widths per WinAnsi code (1/1000 em)
  const TITLE = "MY IT HERO", SUBTITLE = "Income Tax Return Preparation Worksheet", NOT_OFFICIAL = "NOT AN OFFICIAL INCOME TAX RETURN";
  const FOOTER = "Preparation aid only — not an official Income Tax Return. Verify information on the Government of India's e-Filing portal before submission.";

  function inr(v) {
    if (v === null || v === undefined || v === "") return "";
    const n = Math.round(Number(v)); if (!isFinite(n)) return String(v);
    let s = String(Math.abs(n));
    if (s.length > 3) { let h = s.slice(0, -3); const t = s.slice(-3); const g = []; while (h.length > 2) { g.unshift(h.slice(-2)); h = h.slice(0, -2); } if (h) g.unshift(h); s = g.join(",") + "," + t; }
    return (n < 0 ? "-" : "") + "Rs " + s;
  }
  function fmtValue(f) {
    const v = f.value;
    if (v === null || v === undefined || v === "") return "—";
    if (f.data_type === "money") return inr(v);
    if (f.data_type === "bool") return v === "true" ? "Yes" : "No";
    if (f.data_type === "date" && String(v).length === 10) { const [y, m, d] = String(v).split("-"); return `${d}/${m}/${y}`; }
    return String(v);
  }
  function istNow() {
    const d = new Date(Date.now() + 5.5 * 3600000);
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
    let h = d.getUTCHours(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return `${String(d.getUTCDate()).padStart(2, "0")} ${mon} ${d.getUTCFullYear()}, ${String(h).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} ${ap} IST`;
  }

  // Portal break-ups read from Form 16 / Form 12BA (filled by the auto-fill step); [] when there are none
  function docSections(sum, calc) {
    if (!sum || !sum.employers || !sum.employers.length) return [];
    const out = [], R = (v) => (v === null || v === undefined || v === "" ? "—" : inr(v));
    const C = (v) => (v === null || v === undefined || v === "" ? "—" : String(Math.round(Number(v)))); // plain digits — what the portal's number boxes accept
    const SAL = "Gross Total Income › Salary";
    for (const e of sum.employers) {
      const who = `${e.name || "Employer"}${e.tan ? " (TAN " + e.tan + ")" : ""}`;
      out.push({ title: `Salary — ${who}`, intro: `Portal: ${SAL} › Add details for this employer. Period ${e.period_from ? e.period_from.split("-").reverse().join("/") : "—"} to ${e.period_to ? e.period_to.split("-").reverse().join("/") : "—"}. Read from: ${e.documents.join(", ")}.`,
        head: ["Portal field", "Amount (copy)", "Form 16 reference"], widths: [0.5, 0.2, 0.3],
        rows: [["Name of employer", e.name || "—", "Part A / Part B header"], ["TAN of employer", e.tan || "—", "Part A / Part B header"],
          ["Salary as per section 17(1)", C(e.salary_17_1), "Part B item 1(a)"], ["Value of perquisites as per section 17(2)", C(e.perquisites_17_2), "Part B item 1(b) / Form 12BA row 21"],
          ["Profits in lieu of salary as per section 17(3)", C(e.profits_17_3), "Part B item 1(c)"], ["Less: allowances exempt u/s 10", C(e.exempt_total), "Part B item 2(i)"],
          ["Standard deduction u/s 16(ia)", C(e.std_deduction), "Part B item 4(a)"], ["Professional tax u/s 16(iii)", C(e.professional_tax), "Part B item 4(c)"],
          ["Income chargeable under the head Salaries", C(e.income_salary), "Part B item 6"]] });
      if (e.perquisites.length) out.push({ title: `Nature of perquisites u/s 17(2) — ${e.name || "employer"}`,
        intro: `Portal: ${SAL} › Value of perquisites as per section 17(2) › choose each nature from the drop-down and enter the amount. Source: Form 12BA column 5 (value − amount recovered), rounded to rupees.`,
        head: ["Nature (drop-down)", "Value", "Recovered", "Amount (copy)"], widths: [0.52, 0.16, 0.16, 0.16],
        rows: e.perquisites.map((p) => [p.nature, R(p.value), R(p.recovered), C(p.chargeable) + (p.adjusted ? " *" : "")]).concat([["Total (equals the 17(2) figure)", "", "", C(e.perquisites.reduce((a, p) => a + Number(p.chargeable), 0))]]),
        foot: e.perquisites.some((p) => p.adjusted) ? "* adjusted by ₹1 so the lines add up to the rounded 17(2) total." : null });
      if (e.exemptions.length) out.push({ title: `Exempt allowances u/s 10 — ${e.name || "employer"}`, intro: `Portal: ${SAL} › Allowances to the extent exempt u/s 10 › choose the nature and enter the amount.`,
        head: ["Nature", "Amount (copy)"], widths: [0.75, 0.25], rows: e.exemptions.map((x) => [x.label, C(x.amount)]) });
    }
    const tdsRows = sum.employers.filter((e) => e.tds !== null && e.tds !== undefined);
    if (tdsRows.length) out.push({ title: "TDS on salary (Schedule TDS1)", intro: "Portal: Tax Paid › TDS on Salary. Usually pre-filled from Form 26AS; check each row matches.",
      head: ["TAN of employer", "Name of employer", "Income chargeable under Salaries (copy)", "Total tax deducted (copy)"], widths: [0.2, 0.34, 0.23, 0.23],
      rows: tdsRows.map((e) => [e.tan || "—", e.name || "—", C(e.income_salary !== null ? e.income_salary : e.amount_paid), C(e.tds)]) });
    const ec = sum.employer_computation;
    if (ec && calc && calc.summary) {
      const s = calc.summary, row = (label, theirs, ours) => [label, R(theirs), R(ours), theirs === null || theirs === undefined ? "—" : Math.abs(Number(theirs) - Number(ours)) <= 10 ? "Match" : "Differs"];
      out.push({ title: "Your employer's computation vs this worksheet", intro: `Form 16 Part B (${sum.employer_computation_of || "employer"}) compared with the calculation above. Small differences come from rounding; large ones mean other income or deductions were added here.`,
        head: ["Item", "Form 16 Part B", "This worksheet", "Check"], widths: [0.4, 0.2, 0.2, 0.2],
        rows: [row("Income chargeable under Salaries", ec.income_salary, s.income_salary), row("Gross total income", ec.gross_total_income, s.gross_total_income),
          row("Deductions under Chapter VI-A", ec.via_total, s.total_deductions), row("Total taxable income", ec.total_income, s.total_income),
          row("Tax on total income", ec.tax_on_total_income, s.tax_normal), row("Rebate u/s 87A", ec.rebate_87a, s.rebate_87a),
          row("Tax payable (after rebate, with cess)", ec.tax_payable, s.total_tax_liability)] });
    }
    return out;
  }

  function worksheetData(ay, regime, calc, mapping, docs, user, conflicts, docSummary) {
    const s = calc.summary;
    return {
      ay, fy: calc.financial_year, regime: regime === "new" ? "New Tax Regime (s.115BAC)" : regime === "old" ? "Old Tax Regime" : (calc.option_label || regime), regime_key: regime,
      category: calc.profile ? `${calc.profile.category} — ${calc.profile.subtype_label}` : "Individual — Resident", return_label: calc.profile ? calc.profile.label : "",
      portal_status: (calc.itr && calc.itr.portal_status) || (calc.profile && calc.profile.portal_status) || "Individual", due_date: s.due_date,
      filing_requirement: calc.filing_requirement || null,
      itr: calc.itr, summary: s, lines: calc.lines, warnings: calc.warnings, mapping: mapping.fields, mapping_disclaimer: mapping.disclaimer,
      mapping_version: mapping.mapping_version, portal_url: mapping.portal_url, docs,
      pending: mapping.fields.filter((f) => ["Needs Review", "Warning", "Error", "Missing"].includes(f.status)), conflicts,
      prepared_at: istNow(), email: user.email, doc_sections: docSections(docSummary, calc), doc_checks: docSummary ? docSummary.checks || [] : [],
      assumptions: [
        `Taxpayer category: ${calc.profile ? calc.profile.category + " — " + calc.profile.subtype_label : "Individual — Resident"}.`,
        `Interest u/s 234A/B/C and fee u/s 234F estimated for a filing date of ${s.filing_date} (non-audit due date ${s.due_date}).`,
        "Self-assessment tax is treated as paid on the filing date.",
        "Values marked UNVERIFIED in the rule set have not been confirmed against official text and require review.",
        "The e-Filing portal's own computation is authoritative; where it differs, investigate before submitting.",
      ],
      steps: [
        "Sign in at incometax.gov.in and open e-File > Income Tax Returns > File Income Tax Return.",
        `Select Assessment Year ${ay}, mode Online, status '${(calc.itr && calc.itr.portal_status) || (calc.profile && calc.profile.portal_status) || "Individual"}', and the form ${calc.itr.recommended}. Then tick the reason for filing${calc.filing_requirement && calc.filing_requirement.required ? "" : " (e.g. to claim a refund)"}.`,
        "Check the pre-filled values against this worksheet; edit only where your documents support a different value.",
        ["new", "old"].includes(regime) ? "Choose the tax regime you used here when the portal asks (new regime is the default; business cases opting out need Form 10-IEA by the due date)." : `Confirm the tax option '${calc.option_label || regime}' in Part A-GEN (and that its form — 10-IB / 10-IC / 10-ID / 10-IF / 10-IFA — was filed by the due date, where applicable).`,
        "Compare the portal's computed tax with this worksheet. Investigate any difference before paying or submitting.",
        `Pay any balance via e-Pay Tax (self-assessment tax), add the challan details, then submit and e-verify within ${(root.ITH_DATA && root.ITH_DATA.rules[ay].deadlines.everify_days) || 30} days — an unverified return is treated as invalid.`,
      ],
    };
  }
  const statusText = (s) => ({ refund: "Refund due", payable: "Tax payable", nil: "Nothing payable" }[s.status]);
  function locText(f) {
    return ((f.section ? f.section + " › " : "") + (f.portal_label || "—") + ((f.mapping_verification || "").startsWith("VERIFIED") ? "" : "  [label unverified]"));
  }
  function srcText(f) {
    if (f.value === null || f.value === undefined || f.value === "") return "—";
    return (f.source_document || "manual entry") + (f.source_page ? ` p.${f.source_page}` : "");
  }

  // =============================================================== PDF
  const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b,
    0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99,
    0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
  function toWin(str) {
    const out = [];
    for (const ch of String(str).replace(/₹\s?/g, "Rs ").replace(/−/g, "-").replace(/≥/g, ">=").replace(/✓/g, "OK -").replace(/✗/g, "CHECK -")) {
      const c = ch.codePointAt(0);
      if (c >= 32 && c < 127) out.push(c);
      else if (CP1252[c]) out.push(CP1252[c]);
      else if (c >= 0xa0 && c <= 0xff) out.push(c);
      else out.push(63); // '?'
    }
    return out;
  }
  function textWidth(codes, bold, size) { const w = WIDTHS[bold ? "Helvetica-Bold" : "Helvetica"]; return codes.reduce((a, c) => a + (w[c] || 556), 0) * size / 1000; }
  function wrap(str, bold, size, maxW) {
    const words = String(str).split(/\s+/).filter(Boolean); const lines = []; let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (textWidth(toWin(t), bold, size) <= maxW || !cur) {
        if (!cur && textWidth(toWin(w), bold, size) > maxW) { // hard-break long tokens
          let piece = "";
          for (const ch of w) { if (textWidth(toWin(piece + ch), bold, size) > maxW) { lines.push(piece); piece = ch; } else piece += ch; }
          cur = piece; continue;
        }
        cur = t;
      } else { lines.push(cur); cur = w; }
    }
    if (cur || !lines.length) lines.push(cur);
    return lines;
  }
  function pdfStr(codes) {
    let s = "(";
    for (const c of codes) { if (c === 40 || c === 41 || c === 92) s += "\\" + String.fromCharCode(c); else if (c < 127) s += String.fromCharCode(c); else s += "\\" + c.toString(8).padStart(3, "0"); }
    return s + ")";
  }

  function buildPdf(d) {
    const W = 595.28, H = 841.89, ML = 40, MR = 40, TOP = 52, BOTTOM = 56, CW = W - ML - MR;
    const INK = "0.122 0.165 0.420", MUTED = "0.357 0.376 0.439", RED = "0.706 0.137 0.094", LINE = "0.85 0.86 0.90", HEAD = "0.933 0.941 0.969";
    const pages = []; let ops = [], y = 0;
    function newPage() { ops = []; pages.push(ops); y = H - TOP; }
    function text(str, x, yy, size, bold, color) { ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${color || "0 0 0"} rg ${x.toFixed(2)} ${yy.toFixed(2)} Td ${pdfStr(toWin(str))} Tj ET`); }
    function ensure(h) { if (y - h < BOTTOM) newPage(); }
    function para(str, opts = {}) {
      const size = opts.size || 9, bold = !!opts.bold, lead = size * 1.32, indent = opts.indent || 0;
      for (const ln of wrap(str, bold, size, CW - indent)) { ensure(lead); y -= lead; text(ln, ML + indent, y + size * 0.25, size, bold, opts.color); }
      if (opts.after) y -= opts.after;
    }
    function heading(str) { ensure(30); y -= 10; para(str, { size: 13, bold: true, color: INK, after: 3 }); }
    function table(rows, widths, opts = {}) {
      const size = opts.size || 7.8, pad = 3.5, lead = size * 1.25;
      const ws = widths.map((w) => w * CW);
      const draw = (row, isHead) => {
        const cells = row.map((c, i) => wrap(c.t !== undefined ? c.t : c, isHead || c.b, size, ws[i] - 2 * pad));
        const h = Math.max(...cells.map((c) => c.length)) * lead + 2 * pad;
        return { cells, h, isHead, row };
      };
      const head = opts.header === false ? null : draw(rows[0], true);
      const body = (opts.header === false ? rows : rows.slice(1)).map((r) => draw(r, false));
      const paint = (r) => {
        if (y - r.h < BOTTOM) { newPage(); if (head && !r.isHead) paint(head); }
        const top = y; let x = ML;
        if (r.isHead) ops.push(`${HEAD} rg ${ML} ${(top - r.h).toFixed(2)} ${CW.toFixed(2)} ${r.h.toFixed(2)} re f`);
        r.cells.forEach((lines, i) => {
          const c = r.row[i];
          lines.forEach((ln, j) => text(ln, x + pad, top - pad - (j + 1) * lead + size * 0.28, size, r.isHead || (c && c.b), c && c.color));
          ops.push(`${LINE} RG 0.5 w ${x.toFixed(2)} ${(top - r.h).toFixed(2)} ${ws[i].toFixed(2)} ${r.h.toFixed(2)} re S`);
          x += ws[i];
        });
        y = top - r.h;
      };
      if (head) paint(head);
      body.forEach(paint);
      y -= 6;
    }

    newPage();
    const s = d.summary;
    para(TITLE, { size: 22, bold: true, color: INK, after: 2 });
    para(SUBTITLE, { size: 13, bold: true, color: INK });
    para(NOT_OFFICIAL, { size: 11, bold: true, color: RED, after: 6 });
    const B = (t) => ({ t, b: true });
    table([[B("Assessment Year"), B(d.ay), B("Financial Year"), d.fy], [B("Taxpayer category"), d.category, B("Portal status"), d.portal_status],
      [B("Regime / option"), d.regime, B("Recommended ITR"), B(d.itr.recommended)], [B("Due date"), d.due_date ? d.due_date.split("-").reverse().join("/") : "—", B("Return"), d.return_label || "—"],
      [B("Prepared"), d.prepared_at, B("Account"), d.email]], [0.18, 0.32, 0.18, 0.32], { header: false, size: 8.5 });
    if (d.filing_requirement) para((d.filing_requirement.required ? "Filing is compulsory: " : "Filing is optional: ") + d.filing_requirement.reasons.join("; "), { size: 8, color: MUTED, after: 4 });
    table([[B("Result"), { t: `${statusText(s)}: ${inr(s.refund_or_payable)}`, b: true }]], [0.18, 0.82], { header: false, size: 11 });

    heading("Why this ITR form");
    d.itr.why.forEach((w) => para("• " + w));
    Object.entries(d.itr.rejected).forEach(([f, r]) => para(`${f} not used: ${r.join("; ") || "—"}`, { size: 7.8, color: MUTED }));
    if (d.itr.note) para(d.itr.note, { size: 7.8, color: MUTED });

    heading("Tax calculation");
    table([["Step", "Amount", "Note"]].concat(d.lines.map((l) => {
      const strong = l.kind === "total" || l.kind === "subtotal" || l.kind === "info";
      return [{ t: l.label, b: strong }, { t: l.kind === "info" ? "" : inr(l.amount), b: strong }, { t: l.note || "", color: MUTED }];
    })), [0.48, 0.17, 0.35]);
    if (d.warnings.length) { heading("Warnings"); d.warnings.forEach((w) => para(`${w.severity.toUpperCase()} — ${w.message}`)); }
    if (d.pending.length) { heading("Unresolved fields"); d.pending.forEach((f) => para(`• ${f.display_name}: ${f.status}`)); }
    const conf = Object.entries(d.conflicts || {});
    if (conf.length) { heading("Conflicting values between documents"); conf.forEach(([fid, c]) => para(`• ${fid}: return value ${c.current}; documents: ` + c.candidates.map((x) => `${x.value} (${x.source} p.${x.page})`).join(", "))); }

    if (d.doc_sections.length) {
      newPage();
      heading("From your Form 16 / Form 12BA — portal break-ups");
      para("These break-ups are what the portal asks for in drop-downs and per-employer rows. Copy the amounts in bold.", { size: 8, color: MUTED, after: 4 });
      if (d.doc_checks.length) d.doc_checks.forEach((c) => para(`${c.ok ? "✓" : "✗"} ${c.label}: ${c.detail}`, { size: 7.8, color: c.ok ? MUTED : RED }));
      for (const sec of d.doc_sections) {
        ensure(60); y -= 4; para(sec.title, { size: 10.5, bold: true, color: INK, after: 1 });
        if (sec.intro) para(sec.intro, { size: 7.6, color: MUTED, after: 2 });
        table([sec.head].concat(sec.rows.map((r) => r.map((c, i) => (/\(copy\)|^Check$/.test(sec.head[i] || "") ? { t: c, b: true } : c)))), sec.widths);
        if (sec.foot) para(sec.foot, { size: 7.4, color: MUTED });
      }
    }
    newPage();
    heading(`Where to enter each value — ${d.itr.recommended}`);
    para(`${d.mapping_disclaimer} Mapping version ${d.mapping_version}. Portal: ${d.portal_url}`, { size: 7.8, color: MUTED, after: 4 });
    table([["Field", "Value (copy)", "ITR / Schedule", "Portal location", "Source", "Status"]].concat(d.mapping.map((f) => [
      f.display_name, { t: fmtValue(f), b: true }, `${f.itr_form} / ${f.schedule || "—"}`, locText(f), srcText(f), f.status])), [0.2, 0.15, 0.16, 0.25, 0.13, 0.11]);
    heading("How to enter values on the portal");
    d.steps.forEach((t, i) => para(`${i + 1}. ${t}`));
    heading("Source documents");
    if (d.docs.length) d.docs.forEach((x) => para(`• ${x.orig_name} (${x.doc_type || "other"}, ${x.pages} page(s))`));
    else para("No documents uploaded — all values were entered manually.");
    heading("Assumptions");
    d.assumptions.forEach((a) => para("• " + a));
    y -= 6;
    para("This application prepares and estimates information for tax filing. It does not constitute professional tax advice.", { size: 7.8, color: MUTED });

    // header & footer on every page
    pages.forEach((p, i) => {
      p.push(`BT /F2 7.5 Tf ${INK} rg ${ML} ${H - 28} Td ${pdfStr(toWin(`MY IT HERO  |  AY ${d.ay} (FY ${d.fy})  |  ${NOT_OFFICIAL}`))} Tj ET`);
      p.push(`BT /F1 6.8 Tf ${MUTED} rg ${ML} 34 Td ${pdfStr(toWin(FOOTER))} Tj ET`);
      const pn = toWin(`Page ${i + 1} of ${pages.length}`);
      p.push(`BT /F1 7 Tf ${MUTED} rg ${(W - MR - textWidth(pn, false, 7)).toFixed(2)} 22 Td ${pdfStr(pn)} Tj ET`);
    });

    // serialise
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids = [];
    pages.forEach((p) => {
      const stream = p.join("\n");
      const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
    const info = add(`<< /Title ${pdfStr(toWin(`${TITLE} — ${SUBTITLE} — AY ${d.ay}`))} /Subject ${pdfStr(toWin(NOT_OFFICIAL))} /Producer (My IT Hero) >>`);
    let out = "%PDF-1.4\n%âãÏÓ\n"; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff; // all content is Latin-1 by construction
    return bytes;
  }

  // =============================================================== DOCX
  const xe = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  function run(text, o = {}) {
    const pr = [o.bold ? "<w:b/>" : "", o.color ? `<w:color w:val="${o.color}"/>` : "", `<w:sz w:val="${Math.round((o.size || 9.5) * 2)}"/>`].join("");
    return `<w:r><w:rPr>${pr}</w:rPr><w:t xml:space="preserve">${xe(text)}</w:t></w:r>`;
  }
  const P = (text, o = {}) => `<w:p>${o.style ? `<w:pPr><w:pStyle w:val="${o.style}"/></w:pPr>` : ""}${run(text, o)}</w:p>`;
  const H = (text, size) => P(text, { bold: true, size: size || 13, color: "1F2A6B" });
  function tbl(rows, widthsCm, header) {
    const tw = widthsCm.map((c) => Math.round(c * 567));
    const grid = `<w:tblGrid>${tw.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
    const border = '<w:tblBorders>' + ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFC4D6"/>`).join("") + "</w:tblBorders>";
    const body = rows.map((r, i) => `<w:tr>${r.map((c, j) => `<w:tc><w:tcPr><w:tcW w:w="${tw[j]}" w:type="dxa"/>${header && i === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF0F7"/>' : ""}</w:tcPr><w:p>${run(c, { size: 8.5, bold: header && i === 0 })}</w:p></w:tc>`).join("")}</w:tr>`).join("");
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${border}<w:tblLayout w:type="fixed"/></w:tblPr>${grid}${body}</w:tbl>${P("")}`;
  }
  function buildDocxXml(d) {
    const s = d.summary; const b = [];
    b.push(H(TITLE, 22), H(SUBTITLE, 14), P(NOT_OFFICIAL, { bold: true, size: 12, color: "B42318" }));
    b.push(tbl([["Assessment Year", d.ay, "Financial Year", d.fy], ["Taxpayer category", d.category, "Portal status", d.portal_status], ["Regime / option", d.regime, "Recommended ITR", d.itr.recommended],
      ["Due date", d.due_date ? d.due_date.split("-").reverse().join("/") : "—", "Return", d.return_label || "—"], ["Prepared", d.prepared_at, "Account", d.email]], [3.2, 5.6, 3.2, 5.6], false));
    if (d.filing_requirement) b.push(P((d.filing_requirement.required ? "Filing is compulsory: " : "Filing is optional: ") + d.filing_requirement.reasons.join("; "), { size: 8.5, color: "5B6070" }));
    b.push(P(`${statusText(s)}: ${inr(s.refund_or_payable)}`, { bold: true, size: 13 }));
    b.push(H("Why this ITR form"));
    d.itr.why.forEach((w) => b.push(P("• " + w)));
    Object.entries(d.itr.rejected).forEach(([f, r]) => b.push(P(`${f} not used: ${r.join("; ") || "—"}`, { size: 8.5, color: "5B6070" })));
    b.push(H("Tax calculation"));
    b.push(tbl([["Step", "Amount", "Note"]].concat(d.lines.map((l) => [l.label, l.kind === "info" ? "" : inr(l.amount), l.note || ""])), [8.5, 3.2, 6.2], true));
    if (d.warnings.length) { b.push(H("Warnings")); d.warnings.forEach((w) => b.push(P(`• ${w.severity.toUpperCase()} — ${w.message}`))); }
    if (d.pending.length) { b.push(H("Unresolved fields")); d.pending.forEach((f) => b.push(P(`• ${f.display_name}: ${f.status}`))); }
    if (d.doc_sections.length) {
      b.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      b.push(H("From your Form 16 / Form 12BA — portal break-ups"));
      b.push(P("These break-ups are what the portal asks for in drop-downs and per-employer rows.", { size: 8.5, color: "5B6070" }));
      d.doc_checks.forEach((c) => b.push(P(`${c.ok ? "✓" : "✗"} ${c.label}: ${c.detail}`, { size: 8.5, color: c.ok ? "5B6070" : "B42318" })));
      for (const sec of d.doc_sections) {
        b.push(P(sec.title, { bold: true, size: 11, color: "1F2A6B" }));
        if (sec.intro) b.push(P(sec.intro, { size: 8.5, color: "5B6070" }));
        b.push(tbl([sec.head].concat(sec.rows), sec.widths.map((w) => +(w * 17.8).toFixed(1)), true));
        if (sec.foot) b.push(P(sec.foot, { size: 8, color: "5B6070" }));
      }
    }
    b.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    b.push(H(`Where to enter each value — ${d.itr.recommended}`));
    b.push(P(`${d.mapping_disclaimer} Mapping version ${d.mapping_version}. Portal: ${d.portal_url}`, { size: 8.5 }));
    b.push(tbl([["Field", "Value (copy)", "ITR / Schedule", "Portal location", "Source", "Status"]].concat(d.mapping.map((f) =>
      [f.display_name, fmtValue(f), `${f.itr_form} / ${f.schedule || "—"}`, locText(f), srcText(f), f.status])), [3.6, 2.6, 2.8, 4.4, 2.6, 1.8], true));
    b.push(H("How to enter values on the portal"));
    d.steps.forEach((t, i) => b.push(P(`${i + 1}. ${t}`)));
    b.push(H("Source documents"));
    (d.docs.length ? d.docs.map((x) => `${x.orig_name} (${x.doc_type || "other"})`) : ["No documents uploaded — values entered manually"]).forEach((t) => b.push(P("• " + t)));
    b.push(H("Assumptions"));
    d.assumptions.forEach((a) => b.push(P("• " + a)));
    b.push(P("This application prepares and estimates information for tax filing. It does not constitute professional tax advice."));
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="907" w:bottom="1000" w:left="907" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr>';
    const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${P(`MY IT HERO | AY ${d.ay} (FY ${d.fy}) | ${NOT_OFFICIAL}`, { bold: true, size: 8, color: "1F2A6B" })}</w:hdr>`;
    const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p>${run(FOOTER + "  Page ", { size: 7 })}${pageField}</w:p></w:ftr>`;
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${b.join("")}${sect}</w:body></w:document>`;
    return { doc, header, footer };
  }
  function buildDocx(d) {
    const { doc, header, footer } = buildDocxXml(d);
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const files = {
      "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      "word/_rels/document.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
      "word/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="19"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
      "word/document.xml": doc, "word/header1.xml": header, "word/footer1.xml": footer,
      "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(`${TITLE} — ${SUBTITLE} — AY ${d.ay}`)}</dc:title><dc:subject>${NOT_OFFICIAL}</dc:subject><dc:creator>My IT Hero</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
    };
    return zipStore(files);
  }
  // ---- minimal ZIP (stored, no compression)
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zipStore(files) {
    const enc = new TextEncoder(); const parts = [], central = []; let offset = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff], u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (const [name, content] of Object.entries(files)) {
      const nb = enc.encode(name), data = enc.encode(content), crc = crc32(data);
      const local = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
      parts.push(new Uint8Array(local), nb, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nb);
      offset += local.length + nb.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(Object.keys(files).length), ...u16(Object.keys(files).length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const all = parts.concat(central, [end]); const total = all.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total); let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  root.ITHWorksheet = { docSections, worksheetData, buildPdf, buildDocx, inr, fmtValue };
  if (typeof module !== "undefined") module.exports = root.ITHWorksheet;
})(typeof window !== "undefined" ? window : globalThis);
