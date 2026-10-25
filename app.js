let catalog = { products: [] };

let section = "";
let category = "";
let subcategory = "";
let country = "";
let club = "";
let season = "";
let visibleLimit = 120;

const PAGE_SIZE = 120;
const UNKNOWN_SEASON = "Seizoen onbekend";
const OTHER_COUNTRY = "Overig";
const OTHER_CLUB = "Overig";

const grid = document.querySelector("#grid");
const detail = document.querySelector("#detail");
const query = document.querySelector("#q");
const categories = document.querySelector("#cats");
const heading = document.querySelector("#heading");
const meta = document.querySelector("#meta");

const esc = value => String(value ?? "").replace(
  /[&<>"']/g,
  char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]
);

function products() {
  if (Array.isArray(catalog.products)) return catalog.products;
  if (Array.isArray(catalog.albums)) return catalog.albums;
  return [];
}

function cleanLabel(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizedLabel(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isSupplierLabel(value = "") {
  const text = normalizedLabel(value);

  if (!text) return false;

  const suppliers = [
    "minkang",
    "yema007",
    "popmo",
    "dohansports",
    "dohan sports",
    "dongshansports",
    "dongshan sports",
    "supplier product",
    "supplier products"
  ];

  return suppliers.some(name => text === normalizedLabel(name));
}

function productSection(product) {
  return cleanLabel(
    product.section,
    product.competition ? "Voetbal" : "Overige producten"
  );
}

function productCategory(product) {
  return cleanLabel(
    product.category,
    product.club ? "Clubteams" : "Overige producten"
  );
}

function productSubcategory(product) {
  const candidates = [
    product.subcategory,
    product.competition,
    product.sourceCategory,
    product.sourceCollection
  ];

  const visible = candidates.find(value => value && !isSupplierLabel(value));
  return cleanLabel(visible, "Overig");
}

function productCountry(product) {
  const value = cleanLabel(product.country, OTHER_COUNTRY);
  return isSupplierLabel(value) ? OTHER_COUNTRY : value;
}

function productClub(product) {
  const value = cleanLabel(product.club, OTHER_CLUB);
  return isSupplierLabel(value) ? OTHER_CLUB : value;
}

function isTrainingProduct(product) {
  const text = normalizedLabel([
    productSection(product),
    productCategory(product),
    productSubcategory(product),
    product.title,
    ...(Array.isArray(product.types) ? product.types : [])
  ].filter(Boolean).join(" "));

  return /\btraining\b|\btrainingskleding\b|\bpre match\b|\bprematch\b|\btracksuit\b|\btrack suit\b|\btraining suit\b|\bwindbreaker\b/.test(text);
}

function fullSeasonYear(shortYear) {
  const year = Number(shortYear);
  if (!Number.isFinite(year)) return null;
  return year >= 50 ? 1900 + year : 2000 + year;
}

function normalizeSeason(firstYear, secondYear) {
  const first = String(firstYear).length === 2
    ? fullSeasonYear(firstYear)
    : Number(firstYear);

  if (!Number.isFinite(first)) return "";

  let second;

  if (String(secondYear).length === 4) {
    second = Number(secondYear);
  } else {
    second = Math.floor(first / 100) * 100 + Number(secondYear);
    if (second < first) second += 100;
  }

  if (!Number.isFinite(second)) return "";
  return `${first}-${second}`;
}

function productSeason(product) {
  const values = [product.season, product.title].filter(Boolean);

  for (const value of values) {
    const text = String(value);

    const full = text.match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)\d{2})\b/);
    if (full) return normalizeSeason(full[1], full[2]);

    const mixed = text.match(/\b((?:19|20)\d{2})\s*[\/_-]\s*(\d{2})\b/);
    if (mixed) return normalizeSeason(mixed[1], mixed[2]);

    const short = text.match(/\b(\d{2})\s*[\/_-]\s*(\d{2})\b/);
    if (short) return normalizeSeason(short[1], short[2]);
  }

  return UNKNOWN_SEASON;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("nl-NL");
}

function matches(product, filters = {}) {
  if (filters.section && productSection(product) !== filters.section) return false;
  if (filters.category && productCategory(product) !== filters.category) return false;
  if (filters.subcategory && productSubcategory(product) !== filters.subcategory) return false;
  if (filters.country && productCountry(product) !== filters.country) return false;
  if (filters.club && productClub(product) !== filters.club) return false;
  if (filters.season && productSeason(product) !== filters.season) return false;
  if (filters.training === true && !isTrainingProduct(product)) return false;
  if (filters.training === false && isTrainingProduct(product)) return false;
  return true;
}

