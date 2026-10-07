/* My IT Hero — browser-only "server". Implements the same API the Flask
   backend exposes, but runs inside the page and stores everything in this
   browser's localStorage. Nothing is sent anywhere. Uploaded files are read in
   memory and never stored; only the values you accept are kept. */
(function (root) {
  "use strict";
  const KEY = "myithero:v1";
  const E = root.ITHEngine, V = root.ITHValidators, O = root.ITHOcr, WS = root.ITHWorksheet, DATA = root.ITH_DATA;
  const AY = DATA.active;
  const CONFIG = { RETENTION_DAYS: 30, MAX_UPLOAD_BYTES: 10 * 1024 * 1024, MAX_PDF_PAGES: 20, MAX_DOCS: 30, SESSION_IDLE: 30 * 60, SESSION_ABS: 12 * 3600, MAX_OUTPUTS: 20 };
  const STATUS = { V: "Verified", R: "Needs Review", M: "Missing", W: "Warning", E: "Error" };

  class LocalError extends Error {
    constructor(code, message, userAction, status, details) {
      super(message);
      this.body = { success: false, error_code: code, message, user_action: userAction || null };
      if (details !== undefined) this.body.details = details;
      this.status = status || 400;
    }
  }
  const now = () => Date.now() / 1000;

  // ------------------------------------------------------------ storage
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) return s; } catch (e) { /* corrupt or blocked */ }
    return { v: 1, seq: 1, users: {}, session: null, returns: {}, documents: {}, outputs: {} };
  }
  function save(st) {
    try { localStorage.setItem(KEY, JSON.stringify(st)); }
    catch (e) { throw new LocalError("STORAGE_FULL", "This browser's storage for My IT Hero is full or blocked.", "Delete old worksheets in Downloads, or allow site data for this page.", 507); }
  }
  const nextId = (st) => st.seq++;

  // ------------------------------------------------------------ passwords (PBKDF2-SHA256)
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function pbkdf2(pw, salt, iter) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256));
  }
  async function hashPassword(pw) { const salt = crypto.getRandomValues(new Uint8Array(16)); const iter = 210000; return { salt: b64(salt), iter, hash: b64(await pbkdf2(pw, salt, iter)) }; }
  async function verifyPassword(rec, pw) {
    const h = await pbkdf2(pw, unb64(rec.salt), rec.iter); const ref = unb64(rec.hash);
    let diff = h.length ^ ref.length; for (let i = 0; i < h.length; i++) diff |= h[i] ^ ref[i]; return diff === 0;
  }
  function passwordProblems(pw) {
    const p = [];
    if (typeof pw !== "string" || pw.length < 10) p.push("at least 10 characters"); else if (pw.length > 128) p.push("at most 128 characters");
    if (typeof pw === "string") { if (!/[A-Za-z]/.test(pw)) p.push("a letter"); if (!/[0-9]/.test(pw)) p.push("a number"); }
    return p;
  }

  // ------------------------------------------------------------ session
  function currentUser(st) {
    const s = st.session;
    if (!s) return { user: null, expired: false };
    const t = now();
    if (s.expires < t || s.lastSeen + CONFIG.SESSION_IDLE < t || !st.users[s.userId]) { st.session = null; save(st); return { user: null, expired: true }; }
    s.lastSeen = t; save(st);
    const u = st.users[s.userId];
    return { user: { id: u.id, email: u.email, mobile: u.mobile, email_verified: false, mobile_verified: false, is_admin: true, retain_documents: !!u.retain }, expired: false };
  }
  function requireUser(st) {
    const { user, expired } = currentUser(st);
    if (!user) {
      if (expired) throw new LocalError("SESSION_EXPIRED", "Your session has expired.", "Sign in again to continue.", 401);
      throw new LocalError("AUTH_REQUIRED", "You need to sign in to do this.", "Sign in and try again.", 401);
    }
    return user;
  }
  function findUser(st, ident) {
    const e = V.parseEmail(ident); if (e.ok) return Object.values(st.users).find((u) => u.email === e.value);
    const m = V.parseMobile(ident); if (m.ok) return Object.values(st.users).find((u) => u.mobile === m.value);
    return null;
  }

  // ------------------------------------------------------------ return model
  const catalog = () => DATA.mapping[AY].fields;
  const catById = () => Object.fromEntries(catalog().map((f) => [f.field_id, f]));
  function getReturn(st, user) {
    st.returns[user.id] = st.returns[user.id] || {};
    let r = st.returns[user.id][AY];
    if (!r) { r = st.returns[user.id][AY] = { regime: "new", fields: {}, created_at: now(), updated_at: now() }; save(st); }
    return r;
  }
  const docsOf = (st, user) => (st.documents[user.id] = st.documents[user.id] || []);
  const outsOf = (st, user) => (st.outputs[user.id] = st.outputs[user.id] || []);
  function typedValues(ret) {
    const cat = catById(); const out = {};
    for (const [fid, row] of Object.entries(ret.fields)) {
      const f = cat[fid]; if (!f || row.value === null || row.value === "") continue;
      out[fid] = f.data_type === "bool" ? row.value === "true" : f.data_type === "int" ? Number(row.value) : row.value;
    }
    return out;
  }
  function norm(v) { const p = V.parseMoney(v); return p.ok ? p.value.replace(/\.?0+$/, "") || "0" : String(v); }
  function conflicts(st, user, ret) {
    const by = {};
    for (const d of docsOf(st, user)) for (const e of d.extractions) {
      if (e.status === "rejected" || e.normalized_value === null) continue;
      (by[e.field_id] = by[e.field_id] || []).push({ value: e.normalized_value, source: d.orig_name, page: e.page, extraction_id: e.id, status: e.status });
    }
    const out = {};
    for (const [fid, cands] of Object.entries(by)) {
      const vals = new Set(cands.map((c) => norm(c.value)));
      const cur = ret.fields[fid] ? ret.fields[fid].value : null;
      if (cur !== null && cur !== undefined && cur !== "") vals.add(norm(cur));
      if (vals.size > 1) out[fid] = { current: cur, candidates: cands };
    }
    return out;
  }
  function fieldStatus(f, row, conflict, regime) {
    if (conflict) return STATUS.W;
    if (!row || row.value === null || row.value === "") return f.required ? STATUS.M : null;
    if (!V.parserFor(f.data_type)(row.value).ok) return STATUS.E;
    if (!f.regimes.includes(regime) && f.group === "deductions" && !["0", "0.00"].includes(row.value)) return STATUS.W;
    return row.user_verified ? STATUS.V : STATUS.R;
  }
  function docName(st, user, id) { const d = docsOf(st, user).find((x) => x.id === id); return d ? d.orig_name : null; }

  function calc(st, user, ret, regime) {
    const vals = typedValues(ret);
    const res = E.compute(vals, regime, AY);
    const sel = E.selectItr(vals, AY, res.summary.total_income);
    const conf = conflicts(st, user, ret);
    const unverified = Object.values(ret.fields).filter((r) => !r.user_verified).length;
    if (Object.keys(conf).length) res.warnings.unshift({ code: "CONFLICTS", severity: "error", message: `${Object.keys(conf).length} value(s) differ between your documents and your return. Resolve them before filing.` });
    if (unverified) res.warnings.unshift({ code: "UNVERIFIED", severity: "warning", message: `${unverified} value(s) taken from documents are not yet confirmed by you.` });
    res.itr = sel; res.financial_year = DATA.rules[AY].financial_year;
    return res;
  }
  function buildMapping(st, user, ret, regime, itr, summary) {
    const mp = DATA.mapping[AY]; const conf = conflicts(st, user, ret); const out = [];
    for (const f of mp.fields) {
      const m = f.mappings.find((x) => x.itr_form === itr) || null;
      if ((!m && ["flags", "filing"].includes(f.group)) || (!f.mappings.length && f.group !== "computed")) continue;
      let row = null, val, status;
      if (f.group === "computed") { val = summary[f.field_id]; status = "Calculated"; }
      else {
        row = ret.fields[f.field_id] || null; val = row ? row.value : null;
        status = fieldStatus(f, row, conf[f.field_id], regime) || "Not applicable";
        if ((val === null || val === "") && !f.required) continue;
        if (!f.regimes.includes(regime)) status = "Not used in this regime";
      }
      out.push({ field_id: f.field_id, display_name: f.display_name, value: val, help: f.help, keywords: f.keywords, group: f.group, data_type: f.data_type,
        assessment_year: AY, regime, itr_form: itr, schedule: m ? m.schedule : null, section: m ? m.section : null, portal_label: m ? m.portal_label : null,
        portal_path: m ? m.portal_path : null, mapping_verification: m ? m.verification : "No mapping for this ITR form",
        source_document: f.group === "computed" ? "Calculated by My IT Hero" : (row && row.source_document_id ? docName(st, user, row.source_document_id) : null),
        source_page: row ? row.source_page : null, confidence: row ? row.confidence : null, verified: row ? !!row.user_verified : null, status, required: f.required });
    }
    return { fields: out, disclaimer: mp.disclaimer, portal_url: mp.portal_url, mapping_version: mp.mapping_version, last_verified: mp.last_verified, stale: !!mp.stale };
  }
  function cleanup(st) {
    const t = now(); let changed = false;
    for (const [uid, docs] of Object.entries(st.documents)) {
      const keep = docs.filter((d) => d.expires_at >= t);
      if (keep.length !== docs.length) {
        const gone = new Set(docs.filter((d) => d.expires_at < t).map((d) => d.id));
        for (const r of Object.values(st.returns[uid] || {})) for (const row of Object.values(r.fields)) if (gone.has(row.source_document_id)) row.source_document_id = null;
        st.documents[uid] = keep; changed = true;
      }
    }
    if (changed) save(st);
  }

  // ------------------------------------------------------------ router
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });
  const body = (b) => { if (!b || typeof b !== "object" || Array.isArray(b)) throw new LocalError("INVALID_REQUEST", "The request body must be JSON.", null, 400); return b; };

  route("GET", "/api/auth/csrf", () => ({ email_configured: false, sms_configured: false, dev_mode: false }));
  route("GET", "/api/auth/me", ({ st }) => { const { user, expired } = currentUser(st); return { user, session_expired: expired }; });
  route("POST", "/api/auth/signup", async ({ st, b }) => {
    b = body(b);
    const e = V.parseEmail(b.email), m = V.parseMobile(b.mobile), errs = {};
    if (!e.ok) errs.email = "Enter a valid email address.";
    if (!m.ok) errs.mobile = "Enter a valid 10-digit Indian mobile number.";
    const probs = passwordProblems(b.password); if (probs.length) errs.password = "Password needs " + probs.join(", ") + ".";
    if (!b.accept_terms) errs.accept_terms = "Accept the Terms of Use and Privacy Policy to continue.";
    if (Object.keys(errs).length) throw new LocalError("VALIDATION_FAILED", "Some details need fixing.", "Correct the highlighted fields.", 422, errs);
    if (Object.values(st.users).some((u) => u.email === e.value || u.mobile === m.value))
      throw new LocalError("ALREADY_REGISTERED", "An account with this email or mobile already exists in this browser.", "Sign in instead.", 409);
    const id = nextId(st);
    st.users[id] = { id, email: e.value, mobile: m.value, pw: await hashPassword(b.password), created_at: now(), failed: 0, locked_until: 0, retain: false };
    st.session = { userId: id, created: now(), lastSeen: now(), expires: now() + CONFIG.SESSION_ABS };
    save(st);
    return { message: "Account created on this device. You are signed in.", next: "signed_in" };
  });
  route("POST", "/api/auth/signin", async ({ st, b }) => {
    b = body(b);
    const u = findUser(st, b.identifier || "");
    const fail = () => new LocalError("INVALID_CREDENTIALS", "The email/mobile or password is incorrect.", "Check your details and try again. Accounts exist only in the browser where they were created.", 401);
    if (!u) { await hashPassword(String(b.password || "x")); throw fail(); }
    if (u.locked_until > now()) throw new LocalError("ACCOUNT_LOCKED", "Too many failed sign-in attempts.", "Wait 15 minutes and try again.", 423);
    if (!(await verifyPassword(u.pw, String(b.password || "")))) {
      u.failed += 1; if (u.failed >= 5) { u.locked_until = now() + 900; u.failed = 0; } save(st); throw fail();
    }
    u.failed = 0; u.locked_until = 0;
    st.session = { userId: u.id, created: now(), lastSeen: now(), expires: now() + CONFIG.SESSION_ABS };
    save(st);
    return { message: "Signed in." };
  });
  route("POST", "/api/auth/logout", ({ st }) => { st.session = null; save(st); return { message: "Signed out." }; });
  route("POST", "/api/auth/forgot", () => { throw new LocalError("RESET_UNAVAILABLE", "This edition runs only in your browser, so it cannot email you a reset code.", "If you've forgotten your password, erase this browser's My IT Hero data below and create a new account.", 501); });
  route("POST", "/api/auth/reset", () => { throw new LocalError("RESET_UNAVAILABLE", "Password reset by code is not available in this edition.", null, 501); });
  route("POST", "/api/auth/mobile/send", () => { throw new LocalError("SMS_NOT_CONFIGURED", "SMS delivery is not configured.", "Mobile verification needs the server edition with an SMS gateway.", 503); });
  route("POST", "/api/auth/mobile/verify", () => { throw new LocalError("SMS_NOT_CONFIGURED", "SMS delivery is not configured.", null, 503); });

  route("GET", "/api/meta", () => ({ active_ay: AY, financial_year: DATA.rules[AY].financial_year, years: Object.keys(DATA.rules), deadlines: DATA.rules[AY].deadlines, portal_url: DATA.mapping[AY].portal_url }));
  route("GET", "/api/rules", ({ q }) => {
    const regime = q.get("regime") || "new";
    if (!["new", "old"].includes(regime)) throw new LocalError("INVALID_REGIME", "Regime must be 'new' or 'old'.", null, 400);
    const r = DATA.rules[AY], reg = r.regimes[regime];
    const inputs = catalog().filter((f) => f.regimes.includes(regime) && ["deductions", "salary", "house_property"].includes(f.group) && !["d_80tta", "d_80ttb"].includes(f.field_id)
      && (f.regimes.length === 1 || f.group === "deductions" || ["hp_type", "hp_interest_24b", "basic_da"].includes(f.field_id)))
      .map((f) => ({ field_id: f.field_id, display_name: f.display_name, help: f.help, data_type: f.data_type, group: f.group }));
    return { assessment_year: AY, financial_year: r.financial_year, regime, name: reg.name, slabs: reg.slabs, slab_verification: reg.slab_verification,
      standard_deduction: reg.standard_deduction_salary, standard_deduction_verification: reg.standard_deduction_verification, rebate: reg.rebate_87a,
      surcharge: reg.surcharge, cess_rate: r.cess_rate, allowed_deductions: reg.allowed_deductions.map((d) => ({ id: d, section: r.deduction_limits[d].section, max: r.deduction_limits[d].max ?? null })),
      allows_exempt_allowances: reg.allows_exempt_allowances, allows_professional_tax: reg.allows_professional_tax, allows_self_occupied_interest: reg.allows_self_occupied_interest,
      inputs, special_rates: r.capital_gains };
  });
  route("GET", "/api/mapping/search", ({ q }) => {
    const term = (q.get("q") || "").trim().toLowerCase().slice(0, 60);
    const results = catalog().filter((f) => !term || f.display_name.toLowerCase().includes(term) || f.keywords.some((k) => k.includes(term)))
      .map((f) => ({ field_id: f.field_id, display_name: f.display_name, help: f.help, mappings: f.mappings, regimes: f.regimes })).slice(0, 40);
    return { results, disclaimer: DATA.mapping[AY].disclaimer };
  });

  route("GET", "/api/return", ({ st }) => {
    const user = requireUser(st), ret = getReturn(st, user), conf = conflicts(st, user, ret);
    const counts = { [STATUS.V]: 0, [STATUS.R]: 0, [STATUS.M]: 0, [STATUS.W]: 0, [STATUS.E]: 0 };
    const fields = catalog().filter((f) => f.group !== "computed").map((f) => {
      const row = ret.fields[f.field_id]; const s = fieldStatus(f, row, conf[f.field_id], ret.regime); if (s) counts[s] += 1;
      return { field_id: f.field_id, display_name: f.display_name, group: f.group, data_type: f.data_type, help: f.help, regimes: f.regimes, required: f.required,
        value: row ? row.value : null, provenance: row ? { source_document: row.source_document_id ? docName(st, user, row.source_document_id) : null, source_page: row.source_page,
          extraction_method: row.extraction_method, confidence: row.confidence, user_verified: !!row.user_verified, last_modified: row.last_modified } : null,
        status: s, conflict: conf[f.field_id] || null };
    });
    return { assessment_year: AY, financial_year: DATA.rules[AY].financial_year, regime: ret.regime, fields, counts, documents: docsOf(st, user).length,
      filled: fields.filter((f) => f.value !== null && f.value !== "").length };
  });
  route("PUT", "/api/return/fields", ({ st, b }) => {
    const user = requireUser(st), ret = getReturn(st, user); b = body(b);
    const vals = b.values; if (!vals || typeof vals !== "object" || Object.keys(vals).length > 100) throw new LocalError("INVALID_REQUEST", "Send an object of field values.", null, 400);
    const cat = catById(), errors = {}, saved = [];
    for (const [fid, raw] of Object.entries(vals)) {
      const f = cat[fid];
      if (!f || f.group === "computed") { errors[fid] = "Unknown field."; continue; }
      if (raw === null || raw === "") { delete ret.fields[fid]; saved.push(fid); continue; }
      const p = V.parserFor(f.data_type)(raw);
      if (!p.ok) { errors[fid] = "Invalid value (" + p.flags.join(", ") + ")."; continue; }
      const v = typeof p.value === "boolean" ? String(p.value) : String(p.value);
      ret.fields[fid] = { value: v, source_document_id: null, source_page: null, extraction_method: "manual", confidence: 1, user_verified: true, last_modified: now() };
      saved.push(fid);
    }
    ret.updated_at = now(); save(st);
    if (Object.keys(errors).length) throw new LocalError("VALIDATION_FAILED", "Some values could not be saved.", "Correct the highlighted fields.", 422, { errors, saved });
    return { saved };
  });
  route("POST", "/api/return/fields/:fid/verify", ({ st, p }) => {
    const user = requireUser(st), ret = getReturn(st, user);
    if (conflicts(st, user, ret)[p.fid]) throw new LocalError("CONFLICT_UNRESOLVED", "This value conflicts with a value in your documents.", "Choose which value is correct first.", 409);
    const row = ret.fields[p.fid]; if (!row) throw new LocalError("NOT_FOUND", "There is no value to verify.", null, 404);
    row.user_verified = true; row.last_modified = now(); save(st); return {};
  });
  route("POST", "/api/return/regime", ({ st, b }) => {
    const user = requireUser(st), ret = getReturn(st, user); const regime = body(b).regime;
    if (!["new", "old"].includes(regime)) throw new LocalError("INVALID_REGIME", "Regime must be 'new' or 'old'.", null, 400);
    ret.regime = regime; ret.updated_at = now(); save(st); return { regime };
  });
  route("DELETE", "/api/return", ({ st }) => {
    const user = requireUser(st);
    if (st.returns[user.id]) delete st.returns[user.id][AY];
    st.documents[user.id] = []; st.outputs[user.id] = []; save(st);
    return { message: "Return and its documents were deleted." };
  });
  route("GET", "/api/calc", ({ st, q }) => {
    const user = requireUser(st), ret = getReturn(st, user); const regime = q.get("regime") || ret.regime;
    if (!["new", "old"].includes(regime)) throw new LocalError("INVALID_REGIME", "Regime must be 'new' or 'old'.", null, 400);
    return calc(st, user, ret, regime);
  });
  route("GET", "/api/calc/compare", ({ st }) => {
    const user = requireUser(st), ret = getReturn(st, user);
    const n = calc(st, user, ret, "new"), o = calc(st, user, ret, "old");
    const a = Number(n.summary.total_tax_liability), c = Number(o.summary.total_tax_liability);
    return { new: n.summary, old: o.summary, itr: n.itr, lower: a < c ? "new" : c < a ? "old" : "equal", difference: String(Math.abs(a - c)), selected: ret.regime };
  });
  route("GET", "/api/mapping", ({ st, q }) => {
    const user = requireUser(st), ret = getReturn(st, user); const regime = q.get("regime") || ret.regime;
    const res = calc(st, user, ret, regime); const itr = q.get("itr") || res.itr.recommended;
    if (!["ITR-1", "ITR-2", "ITR-3", "ITR-4"].includes(itr)) throw new LocalError("INVALID_ITR", "Unknown ITR form.", null, 400);
    const mp = buildMapping(st, user, ret, regime, itr, res.summary);
    const term = (q.get("q") || "").trim().toLowerCase();
    if (term) mp.fields = mp.fields.filter((f) => f.display_name.toLowerCase().includes(term) || f.keywords.some((k) => k.includes(term)) || (f.schedule || "").toLowerCase().includes(term) || (f.portal_label || "").toLowerCase().includes(term));
    return { itr, recommended: res.itr.recommended, ...mp };
  });

  // documents
  function docJson(d) {
    const cat = catById(); const label = (O.DOC_TYPES.find((x) => x[0] === d.doc_type) || [0, "Other tax document"])[1];
    return { id: d.id, name: d.orig_name, mime: d.mime, size: d.size, pages: d.pages, doc_type: d.doc_type, doc_label: label, doc_type_confidence: d.doc_type_confidence,
      created_at: d.created_at, expires_at: d.expires_at, methods: d.methods,
      extractions: d.extractions.map((e) => ({ ...e, display_name: (cat[e.field_id] || {}).display_name || e.field_id,
        message: e.confidence < O.LOW_CONFIDENCE || e.validation_status !== "valid" ? "Please verify this value." : null })) };
  }
  route("POST", "/api/documents", async ({ st, b, opts }) => {
    const user = requireUser(st);
    if (docsOf(st, user).length >= CONFIG.MAX_DOCS) throw new LocalError("TOO_MANY_DOCUMENTS", "You have reached the document limit for this return.", "Delete documents you no longer need.", 400);
    const file = b instanceof FormData ? b.get("file") : null;
    if (!file) throw new LocalError("NO_FILE", "No file was uploaded.", "Choose a file and try again.", 400);
    const r = await O.processFile(file, { maxBytes: CONFIG.MAX_UPLOAD_BYTES, maxPages: CONFIG.MAX_PDF_PAGES, progress: opts.progress });
    const st2 = load(); // reload: OCR can take a while
    const u2 = requireUser(st2);
    const id = nextId(st2), t = now();
    const doc = { id, orig_name: r.name, mime: r.mime, size: r.size, pages: r.pages, doc_type: r.doc_type, doc_type_confidence: r.doc_type_confidence, methods: r.methods,
      created_at: t, expires_at: t + (st2.users[u2.id].retain ? 3650 : CONFIG.RETENTION_DAYS) * 86400,
      extractions: r.suggestions.map((s) => ({ id: nextId(st2), field_id: s.field_id, page: s.page, raw_value: s.raw_value, normalized_value: s.normalized_value,
        confidence: s.confidence, flags: s.flags, validation_status: s.validation_status, status: "pending" })) };
    docsOf(st2, u2).push(doc); save(st2);
    return { document: docJson(doc) };
  });
  route("GET", "/api/documents", ({ st }) => { const user = requireUser(st); return { documents: docsOf(st, user).slice().reverse().map(docJson), retention_days: CONFIG.RETENTION_DAYS }; });
  route("DELETE", "/api/documents/:id", ({ st, p }) => {
    const user = requireUser(st); const id = Number(p.id); const docs = docsOf(st, user);
    if (!docs.some((d) => d.id === id)) throw new LocalError("NOT_FOUND", "Document not found.", null, 404);
    st.documents[user.id] = docs.filter((d) => d.id !== id);
    for (const row of Object.values(getReturn(st, user).fields)) if (row.source_document_id === id) { row.source_document_id = null; row.extraction_method += " (source deleted)"; }
    save(st); return { message: "Document deleted." };
  });
  function findExtraction(st, user, id) {
    for (const d of docsOf(st, user)) { const e = d.extractions.find((x) => x.id === id); if (e) return [d, e]; }
    throw new LocalError("NOT_FOUND", "Extracted value not found.", null, 404);
  }
  route("POST", "/api/extractions/:id/accept", ({ st, p, b }) => {
    const user = requireUser(st), ret = getReturn(st, user); b = body(b || {});
    const [d, e] = findExtraction(st, user, Number(p.id));
    const f = catById()[e.field_id]; if (!f) throw new LocalError("NOT_FOUND", "Unknown field.", null, 404);
    const raw = b.value !== undefined ? b.value : e.normalized_value;
    const pr = V.parserFor(f.data_type)(raw);
    if (!pr.ok) throw new LocalError("VALIDATION_FAILED", "This value is not valid for " + f.display_name + ".", "Correct the value and accept again.", 422, { flags: pr.flags });
    const cur = ret.fields[e.field_id];
    if (cur && cur.value !== null && cur.value !== "" && norm(cur.value) !== norm(pr.value) && !b.replace)
      throw new LocalError("CONFLICT", "Your return already has a different value for this field.", "Compare the two values and choose which one to keep.", 409, { current: cur.value, document: String(pr.value) });
    const edited = String(raw) !== String(e.normalized_value);
    ret.fields[e.field_id] = { value: String(pr.value), source_document_id: d.id, source_page: e.page, extraction_method: edited ? "ocr+user_corrected" : "ocr",
      confidence: e.confidence, user_verified: true, last_modified: now() };
    e.status = "accepted"; e.normalized_value = String(pr.value);
    if (b.replace) for (const dd of docsOf(st, user)) for (const x of dd.extractions)
      if (x.field_id === e.field_id && x.id !== e.id && x.status === "pending" && x.normalized_value !== String(pr.value)) x.status = "rejected";
    save(st); return {};
  });
  route("POST", "/api/extractions/:id/reject", ({ st, p }) => { const user = requireUser(st); const [, e] = findExtraction(st, user, Number(p.id)); e.status = "rejected"; save(st); return {}; });

  // outputs
  const MIME = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  route("POST", "/api/outputs", ({ st, b }) => {
    const user = requireUser(st), ret = getReturn(st, user); b = body(b);
    const fmt = b.format, regime = b.regime || ret.regime;
    if (!["pdf", "docx"].includes(fmt) || !["new", "old"].includes(regime)) throw new LocalError("INVALID_REQUEST", "Choose PDF or DOCX and a regime.", null, 400);
    const res = calc(st, user, ret, regime); const itr = res.itr.recommended;
    const mp = buildMapping(st, user, ret, regime, itr, res.summary);
    const docs = docsOf(st, user).map((d) => ({ orig_name: d.orig_name, doc_type: d.doc_type, pages: d.pages, created_at: d.created_at }));
    const data = WS.worksheetData(AY, regime, res, mp, docs, user, conflicts(st, user, ret));
    const bytes = fmt === "pdf" ? WS.buildPdf(data) : WS.buildDocx(data);
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const out = { id: nextId(st), kind: fmt, regime, itr, filename: `MyITHero_Worksheet_AY${AY}_${regime}-regime_${itr}.${fmt}`, created_at: now(), emailed_at: null, data: btoa(bin) };
    const list = outsOf(st, user); list.push(out);
    while (list.length > CONFIG.MAX_OUTPUTS) list.shift();
    save(st);
    return { output: { id: out.id, filename: out.filename, kind: fmt, regime, itr } };
  });
  route("GET", "/api/outputs", ({ st }) => { const user = requireUser(st); return { outputs: outsOf(st, user).slice().reverse().map(({ data, ...o }) => o), email_configured: false }; });
  route("POST", "/api/outputs/:id/email", ({ st, p }) => { const user = requireUser(st); if (!outsOf(st, user).some((o) => o.id === Number(p.id))) throw new LocalError("NOT_FOUND", "File not found.", null, 404); throw new LocalError("EMAIL_NOT_CONFIGURED", "Email delivery is not configured.", "Download the file from this page instead.", 503); });
  route("DELETE", "/api/outputs/:id", ({ st, p }) => {
    const user = requireUser(st); const id = Number(p.id); const list = outsOf(st, user);
    if (!list.some((o) => o.id === id)) throw new LocalError("NOT_FOUND", "File not found.", null, 404);
    st.outputs[user.id] = list.filter((o) => o.id !== id); save(st); return {};
  });

  // account
  route("POST", "/api/account/retention", ({ st, b }) => {
    const user = requireUser(st); const retain = !!body(b).retain; st.users[user.id].retain = retain;
    if (!retain) for (const d of docsOf(st, user)) d.expires_at = Math.min(d.expires_at, d.created_at + CONFIG.RETENTION_DAYS * 86400);
    save(st); return { retain };
  });
  route("DELETE", "/api/account", async ({ st, b }) => {
    const user = requireUser(st); b = body(b);
    if (!(await verifyPassword(st.users[user.id].pw, String(b.password || "")))) throw new LocalError("INVALID_CREDENTIALS", "Password is incorrect.", "Enter your current password to confirm.", 401);
    delete st.users[user.id]; delete st.returns[user.id]; delete st.documents[user.id]; delete st.outputs[user.id]; st.session = null; save(st);
    return { message: "Your account and all associated data were deleted." };
  });
  route("GET", "/api/dashboard", ({ st }) => {
    const user = requireUser(st), ret = getReturn(st, user); const res = calc(st, user, ret, ret.regime); const conf = conflicts(st, user, ret);
    const cat = catalog();
    const review = cat.filter((f) => f.group !== "computed" && [STATUS.R, STATUS.W, STATUS.E].includes(fieldStatus(f, ret.fields[f.field_id], conf[f.field_id], ret.regime))).length;
    const missing = cat.filter((f) => f.required && !ret.fields[f.field_id]).map((f) => f.display_name);
    const docs = docsOf(st, user); const pending = docs.reduce((a, d) => a + d.extractions.filter((e) => e.status === "pending").length, 0);
    const has = (k) => !!ret.fields[k];
    const progress = [
      { label: "Personal details", done: ["pan", "full_name", "dob", "residential_status"].every(has) },
      { label: "Documents uploaded", done: docs.length > 0 },
      { label: "Income entered", done: ["salary_17_1", "os_savings_interest", "os_deposit_interest", "hp_type", "cg_ltcg_112a", "bp_presumptive"].some(has) },
      { label: "Values verified", done: review === 0 && pending === 0 && Object.keys(ret.fields).length > 0 },
      { label: "Regime chosen", done: true },
      { label: "Worksheet downloaded", done: outsOf(st, user).length > 0 },
    ];
    return { assessment_year: AY, financial_year: DATA.rules[AY].financial_year, regime: ret.regime, documents: docs.length, pending_suggestions: pending,
      needs_review: review, missing, recommended_itr: res.itr.recommended, summary: res.summary, warnings: res.warnings, progress, user };
  });
  route("GET", "/api/admin/status", ({ st }) => {
    requireUser(st);
    const years = Object.keys(DATA.rules).map((y) => {
      const items = []; (function walk(o, path) { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k.includes("verification") && typeof v === "string") items.push({ rule: path || "(root)", key: k, status: v }); else walk(v, path ? path + "." + k : k); } })(DATA.rules[y], "");
      const maps = DATA.mapping[y].fields.flatMap((f) => f.mappings);
      return { assessment_year: y, status: DATA.rules[y].status, rules_total: items.length, rules_verified: items.filter((i) => i.status.startsWith("VERIFIED")).length,
        rules_pending: items.filter((i) => !i.status.startsWith("VERIFIED")), mappings_total: maps.length,
        mappings_verified: maps.filter((m) => m.verification.startsWith("VERIFIED")).length, mappings_section_verified: maps.filter((m) => m.verification.startsWith("SECTION VERIFIED")).length,
        mapping_last_verified: DATA.mapping[y].last_verified, mapping_stale: !!DATA.mapping[y].stale, sources: DATA.sources[y].sources };
    });
    return { current_ay: AY, years, tests: root.ITH_TEST_RESULTS || null };
  });

  // ------------------------------------------------------------ entry points
  async function handle(method, url, b, opts = {}) {
    const u = new URL(url, "https://local.invalid");
    const st = load(); cleanup(st);
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(u.pathname); if (!m) continue;
      try { return { success: true, ...(await r.fn({ st, b, q: u.searchParams, p: m.groups || {}, opts })) }; }
      catch (e) { if (e && e.body) throw e; console.error(e); throw new LocalError("INTERNAL_ERROR", "Something went wrong in the page.", "Reload and try again.", 500); }
    }
    throw new LocalError("NOT_FOUND", "The requested resource was not found.", null, 404);
  }
  function getOutputBlob(id) {
    const st = load(); const user = requireUser(st);
    const o = outsOf(st, user).find((x) => x.id === Number(id));
    if (!o) throw new LocalError("NOT_FOUND", "File not found.", "Generate the worksheet again.", 404);
    return { blob: new Blob([Uint8Array.from(atob(o.data), (c) => c.charCodeAt(0))], { type: MIME[o.kind] }), filename: o.filename, kind: o.kind };
  }
  function exportData() {
    const st = load(); const user = requireUser(st);
    const data = { exported_at: new Date().toISOString().slice(0, 10), user: { email: user.email, mobile: user.mobile },
      returns: Object.entries(st.returns[user.id] || {}).map(([ay, r]) => ({ assessment_year: ay, regime: r.regime, fields: r.fields,
        documents: docsOf(st, user).map((d) => ({ name: d.orig_name, type: d.doc_type, uploaded: d.created_at, extractions: d.extractions })) })) };
    return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  }
  function eraseAll() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  root.ITHLocal = { handle, getOutputBlob, exportData, eraseAll, LocalError, CONFIG, _load: load };
})(typeof window !== "undefined" ? window : globalThis);
