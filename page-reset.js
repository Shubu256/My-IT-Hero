(async function () {
  const { api, el, shell, showError, fieldErrors } = ITH;
  await shell();
  let identifier = "";
  document.getElementById("req-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    identifier = document.getElementById("identifier").value;
    try {
      const r = await api("POST", "/api/auth/forgot", { identifier });
      document.getElementById("step-request").classList.add("hidden");
      document.getElementById("step-reset").classList.remove("hidden");
      const box = document.getElementById("reset-msg");
      const kids = [el("div", { class: "notice info" }, el("p", { text: r.message }))];
      if (r.dev_otp) kids.push(el("div", { class: "notice warning" }, el("p", { text: r.dev_note + " Code:" }), el("p", { class: "dev-otp", text: r.dev_otp })));
      else if (r.delivered === false) kids.push(el("div", { class: "notice warning" }, el("p", { text: r.delivery_message })));
      box.replaceChildren(...kids);
    } catch (err) {
      showError(document.getElementById("msg"), err);
      if (err.body && err.body.error_code === "RESET_UNAVAILABLE") {
        document.getElementById("msg").append(el("div", { class: "btn-row" }, el("button", { class: "btn danger", type: "button", text: "Erase My IT Hero data in this browser",
          onclick: () => { if (confirm("Erase every My IT Hero account and figure stored in this browser? This cannot be undone.")) { window.ITHLocal.eraseAll(); location.href = "signup.html"; } } })));
      }
    }
  });
  const rf = document.getElementById("reset-form");
  rf.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("POST", "/api/auth/reset", { identifier, code: rf.code.value, password: rf.password.value });
      document.getElementById("reset-msg").replaceChildren(el("div", { class: "notice info" }, el("p", null, r.message + " ", el("a", { href: "signin.html", text: "Sign in" }))));
      rf.classList.add("hidden");
    } catch (err) { fieldErrors(rf, err.body && err.body.details); showError(document.getElementById("reset-msg"), err); }
  });
})();
