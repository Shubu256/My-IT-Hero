(async function () {
  const { api, el, shell, showError, toast } = ITH;
  const s = await shell({ auth: true });
  if (!s) return;
  const u = s.user;
  const meta = await api("GET", "/api/documents");
  document.getElementById("days").textContent = meta.retention_days;
  document.getElementById("acct-sub").textContent = "Signed in as " + u.email;
  const status = (ok) => el("span", { class: "chip " + (ok ? "verified" : "review"), text: ok ? "Verified" : "Not verified" });
  document.getElementById("contact").replaceChildren(
    el("dt", { text: "Email" }), el("dd", null, u.email, " ", status(u.email_verified)),
    el("dt", { text: "Mobile" }), el("dd", null, u.mobile, " ", status(u.mobile_verified)));
  const mv = document.getElementById("mobile-verify");
  if (!u.mobile_verified) {
    const msg = el("div");
    const code = el("input", { type: "text", inputmode: "numeric", maxlength: "6", placeholder: "6-digit code", "aria-label": "Mobile verification code" });
    mv.replaceChildren(msg,
      el("div", { class: "btn-row" }, el("button", { class: "btn secondary", type: "button", text: "Send code by SMS", onclick: async () => {
        try {
          const r = await api("POST", "/api/auth/mobile/send", {});
          msg.replaceChildren(el("div", { class: "notice " + (r.delivered ? "info" : "warning") }, el("p", { text: r.delivery_message }),
            r.dev_otp ? el("p", null, r.dev_note + " Code: ", el("strong", { text: r.dev_otp })) : null));
        } catch (e) { showError(msg, e); } } })),
      el("div", { class: "btn-row" }, code, el("button", { class: "btn", type: "button", text: "Verify mobile", onclick: async () => {
        try { await api("POST", "/api/auth/mobile/verify", { code: code.value }); toast("Mobile verified."); location.reload(); } catch (e) { showError(msg, e); } } })));
  }
  document.getElementById("export-btn").addEventListener("click", () => ITH.saveBlob(window.ITHLocal.exportData(), "my-it-hero-data-export.json"));
  const ret = document.getElementById("retain");
  ret.checked = u.retain_documents;
  ret.addEventListener("change", async () => {
    try { await api("POST", "/api/account/retention", { retain: ret.checked }); toast(ret.checked ? "Documents will be kept until you delete them." : "Documents will be deleted automatically."); }
    catch (e) { showError(null, e); }
  });
  document.getElementById("logout").addEventListener("click", async () => { await api("POST", "/api/auth/logout", {}); location.href = "signin.html"; });
  document.getElementById("del-return").addEventListener("click", async () => {
    if (!confirm("Delete this year's return, its documents and worksheets? This cannot be undone.")) return;
    try { const r = await api("DELETE", "/api/return"); toast(r.message); } catch (e) { showError(null, e); }
  });
  document.getElementById("del-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!confirm("Permanently delete your account and all data?")) return;
    try { await api("DELETE", "/api/account", { password: document.getElementById("del-pw").value }); location.href = "index.html"; }
    catch (err) { showError(document.getElementById("del-msg"), err); }
  });
})();
