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

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("nl-NL");
}

function productId(product) {
  return product.uniqueKey || `${product.source || "onbekend"}:${product.sourceId || "onbekend"}`;
}

function trainingType(product) {
  const value = [product.title, product.subcategory, ...(product.types || [])].filter(Boolean).join(" ").toLowerCase();
  if (/half[- ]?zip|quarter[- ]?zip/.test(value)) return "Half-zip";
  if (/windbreaker|windjack|windproof/.test(value)) return "Windjacks";
  if (/hoodie|hooded/.test(value)) return "Hoodies";
  if (/jacket|coat|jas/.test(value)) return "Jassen";
  if (/tracksuit|training suit|trainingspak|training set/.test(value)) return "Trainingspakken";
  if (/pants|trousers|broek/.test(value)) return "Trainingsbroeken";
  if (/shorts|short/.test(value)) return "Trainingsshorts";
  if (/long sleeve|lange mouw/.test(value)) return "Lange mouw";
  if (/short sleeve|korte mouw/.test(value)) return "Korte mouw";
  return "Overige trainingskleding";
}

function productPath(product) {
  const section = text(product.section, "Overige producten");
  const category = text(product.category, "Overige producten");
  const subcategory = text(product.subcategory || product.competition, "Overig");
  const club = text(product.club, subcategory);
  const season = text(product.season, "Seizoen onbekend");

  if (section === "Voetbal" || section === "Trainingskleding") {
    const rootCategory = category === "Clubteams" ? "Clubteams" : category === "Landenteams" ? "Landenteams" : "Overig";
    const productType = section === "Trainingskleding" ? "Trainingskleding" : "Shirts";

    if (rootCategory === "Clubteams") {
      const path = ["Voetbal", "Clubteams", text(product.competition || subcategory, "Overige competities"), club, season, productType];
      if (productType === "Trainingskleding") path.push(trainingType(product));
      return path;
    }

    if (rootCategory === "Landenteams") {
      const path = ["Voetbal", "Landenteams", club, season, productType];
      if (productType === "Trainingskleding") path.push(trainingType(product));
      return path;
    }

    const path = ["Voetbal", "Overig", club, season, productType];
    if (productType === "Trainingskleding") path.push(trainingType(product));
    return path;
  }

  if (section === "Voetbalschoenen" || (section === "Schoenen" && category === "Voetbalschoenen")) {
    const brand = section === "Voetbalschoenen" ? category : subcategory;
    const model = section === "Voetbalschoenen" ? subcategory : text(product.club, "Overig model");
    return ["Voetbalschoenen", brand, model];
  }

  return [section, category, subcategory];
}

function samePath(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function pathStartsWith(path, prefix) {
  return prefix.every((value, index) => path[index] === value);
}

function createNode() {
  return { count: 0, children: new Map() };
}

function buildTree() {
  const root = createNode();
  for (const product of products()) {
    let node = root;
    node.count++;
    for (const label of productPath(product)) {
      if (!node.children.has(label)) node.children.set(label, createNode());
      node = node.children.get(label);
      node.count++;
    }
  }
  return root;
}

function labelSort(a, b) {
  if (a === "Seizoen onbekend") return 1;
  if (b === "Seizoen onbekend") return -1;
  if (/^(19|20)\d{2}-/.test(a) && /^(19|20)\d{2}-/.test(b)) return Number(b.slice(0, 4)) - Number(a.slice(0, 4));
  return a.localeCompare(b, "nl", { numeric: true });
}

function navButton(label, path, count) {
  return `<button class="nav-pill${samePath(path, selectedPath) ? " active" : ""}" data-path="${esc(JSON.stringify(path))}">
    <span>${esc(label)}</span><span>${formatNumber(count)}</span>
  </button>`;
}

function renderTree(node, currentPath = []) {
  return [...node.children.entries()].sort(([a], [b]) => labelSort(a, b)).map(([label, child]) => {
    const nextPath = [...currentPath, label];
    if (!child.children.size) return navButton(label, nextPath, child.count);
    return `<details class="nav-group" ${pathStartsWith(selectedPath, nextPath) ? "open" : ""}>
      <summary>${esc(label)}<span>${formatNumber(child.count)}</span></summary>
      <div class="nav-level">
        ${navButton(`Alles binnen ${label}`, nextPath, child.count)}
        ${renderTree(child, nextPath)}
      </div>
    </details>`;
  }).join("");
}

function renderNavigation() {
  const tree = buildTree();
  categories.innerHTML = navButton("Alles", [], tree.count) + renderTree(tree);
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
  return [product.title, product.source, product.country, product.competition, product.club, product.season, ...productPath(product), ...(product.types || [])]
    .filter(Boolean).join(" ").toLowerCase();
}

function filteredProducts() {
  const term = query.value.trim().toLowerCase();
  return products().filter(product => pathStartsWith(productPath(product), selectedPath) && (!term || searchableText(product).includes(term)));
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

  grid.innerHTML = visible.map(product => {
    const image = product.coverUrl || product.images?.[0] || "";
    const label = productPath(product).slice(1).join(" · ");
    const imageCount = product.imageCount || product.images?.length || 0;
    return `<article class="card" data-id="${esc(productId(product))}">
      ${image ? `<img class="album-cover" loading="lazy" decoding="async" src="${esc(image)}" alt="${esc(product.title)}">` : `<div class="album-cover no-image">Geen foto</div>`}
      <div class="card-copy"><span>${esc(label)}</span><strong>${esc(product.title)}</strong><small>${esc(imageCount)} foto's</small></div>
    </article>`;
  }).join("") + (visible.length < filtered.length ? `<div class="load-more-wrap" style="grid-column:1/-1;text-align:center;padding:24px"><button id="loadMore" type="button">Meer producten laden (${formatNumber(visible.length)} van ${formatNumber(filtered.length)})</button></div>` : "");

  grid.querySelectorAll(".card").forEach(card => card.onclick = () => openProduct(card.dataset.id));
  const loadMore = document.querySelector("#loadMore");
  if (loadMore) loadMore.onclick = () => { visibleLimit += PAGE_SIZE; renderProducts(); };
}

function openProduct(id) {
  const product = products().find(item => productId(item) === id);
  if (!product) return;
  grid.hidden = true;
  detail.hidden = false;
  const images = Array.isArray(product.images) ? product.images : [];
  detail.innerHTML = `<button class="back" type="button">← Terug naar overzicht</button>
    <p class="eyebrow">${esc(productPath(product).join(" › "))}</p>
    <h1>${esc(product.title)}</h1>
    ${product.types?.length ? `<p>${esc(product.types.join(" · "))}</p>` : ""}
    <div class="detail-photos">${images.length ? images.map((src, index) => `<img loading="lazy" decoding="async" src="${esc(src)}" alt="${esc(product.title)} foto ${index + 1}">`).join("") : `<p class="empty-state">Voor dit product zijn nog geen foto's opgeslagen.</p>`}</div>`;
  detail.querySelector(".back").onclick = () => { renderProducts(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadCatalog() {
  try {
    const response = await fetch(`./data/catalog.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalog = await response.json();
    renderNavigation();
    renderProducts();
  } catch (error) {
    console.error("Catalogusfout:", error);
    grid.innerHTML = `<p class="error">Catalogus kon niet worden geladen: ${esc(error.message)}</p>`;
    heading.textContent = "Catalogus";
    meta.textContent = "Laden mislukt";
  }
}

query.oninput = () => { visibleLimit = PAGE_SIZE; renderProducts(); };
loadCatalog();
