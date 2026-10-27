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
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
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

function productSeason(product) {
  const value = text(product.season);
  if (!value || /onbekend/i.test(value)) return "Seizoen onbekend";

  const match = value.match(/\b((?:19|20)?\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/);
  if (!match) return value;

  let first = Number(match[1]);
  if (match[1].length === 2) first += first >= 50 ? 1900 : 2000;

  let second = Number(match[2]);
  if (match[2].length === 2) {
    second += Math.floor(first / 100) * 100;
    if (second < first) second += 100;
  }

  return `${first}-${second}`;
}

function trainingType(product) {
  const explicit = text(product.trainingType || product.productType);
  if (explicit) return explicit;

  const haystack = [product.title, product.subcategory, ...(product.types || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/half[- ]?zip|quarter[- ]?zip/.test(haystack)) return "Half-zip";
  if (/windbreaker|windjack/.test(haystack)) return "Windjacks";
  if (/hoodie|hooded/.test(haystack)) return "Hoodies";
  if (/jacket|coat|jas/.test(haystack)) return "Jassen";
  if (/tracksuit|training suit|trainingspak|set/.test(haystack)) return "Trainingspakken";
  if (/pants|trousers|broek/.test(haystack)) return "Trainingsbroeken";
  if (/shorts|short/.test(haystack)) return "Trainingsshorts";
  if (/long sleeve|lange mouw/.test(haystack)) return "Lange mouw";
  if (/short sleeve|korte mouw/.test(haystack)) return "Korte mouw";
  return "Overige trainingskleding";
}

function normalizedSection(product) {
  const section = text(product.section, "Overige producten");
  if (section === "Schoenen" && text(product.category) === "Voetbalschoenen") return "Voetbalschoenen";
  return section;
}

function productPath(product) {
  const section = normalizedSection(product);
  const category = text(product.category, "Overige producten");
  const subcategory = text(product.subcategory || product.competition, "Overig");
  const club = text(product.club, "Overig");
  const season = productSeason(product);

  // Shirts en trainingskleding komen samen onder Voetbal > team > club/land > seizoen.
  if (section === "Voetbal" || section === "Trainingskleding") {
    const teamCategory = category === "Landenteams" ? "Landenteams" : category === "Clubteams" ? "Clubteams" : "Overig";
    const teamName = club !== "Overig" ? club : subcategory;
    const productType = section === "Trainingskleding" ? "Trainingskleding" : "Shirts";

    if (teamCategory === "Clubteams") {
      const competition = text(product.competition || subcategory, "Overige clubs");
      return ["Voetbal", "Clubteams", competition, teamName, season, productType, ...(productType === "Trainingskleding" ? [trainingType(product)] : [])];
    }

    if (teamCategory === "Landenteams") {
      return ["Voetbal", "Landenteams", teamName, season, productType, ...(productType === "Trainingskleding" ? [trainingType(product)] : [])];
    }

    return ["Voetbal", "Overig", teamName || "Overig", season, productType, ...(productType === "Trainingskleding" ? [trainingType(product)] : [])];
  }

  if (section === "Voetbalschoenen") {
    const brand = category === "Voetbalschoenen" ? text(product.subcategory, "Overige merken") : category;
    const model = category === "Voetbalschoenen" ? text(product.club, "Overige modellen") : subcategory;
    return ["Voetbalschoenen", brand, model];
  }

  return [section, category, subcategory];
}

function startsWithPath(fullPath, filterPath) {
  return filterPath.every((value, index) => fullPath[index] === value);
}

function samePath(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function isPrefix(prefix, fullPath) {
  return prefix.every((value, index) => fullPath[index] === value);
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

function labelSort(first, second) {
  if (first === "Seizoen onbekend") return 1;
  if (second === "Seizoen onbekend") return -1;

  const firstSeason = /^(19|20)\d{2}-/.test(first);
  const secondSeason = /^(19|20)\d{2}-/.test(second);
  if (firstSeason && secondSeason) return Number(second.slice(0, 4)) - Number(first.slice(0, 4));

  return first.localeCompare(second, "nl", { numeric: true });
}

function navButton(label, path, count) {
  return `<button class="nav-pill${samePath(path, selectedPath) ? " active" : ""}" data-path="${esc(JSON.stringify(path))}">
    <span>${esc(label)}</span>
    <span>${formatNumber(count)}</span>
  </button>`;
}

function renderTree(node, currentPath = []) {
  return [...node.children.entries()]
    .sort(([first], [second]) => labelSort(first, second))
    .map(([label, child]) => {
      const nextPath = [...currentPath, label];

      if (!child.children.size) return navButton(label, nextPath, child.count);

      return `<details class="nav-group" ${isPrefix(nextPath, selectedPath) ? "open" : ""}>
        <summary>${esc(label)}<span>${formatNumber(child.count)}</span></summary>
        <div class="nav-level">
          ${navButton(`Alles binnen ${label}`, nextPath, child.count)}
          ${renderTree(child, nextPath)}
        </div>
      </details>`;
    })
    .join("");
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
  return [
    product.title,
    product.source,
    product.country,
    product.competition,
    product.club,
    productSeason(product),
    ...productPath(product),
    ...(Array.isArray(product.types) ? product.types : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function filteredProducts() {
  const searchTerm = query.value.trim().toLowerCase();
  return products().filter(product => {
    if (!startsWithPath(productPath(product), selectedPath)) return false;
    return !searchTerm || searchableText(product).includes(searchTerm);
  });
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
    const label = productPath(product).slice(1).join(" · ");
    const imageCount = product.imageCount || product.images?.length || 0;

    return `<article class="card" data-id="${esc(productId(product))}">
      ${image
        ? `<img class="album-cover" loading="lazy" decoding="async" src="${esc(image)}" alt="${esc(product.title)}">`
        : `<div class="album-cover no-image">Geen foto</div>`}
      <div class="card-copy">
        <span>${esc(label)}</span>
        <strong>${esc(product.title)}</strong>
        <small>${esc(imageCount)} foto's</small>
      </div>
    </article>`;
  }).join("");

  const moreButton = visible.length < filtered.length
    ? `<div class="load-more-wrap" style="grid-column:1/-1;text-align:center;padding:24px">
        <button id="loadMore" type="button">Meer producten laden (${formatNumber(visible.length)} van ${formatNumber(filtered.length)})</button>
      </div>`
    : "";

  grid.innerHTML = cards + moreButton;
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
  const product = products().find(item => productId(item) === id);
  if (!product) return;

  grid.hidden = true;
  detail.hidden = false;

  const images = Array.isArray(product.images) ? product.images : [];
  const breadcrumb = productPath(product).join(" › ");

  detail.innerHTML = `<button class="back" type="button">← Terug naar overzicht</button>
    <p class="eyebrow">${esc(breadcrumb)}</p>
    <h1>${esc(product.title)}</h1>
    ${product.types?.length ? `<p>${esc(product.types.join(" · "))}</p>` : ""}
    <div class="detail-photos">
      ${images.length
        ? images.map((src, index) => `<img loading="lazy" decoding="async" src="${esc(src)}" alt="${esc(product.title)} foto ${index + 1}">`).join("")
        : `<p class="empty-state">Voor dit product zijn nog geen foto's opgeslagen.</p>`}
    </div>`;

  detail.querySelector(".back").onclick = () => {
    renderProducts();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showLoadError(error) {
  console.error("Catalogusfout:", error);
  grid.innerHTML = `<p class="error">Catalogus kon niet worden geladen: ${esc(error.message)}</p>`;
  heading.textContent = "Catalogus";
  meta.textContent = "Laden mislukt";
}

async function loadCatalog() {
  try {
    const response = await fetch(`./data/catalog.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    catalog = await response.json();
    console.log(`[Catalogus] ${products().length} producten uit alle bronnen geladen`);
    renderNavigation();
    renderProducts();
  } catch (error) {
    showLoadError(error);
  }
}

query.oninput = () => {
  visibleLimit = PAGE_SIZE;
  renderProducts();
};

loadCatalog();
