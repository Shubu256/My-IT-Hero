(async function () {
  const { api, el, shell, showError, toast } = ITH;
  const s = await shell({ auth: true });
  if (!s) return;
  const drop = document.getElementById("drop");
  const input = document.getElementById("file");
  const status = document.getElementById("upload-status");

  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => uploadAll(Array.from(e.dataTransfer.files)));
  input.addEventListener("change", () => { const files = Array.from(input.files); input.value = ""; uploadAll(files); });

  async function uploadAll(files) {
    for (const f of files) {
      const line = el("div", { class: "notice info" }, el("p", { text: `Reading ${f.name}…` }));
      status.prepend(line);
      if (f.size > 10 * 1024 * 1024) { line.className = "notice error"; line.firstChild.textContent = `${f.name}: larger than 10 MB. Upload a smaller file.`; continue; }
      const fd = new FormData(); fd.append("file", f);
      try {
        const r = await api("POST", "/api/documents", fd, { progress: (msg) => { line.firstChild.textContent = `${f.name}: ${msg}`; } });
        const n = r.document.extractions.length;
        line.firstChild.textContent = `${f.name}: read as ${r.document.doc_label}. ${n} value(s) found — review them below.`;
      } catch (e) {
        line.className = "notice error";
        line.firstChild.textContent = `${f.name}: ${e.body ? e.body.message + " " + (e.body.user_action || "") : e.message}`;
      }
    }
    load();
  }

  const dlg = document.getElementById("conflict-dlg");
  function askConflict(details) {
    return new Promise((resolve) => {
      document.getElementById("conflict-text").textContent =
        `Your return has ${ITH.displayValue(details.current, "money") || details.current}, but this document shows ${ITH.displayValue(details.document, "money") || details.document}. Which value is correct? We won't choose for you.`;
      const done = (v) => { dlg.close(); resolve(v); };
      document.getElementById("use-doc").onclick = () => done(true);
      document.getElementById("keep-mine").onclick = () => done(false);
      dlg.showModal();
    });
  }

  async function accept(ex, inputEl, replace) {
    try {
      await api("POST", `/api/extractions/${ex.id}/accept`, { value: inputEl.value, replace: !!replace });
      toast(`${ex.display_name} added to your return.`);
      load();
    } catch (e) {
      if (e.body && e.body.error_code === "CONFLICT") {
        if (await askConflict(e.body.details)) accept(ex, inputEl, true);
        else { await api("POST", `/api/extractions/${ex.id}/reject`, {}); load(); }
      } else showError(null, e);
    }
  }

  async function load() {
    const box = document.getElementById("docs");
    try {
      const r = await api("GET", "/api/documents");
      document.getElementById("ret-days").textContent = r.retention_days;
      if (!r.documents.length) { box.replaceChildren(el("p", { class: "muted", text: "No documents yet. Upload your Form 16 first — it covers most salary figures." })); return; }
      box.replaceChildren(...r.documents.map((d) => {
        const rows = d.extractions.map((x) => {
          const inp = el("input", { type: "text", value: x.normalized_value ?? x.raw_value ?? "", "aria-label": "Value for " + x.display_name });
          const low = x.confidence < 0.8;
          const vstat = { valid: ["Valid", "verified"], low_confidence: ["Low confidence", "review"], invalid: ["Invalid", "error"] }[x.validation_status] || [x.validation_status, "neutral"];
          return el("tr", null,
            el("td", null, el("strong", { text: x.display_name }), x.message ? el("div", { class: "field-error", text: x.message }) : null,
              x.flags.length ? el("div", { class: "muted", text: x.flags.join(", ").replaceAll("_", " ") }) : null),
            el("td", { text: x.page ?? "—" }),
            el("td", { text: x.raw_value ?? "—" }),
            el("td", { text: x.normalized_value ?? "—" }),
            el("td", null, el("span", { class: "conf" + (low ? " low" : ""), text: Math.round(x.confidence * 100) + "%" })),
            el("td", null, el("span", { class: "chip " + vstat[1], text: vstat[0] })),
            el("td", null, x.status === "pending" ? el("div", { class: "ex-actions" }, inp,
              el("button", { class: "btn small", type: "button", text: "Accept", onclick: () => accept(x, inp) }),
              el("button", { class: "btn small secondary", type: "button", text: "Reject", onclick: async () => { await api("POST", `/api/extractions/${x.id}/reject`, {}); load(); } }))
              : el("span", { class: "chip " + (x.status === "accepted" ? "verified" : "missing"), text: x.status === "accepted" ? "Confirmed" : "Rejected" })));
        });
        return el("article", { class: "doc" },
          el("div", { class: "doc-head" },
            el("div", null, el("h3", { text: d.name }), el("div", { class: "muted", text: `${d.doc_label} (${Math.round((d.doc_type_confidence || 0) * 100)}% sure) · ${d.pages} page(s) · auto-delete ${new Date(d.expires_at * 1000).toLocaleDateString("en-IN")}` })),
            el("button", { class: "btn small danger", type: "button", text: "Delete document", onclick: async () => {
              if (!confirm(`Delete ${d.name}? Values you already confirmed stay in your return.`)) return;
              try { await api("DELETE", `/api/documents/${d.id}`); toast("Document deleted."); load(); } catch (e) { showError(null, e); } } })),
          rows.length ? el("div", { class: "table-wrap" }, el("table", null,
            el("thead", null, el("tr", null, ...["Field", "Page", "Extracted", "Normalised", "Confidence", "Validation", "Your confirmation"].map((h) => el("th", { text: h })))),
            el("tbody", null, ...rows)))
            : el("p", { class: "muted", text: "No values could be read automatically. Enter the figures from this document in My Return." }));
      }));
    } catch (e) { showError(box, e); }
  }
  load();
})();
