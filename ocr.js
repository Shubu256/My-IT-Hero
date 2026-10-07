/* Document reading in the browser (port of myithero/ocr.py).
   Files never leave the device. Text PDFs are read with PDF.js; images and
   scanned pages with Tesseract.js; HEIC/HEIF photos are converted with heic2any.
   These three libraries are loaded on demand from the jsDelivr / cdnjs CDNs.
   Every value read is only a suggestion until the user accepts it. */
(function (root) {
  "use strict";
  const V = root.ITHValidators;
  const T = {"DOC_TYPES": [["form16", "Form 16", ["form\\s*no\\.?\\s*16\\b", "\\bform\\s*16\\b", "section 203", "certificate under section 203"]], ["form16a", "Form 16A", ["form\\s*no\\.?\\s*16a", "\\bform\\s*16a\\b"]], ["form26as", "Form 26AS", ["26as", "annual tax statement"]], ["ais", "AIS", ["annual information statement"]], ["tis", "TIS", ["taxpayer information summary"]], ["salary_slip", "Salary slip", ["pay\\s*slip", "salary\\s*slip", "earnings.*deductions"]], ["interest_cert", "Bank interest certificate", ["interest certificate", "certificate of interest", "interest (paid|earned|credited)"]], ["home_loan", "Home-loan certificate", ["housing loan", "home loan", "provisional (interest )?certificate"]], ["rent", "Rent receipt / agreement", ["rent receipt", "rent agreement", "leave and licen[cs]e"]], ["capital_gains", "Capital-gains statement", ["capital gain", "\\bltcg\\b", "\\bstcg\\b", "realised gain", "realized gain"]], ["dividend", "Dividend statement", ["dividend"]], ["insurance", "Insurance premium receipt", ["premium (paid )?receipt", "policy\\s*(no|number)", "health insurance", "mediclaim"]], ["donation", "Donation receipt (80G)", ["\\b80g\\b", "donation"]], ["investment", "Investment proof", ["\\bppf\\b", "\\belss\\b", "\\bnsc\\b", "\\bnps\\b", "provident fund"]]], "FIELD_PATTERNS": {"salary_17_1": ["17\\s*\\(\\s*1\\s*\\)", "salary as per provisions contained in section 17"], "perquisites_17_2": ["17\\s*\\(\\s*2\\s*\\)", "value of perquisites"], "profits_17_3": ["17\\s*\\(\\s*3\\s*\\)", "profits in lieu of salary"], "exempt_allowances": ["total amount of exemption claimed under section 10", "exempt(ed)? under section 10"], "professional_tax": ["tax on employment", "professional tax"], "tds_salary": ["total (amount of )?tax deducted", "tax deducted at source", "net tax deducted"], "tds_other": ["total (amount of )?tax deducted", "tds deducted", "tax deducted"], "d_80c": ["80\\s*c(?![a-z])"], "d_80ccd1b": ["80\\s*ccd\\s*\\(\\s*1b\\s*\\)"], "d_80ccd2": ["80\\s*ccd\\s*\\(\\s*2\\s*\\)"], "d_80d_self": ["80\\s*d(?![a-z])", "premium (amount|paid)", "total premium"], "d_80e": ["80\\s*e(?![a-z])"], "d_80g": ["80\\s*g(?![a-z])", "donation amount", "amount (of donation|donated|received)"], "hp_interest_24b": ["interest (component|paid|payable|amount)", "total interest", "section 24"], "os_savings_interest": ["savings.*interest", "interest.*savings"], "os_deposit_interest": ["(fixed|term|recurring) deposit.*interest", "total interest (paid|credited|earned)", "interest (paid|credited|earned)"], "os_dividend": ["total dividend", "dividend (amount|paid|received)"], "cg_ltcg_112a": ["long[- ]term.*(gain|112a)", "\\bltcg\\b"], "cg_stcg_111a": ["short[- ]term.*(gain|111a)", "\\bstcg\\b"]}, "DOC_FIELDS": {"form16": ["salary_17_1", "perquisites_17_2", "profits_17_3", "exempt_allowances", "professional_tax", "tds_salary", "d_80c", "d_80ccd1b", "d_80ccd2", "d_80d_self", "d_80e", "d_80g"], "salary_slip": [], "form16a": ["tds_other"], "form26as": [], "ais": [], "tis": [], "interest_cert": ["os_savings_interest", "os_deposit_interest", "tds_other"], "home_loan": ["hp_interest_24b"], "capital_gains": ["cg_ltcg_112a", "cg_stcg_111a"], "dividend": ["os_dividend", "tds_other"], "insurance": ["d_80d_self"], "donation": ["d_80g"], "investment": ["d_80c"], "rent": [], "other": []}, "MONEY_TOKEN": "(?<![A-Za-z0-9/(])(?:₹|Rs\\.?|INR)?\\s?((?:\\d[\\dOoIlSB,]*|[OoIlSB]\\d[\\dOoIlSB,]*)(?:\\.[\\dOoIlSB]{1,2})?)(?![A-Za-z0-9)%])"};
  const LOW_CONFIDENCE = 0.8;
  const ALLOWED_EXT = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif" };
  const HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"];
  const CDN = {
    pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    pdfworker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    tesseract: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    heic2any: "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js",
  };

  class DocError extends Error {
    constructor(code, message, userAction, status) { super(message); this.body = { success: false, error_code: code, message, user_action: userAction }; this.status = status || 422; }
  }

  // ------------------------------------------------------------ validation
  function sniff(b) {
    const s = (i, n) => String.fromCharCode(...b.slice(i, i + n));
    if (s(0, 5) === "%PDF-") return "application/pdf";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b[0] === 0x89 && s(1, 3) === "PNG") return "image/png";
    if (b.length > 12 && s(4, 4) === "ftyp" && HEIF_BRANDS.includes(s(8, 4))) return "image/heic";
    return null;
  }
  function sanitizeFilename(name) {
    name = String(name || "document").split(/[\\/]/).pop().replace(/\0/g, "");
    name = name.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^[ .]+|[ .]+$/g, "").slice(0, 120);
    return name || "document";
  }
  function containsAscii(bytes, needle) {
    const n = [...needle].map((c) => c.charCodeAt(0));
    outer: for (let i = 0; i <= bytes.length - n.length; i++) { for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer; return true; }
    return false;
  }
  function validateUpload(filename, bytes, maxBytes) {
    if (!bytes.length) throw new DocError("EMPTY_FILE", "The uploaded file is empty.", "Choose a different file.", 400);
    if (bytes.length > maxBytes) throw new DocError("FILE_TOO_LARGE", "The uploaded file is larger than the allowed limit.", `Upload a file under ${Math.floor(maxBytes / 1048576)} MB.`, 413);
    const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
    if (!ALLOWED_EXT[ext]) throw new DocError("UNSUPPORTED_TYPE", "Only PDF, JPG, JPEG, PNG, HEIC and HEIF files are accepted.", "Convert the file and upload again.", 415);
    const real = sniff(bytes);
    if (!real) throw new DocError("INVALID_DOCUMENT", "The file content does not match a supported format.", "Upload a genuine PDF or image.", 415);
    if (!(real === ALLOWED_EXT[ext] || (real === "image/heic" && (ext === "heic" || ext === "heif"))))
      throw new DocError("TYPE_MISMATCH", "The file extension does not match its content.", "Rename the file correctly or export it again.", 415);
    if (real === "application/pdf" && ["/JavaScript", "/JS ", "/Launch", "/EmbeddedFile"].some((k) => containsAscii(bytes, k)))
      throw new DocError("UNSAFE_PDF", "This PDF contains active content (scripts or embedded files) and was rejected.", "Print it to a new PDF and upload that.", 415);
    return real;
  }

  // ------------------------------------------------------------ CDN loader
  const loading = {};
  function loadScript(url) {
    if (!loading[url]) loading[url] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url; s.async = true; s.crossOrigin = "anonymous";
      s.onload = resolve;
      s.onerror = () => { delete loading[url]; reject(new DocError("READER_UNAVAILABLE", "The document reader could not be loaded.", "Check your internet connection and try again, or type the values in My Return.", 503)); };
      document.head.append(s);
    });
    return loading[url];
  }

  // ------------------------------------------------------------ text extraction
  let tessWorker = null;
  async function ocrCanvas(canvas, progress) {
    await loadScript(CDN.tesseract);
    if (!tessWorker) { progress && progress("Loading the OCR engine (first time only)…"); tessWorker = await root.Tesseract.createWorker("eng"); }
    progress && progress("Reading text…");
    const { data } = await tessWorker.recognize(canvas);
    const out = [];
    for (const ln of data.lines || []) {
      const text = (ln.text || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const confs = (ln.words || []).map((w) => w.confidence).filter((c) => c >= 0);
      out.push({ text, conf: confs.length ? Math.min(...confs) / 100 : (ln.confidence || 50) / 100 });
    }
    return out;
  }
  function prepCanvas(source, w, h) {
    const scale = w < 1600 ? 1600 / w : 1;
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }
  async function extractPages(bytes, mime, maxPages, progress) {
    if (mime === "application/pdf") {
      await loadScript(CDN.pdfjs);
      const pdfjs = root.pdfjsLib; pdfjs.GlobalWorkerOptions.workerSrc = CDN.pdfworker;
      let pdf;
      try { pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false }).promise; }
      catch (e) {
        if (e && e.name === "PasswordException") throw new DocError("ENCRYPTED_PDF", "This PDF is password-protected.", "Remove the password (e.g. print to PDF) and upload again.");
        throw new DocError("INVALID_DOCUMENT", "The uploaded file could not be processed.", "Please upload a clearer PDF or image.");
      }
      if (pdf.numPages > maxPages) throw new DocError("TOO_MANY_PAGES", `The PDF has ${pdf.numPages} pages; the limit is ${maxPages}.`, "Upload only the relevant pages.");
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        progress && progress(`Reading page ${i} of ${pdf.numPages}…`);
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const rows = new Map();
        for (const it of tc.items) {
          if (!it.str || !it.str.trim()) continue;
          const y = Math.round(it.transform[5] / 3) * 3;
          if (!rows.has(y)) rows.set(y, []);
          rows.get(y).push({ x: it.transform[4], s: it.str });
        }
        const text = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => items.sort((a, b) => a.x - b.x).map((x) => x.s).join(" ").replace(/\s+/g, " ").trim());
        if (text.join("").length >= 30) pages.push({ page: i, method: "pdf_text", lines: text.filter(Boolean).map((t) => ({ text: t, conf: 0.97 })) });
        else {
          const vp = page.getViewport({ scale: 200 / 72 });
          const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
          pages.push({ page: i, method: "ocr", lines: await ocrCanvas(c, progress) });
        }
      }
      return { pages, count: pdf.numPages };
    }
    let blob = new Blob([bytes], { type: mime });
    if (mime === "image/heic") {
      progress && progress("Converting HEIC/HEIF photo…");
      await loadScript(CDN.heic2any);
      try { const r = await root.heic2any({ blob, toType: "image/png" }); blob = Array.isArray(r) ? r[0] : r; }
      catch (e) { throw new DocError("INVALID_DOCUMENT", "The HEIC/HEIF image could not be processed.", "Upload a clearer image or a JPG/PDF."); }
    }
    let bmp;
    try { bmp = await createImageBitmap(blob); }
    catch (e) { throw new DocError("INVALID_DOCUMENT", "The uploaded file could not be processed.", "Please upload a clearer PDF or image."); }
    if (bmp.width < 300 || bmp.height < 300) throw new DocError("LOW_RESOLUTION", "The image resolution is too low to read reliably.", "Upload a clearer photo or scan (at least 300×300 pixels, ideally 1500+ wide).");
    if (bmp.width * bmp.height > 40000000) throw new DocError("IMAGE_TOO_LARGE", "The image has too many pixels.", "Resize the photo and upload again.");
    return { pages: [{ page: 1, method: "ocr", lines: await ocrCanvas(prepCanvas(bmp, bmp.width, bmp.height), progress) }], count: 1 };
  }

  // ------------------------------------------------------------ classification & extraction (pure functions, unit-tested)
  function classify(text) {
    const t = text.toLowerCase();
    let best = ["other", "Other tax document"], bestScore = 0;
    for (const [key, label, pats] of T.DOC_TYPES) {
      const score = pats.filter((p) => new RegExp(p).test(t)).length;
      if (score > bestScore) { best = [key, label]; bestScore = score; }
    }
    return [best[0], best[1], bestScore === 0 ? 0 : Math.min(0.95, Math.round((0.55 + 0.2 * bestScore) * 100) / 100)];
  }
  const MONEY_TOKEN = new RegExp(T.MONEY_TOKEN, "g");
  const SECTION_REF = /(section|sec\.?|u\/s|rule|form|schedule|chapter)\s*$/i;
  function moneyIn(text) {
    const toks = [];
    for (const m of text.matchAll(MONEY_TOKEN)) {
      const tok = m[1].replace(/,+$/, "");
      if ((tok.match(/\d/g) || []).length < 2) continue;
      if (/^(19|20)\d\d$/.test(tok)) continue;
      if (SECTION_REF.test(text.slice(0, m.index + m[0].indexOf(m[1])))) continue;
      const end = m.index + m[0].length;
      if (text.slice(end, end + 2).trimStart().startsWith("(")) continue;
      toks.push(tok);
    }
    return toks;
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  function sugg(fid, page, raw, p, conf, flags) {
    conf = Math.max(0, Math.min(1, round2(conf)));
    let status = p.ok ? "valid" : "invalid";
    if (status === "valid" && conf < LOW_CONFIDENCE) status = "low_confidence";
    return { field_id: fid, page, raw_value: raw, normalized_value: p.value === null ? null : String(p.value), confidence: conf, flags, validation_status: status };
  }
  function candidate(fid, lines, idx, pat, ocr, page) {
    const ln = lines[idx];
    const m = new RegExp(pat).exec(ln.text.toLowerCase());
    if (!m) return null;
    let toks = moneyIn(ln.text.slice(m.index + m[0].length));
    let conf = ln.conf; const flags = [], used = [idx];
    if (!toks.length && idx + 1 < lines.length) {
      toks = moneyIn(lines[idx + 1].text);
      conf = Math.min(conf, lines[idx + 1].conf) - 0.1;
      flags.push("value_on_next_line"); used.push(idx + 1);
    }
    if (!toks.length) return null;
    const raw = toks[toks.length - 1];
    const p = V.parseMoney(raw, ocr);
    flags.push(...p.flags);
    if (p.flags.includes("ocr_character_correction")) conf -= 0.3;
    if (toks.length > 1) { flags.push("multiple_numbers_on_line"); conf -= 0.1; }
    const s = sugg(fid, page, raw, p, conf, flags);
    s._lines = used;
    return s;
  }
  function findId(lines, labelRx, parser, tokenRx, ocr, page, preferHolder) {
    let cands = [];
    lines.forEach((ln, idx) => {
      for (const tok of ln.text.toUpperCase().match(new RegExp(tokenRx, "g")) || []) {
        const p = parser(tok, ocr);
        if (!p.ok) continue;
        const lab = new RegExp(labelRx);
        const labelled = lab.test(ln.text.toLowerCase()) || (idx > 0 && lab.test(lines[idx - 1].text.toLowerCase()));
        cands.push({ labelled, tok, p, conf: ln.conf });
      }
    });
    if (!cands.length) return null;
    if (preferHolder) { const held = cands.filter((c) => c.p.value[3] === preferHolder); if (held.length) cands = held; }
    cands.sort((a, b) => (b.labelled ? 1 : 0) - (a.labelled ? 1 : 0));
    let { labelled, tok, p, conf } = cands[0];
    const flags = [...p.flags];
    if (new Set(cands.map((c) => c.p.value)).size > 1) { flags.push("multiple_candidates"); conf -= 0.15; }
    if (!labelled) { conf -= 0.15; flags.push("no_label_found"); }
    if (flags.includes("ocr_character_correction")) conf -= 0.3;
    return sugg(null, page, tok, p, conf, flags);
  }
  function extractFields(pages, docType) {
    const out = [], consumed = new Set();
    for (const fid of T.DOC_FIELDS[docType] || []) {
      let best = null;
      for (const pg of pages) {
        const ocr = pg.method === "ocr";
        for (let idx = 0; idx < pg.lines.length; idx++) {
          if (consumed.has(pg.page + ":" + idx)) continue;
          for (const pat of T.FIELD_PATTERNS[fid] || []) {
            let c = candidate(fid, pg.lines, idx, pat, ocr, pg.page);
            if (c && c._lines.slice(1).some((i) => consumed.has(pg.page + ":" + i))) c = null;
            if (c && (!best || c.confidence > best.confidence)) best = c;
            if (c) break;
          }
        }
      }
      if (best) { best._lines.forEach((i) => consumed.add(best.page + ":" + i)); delete best._lines; out.push(best); }
    }
    for (const pg of pages) {
      const ocr = pg.method === "ocr";
      if (!out.some((o) => o.field_id === "pan")) {
        const s = findId(pg.lines, "pan\\s*(of|no|number)?\\s*(the)?\\s*(employee|deductee|assessee|holder|customer|borrower|investor)?", V.parsePan, "\\b[A-Z0-9]{5}[A-Z0-9]{4}[A-Z0-9]\\b", ocr, pg.page, "P");
        if (s) { s.field_id = "pan"; out.push(s); }
      }
      if (docType === "form16" && !out.some((o) => o.field_id === "employer_tan")) {
        const s = findId(pg.lines, "tan\\s*(of|no)?\\s*(the)?\\s*(deductor|employer)?", V.parseTan, "\\b[A-Z0-9]{4}[A-Z0-9]{5}[A-Z0-9]\\b", ocr, pg.page);
        if (s) { s.field_id = "employer_tan"; out.push(s); }
      }
    }
    return out;
  }

  async function processFile(file, opts) {
    const name = sanitizeFilename(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = validateUpload(name, bytes, opts.maxBytes);
    const { pages, count } = await extractPages(bytes, mime, opts.maxPages, opts.progress);
    const full = pages.flatMap((p) => p.lines.map((l) => l.text)).join("\n");
    if (full.trim().length < 20) throw new DocError("NO_TEXT_FOUND", "No readable text was found in this document.", "Upload a clearer scan or the original PDF.");
    const [docType, label, conf] = classify(full);
    return { name, mime, size: bytes.length, pages: count, doc_type: docType, doc_label: label, doc_type_confidence: conf,
      suggestions: extractFields(pages, docType), methods: [...new Set(pages.map((p) => p.method))].sort() };
  }

  root.ITHOcr = { processFile, validateUpload, sniff, sanitizeFilename, classify, extractFields, moneyIn, DocError, LOW_CONFIDENCE, DOC_TYPES: T.DOC_TYPES, CDN };
  if (typeof module !== "undefined") module.exports = root.ITHOcr;
})(typeof window !== "undefined" ? window : globalThis);
