import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG_PATH = "data/catalog.json";
const STATE_PATH = "data/sync-state.json";
const DISCOVERY_DIR = "data/discovery";
const ASSET_ROOT = "assets/products";
const CLASSIFICATION_VERSION = 4;
const SHOE_PHOTO_VERSION = 2;

const SOURCES = [
  { key: "minkang", base: "https://minkang.x.yupoo.com", priority: 1, seeds: ["718623"] },
  { key: "yema007", base: "https://yema007.x.yupoo.com", priority: 2, seeds: [] },
  { key: "popmo", base: "https://popmo.x.yupoo.com", priority: 3, seeds: [] },
  { key: "dachang88", base: "https://dachang88.x.yupoo.com", priority: 4, mode: "shoes", seeds: [] },
  { key: "dongshanstore", base: "https://dongshanstore.x.yupoo.com", priority: 5, mode: "training", seeds: [] },
  { key: "aosendi", base: "https://aosendi.x.yupoo.com", priority: 6, mode: "training", seeds: [] }
];

const MAX_INDEX_PAGES = setting("SYNC_MAX_PAGES", 100);
const MAX_CATEGORY_PAGES = setting("SYNC_CATEGORY_MAX_PAGES", 100);
const MAX_CATEGORIES = setting("SYNC_MAX_CATEGORIES_PER_SOURCE", 500);
const MAX_DISCOVERY_MINUTES = setting("SYNC_MAX_DISCOVERY_MINUTES", 45);
const MAX_IMAGES = setting("MAX_IMAGES_PER_ALBUM", 6);
const BATCH_SIZE = setting("SYNC_BATCH_SIZE", 25);
const REQUEST_TIMEOUT = setting("SYNC_REQUEST_TIMEOUT_MS", 45000);
const REQUEST_RETRIES = setting("SYNC_REQUEST_RETRIES", 2);
const REQUEST_DELAY = Math.max(0, Number(process.env.SYNC_DELAY_MS || 250));
const SOURCE_FILTER = String(process.env.SYNC_SOURCE || "").trim().toLowerCase();
const limit = pLimit(setting("SYNC_CONCURRENCY", 2));

