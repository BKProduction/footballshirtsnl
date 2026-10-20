let catalog = { albums: [] };
let competition = "";
let club = "";
const grid = document.querySelector("#grid");
const detail = document.querySelector("#detail");
const query = document.querySelector("#q");
const categories = document.querySelector("#cats");
const heading = document.querySelector("#heading");
const meta = document.querySelector("#meta");
const esc = value => String(value || "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[c]);

function grouped() {
  const groups = new Map();
  for (const album of catalog.albums) {
    const comp = album.competition || "Overige collectie";
    if (!groups.has(comp)) groups.set(comp, new Set());
    groups.get(comp).add(album.club || "Overig");
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "nl"));
}

function renderNavigation() {
  categories.innerHTML = `<button class="nav-all active" data-competition="" data-club="">Alle albums</button>` + grouped().map(([comp, clubs]) => `
    <details class="competition" ${competition === comp ? "open" : ""}>
      <summary>${esc(comp)} <span>${[...clubs].length}</span></summary>
      <button data-competition="${esc(comp)}" data-club="">Alle ${esc(comp)}</button>
      ${[...clubs].sort((a,b)=>a.localeCompare(b,"nl")).map(name => `<button data-competition="${esc(comp)}" data-club="${esc(name)}">${esc(name)}</button>`).join("")}
    </details>`).join("");

  categories.querySelectorAll("button").forEach(button => {
    button.onclick = () => {
      competition = button.dataset.competition || "";
      club = button.dataset.club || "";
      renderNavigation();
      renderAlbums();
    };
  });
}

function renderAlbums() {
  detail.hidden = true;
  grid.hidden = false;
  const term = query.value.trim().toLowerCase();
  const albums = catalog.albums.filter(album =>
    (!competition || album.competition === competition) &&
    (!club || album.club === club) &&
    (!term || `${album.title} ${album.club} ${album.competition}`.toLowerCase().includes(term))
  );

  heading.textContent = club || competition || "Alle albums";
  meta.textContent = `${albums.length} albums`;
  grid.innerHTML = albums.map(album => `
    <article class="card" data-id="${esc(album.sourceId)}">
      <img class="album-cover" loading="lazy" decoding="async" src="${esc(album.coverUrl)}" alt="${esc(album.title)}">
      <div class="card-copy"><span>${esc(album.competition)}</span><strong>${esc(album.title)}</strong><small>${album.imageCount || album.images.length} foto's</small></div>
    </article>`).join("");
  grid.querySelectorAll(".card").forEach(card => card.onclick = () => openAlbum(card.dataset.id));
}

function openAlbum(id) {
  const album = catalog.albums.find(item => String(item.sourceId) === String(id));
  if (!album) return;
  grid.hidden = true;
  detail.hidden = false;
  detail.innerHTML = `
    <button class="back">← Terug naar overzicht</button>
    <p class="eyebrow">${esc(album.competition)} · ${esc(album.club)}</p>
    <h1>${esc(album.title)}</h1>
    <p>${album.images.length} foto's</p>
    <div class="photos">${album.images.map((src, i) => `<img loading="lazy" decoding="async" src="${esc(src)}" alt="${esc(album.title)} foto ${i + 1}">`).join("")}</div>`;
  detail.querySelector(".back").onclick = renderAlbums;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

fetch("./data/catalog.json", { cache: "no-store" })
  .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then(data => { catalog = data; renderNavigation(); renderAlbums(); })
  .catch(error => { grid.innerHTML = `<p>Catalogus kon niet worden geladen: ${esc(error.message)}</p>`; });
query.oninput = renderAlbums;
