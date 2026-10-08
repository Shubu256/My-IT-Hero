/* Taxpayer category hub: the eight categories, the user's returns, and starting a new one. */
(async function () {
  "use strict";
  const { api, el, shell, showError, toast } = ITH;
  const s = await shell();
  const D = await api("GET", "/api/categories");
  const BLURB = {
    IND_RES: "Salaried people, pensioners, freelancers and business owners who are resident in India.",
    IND_NR: "Non-residents and residents-but-not-ordinarily-resident, with a residential-status check.",
    HUF: "Hindu Undivided Families — resident or non-resident, with or without business income.",
    COMPANY: "Domestic and foreign companies, with the 115BA / 115BAA / 115BAB options and MAT.",
    FIRM: "Partnership firms and LLPs, including presumptive firms that can use ITR-4.",
    TRUST: "Charitable and religious trusts, 10(23C) institutions, private and business trusts.",
    COOP_AOP: "Co-operative societies, associations of persons, bodies of individuals, AJPs and local authorities.",
    POLITICAL: "Political parties, electoral trusts, research associations, universities and other ITR-7 filers.",
  };
  const grid = document.getElementById("cat-grid");
  grid.replaceChildren(...Object.entries(D.categories).map(([code, c]) => el("a", { class: "cat-card", href: c.page },
    el("strong", { text: c.label }), el("span", { text: BLURB[code] }), el("span", { class: "cat-meta", text: `${c.itr_forms.join(" / ")} · status: ${c.portal_status}` }))));
  if (!s.user) {
    document.getElementById("returns-panel").classList.add("hidden");
    document.getElementById("new-return-panel").replaceChildren(el("p", null, el("a", { href: "signup.html", text: "Create an account" }), " to prepare returns for any of these categories."));
    return;
  }
  const entSel = document.getElementById("nr-entity"), subSel = document.getElementById("nr-subtype");
  entSel.replaceChildren(...Object.entries(D.categories).map(([k, c]) => el("option", { value: k, text: c.label })));
  const fillSub = () => subSel.replaceChildren(...Object.entries(D.categories[entSel.value].subtypes).map(([k, v]) => el("option", { value: k, text: v })));
  entSel.addEventListener("change", fillSub); fillSub();
  document.getElementById("new-return").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("POST", "/api/profiles", { entity: entSel.value, subtype: subSel.value, label: document.getElementById("nr-label").value, copy_contact: true });
      toast(r.message); location.href = r.profile.page;
    } catch (err) { showError(null, err); }
  });
  async function list() {
    const P = await api("GET", "/api/profiles");
    document.getElementById("returns-list").replaceChildren(el("div", { class: "table-wrap" }, el("table", null,
      el("thead", null, el("tr", null, ...["Return", "Category", "Type", "Values", ""].map((h) => el("th", { text: h })))),
      el("tbody", null, ...P.profiles.map((p) => el("tr", { class: p.id === P.active ? "total" : "" },
        el("td", null, el("strong", { text: p.label }), p.id === P.active ? el("div", { class: "muted", text: "Open now" }) : null),
        el("td", null, el("a", { href: p.page, text: p.category })), el("td", { text: p.subtype_label }), el("td", { text: String(p.filled) }),
        el("td", null, el("div", { class: "btn-row" },
          p.id === P.active ? null : el("button", { class: "btn small", type: "button", text: "Open", onclick: async () => { await api("POST", `/api/profiles/${p.id}/activate`, {}); toast(`Opened ${p.label}.`); list(); } }),
          el("button", { class: "btn small secondary", type: "button", text: "Rename", onclick: async () => {
            const name = prompt("New name for this return", p.label); if (!name) return;
            await api("PATCH", `/api/profiles/${p.id}`, { label: name }); list(); } }),
          el("button", { class: "btn small danger", type: "button", text: "Delete", onclick: async () => {
            if (!confirm(`Delete the return "${p.label}" and its values?`)) return;
            await api("POST", `/api/profiles/${p.id}/activate`, {}); await api("DELETE", "/api/return"); toast("Return deleted."); list(); } })))))))));
  }
  try { await list(); } catch (e) { showError(document.getElementById("returns-list"), e); }
})();
