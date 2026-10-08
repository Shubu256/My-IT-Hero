(async function () {
  const { api, el, shell, showError, chip, copyBox } = ITH;
  const s = await shell();
  const list = document.getElementById("map-list");
  const q = document.getElementById("q");
  const itrSel = document.getElementById("itr-sel");
  const tags = ["salary", "TDS", "80C", "80D", "home loan", "interest", "capital gain", "dividend", "bank interest", "rent", "donation"];
  document.getElementById("tags").replaceChildren(...tags.map((t) => el("button", { type: "button", class: "tag", text: t, onclick: () => { q.value = t; run(); } })));
  document.getElementById("map-search").addEventListener("submit", (e) => { e.preventDefault(); run(); });
  itrSel.addEventListener("change", run);

  function dl(pairs) {
    return el("dl", null, ...pairs.filter(([, v]) => v !== null && v !== undefined && v !== "").flatMap(([k, v]) => [el("dt", { text: k }), el("dd", null, v)]));
  }

  async function run() {
    list.replaceChildren(el("p", { class: "muted", text: "Loading…" }));
    try {
      if (!s.user) {
        const r = await api("GET", "/api/mapping/search?q=" + encodeURIComponent(q.value.trim()));
        document.getElementById("map-meta").textContent = "Sign in to see your own values with copy buttons.";
        list.replaceChildren(...r.results.map((f) => {
          const m = f.mappings.find((x) => !itrSel.value || x.itr_form === itrSel.value);
          return el("article", { class: "map-card" },
            el("div", null, el("h3", { text: f.display_name }), el("p", { class: "muted", text: f.help })),
            m ? dl([["ITR form", m.itr_form], ["Schedule", m.schedule], ["Portal section", m.section], ["Portal field", m.portal_label], ["Portal path", m.portal_path], ["Label status", m.verification]])
              : el("p", { class: "muted", text: "Not reported in this ITR form." }));
        }));
        return;
      }
      const r = await api("GET", `/api/mapping?q=${encodeURIComponent(q.value.trim())}&itr=${encodeURIComponent(itrSel.value)}`);
      if (!itrSel.dataset.filled) {
        const keep = itrSel.value;
        itrSel.replaceChildren(el("option", { value: "", text: "Recommended ITR" }), ...r.itr_forms.map((x) => el("option", { value: x, text: x })));
        itrSel.value = r.itr_forms.includes(keep) ? keep : ""; itrSel.dataset.filled = "1";
      }
      document.getElementById("map-meta").textContent =
        `${r.profile.label} (${r.profile.category_short}). Showing ${r.fields.length} field(s) for ${r.itr}${r.itr === r.recommended ? " (recommended for you)" : " — your recommended form is " + r.recommended}. Mapping version ${r.mapping_version}, last checked ${r.last_verified}.` + (r.stale ? " This mapping is marked stale for the current year." : "");
      if (!r.fields.length) { list.replaceChildren(el("p", { class: "muted", text: "Nothing matches. Try another word, or enter more values in My Return." })); return; }
      list.replaceChildren(...r.fields.map((f) => el("article", { class: "map-card" },
        el("div", null,
          el("h3", { text: f.display_name }),
          el("p", { class: "muted", text: f.help }),
          copyBox(f.value, f.data_type),
          el("div", { class: "tagline" }, chip(f.status === "Calculated" ? null : f.status) || el("span", { class: "chip neutral", text: f.status }))),
        dl([
          ["ITR form", f.itr_form], ["Schedule", f.schedule || "Not reported in this form"], ["Portal section", f.section], ["Portal field", f.portal_label],
          ["Portal path", f.portal_path], ["Source", f.source_document ? f.source_document + (f.source_page ? `, page ${f.source_page}` : "") : (f.value ? "Entered by you" : null)],
          ["Confidence", f.confidence != null && f.source_document && f.group !== "computed" ? Math.round(f.confidence * 100) + "%" : null],
          ["Label status", f.mapping_verification],
        ]))));
    } catch (e) { showError(list, e); }
  }
  run();
})();
