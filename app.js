let catalog = { products: [] };
let selectedPath = [];
let visibleLimit = 120;
const PAGE_SIZE = 120;

const grid = document.querySelector("#grid");
const detail = document.querySelector("#detail");
const query = document.querySelector("#q");
const categories = document.querySelector("#cats");
const heading = document.querySelector("#heading");
const meta = document.querySelector("#meta");

const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

function products() {
  if (Array.isArray(catalog.products)) return catalog.products;
  if (Array.isArray(catalog.albums)) return catalog.albums;
  return [];
}

function sectionOf(product) {
  return product.section || "Overige producten";
}

function categoryOf(product) {
  return product.category || "Overige producten";
}

function competitionOf(product) {
  return product.competition || product.subcategory || "Overige competitie";
}

/*
 * Verwijdert uitsluitend losstaande cijfers aan het einde van een clubnaam.
 * Voorbeelden:
 *   "Ajax 12345"         -> "Ajax"
 *   "Real Madrid 01"     -> "Real Madrid"
 *   "Paris Saint-Germain" blijft ongewijzigd
 *
 * Cijfers midden in een naam worden niet verwijderd.
 */
function cleanClubName(value) {
  const cleaned = String(value || "")
    .replace(/\s+\d+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned || "Overige club";
}

function clubOf(product) {
  return cleanClubName(product.club);
}

function seasonOf(product) {
  return product.season || "Seizoen onbekend";
}

function idOf(product) {
  return product.uniqueKey || `${product.source || "onbekend"}:${product.sourceId}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("nl-NL");
}

/*
 * Navigatiestructuur:
 * Voetbal / Trainingskleding -> Clubteams -> Competitie -> Club -> Seizoen
 * Voetbal / Trainingskleding -> Landenteams -> Land -> Seizoen
 * Voetbalschoenen -> Merk -> Model
 */
function navigationPath(product) {
  const section = sectionOf(product);
  const category = categoryOf(product);

  if (section === "Voetbalschoenen") {
    return [section, category, product.subcategory || "Overig model"];
  }

  if ((section === "Voetbal" || section === "Trainingskleding") && category === "Clubteams") {
    return [section, category, competitionOf(product), clubOf(product), seasonOf(product)];
  }

  if ((section === "Voetbal" || section === "Trainingskleding") && category === "Landenteams") {
    return [
      section,
      category,
      product.country || product.subcategory || clubOf(product),
      seasonOf(product)
    ];
  }

  return [section, category, product.subcategory || "Overig"];
}

function startsWithPath(fullPath, prefix) {
  return prefix.every((value, index) => fullPath[index] === value);
}

function pathEquals(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function compareLabels(first, second) {
  if (first === "Seizoen onbekend") return 1;
  if (second === "Seizoen onbekend") return -1;

  const firstYear = /^\d{4}-/.test(first) ? Number(first.slice(0, 4)) : null;
  const secondYear = /^\d{4}-/.test(second) ? Number(second.slice(0, 4)) : null;

  if (firstYear !== null && secondYear !== null) return secondYear - firstYear;
  return first.localeCompare(second, "nl", { numeric: true });
}

function treeNode() {
  return { count: 0, children: new Map() };
}

function buildTree() {
  const root = treeNode();

  for (const product of products()) {
    let node = root;
    node.count++;

    for (const label of navigationPath(product)) {
      if (!node.children.has(label)) node.children.set(label, treeNode());
      node = node.children.get(label);
      node.count++;
    }
  }

  return root;
}

function navButton(label, path, count) {
  return `<button class="nav-pill${pathEquals(path, selectedPath) ? " active" : ""}" data-path="${esc(JSON.stringify(path))}"><span>${esc(label)}</span><span>${formatNumber(count)}</span></button>`;
}

function renderBranch(node, path = []) {
  return [...node.children.entries()]
    .sort(([first], [second]) => compareLabels(first, second))
    .map(([label, child]) => {
      const nextPath = [...path, label];

      if (!child.children.size) {
        return navButton(label, nextPath, child.count);
      }

      return `<details class="nav-group" ${startsWithPath(selectedPath, nextPath) ? "open" : ""}>
        <summary>${esc(label)}<span>${formatNumber(child.count)}</span></summary>
        <div class="nav-level">
          ${navButton(`Alles binnen ${label}`, nextPath, child.count)}
          ${renderBranch(child, nextPath)}
        </div>
      </details>`;
    })
    .join("");
}

function renderNavigation() {
  const tree = buildTree();
  categories.innerHTML = navButton("Alle producten", [], tree.count) + renderBranch(tree);

  categories.querySelectorAll("button[data-path]").forEach(button => {
    button.onclick = () => {
      selectedPath = JSON.parse(button.dataset.path || "[]");
      visibleLimit = PAGE_SIZE;
      renderNavigation();
      renderProducts();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  });
}

function searchableText(product) {
  return [
    product.title,
    ...navigationPath(product),
    product.country,
    product.competition,
    ...(product.types || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filteredProducts() {
  const term = query.value.trim().toLowerCase();

  return products().filter(product =>
    startsWithPath(navigationPath(product), selectedPath) &&
    (!term || searchableText(product).includes(term))
  );
}

function imageMarkup(image, title, className = "album-cover") {
  if (!image) {
    return `<div class="${className} no-image">Geen foto</div>`;
  }

  return `<img class="${className}" loading="lazy" decoding="async" src="${esc(image)}" alt="${esc(title)}" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'${className} no-image',textContent:'Geen foto'}))">`;
}

