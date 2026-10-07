(async function () {
  const { api, el, shell, showError } = ITH;
  const s = await shell({ auth: true });
  if (!s) return;
  const box = document.getElementById("adm");
  try {
    const r = await api("GET", "/api/admin/status");
    const cur = r.years.find((y) => y.assessment_year === r.current_ay);
    const prev = r.years.filter((y) => y.assessment_year < r.current_ay).pop();
    const stat = (k, v) => el("div", { class: "stat" }, el("div", { class: "k", text: k }), el("div", { class: "v", text: v }));
    box.replaceChildren(
      cur.rules_verified < cur.rules_total ? el("div", { class: "notice warning" }, el("p", { text: `${cur.rules_total - cur.rules_verified} rule(s) for AY ${r.current_ay} are not fully verified. Review them before relying on results.` })) : null,
      el("div", { class: "stats" },
        stat("Current AY", r.current_ay), stat("Previous AY", prev ? prev.assessment_year : "None loaded"),
        stat("Rules verified", `${cur.rules_verified} / ${cur.rules_total}`),
        stat("Portal mappings verified", `${cur.mappings_verified} full, ${cur.mappings_section_verified} section-only / ${cur.mappings_total}`),
        stat("Tests passing", r.tests ? `${r.tests.passed} / ${r.tests.total}` : "Not run"),
        stat("Mapping last verified", cur.mapping_last_verified)),
      el("section", { class: "panel" }, el("h2", { text: "Pending reviews" }), el("div", { class: "table-wrap" }, el("table", null,
        el("thead", null, el("tr", null, el("th", { text: "Rule" }), el("th", { text: "Status" }))),
        el("tbody", null, ...cur.rules_pending.map((p) => el("tr", null, el("td", { text: `${p.rule} (${p.key})` }), el("td", { text: p.status }))))))),
      el("section", { class: "panel" }, el("h2", { text: "Sources" }), el("div", { class: "table-wrap" }, el("table", null,
        el("thead", null, el("tr", null, ...["Source", "Authority", "Verified", "Notes"].map((h) => el("th", { text: h })))),
        el("tbody", null, ...cur.sources.map((x) => el("tr", null,
          el("td", null, el("a", { href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.title })),
          el("td", { text: x.authority }), el("td", { text: x.verified_on }), el("td", { class: "muted", text: x.notes }))))))));
  } catch (e) { showError(box, e); }
})();