function countProducts(filters = {}) {
  let count = 0;
  for (const product of products()) {
    if (matches(product, filters)) count++;
  }
  return count;
}

function addNested(map, keys) {
  let current = map;

  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      if (!current.has(key)) current.set(key, new Set());
      return;
    }

    if (!current.has(key)) current.set(key, new Map());
    current = current.get(key);
  });
}

function buildStandardGroups() {
  const groups = new Map();

  for (const product of products()) {
    if (isTrainingProduct(product)) continue;

    const keys = [
      productSection(product),
      productCategory(product),
      productSubcategory(product),
      productClub(product)
    ];

    addNested(groups, keys);
    groups
      .get(keys[0])
      .get(keys[1])
      .get(keys[2])
      .get(keys[3])
      .add(productSeason(product));
  }

  return groups;
}

function buildTrainingGroups() {
  const groups = new Map();

  for (const product of products()) {
    if (!isTrainingProduct(product)) continue;

    const countryName = productCountry(product);
    const clubName = productClub(product);

    if (!groups.has(countryName)) groups.set(countryName, new Map());
    const countryGroup = groups.get(countryName);
    if (!countryGroup.has(clubName)) countryGroup.set(clubName, new Set());
    countryGroup.get(clubName).add(productSeason(product));
  }

  return groups;
}

function sortLabels(entries) {
  return [...entries].sort(([a], [b]) => a.localeCompare(b, "nl"));
}

function sortSeasons(values) {
  return [...values].sort((a, b) => {
    if (a === UNKNOWN_SEASON) return 1;
    if (b === UNKNOWN_SEASON) return -1;
    return Number(b.split("-")[0]) - Number(a.split("-")[0]);
  });
}

function navButton(label, data = {}, active = false, count = null) {
  const attributes = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `data-${key}="${esc(value)}"`)
    .join(" ");

  const countText = count === null ? "" : `<span>${formatNumber(count)}</span>`;

  return `
    <button class="nav-pill${active ? " active" : ""}" ${attributes}>
      <span>${esc(label)}</span>
      ${countText}
    </button>
  `;
}

function renderTrainingNavigation() {
  const groups = buildTrainingGroups();
  const trainingCount = countProducts({ training: true });

  if (!trainingCount) return "";

  let html = `
    <details class="nav-group" ${category === "Trainingskleding" ? "open" : ""}>
      <summary>Trainingskleding <span>${formatNumber(trainingCount)}</span></summary>
      <div class="nav-level">
        ${navButton(
          "Alle trainingskleding",
          { category: "Trainingskleding", training: "true" },
          category === "Trainingskleding" && !country,
          trainingCount
        )}
  `;

  for (const [countryName, clubGroups] of sortLabels(groups.entries())) {
    const countryCount = countProducts({ training: true, country: countryName });

    html += `
      <details ${category === "Trainingskleding" && country === countryName ? "open" : ""}>
        <summary>${esc(countryName)} <span>${formatNumber(countryCount)}</span></summary>
        <div class="nav-level">
          ${navButton(
            `Alles uit ${countryName}`,
            { category: "Trainingskleding", training: "true", country: countryName },
            category === "Trainingskleding" && country === countryName && !club,
            countryCount
          )}
    `;

    for (const [clubName, seasons] of sortLabels(clubGroups.entries())) {
      const clubCount = countProducts({
        training: true,
        country: countryName,
        club: clubName
      });

      html += `
        <details ${category === "Trainingskleding" && country === countryName && club === clubName ? "open" : ""}>
          <summary>${esc(clubName)} <span>${formatNumber(clubCount)}</span></summary>
          <div class="nav-level">
            ${navButton(
              `Alles van ${clubName}`,
              {
                category: "Trainingskleding",
                training: "true",
                country: countryName,
                club: clubName
              },
              category === "Trainingskleding" && country === countryName && club === clubName && !season,
              clubCount
            )}
      `;

      for (const seasonName of sortSeasons(seasons)) {
        const seasonCount = countProducts({
          training: true,
          country: countryName,
          club: clubName,
          season: seasonName
        });

        html += navButton(
          seasonName,
          {
            category: "Trainingskleding",
            training: "true",
            country: countryName,
            club: clubName,
            season: seasonName
          },
          category === "Trainingskleding" &&
            country === countryName &&
            club === clubName &&
            season === seasonName,
          seasonCount
        );
      }

      html += "</div></details>";
    }

    html += "</div></details>";
  }

  html += "</div></details>";
  return html;
}

