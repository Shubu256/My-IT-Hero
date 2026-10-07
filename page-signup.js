(async function () {
  const { api, el, shell, fieldErrors, showError, busy } = ITH;
  await shell();
  const form = document.getElementById("signup-form");
  let email = "";

  function devNote(target, r) {
    if (r.dev_otp) {
      target.replaceChildren(el("div", { class: "notice warning" }, el("p", null, r.dev_note + " Code: "), el("p", { class: "dev-otp", text: r.dev_otp })));
    } else if (r.delivery_message && !r.delivered) {
      target.replaceChildren(el("div", { class: "notice warning" }, el("p", { text: r.delivery_message })));
    } else target.replaceChildren();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    busy(btn, true, "Creating account…");
    const body = { email: form.email.value, mobile: form.mobile.value, password: form.password.value, accept_terms: form.accept_terms.checked };
    try {
      const r = await api("POST", "/api/auth/signup", body);
      fieldErrors(form, null);
      if (r.next === "signed_in") { location.href = "dashboard.html"; return; }
      email = body.email;
      document.getElementById("step-details").classList.add("hidden");
      document.getElementById("step-otp").classList.remove("hidden");
      document.getElementById("otp-intro").textContent = r.message;
      devNote(document.getElementById("otp-msg"), r);
      document.getElementById("code").focus();
    } catch (err) {
      fieldErrors(form, err.body && err.body.details);
      showError(document.getElementById("msg"), err);
    } finally { busy(btn, false); }
  });

  document.getElementById("otp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("POST", "/api/auth/verify-email", { email, code: document.getElementById("code").value });
      location.href = "dashboard.html";
    } catch (err) { showError(document.getElementById("otp-msg"), err); }
  });
  document.getElementById("resend").addEventListener("click", async () => {
    try { const r = await api("POST", "/api/auth/resend", { email }); devNote(document.getElementById("otp-msg"), r); ITH.toast(r.message); }
    catch (err) { showError(document.getElementById("otp-msg"), err); }
  });
})();
