/* Structured readers for the salary documents an employer issues:
     - Form 16 Part A (TRACES): employer/employee, PAN/TAN, AY, period, quarter-wise amount paid and TDS
     - Form 16 Part B (Annexure I): salary break-up, exemptions, section 16, Chapter VI-A, employer's tax computation, regime choice
     - Form 12BA: nature-wise perquisites (value, recovered, chargeable), profits in lieu of salary, tax paid by employer
   A combined Form 16 (Part A + Part B in one PDF) is read by both. Works on the text lines that
   ocr.js produces (PDF text layer or OCR); uses x-positions when available to split the
   employer / employee columns. Pure functions — no DOM, no storage. */
(function (root) {
  "use strict";

  // ------------------------------------------------------------ text helpers
  const NUM = /(?<![\w\/.:-])(-?\d[\d,]*\.\d{2})(?![\w%\/])/g;
  const NUM_LOOSE = /(?<![\w\/.:-])(-?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|-?\d+\.\d{1,2})(?![\w%\/])/g;
  const PAN_RX = /\b([A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z])\b/g;
  const TAN_RX = /\b([A-Z]{4}\d{5}[A-Z])\b/g;
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function nums(text, loose) {
    const out = [];
    for (const m of String(text).matchAll(loose ? NUM_LOOSE : NUM)) out.push(m[1]);
    return out;
  }
  // "93229.60" -> "93230" (whole rupees, half-up — ITR figures are in whole rupees)
  function rupees(s) {
    if (s === null || s === undefined || s === "") return null;
    const t = String(s).replace(/,/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    const neg = t.startsWith("-"); const [i, f = ""] = t.replace("-", "").split(".");
    let v = BigInt(i || "0"); if (f && Number(f[0]) >= 5) v += 1n;
    return (neg && v !== 0n ? "-" : "") + v.toString();
  }
  const toNum = (s) => (s === null || s === undefined ? 0 : Number(String(s).replace(/,/g, "")) || 0);
  function despace(label) { // "A m o u n t o f a n y" -> "Amount of any"
    const singles = (label.match(/(?:^|\s)\S(?=\s|$)/g) || []).length;
    return singles >= 8 && singles / label.split(/\s+/).length > 0.6 ? label.replace(/(\S) (?=\S( |$))/g, "$1").replace(/\s{2,}/g, " ") : label;
  }
  function dateIso(s) { // 01-Apr-2025 / 01/04/2025 / 01-04-2025
    let m = /^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{4})$/.exec(s);
    if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(s);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
  }
  const DATE_RX = /\b(\d{1,2}[-\/ ](?:[A-Za-z]{3}[A-Za-z]*|\d{1,2})[-\/ ]\d{4})\b/g;
  const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/^[\s,:;-]+|[\s,:;-]+$/g, "").trim();

  function allLines(pages) {
    const out = [];
    for (const pg of pages) pg.lines.forEach((ln, i) => out.push({ ...ln, page: pg.page, idx: i, width: pg.width || null, ocr: pg.method === "ocr" }));
    return out;
  }
  const isBoiler = (t) => /^(certificate number:|page \d+ of \d+|signature not verified|digitally signed|date: \d{4}\.\d\d)/i.test(t);

  // ------------------------------------------------------------ detection
  function detect(text) {
    const t = text.toLowerCase();
    const kinds = [];
    // Form 16 Part B cites "Form No. 12BA" too, so 12BA needs its own table headings as well
    if (/12\s*ba\b/.test(t) && /(valuation of perquisites|nature of perquisites)/.test(t)) kinds.push("form12ba");
    const f16 = /form\s*no\.?\s*16\b(?!\s*a)/.test(t) || /certificate under section 203/.test(t);
    if (f16 && /part\s*a\b/.test(t) && /(summary of amount paid|quarter\(s\)|amount paid\/credited|total amount of tax deducted)/.test(t)) kinds.push("form16_part_a");
    if (f16 && (/part\s*b\b/.test(t) || /annexure/.test(t)) && /(gross salary|17\s*\(\s*1\s*\))/.test(t)) kinds.push("form16_part_b");
    return kinds;
  }

  // ------------------------------------------------------------ shared header (Form 16 Part A / Part B)
  function header(lines) {
    const res = { employer_name: null, employer_address: null, employee_name: null, employee_address: null, deductor_pan: null, employer_tan: null, pan: null,
      assessment_year: null, period_from: null, period_to: null, certificate_no: null, name_conf: 0.9 };
    const text = lines.map((l) => l.text).join("\n");
    const cert = /certificate no\.?\s*[:\-]?\s*([A-Z0-9]{5,10})\b/i.exec(text); if (cert) res.certificate_no = cert[1];
    const ay = /assessment year[\s\S]{0,200}?\b(20\d\d-\d\d)\b/i.exec(text) || /\b(20\d\d-\d\d)\b/.exec(text); if (ay) res.assessment_year = ay[1];
    const per = /period with the employer([\s\S]{0,300})/i.exec(text);
    if (per) { const ds = [...per[1].matchAll(DATE_RX)].map((m) => dateIso(m[1].replace(/ /g, "-"))).filter(Boolean); if (ds.length >= 2) { res.period_from = ds[0]; res.period_to = ds[1]; } }
    // PAN of deductor / TAN / PAN of employee usually share one line under their headings
    const hi = lines.findIndex((l) => /pan of the deductor/i.test(l.text));
    const scan = hi >= 0 ? lines.slice(hi, hi + 6) : lines;
    for (const l of scan) {
      const up = l.text.toUpperCase();
      for (const m of up.matchAll(TAN_RX)) if (!res.employer_tan) res.employer_tan = m[1];
      for (const m of up.matchAll(PAN_RX)) { if (m[1][3] === "P" && !res.pan) res.pan = m[1]; else if (m[1][3] !== "P" && !res.deductor_pan) res.deductor_pan = m[1]; }
    }
    if (!res.pan) for (const l of lines) { const m = /pan of employee:?\s*([A-Z]{5}\d{4}[A-Z])/i.exec(l.text); if (m) { res.pan = m[1].toUpperCase(); break; } }
    if (!res.employer_tan) for (const l of lines) { const m = /tan of employer:?\s*([A-Z]{4}\d{5}[A-Z])/i.exec(l.text); if (m) { res.employer_tan = m[1].toUpperCase(); break; } }
    // names: block between "Name and address of the Employer" and "PAN of the Deductor"
    const ni = lines.findIndex((l) => /name and address of the employer/i.test(l.text));
    const inline = ni >= 0 ? /name and address of the employer[^:]*:\s*([^,]+)(?:,\s*(.*))?$/i.exec(lines[ni].text) : null;
    if (inline && inline[1].trim()) { res.employer_name = clean(inline[1]); res.employer_address = inline[2] ? clean(inline[2]) : null; res.name_conf = 0.9; }
    else if (ni >= 0) {
      const end = lines.findIndex((l, i) => i > ni && /pan of the (deductor|employee)/i.test(l.text));
      const block = lines.slice(ni + 1, end > ni ? end : ni + 10).filter((l) => !isBoiler(l.text));
      const hd = lines[ni];
      let split = null;
      if (hd.items && hd.items.length) {
        const emp = hd.items.find((it) => /employee/i.test(it.s) && !/employer/i.test(it.s));
        const er = hd.items.find((it) => /employer/i.test(it.s));
        if (emp) split = er && er.x < emp.x ? (er.x + emp.x) / 2 : emp.x - 40;
        else if (hd.width) split = hd.width * 0.45;
      }
      const left = [], right = [];
      if (split !== null && block.every((l) => l.items && l.items.length)) {
        for (const l of block) {
          const L = l.items.filter((it) => it.x < split).map((it) => it.s).join(" ").trim();
          const R = l.items.filter((it) => it.x >= split).map((it) => it.s).join(" ").trim();
          if (L) left.push(L); if (R) right.push(R);
        }
      } else { // no positions (OCR): employer and employee lines alternate, employer first
        block.forEach((l, i) => (i % 2 === 0 ? left : right).push(l.text)); res.name_conf = 0.75;
      }
      const isContact = (s) => /@|^\+?\(?\d|^\d{6}$|^phone|^tel/i.test(s);
      if (left.length) { res.employer_name = clean(left[0]); res.employer_address = clean(left.slice(1).filter((s) => !isContact(s)).join(", ")) || null; }
      if (right.length) { res.employee_name = clean(right[0]).toUpperCase(); res.employee_address = clean(right.slice(1).filter((s) => !isContact(s)).join(", ")) || null; }
    }
    return res;
  }

  // ------------------------------------------------------------ Part A
  function parsePartA(pages) {
    const lines = allLines(pages).filter((l) => !isBoiler(l.text));
    const h = header(lines);
    const quarters = [];
    let total = null;
    const start = lines.findIndex((l) => /summary of amount paid/i.test(l.text) || /^quarter\(s\)/i.test(l.text));
    for (let i = Math.max(0, start); i < lines.length; i++) {
      const t = lines[i].text;
      const q = /^Q\s*([1-4])\b\s*(.*)$/i.exec(t);
      if (q) {
        const ns = nums(q[2]); const receipt = (/^([A-Z]{8})\b/i.exec(q[2].trim()) || [])[1] || null;
        if (ns.length >= 2) quarters.push({ quarter: "Q" + q[1], receipt, paid: rupees(ns[0]), deducted: rupees(ns[1]), deposited: rupees(ns[2] ?? ns[1]) });
        continue;
      }
      if (/^total\s*\(?rs\.?\)?/i.test(t) && quarters.length) {
        const ns = nums(t); if (ns.length >= 2) total = { paid: rupees(ns[0]), deducted: rupees(ns[1]), deposited: rupees(ns[2] ?? ns[1]) };
        break;
      }
    }
    if (!total) { // simple layouts: "Total amount of tax deducted (Rs.) 1,02,000.00"
      const l = lines.find((x) => /total (amount of )?tax deducted/i.test(x.text) && nums(x.text, x.ocr).length);
      if (l) { const ns = nums(l.text, l.ocr); total = { paid: null, deducted: rupees(ns[ns.length - 1]), deposited: null }; }
    }
    if (!total && quarters.length) {
      const sum = (k) => String(quarters.reduce((a, q) => a + toNum(q[k]), 0));
      total = { paid: sum("paid"), deducted: sum("deducted"), deposited: sum("deposited"), derived: true };
    }
    return { kind: "form16_part_a", ...h, quarters, total };
  }

  // ------------------------------------------------------------ numbered-item reader (Part B and Form 12BA tables)
  // TRACES prints each item as "(b) 93230.00" with the label wrapped above and below. This rebuilds items with full labels.
  function readItems(lines, opts) {
    opts = opts || {};
    const maxSec = opts.maxSec || 30;
    const rows = lines.map((l) => {
      const t = l.text.trim();
      let sec = null, sub = null, rest = t, m;
      if ((m = /^\(\s*([a-z])\s*\)\s*(.*)$/i.exec(t)) && m[1].length === 1) { sub = m[1].toLowerCase(); rest = m[2]; }
      else if ((m = /^(\d{1,2})\.(?:\s+(.*))?$/.exec(t)) && Number(m[1]) >= 1 && Number(m[1]) <= maxSec) { sec = Number(m[1]); rest = m[2] || ""; }
      const ns = nums(rest, l.ocr);
      let label = rest; for (const n of ns) label = label.replace(n, " ");
      label = despace(label.replace(/\bRs\.?(\s|$)/g, " ").replace(/\s+/g, " ").trim());
      const numOnly = sec === null && sub === null && ns.length > 0 && !label.replace(/[()\[\]:.\-]/g, "").trim();
      const unmarked = sec === null && sub === null && ns.length > 0 && !numOnly && /[a-z]{3}/i.test(label); // "Total amount of exemption … 1,80,000.00"
      return { sec, sub, label, nums: ns, line: l, marker: sec !== null || sub !== null || unmarked, numOnly };
    });
    const items = []; let curSec = null;
    const markers = [];
    rows.forEach((r, i) => { if (r.marker) markers.push(i); });
    for (const i of markers) {
      const r = rows[i];
      if (r.sec !== null) curSec = r.sec;
      items.push({ sec: r.sec !== null ? r.sec : curSec, sub: r.sub, own: r.label, pre: [], post: [], nums: r.nums.slice(), row: i, page: r.line.page });
    }
    // distribute the unmarked lines between neighbouring items
    for (let k = 0; k <= items.length; k++) {
      const prev = items[k - 1], next = items[k];
      const from = prev ? prev.row + 1 : 0, to = next ? next.row : rows.length;
      const gap = rows.slice(from, to).filter((r) => !isBoiler(r.line.text));
      const orphans = gap.filter((r) => !r.numOnly && r.label);
      const numLines = gap.filter((r) => r.numOnly);
      for (const nl of numLines) { const tgt = prev && !prev.nums.length ? prev : next && !next.nums.length ? next : null; if (tgt) tgt.nums = nl.nums.slice(); }
      if (!orphans.length) continue;
      const prevNeeds = prev && !prev.own, nextNeeds = next && !next.own;
      let toPrev = 0;
      if (prev && !next) toPrev = orphans.length;
      else if (prevNeeds && nextNeeds) toPrev = Math.ceil(orphans.length / 2);
      else if (prevNeeds) toPrev = orphans.length;
      else if (!next) toPrev = orphans.length;
      orphans.slice(0, toPrev).forEach((o) => prev.post.push(o.label));
      if (next) orphans.slice(toPrev).forEach((o) => next.pre.push(o.label));
    }
    for (const it of items) it.label = clean([...it.pre, it.own, ...it.post].join(" "));
    return items;
  }
  function pick(items, sec, rx, col) {
    const it = items.find((x) => (sec === null || x.sec === sec) && rx.test(x.label.toLowerCase()) && x.nums.length);
    if (!it) return null;
    const raw = col === "first" ? it.nums[0] : it.nums[it.nums.length - 1];
    return { value: rupees(raw), raw, page: it.page, label: it.label };
  }

  // ------------------------------------------------------------ Part B
  const PART_B = [
    // [key, section, label regex, column]
    ["salary_17_1", 1, /17\s*\(\s*1\s*\)/, "last"],
    ["perquisites_17_2", 1, /17\s*\(\s*2\s*\)|perquisite/, "last"],
    ["profits_17_3", 1, /17\s*\(\s*3\s*\)|profits in lieu/, "last"],
    ["gross_salary", 1, /^\(?total\b|^total$/, "last"],
    ["salary_other_employers", 1, /other employer/, "last"],
    ["ex_10_5", 2, /10\s*\(\s*5\s*\)|travel concession/, "last"],
    ["ex_10_10", 2, /10\s*\(\s*10\s*\)(?!\s*a)|gratuity/, "last"],
    ["ex_10_10a", 2, /10\s*\(\s*10\s*a\s*\)(?!a)|commuted value of pension/, "last"],
    ["ex_10_10aa", 2, /10\s*\(\s*10\s*aa\s*\)|\(10aa\)|leave salary encashment/, "last"],
    ["ex_10_13a", 2, /10\s*\(\s*13\s*a\s*\)|house rent allowance/, "last"],
    ["ex_10_14", 2, /10\s*\(\s*14\s*\)|special allowances/, "last"],
    ["ex_other", 2, /total amount of any other exemption/, "last"],
    ["exempt_total", 2, /total amount of exemption claimed/, "last"],
    ["salary_current_employer", null, /total amount of salary received from current employer/, "last"],
    ["std_deduction", 4, /16\s*\(\s*ia\s*\)|standard deduction/, "last"],
    ["entertainment_16_ii", 4, /16\s*\(\s*ii\s*\)|entertainment allowance/, "last"],
    ["professional_tax", 4, /16\s*\(\s*iii\s*\)|tax on employment|professional tax/, "last"],
    ["income_salary", null, /income chargeable under the head\s*.?salaries/, "last"],
    ["hp_reported", 7, /house property/, "last"],
    ["os_reported", 7, /other sources/, "last"],
    ["gross_total_income", null, /gross total income/, "last"],
    ["d_80c_only", 10, /\b80c\b(?!c)|life insurance premia/, "last"],
    ["d_80ccc", 10, /80\s*ccc\b|certain pension funds/, "last"],
    ["d_80ccd1", 10, /80\s*ccd\s*\(\s*1\s*\)(?!\s*b)|contribution by taxpayer to pension/, "last"],
    ["d_80c_group", 10, /total deduction under section 80c/, "last"],
    ["d_80ccd1b", 10, /80\s*ccd\s*\(\s*1\s*b\s*\)/, "last"],
    ["d_80ccd2", 10, /80\s*ccd\s*\(\s*2\s*\)|contribution by employer to pension/, "last"],
    ["d_80d", 10, /\b80\s*d\b|health insurance/, "last"],
    ["d_80e", 10, /\b80\s*e\b|higher education/, "last"],
    ["d_80cch_employee", 10, /80\s*cch.*|agnipath/, "last"],
    ["d_80g", 10, /\b80\s*g\b|donations/, "last"],
    ["d_80tta", 10, /80\s*tta|savings account/, "last"],
    ["d_other", 10, /total of amount deductible under any other/, "last"],
    ["via_total", null, /aggregate of deductible amount under chapter vi-?a/, "last"],
    ["total_income", null, /total taxable income/, "last"],
    ["tax_on_total_income", null, /^tax on total income/, "last"],
    ["rebate_87a", null, /rebate under section 87a/, "last"],
    ["surcharge", null, /^surcharge/, "last"],
    ["cess", null, /health and education cess/, "last"],
    ["tax_payable", null, /^tax payable/, "last"],
    ["relief_89", null, /relief under section 89/, "last"],
    ["tds_12baa", null, /tax deducted at source as per form no\.? 12baa/, "last"],
    ["tcs_12baa", null, /tax collected at source as per form no\.? 12baa/, "last"],
    ["net_tax_payable", null, /^net tax payable/, "last"],
  ];
  function parsePartB(pages) {
    const lines = allLines(pages).filter((l) => !isBoiler(l.text));
    const h = header(lines);
    const text = lines.map((l) => l.text).join("\n");
    const opt = /opting out of taxation u\/s\s*115\s*bac\s*\(?\s*1\s*a\s*\)?\s*\??\s*(yes|no)\b/i.exec(text);
    const startIdx = lines.findIndex((l) => /gross salary/i.test(l.text) || /details of salary paid/i.test(l.text));
    const endIdx = lines.findIndex((l, i) => i > startIdx && /^verification$|^i, .* do hereby certify|son\s*\/\s*daughter of/i.test(l.text.trim()));
    const items = readItems(lines.slice(Math.max(0, startIdx), endIdx > startIdx ? endIdx : lines.length), { maxSec: 25 });
    const v = {};
    for (const [key, sec, rx, col] of PART_B) {
      let p = pick(items, sec, rx, col);
      if (!p && sec !== null && /^(d_|ex_|exempt_total|professional_tax|std_deduction)/.test(key)) p = pick(items, null, rx, col); // layouts without the numbered headings
      if (p) v[key] = p;
    }
    // Agnipath 80CCH appears twice (employee + Government) — add both deductible amounts
    const cch = items.filter((x) => x.sec === 10 && /80\s*cch|agnipath/.test(x.label.toLowerCase()) && x.nums.length);
    if (cch.length > 1) v.d_80cch_employee = { value: String(cch.reduce((a, x) => a + toNum(rupees(x.nums[x.nums.length - 1])), 0)), page: cch[0].page, label: "80CCH (employee + Central Government)" };
    return { kind: "form16_part_b", ...h, opted_out_of_new_regime: opt ? opt[1].toLowerCase() === "yes" : null, values: v,
      regime: opt ? (opt[1].toLowerCase() === "yes" ? "old" : "new") : null };
  }

  // ------------------------------------------------------------ Form 12BA
  const PERQ_NATURES = { 1: "Accommodation", 2: "Cars / Other automotive", 3: "Sweeper, gardener, watchman or personal attendant", 4: "Gas, electricity, water",
    5: "Interest free or concessional loans", 6: "Holiday expenses", 7: "Free or concessional travel", 8: "Free meals", 9: "Free education", 10: "Gifts, vouchers, etc.",
    11: "Credit card expenses", 12: "Club expenses", 13: "Use of movable assets by employees", 14: "Transfer of assets to employees",
    15: "Value of any other benefit / amenity / service / privilege", 16: "Stock options allotted or transferred by employer being an eligible start-up referred to in section 80-IAC",
    17: "Stock options (non-qualified options) other than ESOP in col 16 above", 18: "Contribution by employer to fund and scheme taxable under section 17(2)(vii)",
    19: "Annual accretion by way of interest, dividend etc. to the balance at the credit of fund and scheme referred to in section 17(2)(vii) and taxable under section 17(2)(viia)",
    20: "Other benefits or amenities" };
  function parse12BA(pages) {
    const lines = allLines(pages).filter((l) => !isBoiler(l.text));
    const text = lines.map((l) => l.text).join("\n");
    const res = { kind: "form12ba", employer_name: null, employer_tan: null, employee_name: null, designation: null, employee_no: null, pan: null,
      financial_year: null, salary_other_than_perquisites: null, perquisites: [], total: null, profits_17_3: null, tax_192_1: null, tax_192_1a: null, tax_total: null };
    const after = (rx) => { const i = lines.findIndex((l) => rx.test(l.text)); if (i < 0) return null; const t = lines[i].text; const c = t.indexOf(":"); return c >= 0 ? t.slice(c + 1).trim() : null; };
    const emp = after(/name and address of employer/i); if (emp) res.employer_name = clean(emp.split(",").filter((s) => s.trim())[0] || emp);
    const tan = /\bTAN\b[^A-Z]{0,10}([A-Z]{4}\d{5}[A-Z])/.exec(text); if (tan) res.employer_tan = tan[1];
    // "Asha Rao,Senior Engineer,,00001234,ABCPR1234K" — the value line starts with ":" near item 4
    const i4 = lines.findIndex((l) => /name, designation and permanent account number/i.test(l.text));
    if (i4 >= 0) {
      const cand = lines.slice(i4, i4 + 4).map((l) => l.text).find((t) => /:\s*\S/.test(t) && /,/.test(t));
      if (cand) {
        const parts = cand.slice(cand.indexOf(":") + 1).split(",").map((s) => s.trim());
        const named = parts.filter((s) => s && !/^\d+$/.test(s) && !/^[A-Z]{5}\d{4}[A-Z]$/.test(s) && !/^\d{4}\s?\d{4}\s?\d{4}$/.test(s));
        res.employee_name = named[0] ? named[0].toUpperCase() : null; res.designation = named[1] || null;
        res.employee_no = parts.find((s) => /^\d{3,}$/.test(s)) || null;
        const p = parts.find((s) => /^[A-Z]{5}\d{4}[A-Z]$/.test(s.toUpperCase())); if (p) res.pan = p.toUpperCase();
      }
    }
    if (!res.pan) { const m = /\b([A-Z]{3}P[A-Z]\d{4}[A-Z])\b/.exec(text.toUpperCase()); if (m) res.pan = m[1]; }
    const fy = /\b(20\d\d)\s*-\s*(20\d\d|\d\d)\b/.exec((text.match(/financial year[\s\S]{0,60}/i) || [""])[0]) || /\b(20\d\d)-(20\d\d)\b/.exec(text);
    if (fy) res.financial_year = fy[1] + "-" + fy[2].slice(-2);
    const i6 = lines.findIndex((l) => /income under the head\s*.?salaries/i.test(l.text));
    if (i6 >= 0) for (const l of lines.slice(i6, i6 + 4)) { const ns = nums(l.text, l.ocr); if (ns.length) { res.salary_other_than_perquisites = rupees(ns[0]); break; } }
    // perquisite table: between the column header row and "Details of tax"
    const ts = lines.findIndex((l) => /valuation of perquisites/i.test(l.text));
    const te = lines.findIndex((l, i) => i > ts && /details of tax/i.test(l.text));
    if (ts >= 0) {
      const body = lines.slice(ts + 1, te > ts ? te : lines.length).filter((l) => !/^\(1\)\s*\(2\)/.test(l.text));
      const firstRow = body.findIndex((l) => /^1\s*\.\s*\D/.test(l.text));
      const items = readItems(body.slice(Math.max(0, firstRow)), { maxSec: 30 });
      for (const it of items) {
        if (it.sub || it.nums.length < 3) continue;
        const [val, rec, chg] = it.nums.slice(-3).map(rupees);
        const lab = it.label.toLowerCase();
        if (/total value of perquisites/.test(lab)) { res.total = { value: val, recovered: rec, chargeable: chg, chargeable_exact: it.nums[it.nums.length - 1], page: it.page }; continue; }
        if (/profits in lieu of salary/.test(lab)) { res.profits_17_3 = { value: val, recovered: rec, chargeable: chg, page: it.page }; continue; }
        if (it.sec >= 1 && it.sec <= 20) res.perquisites.push({ no: it.sec, nature: PERQ_NATURES[it.sec] || clean(it.label), document_label: clean(it.label),
          value: val, recovered: rec, chargeable: chg, chargeable_exact: it.nums[it.nums.length - 1], page: it.page });
      }
    }
    if (!res.total && res.perquisites.length) {
      const s = (k) => String(res.perquisites.reduce((a, p) => a + toNum(p[k]), 0));
      res.total = { value: s("value"), recovered: s("recovered"), chargeable: s("chargeable"), derived: true };
    }
    const tax = (rx) => { const l = lines.find((x) => rx.test(x.text)); const ns = l ? nums(l.text, l.ocr) : []; return ns.length ? rupees(ns[ns.length - 1]) : null; };
    res.tax_192_1 = tax(/tax deducted from salary of the employee under section 192\s*\(\s*1\s*\)/i);
    res.tax_192_1a = tax(/tax paid by employer on behalf of the employee under section 192\s*\(\s*1a\s*\)/i);
    res.tax_total = tax(/^\(?c\)?\s*total tax paid/i);
    return res;
  }

  // ------------------------------------------------------------ suggestions for the return
  // Each suggestion: { field_id, value, raw, page, confidence, note }
  function suggestions(details) {
    const out = [];
    const add = (field_id, value, page, confidence, raw, note) => { if (value !== null && value !== undefined && value !== "") out.push({ field_id, value: String(value), raw: raw !== undefined ? String(raw) : String(value), page: page || 1, confidence, note: note || null }); };
    if (details.kind === "form16_part_a" || details.kind === "form16_part_b") {
      add("pan", details.pan, 1, 0.97);
      add("full_name", details.employee_name, 1, details.name_conf);
      add("employer_name", details.employer_name, 1, details.name_conf);
      add("employer_tan", details.employer_tan, 1, 0.97);
    }
    if (details.kind === "form16_part_a" && details.total) add("tds_salary", details.total.deducted, 1, details.total.derived ? 0.85 : 0.97, details.total.deducted, "Total tax deducted (Part A)");
    if (details.kind === "form16_part_b") {
      const v = details.values, g = (k) => (v[k] ? v[k] : null);
      const m = (fid, key, note, conf) => { const x = g(key); if (x) add(fid, x.value, x.page, conf || 0.97, x.raw, note); };
      m("salary_17_1", "salary_17_1"); m("perquisites_17_2", "perquisites_17_2"); m("profits_17_3", "profits_17_3");
      m("exempt_allowances", "exempt_total", "Total exemption u/s 10 — item 2(i)"); m("professional_tax", "professional_tax");
      if (g("d_80c_group")) m("d_80c", "d_80c_group", "80C + 80CCC + 80CCD(1)"); else m("d_80c", "d_80c_only");
      m("d_80ccd1b", "d_80ccd1b"); m("d_80ccd2", "d_80ccd2"); m("d_80d_self", "d_80d", "80D (as allowed by employer)", 0.9);
      m("d_80e", "d_80e"); m("d_80cch", "d_80cch_employee"); m("d_80g", "d_80g", null, 0.9); m("d_80tta", "d_80tta", null, 0.9);
      m("os_other", "os_reported", "Other income you declared to the employer (192(2B))", 0.85);
      const hp = g("hp_reported");
      if (hp && toNum(hp.value) < 0) { add("hp_type", "self", hp.page, 0.85, hp.raw, "Loss from house property declared to the employer"); add("hp_interest_24b", String(-toNum(hp.value)), hp.page, 0.85, hp.raw, "Interest on housing loan (loss declared to the employer)"); }
      if (details.regime) add("tax_regime", details.regime, 1, 0.97, details.opted_out_of_new_regime ? "Yes" : "No", "Opting out of 115BAC(1A)?");
    }
    if (details.kind === "form12ba") {
      add("pan", details.pan, 1, 0.95);
      add("full_name", details.employee_name, 1, 0.9);
      add("employer_name", details.employer_name, 1, 0.9);
      add("employer_tan", details.employer_tan, 1, 0.95);
      if (details.total) add("perquisites_17_2", details.total.chargeable, details.total.page, details.total.derived ? 0.85 : 0.95, details.total.chargeable_exact, "Total perquisites chargeable (Form 12BA, rounded)");
      if (details.profits_17_3) add("profits_17_3", details.profits_17_3.chargeable, details.profits_17_3.page, 0.95);
    }
    return out;
  }

  // ------------------------------------------------------------ checks across documents
  function checks(details) {
    const w = [];
    if (details.kind === "form16_part_b") {
      const v = details.values, n = (k) => (v[k] ? toNum(v[k].value) : null);
      if (n("gross_salary") !== null && n("salary_17_1") !== null) {
        const s = (n("salary_17_1") || 0) + (n("perquisites_17_2") || 0) + (n("profits_17_3") || 0);
        if (Math.abs(s - n("gross_salary")) > 2) w.push(`Part B: 17(1) + 17(2) + 17(3) = ₹${s} but the form's total is ₹${n("gross_salary")}. Check the figures.`);
      }
      if (n("salary_other_employers")) w.push(`Part B shows ₹${n("salary_other_employers")} salary from another employer. Upload that employer's Form 16 as well so it is not missed.`);
      if (n("entertainment_16_ii")) w.push("Entertainment allowance deduction u/s 16(ii) applies only to government employees; enter it in the portal if it applies to you.");
      if (n("d_other")) w.push(`Part B shows ₹${n("d_other")} under "any other provision of Chapter VI-A". Enter that deduction yourself under the right section in My Return.`);
      if (n("relief_89")) w.push(`Relief u/s 89 of ₹${n("relief_89")} — file Form 10E on the portal before filing the return.`);
    }
    if (details.kind === "form12ba" && toNum(details.tax_192_1a) > 0) w.push(`Form 12BA shows ₹${details.tax_192_1a} tax paid by the employer on your behalf u/s 192(1A); this tax is exempt u/s 10(10CC) and is not a TDS credit you can claim again.`);
    if (details.assessment_year && details.assessment_year !== "2026-27") w.push(`This document is for AY ${details.assessment_year}, not AY 2026-27.`);
    if (details.financial_year && details.financial_year !== "2025-26") w.push(`This Form 12BA is for FY ${details.financial_year}, not FY 2025-26.`);
    return w;
  }

  function read(pages, fullText) {
    const kinds = detect(fullText);
    if (!kinds.length) return null;
    const docs = kinds.map((k) => (k === "form12ba" ? parse12BA(pages) : k === "form16_part_a" ? parsePartA(pages) : parsePartB(pages)));
    const label = kinds.includes("form12ba") ? "Form 12BA" : kinds.length === 2 ? "Form 16 (Part A + Part B)" : kinds[0] === "form16_part_a" ? "Form 16 — Part A" : "Form 16 — Part B";
    const docType = kinds.includes("form12ba") ? "form12ba" : "form16";
    const sugg = []; const seen = new Set();
    for (const d of docs) for (const s of suggestions(d)) { const k = s.field_id + "=" + s.value; if (seen.has(k)) continue; seen.add(k); sugg.push(s); }
    return { doc_type: docType, label, kinds, details: docs, suggestions: sugg, warnings: docs.flatMap(checks) };
  }

  root.ITHForms = { detect, read, parsePartA, parsePartB, parse12BA, readItems, header, suggestions, checks, rupees, nums, PERQ_NATURES };
  if (typeof module !== "undefined") module.exports = root.ITHForms;
})(typeof window !== "undefined" ? window : globalThis);