function renderStandardNavigation() {
  const groups = buildStandardGroups();
  let html = "";

  for (const [sectionName, categoryGroups] of sortLabels(groups.entries())) {
    const sectionCount = countProducts({ section: sectionName, training: false });

    html += `
      <details class="nav-group" ${section === sectionName ? "open" : ""}>
        <summary>${esc(sectionName)} <span>${formatNumber(sectionCount)}</span></summary>
        <div class="nav-level">
          ${navButton(
            `Alles binnen ${sectionName}`,
            { section: sectionName, training: "false" },
            section === sectionName && !category,
            sectionCount
          )}
    `;

    for (const [categoryName, subcategoryGroups] of sortLabels(categoryGroups.entries())) {
      const categoryCount = countProducts({
        section: sectionName,
        category: categoryName,
        training: false
      });

      html += `
        <details ${section === sectionName && category === categoryName ? "open" : ""}>
          <summary>${esc(categoryName)} <span>${formatNumber(categoryCount)}</span></summary>
          <div class="nav-level">
            ${navButton(
              `Alles binnen ${categoryName}`,
              { section: sectionName, category: categoryName, training: "false" },
              section === sectionName && category === categoryName && !subcategory,
              categoryCount
            )}
      `;

      for (const [subcategoryName, clubGroups] of sortLabels(subcategoryGroups.entries())) {
        const subcategoryCount = countProducts({
          section: sectionName,
          category: categoryName,
          subcategory: subcategoryName,
          training: false
        });

        html += `
          <details ${section === sectionName && category === categoryName && subcategory === subcategoryName ? "open" : ""}>
            <summary>${esc(subcategoryName)} <span>${formatNumber(subcategoryCount)}</span></summary>
            <div class="nav-level">
              ${navButton(
                `Alles binnen ${subcategoryName}`,
                {
                  section: sectionName,
                  category: categoryName,
                  subcategory: subcategoryName,
                  training: "false"
                },
                section === sectionName && category === categoryName && subcategory === subcategoryName && !club,
                subcategoryCount
              )}
        `;

        for (const [clubName, seasons] of sortLabels(clubGroups.entries())) {
          const clubCount = countProducts({
            section: sectionName,
            category: categoryName,
            subcategory: subcategoryName,
            club: clubName,
            training: false
          });

          html += `
            <details ${section === sectionName && category === categoryName && subcategory === subcategoryName && club === clubName ? "open" : ""}>
              <summary>${esc(clubName)} <span>${formatNumber(clubCount)}</span></summary>
              <div class="nav-level">
                ${navButton(
                  `Alles van ${clubName}`,
                  {
                    section: sectionName,
                    category: categoryName,
                    subcategory: subcategoryName,
                    club: clubName,
                    training: "false"
                  },
                  section === sectionName &&
                    category === categoryName &&
                    subcategory === subcategoryName &&
                    club === clubName &&
                    !season,
                  clubCount
                )}
          `;

          for (const seasonName of sortSeasons(seasons)) {
            const seasonCount = countProducts({
              section: sectionName,
              category: categoryName,
              subcategory: subcategoryName,
              club: clubName,
              season: seasonName,
              training: false
            });

            html += navButton(
              seasonName,
              {
                section: sectionName,
                category: categoryName,
                subcategory: subcategoryName,
                club: clubName,
                season: seasonName,
                training: "false"
              },
              section === sectionName &&
                category === categoryName &&
                subcategory === subcategoryName &&
                club === clubName &&
                season === seasonName,
              seasonCount
            );
          }

          html += "</div></details>";
        }

        html += "</div></details>";
      }

      html += "</div></details>";
    }

    html += "</div></details>";
  }

  return html;
}

