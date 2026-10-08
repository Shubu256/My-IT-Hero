(async function () {
  const { api, el, shell, showError, chip, fieldErrors, toast, displayValue } = ITH;
  const s = await shell({ auth: true });
  if (!s) return;
  const GROUPS = [
    ["personal", "Basic information"], ["category", "Category options"], ["residency", "Residential status check (days in India)"], ["flags", "Eligibility and audit questions"], ["salary", "Salary"],
    ["house_property", "House property"], ["other_sources", "Other sources"], ["capital_gains", "Capital gains"], ["business", "Business or profession"],
    ["trust", "Trust income and application"], ["political", "Political party / exempt entity conditions"],
    ["deductions", "Deductions (Chapter VI-A)"], ["taxes_paid", "Taxes already paid"], ["bank", "Refund bank account"], ["filing_check", "Is filing compulsory? (seventh proviso)"], ["filing", "Filing"],
  ];
  const ENUM_LABELS = { RES: "Resident", RNOR: "Resident but not ordinarily resident", NR: "Non-resident", none: "No house property", self: "Self-occupied", let: "Let out",
    normal: "Normal rates", "115BA": "Section 115BA (25%)", "115BAA": "Section 115BAA (22%)", "115BAB": "Section 115BAB (15%)", "115BAD": "Section 115BAD (22%)", "115BAE": "Section 115BAE (15%)" };

  function inputFor(f) {
    const id = "f-" + f.field_id;
    if (f.data_type === "bool") {
      return el("select", { id, name: f.field_id }, el("option", { value: "", text: "Not answered" }),
        el("option", { value: "false", text: "No", selected: f.value === "false" }), el("option", { value: "true", text: "Yes", selected: f.value === "true" }));
    }
    if (f.data_type.startsWith("enum:")) {
      return el("select", { id, name: f.field_id }, el("option", { value: "", text: "Select" }),
        ...f.data_type.slice(5).split("|").map((o) => el("option", { value: o, text: ENUM_LABELS[o] || o, selected: f.value === o })));
    }
    const type = f.data_type === "date" ? "date" : f.data_type === "email" ? "email" : f.data_type === "mobile" ? "tel" : "text";
    const v = f.value == null ? "" : f.data_type === "date" ? f.value : displayValue(f.value, f.data_type);
    return el("input", { id, name: f.field_id, type, value: v, inputmode: ["money", "int", "mobile", "account"].includes(f.data_type) ? "numeric" : null,
      autocomplete: "off", placeholder: f.data_type === "money" ? "e.g. 1,20,000" : f.data_type === "pan" ? "ABCDE1234F" : null });
  }

  async function load() {
    let r;
    try { r = await api("GET", "/api/return"); } catch (e) { showError(document.getElementById("ret-err"), e); return; }
    document.getElementById("ret-sub").replaceChildren(`${r.profile.label} — ${r.profile.category} (${r.profile.subtype_label}) · AY ${r.assessment_year} · ${r.regime === "new" ? "New regime" : r.regime === "old" ? "Old regime" : "Option: " + r.regime} · ${r.filled} values entered · ${r.documents} document(s) · `,
      el("a", { href: "taxpayer-categories.html", text: "switch return" }));
    const cbox = document.getElementById("counts");
    cbox.replaceChildren(...Object.entries(r.counts).map(([k, v]) => el("div", { class: "stat" }, el("div", { class: "k" }, chip(k)), el("div", { class: "v", text: String(v) }))));
    const secs = document.getElementById("sections");
    secs.replaceChildren(...GROUPS.map(([g, title]) => {
      const fields = r.fields.filter((f) => f.group === g);
      if (!fields.length) return null;
      const form = el("form", { novalidate: true });
      fields.forEach((f) => {
        const p = f.provenance;
        const meta = [];
        if (p) {
          meta.push(p.source_document ? `From ${p.source_document}${p.source_page ? ", page " + p.source_page : ""}` : `Source: ${p.extraction_method}`);
          if (p.extraction_method !== "manual") meta.push(`confidence ${Math.round(p.confidence * 100)}%`);
        }
        if (!f.regimes.includes(r.regime)) meta.push(`not used in the ${r.regime} regime`);
        const side = el("div", { class: "side" }, chip(f.status));
        if (f.status === "Needs Review") side.append(el("button", { class: "btn small secondary", type: "button", text: "Mark verified", onclick: async () => {
          try { await api("POST", `/api/return/fields/${f.field_id}/verify`, {}); toast(f.display_name + " verified."); load(); } catch (e) { showError(null, e); } } }));
        const row = el("div", { class: "frow" },
          el("div", { class: "field" }, el("label", { for: "f-" + f.field_id }, f.display_name, f.required ? " *" : "", el("span", { class: "hint", text: f.help })), inputFor(f)),
          el("div", { class: "meta", text: meta.join(" · ") }), side);
        if (f.conflict) {
          row.append(el("div", { class: "conflict", role: "alert" }, el("strong", { text: "Values differ — review needed. " }),
            `Your return: ${displayValue(f.conflict.current, f.data_type) || "empty"}. Documents: ` +
            f.conflict.candidates.map((c) => `${displayValue(c.value, f.data_type)} (${c.source}, p.${c.page}, ${c.status})`).join("; ") +
            ". Correct the value here or accept/reject the document value on the Upload page."));
        }
        form.append(row);
      });
      form.append(el("div", { class: "btn-row" }, el("button", { class: "btn", type: "submit", text: "Save " + title.split(" (")[0].toLowerCase() })));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const values = {};
        fields.forEach((f) => {
          const v = form.elements[f.field_id].value;
          const before = f.value == null ? "" : f.data_type === "date" ? f.value : displayValue(f.value, f.data_type);
          if (v !== before) values[f.field_id] = v;
        });
        if (!Object.keys(values).length) { toast("Nothing changed."); return; }
        try { await api("PUT", "/api/return/fields", { values }); fieldErrors(form, null); toast("Saved."); load(); }
        catch (err) { fieldErrors(form, err.body && err.body.details); showError(null, err); }
      });
      return el("section", { class: "panel", id: "sec-" + g }, el("h2", { text: title }), form);
    }));
  }
  load();
})();