function renderProducts() {
  detail.hidden = true;
  grid.hidden = false;

  const filtered = filteredProducts();
  const visible = filtered.slice(0, visibleLimit);

  heading.textContent = selectedPath.at(-1) || "Alle producten";
  meta.textContent = `${formatNumber(filtered.length)} ${filtered.length === 1 ? "product" : "producten"}`;

  if (!filtered.length) {
    grid.innerHTML = `<p class="empty-state">Geen producten gevonden binnen deze selectie.</p>`;
    return;
  }

  const cards = visible.map(product => {
    const image = product.coverUrl || product.images?.[0] || "";
    const label = navigationPath(product).slice(1).join(" · ");
    const imageCount = product.imageCount || product.images?.length || 0;

    return `<article class="card" data-id="${esc(idOf(product))}">
      ${imageMarkup(image, product.title)}
      <div class="card-copy">
        <span>${esc(label)}</span>
        <strong>${esc(product.title)}</strong>
        <small>${esc(imageCount)} ${imageCount === 1 ? "foto" : "foto’s"}</small>
      </div>
    </article>`;
  }).join("");

  const more = visible.length < filtered.length
    ? `<div class="load-more-wrap" style="grid-column:1/-1;text-align:center;padding:24px"><button id="loadMore" type="button">Meer producten laden (${formatNumber(visible.length)} van ${formatNumber(filtered.length)})</button></div>`
    : "";

  grid.innerHTML = cards + more;

  grid.querySelectorAll(".card").forEach(card => {
    card.onclick = () => openProduct(card.dataset.id);
  });

  const loadMore = document.querySelector("#loadMore");
  if (loadMore) {
    loadMore.onclick = () => {
      visibleLimit += PAGE_SIZE;
      renderProducts();
    };
  }
}

function openProduct(id) {
  const product = products().find(item => idOf(item) === id);
  if (!product) return;

  grid.hidden = true;
  detail.hidden = false;

  const images = Array.isArray(product.images) ? product.images : [];

  detail.innerHTML = `<button class="back" type="button">← Terug naar overzicht</button>
    <p class="eyebrow">${esc(navigationPath(product).join(" › "))}</p>
    <h1>${esc(product.title)}</h1>
    ${product.types?.length ? `<p>${esc(product.types.join(" · "))}</p>` : ""}
    <div class="detail-photos">
      ${images.length
        ? images.map((src, index) => `<img loading="lazy" decoding="async" src="${esc(src)}" alt="${esc(product.title)} foto ${index + 1}" onerror="this.remove()">`).join("")
        : `<p class="empty-state">Voor dit product zijn geen foto’s beschikbaar.</p>`}
    </div>`;

  detail.querySelector(".back").onclick = () => {
    renderProducts();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadCatalog() {
  try {
    const response = await fetch(`./data/catalog.json?v=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    catalog = await response.json();
    console.log(`[Catalogus] ${products().length} producten geladen`);
    renderNavigation();
    renderProducts();
  } catch (error) {
    console.error("Catalogusfout:", error);
    grid.innerHTML = `<p class="error">De catalogus kon niet worden geladen: ${esc(error.message)}</p>`;
    heading.textContent = "Catalogus";
    meta.textContent = "Laden mislukt";
  }
}

query.oninput = () => {
  visibleLimit = PAGE_SIZE;
  renderProducts();
};

loadCatalog();
