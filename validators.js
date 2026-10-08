/* Field parsing & validation (port of myithero/validators.py).
   Never silently changes a financial value: every parser returns raw, value, ok, flags. */
(function (root) {
  "use strict";
  const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/, TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/, IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  const ACCOUNT_RE = /^[0-9]{9,18}$/, MOBILE_RE = /^[6-9][0-9]{9}$/, EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$/;
  const DIGIT_FIX = { O: "0", o: "0", D: "0", I: "1", l: "1", "|": "1", S: "5", s: "5", B: "8", G: "6", Z: "2" };
  const ALPHA_FIX = { 0: "O", 1: "I", 5: "S", 8: "B", 6: "G", 2: "Z" };
  const MAX_PAISE = 100000000000000n; // ₹1 lakh crore
  const res = (raw, value, ok, flags) => ({ raw, value, ok, flags });

  function paiseToStr(p) { const neg = p < 0n; const a = neg ? -p : p; return (neg ? "-" : "") + (a / 100n).toString() + "." + (a % 100n).toString().padStart(2, "0"); }

  function parseMoney(raw, ocr) {
    let flags = [];
    if (raw === null || raw === undefined) return res(raw, null, false, ["empty"]);
    if (typeof raw === "number") raw = String(raw);
    let s = String(raw).trim();
    if (!s) return res(raw, null, false, ["empty"]);
    s = s.replace(/₹/g, "").replace(/INR/g, "").replace(/Rs\./g, "").replace(/Rs/g, "").replace(/\/-/g, "").replace(/ /g, " ").trim();
    let negative = false;
    if (s.startsWith("(") && s.endsWith(")")) { negative = true; s = s.slice(1, -1).trim(); }
    if (s.startsWith("-")) { negative = true; s = s.slice(1).trim(); }
    let mult = 1n, unitDigits = 0;
    const mm = s.match(/^([0-9.,\s]+)\s*(lakhs?|lacs?|lac|l|crores?|cr)\.?$/i);
    if (mm) { const crore = mm[2].toLowerCase().startsWith("c"); mult = crore ? 10000000n : 100000n; s = mm[1].trim(); flags.push(crore ? "unit_crore" : "unit_lakh"); unitDigits = 1; }
    if (ocr) { const fixed = [...s].map((c) => DIGIT_FIX[c] || c).join(""); if (fixed !== s) { flags.push("ocr_character_correction"); s = fixed; } }
    s = s.replace(/ /g, "");
    if (!/^[0-9,]*\.?[0-9]*$/.test(s) || !/[0-9]/.test(s)) return res(raw, null, false, flags.concat(["not_a_number"]));
    let [intpart, frac = ""] = s.split(".");
    if (s.split(".").length > 2) return res(raw, null, false, flags.concat(["ambiguous_separators"]));
    if (intpart.includes(",")) {
      const g = intpart.split(",");
      const indian = g.slice(1, -1).every((x) => x.length === 2) && g[g.length - 1].length === 3 && g[0].length >= 1 && g[0].length <= 2;
      const western = g.slice(1).every((x) => x.length === 3) && g[0].length >= 1 && g[0].length <= 3;
      if (!(indian || western)) return res(raw, null, false, flags.concat(["invalid_digit_grouping"]));
      intpart = g.join("");
    }
    if (frac.length > 2 && !unitDigits) return res(raw, null, false, flags.concat(["too_many_decimals"]));
    // exact: value in units of 10^-len(frac) rupees, times mult, then to paise (half-up)
    const scale = 10n ** BigInt(frac.length);
    const units = BigInt(intpart || "0") * scale + BigInt(frac || "0");
    const num = units * mult * 100n, q = num / scale, r = num % scale;
    let paise = r * 2n >= scale ? q + 1n : q;
    if (negative) return res(raw, paiseToStr(-paise), false, flags.concat(["negative"]));
    if (paise > MAX_PAISE) return res(raw, paiseToStr(paise), false, flags.concat(["implausibly_large"]));
    return res(raw, paiseToStr(paise), true, flags);
  }

  function fixAlnum(s, pattern) {
    let changed = false;
    const out = [...s].map((ch, i) => {
      const k = pattern[i];
      if (k === "A" && /[0-9]/.test(ch) && ALPHA_FIX[ch]) { changed = true; return ALPHA_FIX[ch]; }
      if (k === "9" && !/[0-9]/.test(ch) && DIGIT_FIX[ch]) { changed = true; return DIGIT_FIX[ch]; }
      return ch;
    }).join("");
    return [out, changed];
  }
  function idParser(re, pattern, flag) {
    return (raw, ocr) => {
      let s = String(raw || "").replace(/\s/g, "").toUpperCase(); const flags = [];
      if (ocr && s.length === 10 && !re.test(s)) { const [f, ch] = fixAlnum(s, pattern); if (ch) { flags.push("ocr_character_correction"); s = f; } }
      const ok = re.test(s);
      if (ok && pattern === "AAAAA9999A" && !"PCHFATBLJG".includes(s[3])) flags.push("unusual_pan_holder_type");
      return res(raw, ok ? s : null, ok, ok ? flags : flags.concat([flag]));
    };
  }
  const parsePan = idParser(PAN_RE, "AAAAA9999A", "invalid_pan_format");
  const parseTan = idParser(TAN_RE, "AAAA99999A", "invalid_tan_format");
  const simple = (re, clean, flag) => (raw) => { const s = clean(String(raw || "")); const ok = re.test(s); return res(raw, ok ? s : null, ok, ok ? [] : [flag]); };
  const parseIfsc = simple(IFSC_RE, (s) => s.replace(/\s/g, "").toUpperCase(), "invalid_ifsc_format");
  const parseAccount = simple(ACCOUNT_RE, (s) => s.replace(/[\s-]/g, ""), "invalid_account_number");
  function parseMobile(raw) {
    let s = String(raw || "").replace(/[\s-]/g, "");
    if (s.startsWith("+91")) s = s.slice(3); else if (s.length === 12 && s.startsWith("91")) s = s.slice(2);
    const ok = MOBILE_RE.test(s); return res(raw, ok ? s : null, ok, ok ? [] : ["invalid_mobile"]);
  }
  function parseEmail(raw) { const s = String(raw || "").trim().toLowerCase(); const ok = EMAIL_RE.test(s) && s.length <= 254; return res(raw, ok ? s : null, ok, ok ? [] : ["invalid_email"]); }
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function mkDate(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    if (y < 1900 || y > 2100) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  function parseDate(raw) {
    const s = String(raw || "").trim(); let m, v = null;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) v = mkDate(+m[1], +m[2], +m[3]);
    else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) v = mkDate(+m[3], +m[2], +m[1]);
    else if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})$/)) && MONTHS.includes(m[2].toLowerCase())) v = mkDate(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
    return res(raw, v, !!v, v ? [] : ["invalid_date"]);
  }
  function parseInt_(raw) { const s = String(raw).trim(); if (!/^\d+$/.test(s)) return res(raw, null, false, ["not_an_integer"]); const v = +s; return res(raw, v, v <= 10000, v <= 10000 ? [] : ["out_of_range"]); }
  function parseBool(raw) {
    const s = String(raw).trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(s)) return res(raw, true, true, []);
    if (["0", "false", "no", "n", "off", ""].includes(s)) return res(raw, false, true, []);
    return res(raw, null, false, ["not_a_boolean"]);
  }
  function parseText(raw) { const s = String(raw || "").replace(/[\x00-\x1f\x7f]/g, "").trim(); const ok = s.length > 0 && s.length <= 200; return res(raw, ok ? s : null, ok, ok ? [] : ["invalid_text"]); }
  function parserFor(type) {
    if (type.startsWith("enum:")) { const opts = type.slice(5).split("|"); return (raw) => { const s = String(raw || "").trim(); const ok = opts.includes(s); return res(raw, ok ? s : null, ok, ok ? [] : ["not_an_allowed_option"]); }; }
    return { money: parseMoney, pan: parsePan, tan: parseTan, ifsc: parseIfsc, account: parseAccount, mobile: parseMobile, email: parseEmail,
      date: parseDate, int: parseInt_, bool: parseBool, text: parseText }[type];
  }
  root.ITHValidators = { parseMoney, parsePan, parseTan, parseIfsc, parseAccount, parseMobile, parseEmail, parseDate, parserFor };
  if (typeof module !== "undefined") module.exports = root.ITHValidators;
})(typeof window !== "undefined" ? window : globalThis);
