(async function () {
  const { api, el, shell, showError, toast } = ITH;
  const s = await shell({ auth: true });
  if (!s) return;
  const list = document.getElementById("out-list");
  const ret = await api("GET", "/api/return");
  document.getElementById("g-regime").value = ret.regime;

  document.getElementById("gen-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    ITH.busy(btn, true, "Preparing…");
    try {
      const r = await api("POST", "/api/outputs", { format: document.getElementById("g-format").value, regime: document.getElementById("g-regime").value });
      toast("Ready: " + r.output.filename);
      load();
    } catch (err) { showError(null, err); } finally { ITH.busy(btn, false); }
  });

  async function load() {
    try {
      const r = await api("GET", "/api/outputs");
      document.getElementById("email-note").replaceChildren(r.email_configured ? "" :
        el("div", { class: "notice warning" }, el("p", { text: "Email delivery is not configured. Your files stay available on this page." })));
      if (!r.outputs.length) { list.replaceChildren(el("p", { class: "muted", text: "No worksheets yet. Generate one above." })); return; }
      list.replaceChildren(el("div", { class: "table-wrap" }, el("table", null,
        el("thead", null, el("tr", null, ...["File", "Regime", "ITR", "Created", ""].map((h) => el("th", { text: h })))),
        el("tbody", null, ...r.outputs.map((o) => el("tr", null,
          el("td", null, el("strong", { text: o.filename }), o.emailed_at ? el("div", { class: "muted", text: "Emailed " + new Date(o.emailed_at * 1000).toLocaleString("en-IN") }) : null),
          el("td", { text: o.regime === "new" ? "New" : "Old" }), el("td", { text: o.itr }),
          el("td", { text: new Date(o.created_at * 1000).toLocaleString("en-IN") }),
          el("td", null, el("div", { class: "btn-row" },
            el("button", { class: "btn small", type: "button", text: "Download", onclick: () => ITH.downloadOutput(o.id) }),
            o.kind === "pdf" ? el("button", { class: "btn small secondary", type: "button", text: "View", onclick: () => ITH.downloadOutput(o.id, true) }) : null,
            el("button", { class: "btn small secondary", type: "button", text: "Send to my email", onclick: async () => {
              try { const x = await api("POST", `/api/outputs/${o.id}/email`, {}); toast(x.message); load(); } catch (err) { showError(null, err); } } }),
            el("button", { class: "btn small danger", type: "button", text: "Delete", onclick: async () => {
              if (!confirm("Delete " + o.filename + "?")) return;
              await api("DELETE", `/api/outputs/${o.id}`); load(); } })))))))));
    } catch (err) { showError(list, err); }
  }
  load();
})();
