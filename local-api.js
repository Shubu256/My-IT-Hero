/* My IT Hero — browser-only "server". Implements the same API the Flask
   backend exposes, but runs inside the page and stores everything in this
   browser's localStorage. Nothing is sent anywhere. Uploaded files are read in
   memory and never stored; only the values you accept are kept. */
(function (root) {
  "use strict";
  const KEY = "myithero:v1";
  const E = root.ITHEngine, X = root.ITHEntities, V = root.ITHValidators, O = root.ITHOcr, WS = root.ITHWorksheet, DATA = root.ITH_DATA;
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
  // One account can prepare several returns (profiles) — e.g. own return, HUF, firm — one per taxpayer category.
  const CATS = () => DATA.rules[AY].entities;
  function newProfile(id, entity, subtype, label) {
    const opts = X.optionsFor({ entity, subtype }, AY);
    const fields = {};
    if (entity === "IND_RES") fields.residential_status = { value: "RES", source_document_id: null, source_page: null, extraction_method: "category", confidence: 1, user_verified: true, last_modified: now() };
    return { id, entity, subtype, label: label || CATS()[entity].short, regime: opts[0].key, fields, created_at: now(), updated_at: now() };
  }
  function bucket(st, user) {
    st.returns[user.id] = st.returns[user.id] || {};
    let b = st.returns[user.id][AY];
    if (b && b.fields && !b.profiles) { // migrate the single-return format used before categories existed
      const p = newProfile("p1", "IND_RES", "RES", "My return"); p.regime = b.regime || "new"; p.fields = b.fields; p.created_at = b.created_at || now();
      b = st.returns[user.id][AY] = { profiles: { p1: p }, active: "p1", seq: 2 }; save(st);
    }
    if (!b) { b = st.returns[user.id][AY] = { profiles: { p1: newProfile("p1", "IND_RES", "RES", "My return") }, active: "p1", seq: 2 }; save(st); }
    if (!b.profiles[b.active]) { b.active = Object.keys(b.profiles)[0]; if (!b.active) { b.profiles.p1 = newProfile("p1", "IND_RES", "RES", "My return"); b.active = "p1"; } save(st); }
    return b;
  }
  function getReturn(st, user) { const b = bucket(st, user); return b.profiles[b.active]; }
  const applicable = (f, ret) => (!f.entities || f.entities.includes(ret.entity)) && (!f.subtypes || f.subtypes.includes(ret.subtype));
  function profileInfo(ret) {
    const c = CATS()[ret.entity];
    return { id: ret.id, entity: ret.entity, subtype: ret.subtype, label: ret.label, category: c.label, category_short: c.short, subtype_label: c.subtypes[ret.subtype],
      page: c.page, portal_status: c.portal_status, itr_forms: c.itr_forms, option: ret.regime, options: X.optionsFor(ret, AY) };
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
  const PSEUDO = { tax_regime: "Tax regime (Form 16: opting out of 115BAC?)" };
  const normFor = (fid, v) => { const f = catById()[fid]; return f && !["money", "int"].includes(f.data_type) ? String(v).trim().toUpperCase() : norm(v); };
  const docOfReturn = (d, ret) => !d.profile_id || d.profile_id === ret.id;
  function conflicts(st, user, ret) {
    const by = {};
    for (const d of docsOf(st, user)) {
      if (!docOfReturn(d, ret)) continue;
      for (const e of d.extractions) {
        if (["rejected", "combined", "info"].includes(e.status) || e.normalized_value === null || PSEUDO[e.field_id] || !catById()[e.field_id]) continue;
        (by[e.field_id] = by[e.field_id] || []).push({ value: e.normalized_value, source: d.orig_name, page: e.page, extraction_id: e.id, status: e.status });
      }
    }
    const out = {};
    for (const [fid, cands] of Object.entries(by)) {
      const vals = new Set(cands.map((c) => normFor(fid, c.value)));
      const cur = ret.fields[fid] ? ret.fields[fid].value : null;
      if (cur !== null && cur !== undefined && cur !== "") vals.add(normFor(fid, cur));
      if (vals.size > 1) out[fid] = { current: cur, candidates: cands };
    }
    return out;
  }
  function fieldStatus(f, row, conflict, regime) {
    if (conflict) return STATUS.W;
    if (!row || row.value === null || row.value === "") return f.required ? STATUS.M : null;
    if (!V.parserFor(f.data_type)(row.value).ok) return STATUS.E;
    if (["new", "old"].includes(regime) && !f.regimes.includes(regime) && f.group === "deductions" && !["0", "0.00"].includes(row.value)) return STATUS.W;
    return row.user_verified ? STATUS.V : STATUS.R;
  }
  function docName(st, user, id) { const d = docsOf(st, user).find((x) => x.id === id); return d ? d.orig_name : null; }

  function calc(st, user, ret, regime) {
    const vals = typedValues(ret);
    const res = X.computeFor(ret, vals, regime, AY);
    const sel = X.selectItrFor(ret, vals, AY, res.summary.total_income);
    const conf = conflicts(st, user, ret);
    const unverified = Object.values(ret.fields).filter((r) => !r.user_verified).length;
    if (Object.keys(conf).length) res.warnings.unshift({ code: "CONFLICTS", severity: "error", message: `${Object.keys(conf).length} value(s) differ between your documents and your return. Resolve them before filing.` });
    if (unverified) res.warnings.unshift({ code: "UNVERIFIED", severity: "warning", message: `${unverified} value(s) taken from documents are not yet confirmed by you.` });
    res.itr = sel; res.financial_year = DATA.rules[AY].financial_year; res.profile = profileInfo(ret);
    return res;
  }
  function buildMapping(st, user, ret, regime, itr, summary) {
    const mp = DATA.mapping[AY]; const conf = conflicts(st, user, ret); const out = [];
    for (const f of mp.fields) {
      if (!applicable(f, ret)) continue;
      const m = f.mappings.find((x) => x.itr_form === itr) || null;
      if ((!m && ["flags", "filing"].includes(f.group)) || (!f.mappings.length && f.group !== "computed")) continue;
      let row = null, val, status;
      if (f.group === "computed") { val = summary[f.field_id]; status = "Calculated"; }
      else {
        row = ret.fields[f.field_id] || null; val = row ? row.value : null;
        status = fieldStatus(f, row, conf[f.field_id], regime) || "Not applicable";
        if ((val === null || val === "") && !f.required) continue;
        if (["new", "old"].includes(regime) && !f.regimes.includes(regime)) status = "Not used in this regime";
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
        for (const r of Object.values(st.returns[uid] || {})) {
          const profs = r && r.profiles ? Object.values(r.profiles) : r && r.fields ? [r] : [];
          for (const pr of profs) for (const row of Object.values(pr.fields || {})) if (gone.has(row.source_document_id)) row.source_document_id = null;
        }
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
    const fields = catalog().filter((f) => f.group !== "computed" && applicable(f, ret)).map((f) => {
      const row = ret.fields[f.field_id]; const s = fieldStatus(f, row, conf[f.field_id], ret.regime); if (s) counts[s] += 1;
      return { field_id: f.field_id, display_name: f.display_name, group: f.group, data_type: f.data_type, help: f.help, regimes: f.regimes, required: f.required,
        value: row ? row.value : null, provenance: row ? { source_document: row.source_document_id ? docName(st, user, row.source_document_id) : null, source_page: row.source_page,
          extraction_method: row.extraction_method, confidence: row.confidence, user_verified: !!row.user_verified, last_modified: row.last_modified } : null,
        status: s, conflict: conf[f.field_id] || null };
    });
    return { assessment_year: AY, financial_year: DATA.rules[AY].financial_year, regime: ret.regime, profile: profileInfo(ret), fields, counts, documents: docsOf(st, user).length,
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
    const opts = X.optionsFor(ret, AY).map((o) => o.key);
    if (!opts.includes(regime)) throw new LocalError("INVALID_REGIME", `This category allows: ${opts.join(", ")}.`, null, 400);
    ret.regime = regime;
    if (ret.entity === "COMPANY" && regime !== "new" && regime !== "old") ret.fields.company_option = { value: regime, source_document_id: null, source_page: null, extraction_method: "manual", confidence: 1, user_verified: true, last_modified: now() };
    if (ret.entity === "COOP_AOP" && ret.subtype === "COOP") ret.fields.coop_option = { value: regime, source_document_id: null, source_page: null, extraction_method: "manual", confidence: 1, user_verified: true, last_modified: now() };
    ret.updated_at = now(); save(st); return { regime };
  });
  route("DELETE", "/api/return", ({ st }) => {
    const user = requireUser(st); const b = bucket(st, user); const ret = b.profiles[b.active];
    delete b.profiles[b.active];
    if (!Object.keys(b.profiles).length) { st.documents[user.id] = []; st.outputs[user.id] = []; }
    else st.outputs[user.id] = outsOf(st, user).filter((o) => o.profile_id !== ret.id);
    b.active = Object.keys(b.profiles)[0]; save(st); bucket(st, user);
    return { message: `The ${CATS()[ret.entity].short} return "${ret.label}" was deleted.` };
  });
  // ---- profiles (one per taxpayer category / person)
  route("GET", "/api/profiles", ({ st }) => {
    const user = requireUser(st); const b = bucket(st, user);
    return { active: b.active, profiles: Object.values(b.profiles).map((p) => Object.assign(profileInfo(p), { filled: Object.keys(p.fields).length, updated_at: p.updated_at })) };
  });
  route("POST", "/api/profiles", ({ st, b: body_ }) => {
    const user = requireUser(st); const b = bucket(st, user); const d = body(body_);
    const c = CATS()[d.entity];
    if (!c) throw new LocalError("INVALID_CATEGORY", "Choose a taxpayer category.", null, 400);
    const subtype = d.subtype && c.subtypes[d.subtype] ? d.subtype : Object.keys(c.subtypes)[0];
    if (Object.keys(b.profiles).length >= 20) throw new LocalError("TOO_MANY_RETURNS", "You can prepare up to 20 returns at a time.", "Delete a return you no longer need.", 400);
    const id = "p" + (b.seq++);
    const p = newProfile(id, d.entity, subtype, String(d.label || "").trim().slice(0, 60) || c.short);
    if (d.entity === "IND_NR") p.fields.residential_status = { value: subtype, source_document_id: null, source_page: null, extraction_method: "manual", confidence: 1, user_verified: true, last_modified: now() };
    if (d.entity === "HUF" || d.entity === "IND_RES") p.fields.residential_status = { value: d.entity === "IND_RES" ? "RES" : subtype, source_document_id: null, source_page: null, extraction_method: "manual", confidence: 1, user_verified: true, last_modified: now() };
    if (d.entity === "COMPANY" && subtype === "FOREIGN") p.fields.residential_status = { value: "NR", source_document_id: null, source_page: null, extraction_method: "manual", confidence: 1, user_verified: true, last_modified: now() };
    if (d.copy_contact) { const cur = b.profiles[b.active]; for (const k of ["mobile", "email"]) if (cur && cur.fields[k]) p.fields[k] = Object.assign({}, cur.fields[k]); }
    b.profiles[id] = p; b.active = id; save(st);
    return { profile: profileInfo(p), message: `Started a ${c.short} return.` };
  });
  route("POST", "/api/profiles/:id/activate", ({ st, p }) => {
    const user = requireUser(st); const b = bucket(st, user);
    if (!b.profiles[p.id]) throw new LocalError("NOT_FOUND", "Return not found.", null, 404);
    b.active = p.id; save(st); return { profile: profileInfo(b.profiles[p.id]) };
  });
  route("PATCH", "/api/profiles/:id", ({ st, p, b: body_ }) => {
    const user = requireUser(st); const b = bucket(st, user); const d = body(body_); const pr = b.profiles[p.id];
    if (!pr) throw new LocalError("NOT_FOUND", "Return not found.", null, 404);
    const c = CATS()[pr.entity];
    if (d.subtype && c.subtypes[d.subtype]) { pr.subtype = d.subtype; const opts = X.optionsFor(pr, AY).map((o) => o.key); if (!opts.includes(pr.regime)) pr.regime = opts[0];
      if (pr.entity === "IND_NR" || pr.entity === "HUF") pr.fields.residential_status = { value: d.subtype, source_document_id: null, source_page: null, extraction_method: "manual", confidence: 1, user_verified: true, last_modified: now() }; }
    if (typeof d.label === "string" && d.label.trim()) pr.label = d.label.trim().slice(0, 60);
    pr.updated_at = now(); save(st); return { profile: profileInfo(pr) };
  });
  route("GET", "/api/categories", () => ({ assessment_year: AY, financial_year: DATA.rules[AY].financial_year, categories: CATS(), deadlines: DATA.rules[AY].deadlines,
    regimes: { new: DATA.rules[AY].regimes.new, old: DATA.rules[AY].regimes.old }, capital_gains: DATA.rules[AY].capital_gains, cess_rate: DATA.rules[AY].cess_rate,
    amt: DATA.rules[AY].amt, special_surcharge_cap_rate: DATA.rules[AY].special_surcharge_cap_rate, filing_requirement: DATA.rules[AY].filing_requirement,
    options: Object.fromEntries(Object.entries(CATS()).map(([k, c]) => [k, Object.fromEntries(Object.keys(c.subtypes).map((sub) => [sub, X.optionsFor({ entity: k, subtype: sub }, AY)]))])) }));
  route("GET", "/api/residency", ({ st }) => {
    const user = requireUser(st), ret = getReturn(st, user);
    return X.residentialStatus(typedValues(ret));
  });
  route("GET", "/api/calc", ({ st, q }) => {
    const user = requireUser(st), ret = getReturn(st, user); const regime = q.get("regime") || ret.regime;
    if (!X.optionsFor(ret, AY).some((o) => o.key === regime)) throw new LocalError("INVALID_REGIME", "This option is not available for this taxpayer category.", null, 400);
    return calc(st, user, ret, regime);
  });
  route("GET", "/api/calc/compare", ({ st }) => {
    const user = requireUser(st), ret = getReturn(st, user);
    const opts = X.optionsFor(ret, AY);
    const results = opts.map((o) => ({ key: o.key, label: o.label, calc: calc(st, user, ret, o.key) }));
    const sorted = results.slice().sort((a, b) => Number(a.calc.summary.total_tax_liability) - Number(b.calc.summary.total_tax_liability));
    const best = sorted[0], second = sorted[1];
    const out = { options: results.map((r) => ({ key: r.key, label: r.label, summary: r.calc.summary })), itr: (results.find((r) => r.key === ret.regime) || results[0]).calc.itr,
      lower: !second || Number(best.calc.summary.total_tax_liability) === Number(second.calc.summary.total_tax_liability) ? "equal" : best.key,
      difference: second ? String(Number(second.calc.summary.total_tax_liability) - Number(best.calc.summary.total_tax_liability)) : "0", selected: ret.regime, profile: profileInfo(ret),
      filing_requirement: (results.find((r) => r.key === ret.regime) || results[0]).calc.filing_requirement };
    for (const r of results) out[r.key] = r.calc.summary;
    return out;
  });
  route("GET", "/api/mapping", ({ st, q }) => {
    const user = requireUser(st), ret = getReturn(st, user); const regime = q.get("regime") || ret.regime;
    const res = calc(st, user, ret, regime); const itr = q.get("itr") || res.itr.recommended;
    if (!["ITR-1", "ITR-2", "ITR-3", "ITR-4", "ITR-5", "ITR-6", "ITR-7"].includes(itr)) throw new LocalError("INVALID_ITR", "Unknown ITR form.", null, 400);
    const mp = buildMapping(st, user, ret, regime, itr, res.summary);
    const term = (q.get("q") || "").trim().toLowerCase();
    if (term) mp.fields = mp.fields.filter((f) => f.display_name.toLowerCase().includes(term) || f.keywords.some((k) => k.includes(term)) || (f.schedule || "").toLowerCase().includes(term) || (f.portal_label || "").toLowerCase().includes(term));
    return { itr, recommended: res.itr.recommended, profile: profileInfo(ret), itr_forms: CATS()[ret.entity].itr_forms, ...mp };
  });

  // documents
  function docJson(d) {
    const cat = catById(); const label = d.doc_label || (O.DOC_TYPES.find((x) => x[0] === d.doc_type) || [0, "Other tax document"])[1];
    return { id: d.id, name: d.orig_name, mime: d.mime, size: d.size, pages: d.pages, doc_type: d.doc_type, doc_label: label, doc_type_confidence: d.doc_type_confidence,
      created_at: d.created_at, expires_at: d.expires_at, methods: d.methods, profile_id: d.profile_id || null, warnings: d.warnings || [],
      kinds: (d.details || []).map((x) => x.kind), structured: !!(d.details && d.details.length),
      extractions: d.extractions.map((e) => ({ ...e, display_name: (cat[e.field_id] || {}).display_name || PSEUDO[e.field_id] || e.field_id,
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
    const doc = { id, orig_name: r.name, mime: r.mime, size: r.size, pages: r.pages, doc_type: r.doc_type, doc_label: r.doc_label, doc_type_confidence: r.doc_type_confidence, methods: r.methods,
      profile_id: getReturn(st2, u2).id, details: r.details || [], warnings: r.warnings || [],
      created_at: t, expires_at: t + (st2.users[u2.id].retain ? 3650 : CONFIG.RETENTION_DAYS) * 86400,
      extractions: r.suggestions.map((s) => ({ id: nextId(st2), field_id: s.field_id, page: s.page, raw_value: s.raw_value, normalized_value: s.normalized_value,
        confidence: s.confidence, flags: s.flags, validation_status: s.validation_status, note: s.note || null, status: "pending" })) };
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
    if (e.field_id === "tax_regime") {
      const val = b.value !== undefined ? String(b.value) : e.normalized_value;
      if (!X.optionsFor(ret, AY).some((o) => o.key === val)) throw new LocalError("INVALID_REGIME", "This return's category does not use the new / old regime choice.", null, 400);
      ret.regime = val; e.status = "accepted"; save(st); return {};
    }
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

  // ------------------------------------------------------------ Form 16 / Form 12BA → My Return (auto-fill)
  // Combines every structured salary document of the open return, employer by employer (keyed by TAN):
  // Part B gives the salary break-up, deductions and regime; Part A the TDS; Form 12BA the nature-wise perquisites.
  // Fills empty fields, refreshes values it filled earlier, and never overwrites a value you typed — those become conflicts for you to decide.
  const AUTO = "form16_auto";
  const n0 = (v) => (v === null || v === undefined || v === "" ? null : Number(String(v).replace(/,/g, "")));
  const isZero = (v) => n0(v) === 0;
  const vOf = (B, k) => (B && B.values && B.values[k] ? B.values[k].value : null);
  const pgOf = (B, k) => (B && B.values && B.values[k] ? B.values[k].page : 1);
  function docSummary(st, user, ret) {
    const docs = docsOf(st, user).filter((d) => docOfReturn(d, ret) && Array.isArray(d.details) && d.details.length).sort((a, b) => a.created_at - b.created_at);
    const emp = new Map(); const pans = new Set(); const warnings = []; const later = [];
    const put = (key, x, d) => {
      if (!emp.has(key)) emp.set(key, { tan: x.employer_tan || null, name: null, A: null, B: null, F: null, src: {} });
      const e = emp.get(key); const slot = x.kind === "form16_part_a" ? "A" : x.kind === "form16_part_b" ? "B" : "F";
      e[slot] = x; e.src[slot] = { id: d.id, name: d.orig_name }; e.name = e.name || x.employer_name || null; e.tan = e.tan || x.employer_tan || null;
    };
    for (const d of docs) {
      for (const w of d.warnings || []) if (!warnings.includes(w)) warnings.push(w);
      for (const x of d.details) { if (x.pan) pans.add(x.pan); if (x.employer_tan) put(x.employer_tan, x, d); else later.push([x, d]); }
    }
    for (const [x, d] of later) put(emp.size === 1 ? [...emp.keys()][0] : "doc" + d.id, x, d); // no TAN read: attach to the only employer, if there is one
    const employers = [...emp.values()].map((e) => {
      const B = e.B, F = e.F, A = e.A;
      const perqB = vOf(B, "perquisites_17_2"), perqF = F && F.total ? F.total.chargeable : null;
      const r = { tan: e.tan, name: e.name, period_from: (A || B || {}).period_from || null, period_to: (A || B || {}).period_to || null, certificate_no: (A || B || {}).certificate_no || null,
        documents: Object.values(e.src).map((x) => x.name), has: { part_a: !!A, part_b: !!B, form12ba: !!F },
        salary_17_1: vOf(B, "salary_17_1"), perquisites_17_2: perqB !== null ? perqB : perqF, profits_17_3: vOf(B, "profits_17_3") !== null ? vOf(B, "profits_17_3") : F && F.profits_17_3 ? F.profits_17_3.chargeable : null,
        gross_salary: vOf(B, "gross_salary"), exempt_total: vOf(B, "exempt_total"), std_deduction: vOf(B, "std_deduction"), professional_tax: vOf(B, "professional_tax"),
        entertainment: vOf(B, "entertainment_16_ii"), income_salary: vOf(B, "income_salary"),
        exemptions: B ? [["ex_10_5", "Leave travel concession / assistance u/s 10(5)"], ["ex_10_10", "Death-cum-retirement gratuity u/s 10(10)"], ["ex_10_10a", "Commuted value of pension u/s 10(10A)"],
          ["ex_10_10aa", "Leave encashment u/s 10(10AA)"], ["ex_10_13a", "House rent allowance u/s 10(13A)"], ["ex_10_14", "Special allowances u/s 10(14)"], ["ex_other", "Any other exemption u/s 10"]]
          .map(([k, label]) => ({ key: k, label, amount: vOf(B, k) })).filter((x) => n0(x.amount)) : [],
        perquisites: F ? F.perquisites.filter((p) => n0(p.chargeable)).map((p) => ({ no: p.no, nature: p.nature, value: p.value, recovered: p.recovered, chargeable: p.chargeable, chargeable_exact: p.chargeable_exact })) : [],
        tds: A && A.total ? A.total.deducted : null, tds_deposited: A && A.total ? A.total.deposited : null, amount_paid: A && A.total ? A.total.paid : null, quarters: A ? A.quarters : [],
        regime: B ? B.regime : null, employer_computation: B ? Object.fromEntries(["income_salary", "gross_total_income", "via_total", "total_income", "tax_on_total_income", "rebate_87a", "surcharge", "cess", "tax_payable", "relief_89", "net_tax_payable"].map((k) => [k, vOf(B, k)])) : null,
        designation: F ? F.designation : null, src: e.src, B, F, A };
      // nature-wise perquisites must add up to the 17(2) figure the return uses (rounding per line can be off by a rupee)
      if (r.perquisites.length && r.perquisites_17_2 !== null) {
        const sum = r.perquisites.reduce((a, p) => a + n0(p.chargeable), 0), diff = n0(r.perquisites_17_2) - sum;
        if (diff && Math.abs(diff) <= r.perquisites.length) { const big = r.perquisites.reduce((m, p) => (n0(p.chargeable) > n0(m.chargeable) ? p : m)); big.chargeable = String(n0(big.chargeable) + diff); big.adjusted = diff; }
      }
      return r;
    });
    const checks = [];
    const fmt = (v) => "₹" + Number(v).toLocaleString("en-IN");
    if (pans.size > 1) checks.push({ ok: false, label: "PAN", detail: `Your documents show different PANs (${[...pans].join(", ")}). Upload only your own documents.` });
    else if (pans.size === 1) checks.push({ ok: true, label: "PAN", detail: `Same PAN on every document (${[...pans][0]}).` });
    for (const e of employers) {
      const who = e.name || e.tan || "employer";
      if (e.B && e.F && perqPair(e)) { const [b, f] = perqPair(e); checks.push({ ok: Math.abs(b - f) <= 1, label: `Perquisites — ${who}`, detail: `Form 16 Part B 17(2) ${fmt(b)} vs Form 12BA chargeable total ${fmt(f)}${Math.abs(b - f) <= 1 ? " (match, after rounding)" : " — they differ; ask your employer which is right"}.` }); }
      if (e.B && e.gross_salary !== null && e.salary_17_1 !== null) { const t = n0(e.salary_17_1) + n0(e.perquisites_17_2 || 0) + n0(e.profits_17_3 || 0); checks.push({ ok: Math.abs(t - n0(e.gross_salary)) <= 2, label: `Gross salary — ${who}`, detail: `17(1) + 17(2) + 17(3) = ${fmt(t)}; Part B total ${fmt(e.gross_salary)}.` }); }
      if (e.A && e.B && e.amount_paid !== null && e.income_salary !== null) { const d = Math.abs(n0(e.amount_paid) - n0(e.income_salary)); checks.push({ ok: d <= 100, label: `Part A vs Part B — ${who}`, detail: `Amount paid/credited in Part A ${fmt(e.amount_paid)}; income chargeable under Salaries in Part B ${fmt(e.income_salary)}${d && d <= 100 ? " (small rounding difference)" : d ? " — a large difference; check with your employer" : ""}.` }); }
      if (e.B && !e.A) warnings.push(`Form 16 Part A for ${who} is missing, so the TDS on salary could not be read. Upload Part A, or enter the TDS from Form 26AS / AIS in My Return.`);
      if (e.A && !e.B) warnings.push(`Form 16 Part B for ${who} is missing, so the salary break-up could not be read. Upload Part B.`);
      if (e.F && !e.B) warnings.push(`Only Form 12BA was found for ${who}; it gives perquisites but not your salary u/s 17(1). Upload Form 16 Part B.`);
    }
    const ay = [...new Set(docs.flatMap((d) => d.details.map((x) => x.assessment_year)).filter(Boolean))];
    if (ay.length) checks.push({ ok: ay.every((a) => a === AY), label: "Assessment year", detail: `Documents are for AY ${ay.join(", ")}; this return is AY ${AY}.` });
    // values for the return
    const withB = employers.filter((e) => e.B);
    const latestB = withB.slice().sort((a, b) => String(a.period_to || "").localeCompare(String(b.period_to || "")) || 0).pop() || null;
    const values = {}; const combined = new Set(); const multi = employers.length > 1;
    if (multi) { combined.add("employer_name"); combined.add("employer_tan"); } // several employers: each document names its own
    const setV = (fid, value, srcSlot, e, page, conf, opts = {}) => { if (value === null || value === undefined || value === "") return; values[fid] = { value: String(value), doc: e && e.src[srcSlot] ? e.src[srcSlot].id : null, source: e && e.src[srcSlot] ? e.src[srcSlot].name : null, page: page || 1, conf, combined: !!opts.combined }; if (opts.combined) combined.add(fid); };
    const sumOf = (k) => { const xs = employers.map((e) => e[k]).filter((v) => v !== null && v !== undefined); return xs.length ? String(xs.reduce((a, v) => a + n0(v), 0)) : null; };
    const first = employers.find((e) => e.B) || employers[0] || null;
    if (pans.size === 1) setV("pan", [...pans][0], first && first.src.A ? "A" : first && first.src.B ? "B" : "F", first, 1, 0.97);
    const nameSrc = employers.find((e) => (e.A || e.B || {}).employee_name) || employers.find((e) => e.F && e.F.employee_name);
    if (nameSrc) { const x = nameSrc.A || nameSrc.B || nameSrc.F; setV("full_name", x.employee_name, nameSrc.A ? "A" : nameSrc.B ? "B" : "F", nameSrc, 1, 0.95); }
    const main = employers.slice().sort((a, b) => n0(b.salary_17_1 || 0) - n0(a.salary_17_1 || 0))[0];
    if (main) { setV("employer_name", main.name, main.src.B ? "B" : main.src.A ? "A" : "F", main, 1, 0.95); setV("employer_tan", main.tan, main.src.B ? "B" : main.src.A ? "A" : "F", main, 1, 0.97); }
    for (const [fid, k, slot, pk] of [["salary_17_1", "salary_17_1", "B", "salary_17_1"], ["perquisites_17_2", "perquisites_17_2", "B", "perquisites_17_2"], ["profits_17_3", "profits_17_3", "B", "profits_17_3"],
      ["exempt_allowances", "exempt_total", "B", "exempt_total"], ["professional_tax", "professional_tax", "B", "professional_tax"], ["tds_salary", "tds", "A", null]]) {
      const v = sumOf(k); if (v === null) continue;
      const e = employers.find((x) => x[k] !== null && x[k] !== undefined);
      const s2 = ["perquisites_17_2", "profits_17_3"].includes(fid) && !e.B ? "F" : slot;
      setV(fid, v, s2, e, pk && e.B ? pgOf(e.B, pk) : fid === "perquisites_17_2" && e.F && e.F.total ? e.F.total.page : 1, s2 === "F" ? 0.95 : 0.97, { combined: multi });
    }
    if (latestB) {
      const B = latestB.B, map = [["d_80c", B.values.d_80c_group ? "d_80c_group" : "d_80c_only"], ["d_80ccd1b", "d_80ccd1b"], ["d_80ccd2", "d_80ccd2"], ["d_80d_self", "d_80d"], ["d_80e", "d_80e"],
        ["d_80cch", "d_80cch_employee"], ["d_80g", "d_80g"], ["d_80tta", "d_80tta"], ["os_other", "os_reported"]];
      for (const [fid, k] of map) { const v = vOf(B, k); if (v !== null && !isZero(v)) setV(fid, v, "B", latestB, pgOf(B, k), fid === "os_other" ? 0.85 : 0.9); }
      const hp = vOf(B, "hp_reported"); if (hp !== null && n0(hp) < 0) { setV("hp_type", "self", "B", latestB, pgOf(B, "hp_reported"), 0.85); setV("hp_interest_24b", String(-n0(hp)), "B", latestB, pgOf(B, "hp_reported"), 0.85); }
    }
    // values the dedicated readers could not place but the general patterns read confidently (single-employer returns only)
    if (!multi) for (const d of docs) for (const x of d.extractions) {
      if (values[x.field_id] || x.status !== "pending" || x.validation_status !== "valid" || x.confidence < 0.9 || x.field_id === "tax_regime" || isZero(x.normalized_value)) continue;
      values[x.field_id] = { value: x.normalized_value, doc: d.id, source: d.orig_name, page: x.page, conf: Math.min(x.confidence, 0.9), combined: false };
    }
    return { generated_at: now(), employers: employers.map(({ A, B, F, src, ...e }) => e), values, combined: [...combined], regime: latestB ? latestB.regime : null,
      regime_source: latestB ? latestB.src.B.name : null, employer_computation: latestB ? latestB.employer_computation : null, employer_computation_of: latestB ? latestB.name : null,
      checks, warnings, documents: docs.map((d) => ({ id: d.id, name: d.orig_name, label: d.doc_label || d.doc_type })) };
    function perqPair(e) { const b = vOf(e.B, "perquisites_17_2"), f = e.F && e.F.total ? e.F.total.chargeable : null; return b !== null && f !== null ? [n0(b), n0(f)] : null; }
  }
  function sameValue(fid, a, b) { return normFor(fid, a) === normFor(fid, b); }
  function autofill(st, user, ret) {
    const sum = docSummary(st, user, ret); const cat = catById();
    const filled = [], unchanged = [], kept = [];
    if (ret.entity === "IND_RES" && !(ret.fields.residential_status && ret.fields.residential_status.value))
      ret.fields.residential_status = { value: "RES", source_document_id: null, source_page: null, extraction_method: "category", confidence: 1, user_verified: true, last_modified: now() };
    for (const [fid, v] of Object.entries(sum.values)) {
      const f = cat[fid]; if (!f || !applicable(f, ret)) continue;
      const p = V.parserFor(f.data_type)(v.value); if (!p.ok) continue;
      const val = String(p.value); const cur = ret.fields[fid];
      const empty = !cur || cur.value === null || cur.value === "";
      const info = { field_id: fid, display_name: f.display_name, data_type: f.data_type, value: val, source: v.source, page: v.page, combined: v.combined };
      if (!empty && sameValue(fid, cur.value, val)) { if (!cur.source_document_id && v.doc) { cur.source_document_id = v.doc; cur.source_page = v.page; } unchanged.push(info); continue; }
      const mine = !empty && !String(cur.extraction_method || "").startsWith(AUTO) && !String(cur.extraction_method || "").startsWith("ocr");
      if (mine) { kept.push(Object.assign(info, { current: cur.value })); continue; }
      ret.fields[fid] = { value: val, source_document_id: v.doc, source_page: v.page, extraction_method: AUTO + (v.combined ? " (combined)" : ""), confidence: v.conf, user_verified: v.conf >= 0.95, last_modified: now() };
      filled.push(Object.assign(info, { verified: v.conf >= 0.95, previous: empty ? null : cur.value }));
    }
    let regime = null;
    if (sum.regime && ["IND_RES", "IND_NR"].includes(ret.entity) && X.optionsFor(ret, AY).some((o) => o.key === sum.regime)) {
      regime = { value: sum.regime, previous: ret.regime, changed: ret.regime !== sum.regime, source: sum.regime_source }; ret.regime = sum.regime;
    }
    for (const d of docsOf(st, user)) {
      if (!docOfReturn(d, ret)) continue;
      for (const e of d.extractions) {
        if (e.status !== "pending") continue;
        const cur = ret.fields[e.field_id];
        if (e.field_id === "tax_regime") e.status = regime ? "accepted" : e.status;
        else if (cur && e.normalized_value !== null && sameValue(e.field_id, cur.value, e.normalized_value)) e.status = "accepted";
        else if (sum.combined.includes(e.field_id)) e.status = "combined";
        else if (isZero(e.normalized_value)) e.status = "info";
      }
    }
    ret.doc_summary = Object.assign({}, sum, { values: undefined });
    ret.updated_at = now(); save(st);
    return { filled, unchanged: unchanged.length, unchanged_fields: unchanged, conflicts: kept, regime, checks: sum.checks, warnings: sum.warnings, employers: sum.employers,
      documents: sum.documents, profile: profileInfo(ret), questions: openQuestions(ret) };
  }
  // what Form 16 / 12BA cannot tell us but the ITR choice and tax need
  function openQuestions(ret) {
    const cat = catById(); const has = (k) => ret.fields[k] && ret.fields[k].value !== null && ret.fields[k].value !== "";
    const ids = ["IND_RES", "IND_NR"].includes(ret.entity) ? ["dob", "is_director", "has_unlisted_shares", "has_foreign_assets", "has_foreign_income", "has_bf_losses", "os_savings_interest", "os_deposit_interest", "bank_ifsc", "bank_account", "mobile", "email"] : [];
    return ids.filter((k) => cat[k] && applicable(cat[k], ret) && !has(k)).map((k) => ({ field_id: k, display_name: cat[k].display_name, data_type: cat[k].data_type, help: cat[k].help, group: cat[k].group }));
  }
  route("POST", "/api/autofill", ({ st }) => { const user = requireUser(st), ret = getReturn(st, user); return autofill(st, user, ret); });
  route("POST", "/api/autofill/use-document", ({ st, b }) => { // the user chose the document value over their own for these fields
    const user = requireUser(st), ret = getReturn(st, user); b = body(b);
    const sum = docSummary(st, user, ret); const cat = catById(); const done = [];
    for (const fid of Array.isArray(b.fields) ? b.fields.slice(0, 50) : []) {
      const v = sum.values[fid], f = cat[fid]; if (!v || !f) continue;
      const p = V.parserFor(f.data_type)(v.value); if (!p.ok) continue;
      ret.fields[fid] = { value: String(p.value), source_document_id: v.doc, source_page: v.page, extraction_method: AUTO, confidence: v.conf, user_verified: true, last_modified: now() };
      done.push(fid);
    }
    save(st); return { updated: done };
  });
  route("GET", "/api/doc-summary", ({ st }) => {
    const user = requireUser(st), ret = getReturn(st, user);
    const docs = docsOf(st, user).filter((d) => docOfReturn(d, ret));
    return { summary: ret.doc_summary || null, structured_documents: docs.filter((d) => d.details && d.details.length).length, documents: docs.length, profile: profileInfo(ret), regime: ret.regime };
  });

  // outputs
  const MIME = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  route("POST", "/api/outputs", ({ st, b }) => {
    const user = requireUser(st), ret = getReturn(st, user); b = body(b);
    const fmt = b.format, regime = b.regime || ret.regime;
    if (!["pdf", "docx"].includes(fmt) || !X.optionsFor(ret, AY).some((o) => o.key === regime)) throw new LocalError("INVALID_REQUEST", "Choose PDF or DOCX and an option available for this category.", null, 400);
    const res = calc(st, user, ret, regime); const itr = res.itr.recommended;
    const mp = buildMapping(st, user, ret, regime, itr, res.summary);
    const docs = docsOf(st, user).filter((d) => docOfReturn(d, ret)).map((d) => ({ orig_name: d.orig_name, doc_type: d.doc_label || d.doc_type, pages: d.pages, created_at: d.created_at }));
    const data = WS.worksheetData(AY, regime, res, mp, docs, user, conflicts(st, user, ret), ret.doc_summary || null);
    const bytes = fmt === "pdf" ? WS.buildPdf(data) : WS.buildDocx(data);
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const slug = (ret.entity + "_" + ret.subtype).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const out = { id: nextId(st), kind: fmt, regime, itr, profile_id: ret.id, category: CATS()[ret.entity].short, label: ret.label,
      filename: `MyITHero_Worksheet_AY${AY}_${slug}_${regime}_${itr}.${fmt}`, created_at: now(), emailed_at: null, data: btoa(bin) };
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
    const review = cat.filter((f) => f.group !== "computed" && applicable(f, ret) && [STATUS.R, STATUS.W, STATUS.E].includes(fieldStatus(f, ret.fields[f.field_id], conf[f.field_id], ret.regime))).length;
    const missing = cat.filter((f) => f.required && applicable(f, ret) && !ret.fields[f.field_id]).map((f) => f.display_name);
    const docs = docsOf(st, user); const pending = docs.reduce((a, d) => a + d.extractions.filter((e) => e.status === "pending").length, 0);
    const has = (k) => !!ret.fields[k];
    const progress = [
      { label: "Taxpayer category chosen", done: true },
      { label: "Basic details", done: ["pan", "full_name", "residential_status"].every(has) && (!["IND_RES", "IND_NR"].includes(ret.entity) || has("dob")) },
      { label: "Documents uploaded", done: docs.length > 0 },
      { label: "Income entered", done: ["salary_17_1", "os_savings_interest", "os_deposit_interest", "os_other", "os_dividend", "hp_type", "cg_ltcg_112a", "cg_stcg_111a", "bp_presumptive", "bp_regular", "trust_income", "pp_voluntary_contributions"].some(has) },
      { label: "Values verified", done: review === 0 && pending === 0 && Object.keys(ret.fields).length > 0 },
      { label: ["IND_RES", "IND_NR", "HUF"].includes(ret.entity) ? "Regime chosen" : "Tax option chosen", done: true },
      { label: "Worksheet downloaded", done: outsOf(st, user).some((o) => o.profile_id === ret.id) },
    ];
    return { assessment_year: AY, financial_year: DATA.rules[AY].financial_year, regime: ret.regime, documents: docs.length, pending_suggestions: pending,
      needs_review: review, missing, recommended_itr: res.itr.recommended, summary: res.summary, warnings: res.warnings, progress, user,
      profile: profileInfo(ret), option_label: res.option_label, filing_requirement: res.filing_requirement, due_date: res.summary.due_date,
      profiles: Object.values(bucket(st, user).profiles).map((p) => ({ id: p.id, label: p.label, category: CATS()[p.entity].short })) };
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
      returns: Object.entries(st.returns[user.id] || {}).map(([ay, r]) => ({ assessment_year: ay, profiles: r.profiles || null, regime: r.regime, fields: r.fields,
        documents: docsOf(st, user).map((d) => ({ name: d.orig_name, type: d.doc_type, uploaded: d.created_at, extractions: d.extractions })) })) };
    return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  }
  function eraseAll() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  root.ITHLocal = { handle, getOutputBlob, exportData, eraseAll, LocalError, CONFIG, _load: load };
})(typeof window !== "undefined" ? window : globalThis);