const LEAGUES = [
  ["Engeland", "Premier League", ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham", "Leeds United", "Liverpool", "Manchester City", "Manchester United", "Newcastle United", "Nottingham Forest", "Sunderland", "Tottenham", "West Ham", "Wolverhampton"]],
  ["Spanje", "La Liga", ["Alaves", "Deportivo Alaves", "Athletic Bilbao", "Atletico Madrid", "Barcelona", "Real Betis", "Real Madrid", "Real Sociedad", "Sevilla", "Valencia", "Villarreal"]],
  ["Italie", "Serie A", ["AC Milan", "Atalanta", "Bologna", "Fiorentina", "Inter Milan", "Juventus", "Lazio", "Napoli", "Roma"]],
  ["Duitsland", "Bundesliga", ["Bayern Munich", "Bayer Leverkusen", "Borussia Dortmund", "Eintracht Frankfurt", "RB Leipzig", "Schalke 04", "Werder Bremen"]],
  ["Frankrijk", "Ligue 1", ["Lille", "Lyon", "Marseille", "Monaco", "Nice", "Paris Saint-Germain", "PSG"]],
  ["Nederland", "Eredivisie", ["Ajax", "AZ", "Feyenoord", "FC Twente", "PSV", "Sparta Rotterdam", "FC Utrecht", "Vitesse"]],
  ["Portugal", "Primeira Liga", ["Benfica", "Porto", "Sporting CP"]],
  ["Schotland", "Scottish Premiership", ["Celtic", "Rangers"]],
  ["Turkije", "Super Lig", ["Besiktas", "Fenerbahce", "Galatasaray"]],
  ["Verenigde Staten", "MLS", ["Atlanta United", "Inter Miami", "LA Galaxy", "Los Angeles FC", "New York City FC"]],
  ["Brazilie", "Brazilie", ["Athletico Paranaense", "Atletico Mineiro", "Bahia", "Botafogo", "Flamengo", "Gremio", "Palmeiras", "Santos", "Sao Paulo"]],
  ["Argentinie", "Argentinie", ["Boca Juniors", "River Plate"]]
];

const COUNTRY_TEAMS = ["Argentina", "Australia", "Austria", "Belgium", "Brazil", "Canada", "Chile", "China", "Colombia", "Croatia", "Denmark", "Ecuador", "England", "France", "Germany", "Ghana", "Italy", "Japan", "Mexico", "Morocco", "Netherlands", "Nigeria", "Norway", "Poland", "Portugal", "Saudi Arabia", "Scotland", "Senegal", "South Korea", "Spain", "Sweden", "Switzerland", "Turkey", "Tunisia", "Uruguay", "USA", "United States", "Wales", "Algeria"];
const SHOE_BRANDS = ["Nike", "Adidas", "Puma", "New Balance", "Mizuno", "Under Armour", "Joma"];
const SHOE_MODELS = [
  ["Nike", "Mercurial", ["mercurial", "vapor", "superfly"]],
  ["Nike", "Phantom", ["phantom", "gx", "luna"]],
  ["Nike", "Tiempo", ["tiempo", "legend"]],
  ["Adidas", "Predator", ["predator"]],
  ["Adidas", "F50", ["f50"]],
  ["Adidas", "Copa", ["adidas copa", "copa pure", "copa mundial", "copa gloro"]],
  ["Adidas", "X", ["speedportal", "speedflow", "crazyfast", "adidas x"]],
  ["Puma", "Future", ["puma future", "future ultimate"]],
  ["Puma", "Ultra", ["puma ultra", "ultra ultimate"]],
  ["Puma", "King", ["puma king"]],
  ["Mizuno", "Morelia", ["morelia"]],
  ["Mizuno", "Alpha", ["mizuno alpha"]],
  ["Joma", "Top Flex", ["top flex"]]
];

function setting(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function absoluteUrl(base, value) {
  if (!value) return "";
  try { return new URL(value, base).href; } catch { return ""; }
}

function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(url).split("?")[0];
  }
}

function albumId(url) {
  return canonicalUrl(url).match(/\/albums\/(\d+)/)?.[1] || "";
}

function includesAny(text, terms) {
  const value = normalize(text);
  return terms.some(term => value.includes(normalize(term)));
}

function fullYear(shortYear) {
  const year = Number(shortYear);
  return year >= 50 ? 1900 + year : 2000 + year;
}

function detectSeason(text = "") {
  const value = String(text);
  let match = value.match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)\d{2})\b/);
  if (match) return `${match[1]}-${match[2]}`;

  match = value.match(/\b((?:19|20)\d{2})\s*[\/_-]\s*(\d{2})\b/);
  if (match) {
    let second = Math.floor(Number(match[1]) / 100) * 100 + Number(match[2]);
    if (second < Number(match[1])) second += 100;
    return `${match[1]}-${second}`;
  }

  match = value.match(/(?:^|\D)(\d{2})\s*[\/_-]\s*(\d{2})(?:\D|$)/);
  if (match) {
    const first = fullYear(match[1]);
    let second = Math.floor(first / 100) * 100 + Number(match[2]);
    if (second < first) second += 100;
    return `${first}-${second}`;
  }

  return "Seizoen onbekend";
}

function findClub(text) {
  const value = normalize(text);
  const candidates = LEAGUES.flatMap(([country, competition, clubs]) => clubs.map(club => ({ country, competition, club })));
  candidates.sort((a, b) => b.club.length - a.club.length);
  return candidates.find(item => value.includes(normalize(item.club))) || null;
}

