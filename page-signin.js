(async function () {
  const { api, el, shell, showError, busy, qs, safeNext } = ITH;
  const s = await shell();
  const next = safeNext(qs("next"));
  if (s && s.user) { location.href = next; return; }
  if (qs("expired")) document.getElementById("msg").replaceChildren(el("div", { class: "notice warning" }, el("p", { text: "Your session expired. Sign in again to continue." })));
  const form = document.getElementById("signin-form");
  let email = "";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    busy(btn, true, "Signing in…");
    try {
      await api("POST", "/api/auth/signin", { identifier: form.identifier.value, password: form.password.value });
      location.href = next;
    } catch (err) {
      if (err.body && err.body.error_code === "EMAIL_NOT_VERIFIED") {
        email = err.body.details.email;
        document.getElementById("step-login").classList.add("hidden");
        document.getElementById("step-otp").classList.remove("hidden");
        const d = err.body.details;
        const box = document.getElementById("otp-msg");
        if (d.dev_otp) box.replaceChildren(el("div", { class: "notice warning" }, el("p", { text: d.dev_note + " Code:" }), el("p", { class: "dev-otp", text: d.dev_otp })));
        else if (!d.delivered) box.replaceChildren(el("div", { class: "notice warning" }, el("p", { text: d.delivery_message })));
      } else showError(document.getElementById("msg"), err);
    } finally { busy(btn, false); }
  });
  document.getElementById("otp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("POST", "/api/auth/verify-email", { email, code: document.getElementById("code").value }); location.href = next; }
    catch (err) { showError(document.getElementById("otp-msg"), err); }
  });
})();
