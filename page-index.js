(async function () {
  const { el, api, copyBox, shell } = ITH;
  const s = await shell();
  if (s && s.user) { /* signed-in users still may view the landing page */ }
  document.getElementById("demo-1").append(copyBox("1200000", "money"));
  document.getElementById("demo-2").append(copyBox("102000", "money"));
  document.getElementById("demo-3").append(copyBox("8450", "money"));
  if (s && s.meta && s.meta.deadlines) {
    const d = new Date(s.meta.deadlines.belated_return_last_date + "T00:00:00");
    document.getElementById("deadline-note").textContent =
      `Preparing AY ${s.meta.active_ay}. The original due date for most individuals has passed; a belated return can be filed until ${d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} (to be confirmed on the portal).`;
  }
  const tags = ["salary", "TDS", "80C", "80D", "home loan", "interest", "capital gain", "dividend", "bank interest", "rent", "donation"];
  const tagBox = document.getElementById("pub-tags");
  tags.forEach((t) => tagBox.append(el("button", { type: "button", class: "tag", text: t, onclick: () => { document.getElementById("pq").value = t; run(t); } })));
  document.getElementById("pub-search").addEventListener("submit", (e) => { e.preventDefault(); run(document.getElementById("pq").value); });

  async function run(q) {
    const out = document.getElementById("pub-results");
    out.replaceChildren(el("p", { class: "muted", text: "Searching…" }));
    try {
      const r = await api("GET", "/api/mapping/search?q=" + encodeURIComponent(q.trim()));
      if (!r.results.length) { out.replaceChildren(el("p", { class: "muted", text: "No match. Try a simpler word like “interest” or “salary”." })); return; }
      out.replaceChildren(...r.results.slice(0, 8).map((f) => el("div", { class: "map-card" },
        el("div", null, el("h3", { text: f.display_name }), el("p", { class: "muted", text: f.help })),
        el("dl", null, ...f.mappings.slice(0, 4).flatMap((m) => [el("dt", { text: m.itr_form }),
          el("dd", { text: [m.schedule, m.section, m.portal_label].filter(Boolean).join(" › ") })])))),
        el("p", { class: "muted", text: r.disclaimer }));
    } catch (e) { ITH.showError(out, e); }
  }
})();