function findCountry(text) {
  const value = normalize(text);
  return COUNTRY_TEAMS.find(country => value.includes(normalize(country))) || "";
}

function isTraining(text, source) {
  if (source.mode === "training") return true;
  return includesAny(text, ["tracksuit", "track suit", "training suit", "training set", "training wear", "training top", "training kit", "pre match", "prematch", "windbreaker", "windproof", "hoodie", "track pants", "training pants", "training shorts", "trainingspak", "trainingskleding"]);
}

function isShoe(text, source) {
  if (source.mode === "shoes") return true;
  const explicit = ["football boot", "football boots", "soccer shoe", "soccer shoes", "soccer boot", "soccer boots", "cleats", "voetbalschoen", "voetbalschoenen"];
  const strongModels = ["mercurial", "superfly", "phantom gx", "phantom luna", "tiempo legend", "adidas predator", "adidas f50", "adidas copa", "copa pure", "copa mundial", "copa gloro", "speedportal", "speedflow", "crazyfast", "puma future", "puma ultra", "puma king", "mizuno morelia", "mizuno alpha", "joma top flex"];
  return includesAny(text, explicit) || includesAny(text, strongModels);
}

function classifyProduct(product, source) {
  const text = [product.title, product.categoryTitle, product.collectionTitle].filter(Boolean).join(" ");
  const normalized = normalize(text);
  const season = detectSeason(text);
  const club = findClub(text);
  const country = findCountry(text);

  if (isTraining(text, source)) {
    if (club) return { section: "Trainingskleding", category: "Clubteams", subcategory: club.competition, club: club.club, country: club.country, competition: club.competition, season, types: ["Trainingskleding"] };
    if (country) return { section: "Trainingskleding", category: "Landenteams", subcategory: country, club: country, country, competition: "Landenteams", season, types: ["Trainingskleding"] };
    return { section: "Trainingskleding", category: "Overig", subcategory: product.categoryTitle || "Overig", club: "Overig", country: "", competition: "", season, types: ["Trainingskleding"] };
  }

  if (isShoe(text, source)) {
    const brand = SHOE_BRANDS.find(item => normalized.includes(normalize(item))) || "Overige merken";
    const model = SHOE_MODELS.find(([entryBrand, , words]) => entryBrand === brand && words.some(word => normalized.includes(normalize(word))))?.[1] || "Overig model";
    return { section: "Voetbalschoenen", category: brand, subcategory: model, club: "", country: "", competition: "", season: "Seizoen onbekend", types: ["Voetbalschoenen"] };
  }

  if (club) return { section: "Voetbal", category: "Clubteams", subcategory: club.competition, club: club.club, country: club.country, competition: club.competition, season, types: ["Voetbalshirt"] };
  if (country) return { section: "Voetbal", category: "Landenteams", subcategory: country, club: country, country, competition: "Landenteams", season, types: ["Voetbalshirt"] };

  if (includesAny(text, ["jersey", "shirt", "kit", "soccer", "football", "retro", "home", "away", "third"])) {
    const fallbackClub = String(product.categoryTitle || "Overige clubs").trim() || "Overige clubs";
    return { section: "Voetbal", category: "Overig", subcategory: fallbackClub, club: fallbackClub, country: "", competition: "Overig", season, types: ["Voetbalshirt"] };
  }

  return { section: "Overige producten", category: "Overige producten", subcategory: product.categoryTitle || "Overig", club: "", country: "", competition: "", season: "Seizoen onbekend", types: ["Overig"] };
}

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} voor ${url}`);
    this.status = status;
    this.url = url;
  }
}

async function request(url, binary = false) {
  let lastError;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
    await sleep(REQUEST_DELAY);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const parsed = new URL(url);
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 FootballshirtsNL/1.0",
          accept: binary ? "image/avif,image/webp,image/*,*/*" : "text/html,application/xhtml+xml",
          referer: `${parsed.origin}/`
        },
        signal: controller.signal
      });
      if (!response.ok) throw new HttpError(response.status, url);
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (error) {
      lastError = error;
      if (error?.status === 404 || attempt === REQUEST_RETRIES) throw error;
      await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(temp, file);
}

function mergeAlbums(existing, incoming) {
  const map = new Map(existing.map(item => [canonicalUrl(item.url), item]));
  for (const item of incoming) {
    const key = canonicalUrl(item.url);
    const previous = map.get(key) || {};
    map.set(key, {
      ...previous,
      ...item,
      url: item.url || previous.url,
      categoryTitle: item.categoryTitle || previous.categoryTitle || "",
      thumbnailUrls: unique([...(previous.thumbnailUrls || []), ...(item.thumbnailUrls || [])])
    });
  }
  return [...map.values()].sort((a, b) => canonicalUrl(a.url).localeCompare(canonicalUrl(b.url), "en", { numeric: true }));
}

function extractPage(html, source, categoryTitle = "") {
  const $ = cheerio.load(html);
  const categories = new Map();
  const albums = new Map();

  $("a[href*='/categories/'], a[href*='/collections/']").each((_, element) => {
    const raw = $(element).attr("href");
    const url = absoluteUrl(source.base, raw);
    if (!url) return;
    const key = canonicalUrl(url);
    categories.set(key, { url: key, title: $(element).attr("title") || $(element).text().trim() || categoryTitle });
  });

  $("a[href*='/albums/']").each((_, element) => {
    const url = absoluteUrl(source.base, $(element).attr("href"));
    const id = albumId(url);
    if (!id) return;

    const anchor = $(element);
    const card = anchor.closest("li, .album__main, .showindex__children, .album__item, .showindex__parent");
    const title = anchor.attr("title") || card.find(".album__title, .showindex__children__title").first().text().trim() || anchor.find("img").first().attr("alt") || anchor.text().trim() || `Product ${id}`;
    const thumbnailUrls = [];
    const images = card.length ? card.find("img") : anchor.find("img");

    images.each((__, image) => {
      [$(image).attr("data-origin-src"), $(image).attr("data-src"), $(image).attr("data-lazy"), $(image).attr("src")].forEach(value => {
        const imageUrl = absoluteUrl(source.base, value);
        if (imageUrl && !/data:image/i.test(imageUrl)) thumbnailUrls.push(imageUrl);
      });
    });

    albums.set(canonicalUrl(url), { url, title, categoryTitle, thumbnailUrls: unique(thumbnailUrls) });
  });

  return { categories: [...categories.values()], albums: [...albums.values()] };
}

function discoveryPath(source) {
  return path.join(DISCOVERY_DIR, `${source.key}.json`);
}

function initialDiscovery(source) {
  return {
    version: 4,
    source: source.key,
    phase: "index",
    indexPage: 1,
    categories: (source.seeds || []).map(id => ({ url: `${source.base}/categories/${id}`, title: "" })),
    categoryIndex: 0,
    categoryPage: 1,
    albums: [],
    complete: false
  };
}

async function saveDiscovery(source, discovery, state) {
  discovery.updatedAt = new Date().toISOString();
  await writeJson(discoveryPath(source), discovery);
  state.sources[source.key] = {
    ...(state.sources[source.key] || {}),
    discoveryComplete: discovery.complete,
    discoveryPhase: discovery.phase,
    discoveredAlbums: discovery.albums.length,
    categoryIndex: discovery.categoryIndex,
    categoryTotal: discovery.categories.length,
    updatedAt: discovery.updatedAt
  };
  await writeJson(STATE_PATH, state);
}

async function discover(source, state) {
  let discovery = await readJson(discoveryPath(source), initialDiscovery(source));
  if (discovery.complete) {
    console.log(`[${source.key}] ontdekking uit cache: ${discovery.albums.length} albums`);
    return discovery.albums;
  }

  const deadline = Date.now() + MAX_DISCOVERY_MINUTES * 60000;
  console.log(`[${source.key}] ontdekking hervat: ${discovery.phase}, albums=${discovery.albums.length}`);

  if (discovery.phase === "index") {
    while (discovery.indexPage <= MAX_INDEX_PAGES) {
      if (Date.now() >= deadline) {
        await saveDiscovery(source, discovery, state);
        return null;
      }

      const url = discovery.indexPage === 1
        ? `${source.base}/albums?tab=gallery`
        : `${source.base}/albums?page=${discovery.indexPage}&tab=gallery`;

      console.log(`[${source.key}] ontdekking indexpagina ${discovery.indexPage}/${MAX_INDEX_PAGES}`);
      try {
        const page = extractPage(await request(url), source);
        discovery.albums = mergeAlbums(discovery.albums, page.albums);
        const categoryMap = new Map(discovery.categories.map(item => [canonicalUrl(item.url), item]));
        page.categories.forEach(item => categoryMap.set(canonicalUrl(item.url), item));
        discovery.categories = [...categoryMap.values()].slice(0, MAX_CATEGORIES);
        discovery.indexPage += 1;
        await saveDiscovery(source, discovery, state);
        if (!page.albums.length && discovery.indexPage > 2) break;
      } catch (error) {
        console.warn(`[${source.key}] index overgeslagen: ${error.message}`);
        discovery.indexPage += 1;
        await saveDiscovery(source, discovery, state);
        break;
      }
    }
    discovery.phase = "categories";
    await saveDiscovery(source, discovery, state);
  }

  while (discovery.categoryIndex < discovery.categories.length) {
    if (Date.now() >= deadline) {
      await saveDiscovery(source, discovery, state);
      return null;
    }

    const category = discovery.categories[discovery.categoryIndex];
    if (discovery.categoryPage > MAX_CATEGORY_PAGES) {
      discovery.categoryIndex += 1;
      discovery.categoryPage = 1;
      continue;
    }

    const separator = category.url.includes("?") ? "&" : "?";
    const url = discovery.categoryPage === 1
      ? `${category.url}${separator}tab=gallery`
      : `${category.url}${separator}page=${discovery.categoryPage}&tab=gallery`;

    console.log(`[${source.key}] ontdekking categorie ${discovery.categoryIndex + 1}/${discovery.categories.length}, pagina ${discovery.categoryPage}`);
    try {
      const page = extractPage(await request(url), source, category.title);
      discovery.albums = mergeAlbums(discovery.albums, page.albums);
      discovery.categoryPage += 1;
      await saveDiscovery(source, discovery, state);
      if (!page.albums.length) {
        discovery.categoryIndex += 1;
        discovery.categoryPage = 1;
        await saveDiscovery(source, discovery, state);
      }
    } catch (error) {
      console.warn(`[${source.key}] categorie overgeslagen: ${error.message}`);
      discovery.categoryIndex += 1;
      discovery.categoryPage = 1;
      await saveDiscovery(source, discovery, state);
    }
  }

  discovery.phase = "complete";
  discovery.complete = true;
  await saveDiscovery(source, discovery, state);
  console.log(`[${source.key}] ontdekking voltooid: ${discovery.albums.length} albums`);
  return discovery.albums;
}

function extractAlbum(html, album, source) {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().trim() || $("meta[property='og:title']").attr("content") || album.title;
  const images = [];

  $("img").each((_, element) => {
    [$(element).attr("data-origin-src"), $(element).attr("data-src"), $(element).attr("data-lazy"), $(element).attr("src")].forEach(value => {
      const imageUrl = absoluteUrl(source.base, value);
      if (/photo\.yupoo\.com|\.jpe?g(?:\?|$)|\.png(?:\?|$)|\.webp(?:\?|$)/i.test(imageUrl)) images.push(imageUrl);
    });
  });

  $("meta[property='og:image']").each((_, element) => images.push(absoluteUrl(source.base, $(element).attr("content"))));
  return { title: String(title).replace(/\s+/g, " ").trim(), images: unique(images).slice(0, MAX_IMAGES) };
}

async function saveImage(url, file) {
  if (await exists(file)) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await sharp(await request(url, true)).rotate().webp({ quality: 78 }).toFile(temp);
  await fs.rename(temp, file);
}

function productKey(source, url) {
  return `${source.key}:${albumId(url)}`;
}

async function processAlbum(source, album, previous) {
  let details = { title: album.title, images: album.thumbnailUrls || [] };
  try {
    details = extractAlbum(await request(album.url), album, source);
  } catch (error) {
    console.warn(`[${source.key}] albumpagina niet bereikbaar; ontdekkingsgegevens gebruikt: ${canonicalUrl(album.url)}`);
  }

  const id = albumId(album.url);
  const folder = path.join(ASSET_ROOT, source.key, id);
  const images = [];
  const candidates = unique([...(details.images || []), ...(album.thumbnailUrls || [])]).slice(0, MAX_IMAGES);

  for (let index = 0; index < candidates.length; index++) {
    const file = path.join(folder, `${String(index + 1).padStart(2, "0")}.webp`);
    try {
      await saveImage(candidates[index], file);
    } catch (error) {
      console.warn(`[${source.key}] foto ${id}/${index + 1} overgeslagen: ${error.message}`);
    }
    if (await exists(file)) images.push(file.replaceAll(path.sep, "/"));
  }

  if (!images.length && previous?.images?.length) images.push(...previous.images);

  return {
    uniqueKey: productKey(source, album.url),
    source: source.key,
    sourceId: id,
    sourceUrl: album.url,
    sourceCategory: album.categoryTitle || "",
    title: details.title,
    ...classifyProduct({ ...album, title: details.title }, source),
    images: unique(images),
    coverUrl: images[0] || previous?.coverUrl || "",
    imageCount: unique(images).length,
    updatedAt: new Date().toISOString()
  };
}

function sortProducts(a, b) {
  return [a.section, a.category, a.subcategory, a.club, a.season, a.title].join("|")
    .localeCompare([b.section, b.category, b.subcategory, b.club, b.season, b.title].join("|"), "nl");
}

async function saveCatalog(productMap, warnings, status, currentSource = "") {
  await writeJson(CATALOG_PATH, {
    lastSync: new Date().toISOString(),
    status,
    currentSource: currentSource || undefined,
    total: productMap.size,
    products: [...productMap.values()].sort(sortProducts),
    warnings: warnings.slice(-200)
  });
}

function reclassifyCatalog(productMap) {
  let changed = 0;
  for (const [key, product] of productMap.entries()) {
    const source = SOURCES.find(item => item.key === product.source) || { key: product.source || "existing" };
    const classification = classifyProduct({ title: product.title, categoryTitle: product.sourceCategory || "", collectionTitle: product.sourceCollection || "" }, source);
    const updated = { ...product, ...classification };
    if (product.section !== updated.section || product.category !== updated.category || product.subcategory !== updated.subcategory || product.season !== updated.season) changed += 1;
    productMap.set(key, updated);
  }
  return changed;
}

async function main() {
  const catalog = await readJson(CATALOG_PATH, { products: [], warnings: [] });
  const products = Array.isArray(catalog.products) ? catalog.products : Array.isArray(catalog.albums) ? catalog.albums : [];
  const productMap = new Map(products.map(product => [product.uniqueKey || `${product.source}:${product.sourceId}`, product]));
  const state = await readJson(STATE_PATH, { version: 4, sources: {} });
  state.version = 4;
  state.sources ||= {};
  const warnings = [];

  if (Number(state.classificationVersion || 0) < CLASSIFICATION_VERSION) {
    console.log(`[classificatie] ${reclassifyCatalog(productMap)} bestaande producten gecorrigeerd`);
    state.classificationVersion = CLASSIFICATION_VERSION;
    await saveCatalog(productMap, warnings, "running", "classificatie");
    await writeJson(STATE_PATH, state);
  }

  if (Number(state.shoePhotoVersion || 0) < SHOE_PHOTO_VERSION) {
    const shoeSource = SOURCES.find(source => source.key === "dachang88");
    state.sources.dachang88 = { ...(state.sources.dachang88 || {}), completed: false, discoveryComplete: false, nextIndex: 0 };
    await fs.rm(discoveryPath(shoeSource), { force: true });
    state.shoePhotoVersion = SHOE_PHOTO_VERSION;
    await writeJson(STATE_PATH, state);
    console.log("[dachang88] fotoreparatie geactiveerd; alleen de schoenenbron wordt opnieuw verwerkt");
  }

  const sources = SOURCES.filter(source => !SOURCE_FILTER || source.key === SOURCE_FILTER).sort((a, b) => a.priority - b.priority);
  if (!sources.length) throw new Error(`Onbekende SYNC_SOURCE: ${SOURCE_FILTER}`);

  for (const source of sources) {
    if (state.sources[source.key]?.completed) {
      console.log(`[${source.key}] reeds voltooid; overgeslagen`);
      continue;
    }

    console.log(`[${source.key}] bron gestart`);
    const albums = await discover(source, state);
    if (!albums) {
      await saveCatalog(productMap, warnings, "paused", source.key);
      console.log(`[${source.key}] ontdekking gepauzeerd; volgende run hervat`);
      return;
    }

    const startIndex = Math.min(Number(state.sources[source.key]?.nextIndex || 0), albums.length);
    console.log(`[${source.key}] ${albums.length} albums; verwerking hervat bij ${startIndex}/${albums.length}`);

    for (let offset = startIndex; offset < albums.length; offset += BATCH_SIZE) {
      const batch = albums.slice(offset, offset + BATCH_SIZE);
      const results = await Promise.all(batch.map(album => limit(async () => {
        try {
          return await processAlbum(source, album, productMap.get(productKey(source, album.url)));
        } catch (error) {
          warnings.push(`[${source.key}] ${canonicalUrl(album.url)}: ${error.message}`);
          return null;
        }
      })));

      results.filter(Boolean).forEach(product => productMap.set(product.uniqueKey, product));
      state.sources[source.key] = {
        ...(state.sources[source.key] || {}),
        nextIndex: offset + batch.length,
        total: albums.length,
        completed: offset + batch.length >= albums.length,
        updatedAt: new Date().toISOString()
      };
      await saveCatalog(productMap, warnings, "running", source.key);
      await writeJson(STATE_PATH, state);
      console.log(`[${source.key}] ${offset + batch.length}/${albums.length}; hervatpunt opgeslagen`);
    }

    state.sources[source.key] = {
      ...(state.sources[source.key] || {}),
      nextIndex: albums.length,
      total: albums.length,
      completed: true,
      completedAt: new Date().toISOString()
    };
    await writeJson(STATE_PATH, state);
    console.log(`[${source.key}] bron volledig voltooid`);
  }

  state.completedAt = new Date().toISOString();
  await writeJson(STATE_PATH, state);
  await saveCatalog(productMap, warnings, "completed");
  console.log(`[Catalogus] ${productMap.size} producten; alle bronnen voltooid`);
}

main().catch(async error => {
  console.error("Synchronisatie mislukt:", error);
  const catalog = await readJson(CATALOG_PATH, { products: [], warnings: [] });
  await writeJson(CATALOG_PATH, {
    ...catalog,
    status: "failed",
    failedAt: new Date().toISOString(),
    warnings: [...(catalog.warnings || []), error.message].slice(-200)
  });
  process.exitCode = 1;
});