function renderNavigation() {
  categories.innerHTML = [
    navButton(
      "Alles",
      {},
      !section && !category && !subcategory && !country && !club && !season,
      products().length
    ),
    renderTrainingNavigation(),
    renderStandardNavigation()
  ].join("");

  categories.querySelectorAll("button").forEach(button => {
    button.onclick = () => {
      section = button.dataset.section || "";
      category = button.dataset.category || "";
      subcategory = button.dataset.subcategory || "";
      country = button.dataset.country || "";
      club = button.dataset.club || "";
      season = button.dataset.season || "";
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
    productSection(product),
    productCategory(product),
    productSubcategory(product),
    productCountry(product),
    productClub(product),
    productSeason(product),
    ...(Array.isArray(product.types) ? product.types : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function selectedTrainingFilter() {
  if (category === "Trainingskleding") return true;
  return undefined;
}

function filteredProducts() {
  const term = query.value.trim().toLowerCase();

  return products().filter(product => {
    if (!matches(product, {
      section,
      category: category === "Trainingskleding" ? "" : category,
      subcategory,
      country,
      club,
      season,
      training: selectedTrainingFilter()
    })) return false;

    return !term || searchableText(product).includes(term);
  });
}

function currentHeading() {
  if (category === "Trainingskleding") {
    return ["Trainingskleding", country, club, season].filter(Boolean).join(" · ");
  }

  return [club, season].filter(Boolean).join(" · ") ||
    subcategory || category || section || "Alle producten";
}

function renderProducts() {
  detail.hidden = true;
  grid.hidden = false;

  const filtered = filteredProducts();
  heading.textContent = currentHeading();
  meta.textContent = `${formatNumber(filtered.length)} ${filtered.length === 1 ? "product" : "producten"}`;

  if (!filtered.length) {
    grid.innerHTML = '<p class="empty-state">Geen producten gevonden binnen deze selectie.</p>';
    return;
  }

  const visible = filtered.slice(0, visibleLimit);

  const cards = visible.map(product => {
    const id = product.uniqueKey || `${product.source || "minkang"}:${product.sourceId}`;
    const image = product.coverUrl || product.images?.[0] || "";
    const imageCount = product.imageCount || product.images?.length || 0;

    const label = isTrainingProduct(product)
      ? ["Trainingskleding", productCountry(product), productClub(product), productSeason(product)]
      : [productSubcategory(product), productClub(product), productSeason(product)];

    return `
      <article class="card" data-id="${esc(id)}">
        ${image
          ? `<img class="album-cover" loading="lazy" decoding="async" src="${esc(image)}" alt="${esc(product.title)}">`
          : '<div class="album-cover no-image">Geen foto</div>'}
        <div class="card-copy">
          <span>${esc(label.filter(value => value && value !== UNKNOWN_SEASON && value !== OTHER_CLUB).join(" · "))}</span>
          <strong>${esc(product.title)}</strong>
          <small>${esc(imageCount)} foto's${product.source ? ` · ${esc(product.source)}` : ""}</small>
        </div>
      </article>
    `;
  }).join("");

  const moreButton = visible.length < filtered.length
    ? `
      <div class="load-more-wrap" style="grid-column:1/-1;text-align:center;padding:24px">
        <button id="loadMore" type="button" style="padding:12px 24px;cursor:pointer;border-radius:8px">
          Meer producten laden (${formatNumber(visible.length)} van ${formatNumber(filtered.length)})
        </button>
      </div>
    `
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
  const product = products().find(item => {
    const itemId = item.uniqueKey || `${item.source || "minkang"}:${item.sourceId}`;
    return itemId === id;
  });

  if (!product) return;

  grid.hidden = true;
  detail.hidden = false;

  const images = Array.isArray(product.images) ? product.images : [];
  const breadcrumb = isTrainingProduct(product)
    ? ["Trainingskleding", productCountry(product), productClub(product), productSeason(product)]
    : [
        productSection(product),
        productCategory(product),
        productSubcategory(product),
        productClub(product),
        productSeason(product)
      ];

  detail.innerHTML = `
    <button class="back" type="button">← Terug naar overzicht</button>
    <p class="eyebrow">${esc(breadcrumb.filter(value => value && value !== UNKNOWN_SEASON && value !== OTHER_CLUB).join(" › "))}</p>
    <h1>${esc(product.title)}</h1>
    ${product.types?.length ? `<p>${esc(product.types.join(" · "))}</p>` : ""}
    <div class="detail-photos">
      ${images.length
        ? images.map((src, index) => `<img loading="lazy" decoding="async" src="${esc(src)}" alt="${esc(product.title)} foto ${index + 1}">`).join("")
        : '<p class="empty-state">Voor dit product zijn nog geen foto\'s opgeslagen.</p>'}
    </div>
  `;

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
    const response = await fetch(`./data/catalog.json?v=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    catalog = await response.json();
    console.log(`[Catalogus] ${products().length} producten geladen`);

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
