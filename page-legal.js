(async function () {
  await ITH.shell();
  const id = ITH.currentPage().replace(/\.html$/, "") || "privacy";
  document.querySelectorAll(".legal section").forEach((s) => s.classList.toggle("hidden", s.id !== id));
  const h = document.querySelector(`#${CSS.escape(id)} h1`);
  if (h) document.title = h.textContent + " — my IT Hero";
})();
