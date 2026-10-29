import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG_PATH = "data/catalog.json";
const STATE_PATH = "data/sync-state.json";
const DISCOVERY_DIR = "data/discovery";
const ASSET_ROOT = "assets/products";
const DAILY_RUN = new Date().toISOString().slice(0, 10);
const SHOE_PHOTO_VERSION = 4;

const SOURCES = [
  { key: "minkang", base: "https://minkang.x.yupoo.com", priority: 1, seeds: ["718623"] },
  { key: "yema007", base: "https://yema007.x.yupoo.com", priority: 2, seeds: [] },
  { key: "popmo", base: "https://popmo.x.yupoo.com", priority: 3, seeds: [] },
  { key: "dachang88", base: "https://dachang88.x.yupoo.com", priority: 4, mode: "shoes", seeds: [] },
  { key: "dongshanstore", base: "https://dongshanstore.x.yupoo.com", priority: 5, mode: "training", seeds: [] },
  { key: "aosendi", base: "https://aosendi.x.yupoo.com", priority: 6, mode: "training", seeds: [] }
];

const setting = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const MAX_INDEX_PAGES = setting("SYNC_MAX_PAGES", 100);
const MAX_CATEGORY_PAGES = setting("SYNC_CATEGORY_MAX_PAGES", 100);
const MAX_CATEGORIES = setting("SYNC_MAX_CATEGORIES_PER_SOURCE", 500);
const MAX_DISCOVERY_MINUTES = setting("SYNC_MAX_DISCOVERY_MINUTES", 45);
const MAX_IMAGES = setting("MAX_IMAGES_PER_ALBUM", 6);
const BATCH_SIZE = setting("SYNC_BATCH_SIZE", 25);
const CONCURRENCY = setting("SYNC_CONCURRENCY", 2);
const REQUEST_TIMEOUT = setting("SYNC_REQUEST_TIMEOUT_MS", 45000);
const REQUEST_RETRIES = setting("SYNC_REQUEST_RETRIES", 2);
const REQUEST_DELAY = Math.max(0, Number(process.env.SYNC_DELAY_MS || 250));
const SOURCE_FILTER = String(process.env.SYNC_SOURCE || "").trim().toLowerCase();
const limit = pLimit(CONCURRENCY);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const LEAGUES = [
  ["Engeland", "Premier League", ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham", "Leeds United", "Liverpool", "Manchester City", "Manchester United", "Newcastle United", "Nottingham Forest", "Sunderland", "Tottenham", "West Ham", "Wolverhampton"]],
  ["Spanje", "La Liga", ["Athletic Bilbao", "Atletico Madrid", "Barcelona", "Real Betis", "Real Madrid", "Real Sociedad", "Sevilla", "Valencia", "Villarreal"]],
  ["Italie", "Serie A", ["AC Milan", "Atalanta", "Bologna", "Fiorentina", "Inter Milan", "Juventus", "Lazio", "Napoli", "Roma"]],
  ["Duitsland", "Bundesliga", ["Bayern Munich", "Bayer Leverkusen", "Borussia Dortmund", "Eintracht Frankfurt", "RB Leipzig", "Schalke 04", "Werder Bremen"]],
  ["Frankrijk", "Ligue 1", ["Lille", "Lyon", "Marseille", "Monaco", "Nice", "Paris Saint-Germain", "PSG"]],
  ["Nederland", "Eredivisie", ["Ajax", "AZ", "Feyenoord", "FC Twente", "PSV", "Sparta Rotterdam", "FC Utrecht", "Vitesse"]],
  ["Portugal", "Primeira Liga", ["Benfica", "Porto", "Sporting CP"]],
  ["Schotland", "Scottish Premiership", ["Celtic", "Rangers"]],
  ["Turkije", "Super Lig", ["Besiktas", "Fenerbahce", "Galatasaray"]],
  ["Verenigde Staten", "MLS", ["Inter Miami", "LA Galaxy", "Los Angeles FC", "New York City FC"]]
];

const COUNTRIES = ["Argentina", "Australia", "Austria", "Belgium", "Brazil", "Canada", "Chile", "China", "Colombia", "Croatia", "Denmark", "Ecuador", "England", "France", "Germany", "Ghana", "Italy", "Japan", "Mexico", "Morocco", "Netherlands", "Nigeria", "Norway", "Poland", "Portugal", "Saudi Arabia", "Scotland", "Senegal", "South Korea", "Spain", "Sweden", "Switzerland", "Turkey", "Tunisia", "Uruguay", "USA", "United States", "Wales"];
const SHOE_BRANDS = ["Nike", "Adidas", "Puma", "New Balance", "Mizuno", "Under Armour", "Joma"];
const SHOE_MODELS = [
  ["Nike", "Mercurial", ["mercurial", "vapor", "superfly"]], ["Nike", "Phantom", ["phantom", "gx", "luna"]], ["Nike", "Tiempo", ["tiempo", "legend"]],
  ["Adidas", "Predator", ["predator"]], ["Adidas", "F50", ["f50"]], ["Adidas", "Copa", ["adidas copa"]], ["Adidas", "X", ["speedportal", "speedflow", "crazyfast", "adidas x"]],
  ["Puma", "Future", ["puma future", "future ultimate"]], ["Puma", "Ultra", ["puma ultra", "ultra ultimate"]], ["Puma", "King", ["puma king"]],
  ["Mizuno", "Morelia", ["morelia"]], ["Mizuno", "Alpha", ["mizuno alpha"]], ["Joma", "Top Flex", ["top flex"]]
];

const unique = values => [...new Set(values.filter(Boolean))];
const normalize = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const includesAny = (text, terms) => terms.some(term => normalize(text).includes(normalize(term)));
const absoluteUrl = (base, value) => { try { return new URL(value, base).href; } catch { return ""; } };
const safeName = value => normalize(value).replace(/\s+/g, "-") || "product";

function productSeason(text) {
  let match = String(text).match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/);
  if (match) {
    const first = Number(match[1]);
    let second = Number(match[2]);
    if (match[2].length === 2) { second = Math.floor(first / 100) * 100 + second; if (second < first) second += 100; }
    return `${first}-${second}`;
  }
  match = String(text).match(/\b(\d{2})\s*[\/_-]\s*(\d{2})\b/);
  if (match) {
    const first = Number(match[1]) >= 50 ? 1900 + Number(match[1]) : 2000 + Number(match[1]);
    let second = Math.floor(first / 100) * 100 + Number(match[2]);
    if (second < first) second += 100;
    return `${first}-${second}`;
  }
  return "Seizoen onbekend";
}

function findClub(text) {
  const value = normalize(text);
  return LEAGUES.flatMap(([country, competition, clubs]) => clubs.map(club => ({ country, competition, club }))).sort((a, b) => b.club.length - a.club.length).find(item => value.includes(normalize(item.club))) || null;
}

function findCountry(text) {
  const value = normalize(text);
  return COUNTRIES.find(country => value.includes(normalize(country))) || "";
}

function classifyProduct(album, source) {
  const text = [album.title, album.categoryTitle, album.collectionTitle].filter(Boolean).join(" ");
  const value = normalize(text);
  const season = productSeason(text);
  const club = findClub(text);
  const country = findCountry(text);

  const trainingTerms = ["tracksuit", "track suit", "training suit", "training set", "training wear", "pre match", "prematch", "windbreaker", "trainingspak", "trainingskleding"];
  if (source.mode === "training" || includesAny(text, trainingTerms)) {
    if (club) return { section: "Trainingskleding", category: "Clubteams", subcategory: club.competition, club: club.club, country: club.country, competition: club.competition, season, types: ["Trainingskleding"] };
    if (country) return { section: "Trainingskleding", category: "Landenteams", subcategory: country, club: country, country, competition: "Landenteams", season, types: ["Trainingskleding"] };
    return { section: "Trainingskleding", category: "Overig", subcategory: album.categoryTitle || "Overig", club: "Overig", country: "", competition: "", season, types: ["Trainingskleding"] };
  }

  const explicitShoes = ["football boot", "football boots", "soccer shoe", "soccer shoes", "soccer boot", "soccer boots", "cleats", "voetbalschoen", "voetbalschoenen"];
  const strongShoes = ["mercurial", "superfly", "phantom gx", "phantom luna", "tiempo legend", "adidas predator", "adidas f50", "adidas copa", "speedportal", "speedflow", "crazyfast", "puma future", "puma ultra", "puma king", "mizuno morelia", "mizuno alpha", "joma top flex"];
  if (source.mode === "shoes" || includesAny(text, explicitShoes) || includesAny(text, strongShoes)) {
    const brand = SHOE_BRANDS.find(brand => value.includes(normalize(brand))) || "Overige merken";
    const model = SHOE_MODELS.find(([modelBrand, , words]) => modelBrand === brand && words.some(word => value.includes(normalize(word))))?.[1] || "Overig model";
    return { section: "Voetbalschoenen", category: brand, subcategory: model, club: "", country: "", competition: "", season: "Seizoen onbekend", types: ["Voetbalschoenen"] };
  }

  if (club) return { section: "Voetbal", category: "Clubteams", subcategory: club.competition, club: club.club, country: club.country, competition: club.competition, season, types: ["Voetbalshirt"] };
  if (country) return { section: "Voetbal", category: "Landenteams", subcategory: country, club: country, country, competition: "Landenteams", season, types: ["Voetbalshirt"] };
  return { section: "Overige producten", category: "Overige producten", subcategory: album.categoryTitle || "Overig", club: "", country: "", competition: "", season: "Seizoen onbekend", types: ["Overig"] };
}

class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status} voor ${url}`); this.status = status; this.url = url; }
}

async function request(url, { binary = false, referer = "", retries = REQUEST_RETRIES } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await sleep(REQUEST_DELAY);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const headers = {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36",
        accept: binary ? "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" : "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9"
      };
      if (referer) {
        headers.referer = referer;
        headers.origin = new URL(referer).origin;
      }
      const response = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
      if (!response.ok) throw new HttpError(response.status, url);
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (error) {
      lastError = error;
      if (error?.status === 404 || attempt === retries) throw error;
      await sleep(1000 * (attempt + 1));
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } }
async function writeJson(file, data) { await fs.mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; await fs.writeFile(temporary, JSON.stringify(data, null, 2) + "\n"); await fs.rename(temporary, file); }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
function discoveryFile(source) { return path.join(DISCOVERY_DIR, `${source.key}.json`); }
function productKey(source, url) { return `${source.key}:${url.match(/\/albums\/(\d+)/)?.[1] || safeName(url)}`; }

function validProductImageUrl(url = "") {
  const value = String(url).toLowerCase();
  if (!value || !value.includes("photo.yupoo.com")) return false;
  return !["logo", "avatar", "favicon", "default", "placeholder", "loading", "qrcode", "qr_code", "icon", "sprite", "banner", "watermark"].some(word => value.includes(word));
}

function imageVariants(url) {
  const clean = String(url || "").replace(/!.*$/, "");
  const original = clean.replace(/\/(small|medium|thumb|large)\//i, "/original/");
  const large = clean.replace(/\/(small|medium|thumb|original)\//i, "/large/");
  const medium = clean.replace(/\/(small|large|thumb|original)\//i, "/medium/");
  return unique([clean, original, large, medium]);
}

function extractPage(html, source, inheritedTitle = "") {
  const $ = cheerio.load(html);
  const categories = new Map();
  const albums = new Map();

  $("a[href*='/categories/'],a[href*='/collections/']").each((_, element) => {
    const url = absoluteUrl(source.base, $(element).attr("href")).split("?")[0];
    if (url) categories.set(url, { url, title: $(element).attr("title") || $(element).text().trim() });
  });

  $("a[href*='/albums/']").each((_, element) => {
    const fetchUrl = absoluteUrl(source.base, $(element).attr("href"));
    const url = fetchUrl.split("?")[0];
    if (!/\/albums\/\d+/.test(url)) return;
    const image = $(element).find("img");
    const previewValues = [image.attr("data-origin-src"), image.attr("data-src"), image.attr("src")].map(value => absoluteUrl(source.base, value)).filter(validProductImageUrl);
    albums.set(url, {
      url,
      fetchUrl,
      title: $(element).attr("title") || image.attr("alt") || $(element).text().trim() || `Product ${url.match(/\/albums\/(\d+)/)?.[1] || ""}`,
      categoryTitle: inheritedTitle,
      previewImage: previewValues[0] || ""
    });
  });

  const next = $("a[rel='next'],a.next,.pagination-next a").first().attr("href");
  return { categories: [...categories.values()], albums: [...albums.values()], nextUrl: next ? absoluteUrl(source.base, next) : "" };
}

function mergeAlbums(existing, incoming) {
  const map = new Map(existing.map(album => [album.url, album]));
  for (const album of incoming) map.set(album.url, { ...(map.get(album.url) || {}), ...album });
  return [...map.values()].sort((a, b) => a.url.localeCompare(b.url, "en", { numeric: true }));
}

function freshDiscovery(source) {
  return { run: DAILY_RUN, phase: "index", indexPage: 1, categories: (source.seeds || []).map(id => ({ url: `${source.base}/categories/${id}`, title: "" })), categoryIndex: 0, categoryPage: 1, albums: [], complete: false };
}

async function saveDiscovery(source, discovery, state) {
  discovery.updatedAt = new Date().toISOString();
  await writeJson(discoveryFile(source), discovery);
  state.sources[source.key] = { ...(state.sources[source.key] || {}), run: DAILY_RUN, discoveryComplete: discovery.complete, discoveredAlbums: discovery.albums.length, categoryIndex: discovery.categoryIndex, categoryTotal: discovery.categories.length, updatedAt: discovery.updatedAt };
  await writeJson(STATE_PATH, state);
}

async function discover(source, state) {
  let discovery = await readJson(discoveryFile(source), freshDiscovery(source));
  if (discovery.run !== DAILY_RUN) discovery = freshDiscovery(source);
  if (discovery.complete) return discovery.albums;

  const deadline = Date.now() + MAX_DISCOVERY_MINUTES * 60000;
  console.log(`[${source.key}] dagelijkse ontdekking hervat: ${discovery.phase}, albums=${discovery.albums.length}`);

  if (discovery.phase === "index") {
    while (discovery.indexPage <= MAX_INDEX_PAGES) {
      if (Date.now() >= deadline) { await saveDiscovery(source, discovery, state); return null; }
      const url = discovery.indexPage === 1 ? `${source.base}/albums` : `${source.base}/albums?page=${discovery.indexPage}`;
      try {
        const page = extractPage(await request(url), source);
        discovery.albums = mergeAlbums(discovery.albums, page.albums);
        const categoryMap = new Map(discovery.categories.map(item => [item.url, item]));
        page.categories.forEach(item => categoryMap.set(item.url, item));
        discovery.categories = [...categoryMap.values()].slice(0, MAX_CATEGORIES);
        discovery.indexPage++;
        await saveDiscovery(source, discovery, state);
        if ((!page.albums.length && !page.categories.length) || (!page.nextUrl && discovery.indexPage > 2)) break;
      } catch (error) {
        console.warn(`[${source.key}] indexpagina ${discovery.indexPage} overgeslagen: ${error.message}`);
        discovery.indexPage++;
        await saveDiscovery(source, discovery, state);
        if (error.status === 404) break;
      }
    }
    discovery.phase = "categories";
    await saveDiscovery(source, discovery, state);
  }

  while (discovery.categoryIndex < discovery.categories.length) {
    if (Date.now() >= deadline) { await saveDiscovery(source, discovery, state); return null; }
    const category = discovery.categories[discovery.categoryIndex];
    if (discovery.categoryPage > MAX_CATEGORY_PAGES) { discovery.categoryIndex++; discovery.categoryPage = 1; continue; }
    const url = discovery.categoryPage === 1 ? category.url : `${category.url}${category.url.includes("?") ? "&" : "?"}page=${discovery.categoryPage}`;
    try {
      const page = extractPage(await request(url), source, category.title);
      discovery.albums = mergeAlbums(discovery.albums, page.albums);
      discovery.categoryPage++;
      if (!page.albums.length || !page.nextUrl) { discovery.categoryIndex++; discovery.categoryPage = 1; }
      await saveDiscovery(source, discovery, state);
    } catch (error) {
      console.warn(`[${source.key}] categorie ${discovery.categoryIndex + 1} overgeslagen: ${error.message}`);
      discovery.categoryIndex++;
      discovery.categoryPage = 1;
      await saveDiscovery(source, discovery, state);
    }
  }

  discovery.complete = true;
  discovery.phase = "complete";
  await saveDiscovery(source, discovery, state);
  console.log(`[${source.key}] dagelijkse ontdekking voltooid: ${discovery.albums.length} albums`);
  return discovery.albums;
}

function extractAlbum(html, album, source) {
  const $ = cheerio.load(html);
  const images = [];
  const add = raw => {
    const url = absoluteUrl(source.base, raw);
    if (validProductImageUrl(url)) images.push(url);
  };
  $("meta[property='og:image'],meta[name='twitter:image']").each((_, element) => add($(element).attr("content")));
  $(".showalbum__image img,.showalbum__children img,.album__photo img,.photo img,img[data-origin-src],img[data-src]").each((_, element) => {
    add($(element).attr("data-origin-src"));
    add($(element).attr("data-src"));
    add($(element).attr("src"));
  });
  return { title: $("h1").first().text().trim() || $("meta[property='og:title']").attr("content") || album.title, images: unique(images).slice(0, MAX_IMAGES) };
}

async function downloadImage(url, file, referer, overwrite = false) {
  if (!overwrite && await exists(file)) return true;
  let lastError;
  for (const candidate of imageVariants(url)) {
    try {
      const buffer = await request(candidate, { binary: true, referer, retries: REQUEST_RETRIES });
      const metadata = await sharp(buffer).metadata();
      if (Number(metadata.width || 0) < 300 || Number(metadata.height || 0) < 300) throw new Error("afbeelding te klein");
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      await sharp(buffer).rotate().webp({ quality: 82 }).toFile(temporary);
      await fs.rename(temporary, file);
      return true;
    } catch (error) { lastError = error; }
  }
  console.warn(`[foto] overgeslagen na alle varianten: ${lastError?.message || url}`);
  return false;
}

async function processAlbum(source, album, previous, forceShoeRepair) {
  const id = album.url.match(/\/albums\/(\d+)/)?.[1] || safeName(album.url);
  const folder = path.join(ASSET_ROOT, source.key, id);
  const referer = album.fetchUrl || album.url;
  let detail = null;

  try {
    detail = extractAlbum(await request(referer), album, source);
  } catch (error) {
    if (error.status !== 404) console.warn(`[${source.key}] album ${id}: ${error.message}`);
  }

  const candidates = detail?.images?.length ? detail.images : (album.previewImage ? [album.previewImage] : []);
  const stored = [];
  const overwrite = forceShoeRepair && source.mode === "shoes";
  if (overwrite && candidates.length) await fs.rm(folder, { recursive: true, force: true });

  for (let index = 0; index < Math.min(candidates.length, MAX_IMAGES); index++) {
    const file = path.join(folder, `${String(index + 1).padStart(2, "0")}.webp`);
    if (await downloadImage(candidates[index], file, referer, overwrite)) stored.push(file.replaceAll(path.sep, "/"));
  }

  if (!stored.length && !overwrite && previous?.images?.length) stored.push(...previous.images);
  if (!stored.length && overwrite && previous?.images?.length) {
    // Oude logo's niet opnieuw registreren; de kaart toont dan neutraal "Geen foto".
  }

  const title = detail?.title || album.title || previous?.title || `Product ${id}`;
  return {
    ...(previous || {}),
    uniqueKey: productKey(source, album.url),
    source: source.key,
    sourceId: id,
    sourceUrl: album.url,
    sourceCategory: album.categoryTitle || previous?.sourceCategory || "",
    title,
    ...classifyProduct({ ...album, title }, source),
    images: stored,
    coverUrl: stored[0] || "",
    imageCount: stored.length,
    updatedAt: new Date().toISOString()
  };
}

const sortProducts = (a, b) => [a.section, a.category, a.subcategory, a.club, a.season, a.title].join("|").localeCompare([b.section, b.category, b.subcategory, b.club, b.season, b.title].join("|"), "nl");

async function saveCatalog(map, warnings, status, currentSource = "") {
  await writeJson(CATALOG_PATH, { lastSync: new Date().toISOString(), status, currentSource: currentSource || undefined, products: [...map.values()].sort(sortProducts), warnings: warnings.slice(-200) });
}

async function main() {
  const catalog = await readJson(CATALOG_PATH, { products: [], warnings: [] });
  const products = Array.isArray(catalog.products) ? catalog.products : Array.isArray(catalog.albums) ? catalog.albums : [];
  const productMap = new Map(products.map(product => [product.uniqueKey || `${product.source}:${product.sourceId}`, product]));
  const state = await readJson(STATE_PATH, { version: 5, sources: {} });
  state.version = 5;
  state.sources ||= {};
  state.daily ||= {};

  const forceShoeRepair = Number(state.shoePhotoVersion || 0) < SHOE_PHOTO_VERSION;
  if (forceShoeRepair) {
    console.log(`[dachang88] schoenfotoherstel versie ${SHOE_PHOTO_VERSION} geactiveerd`);
    await fs.rm(path.join(ASSET_ROOT, "dachang88"), { recursive: true, force: true });
  }

  const warnings = [];
  const sources = SOURCES.filter(source => !SOURCE_FILTER || source.key === SOURCE_FILTER).sort((a, b) => a.priority - b.priority);
  if (!sources.length) throw new Error(`Onbekende SYNC_SOURCE: ${SOURCE_FILTER}`);

  for (const source of sources) {
    const today = state.daily[source.key];
    if (today?.run === DAILY_RUN && today.completed === true && !(forceShoeRepair && source.mode === "shoes")) {
      console.log(`[${source.key}] dagelijkse controle van ${DAILY_RUN} reeds voltooid; overgeslagen`);
      continue;
    }

    console.log(`\n[${source.key}] dagelijkse controle gestart`);
    const albums = await discover(source, state);
    if (!albums) {
      console.log(`[${source.key}] ontdekking gepauzeerd; volgende run hervat automatisch`);
      await saveCatalog(productMap, warnings, "paused", source.key);
      return;
    }

    let start = today?.run === DAILY_RUN ? Number(today.nextIndex || 0) : 0;
    if (forceShoeRepair && source.mode === "shoes") start = 0;
    start = Math.min(start, albums.length);
    console.log(`[${source.key}] ${albums.length} albums; hervat bij ${start}/${albums.length}`);

    for (let offset = start; offset < albums.length; offset += BATCH_SIZE) {
      const batch = albums.slice(offset, offset + BATCH_SIZE);
      const results = await Promise.all(batch.map(album => limit(async () => {
        try { return await processAlbum(source, album, productMap.get(productKey(source, album.url)), forceShoeRepair); }
        catch (error) {
          const message = `[${source.key}] ${album.url}: ${error.message}`;
          warnings.push(message);
          console.warn(message);
          return null;
        }
      })));
      results.filter(Boolean).forEach(product => productMap.set(product.uniqueKey, product));
      state.daily[source.key] = { run: DAILY_RUN, nextIndex: offset + batch.length, total: albums.length, completed: offset + batch.length >= albums.length, updatedAt: new Date().toISOString() };
      await saveCatalog(productMap, warnings, "running", source.key);
      await writeJson(STATE_PATH, state);
      console.log(`[${source.key}] ${offset + batch.length}/${albums.length}; dagelijks hervatpunt opgeslagen`);
    }

    state.daily[source.key] = { run: DAILY_RUN, nextIndex: albums.length, total: albums.length, completed: true, completedAt: new Date().toISOString() };
    await writeJson(STATE_PATH, state);
    console.log(`[${source.key}] dagelijkse controle voltooid`);
  }

  if (forceShoeRepair) state.shoePhotoVersion = SHOE_PHOTO_VERSION;
  state.lastCompletedDailyRun = DAILY_RUN;
  state.completedAt = new Date().toISOString();
  await writeJson(STATE_PATH, state);
  await saveCatalog(productMap, warnings, "completed");
  console.log(`[Catalogus] ${productMap.size} producten opgeslagen; alle zes bronnen gecontroleerd.`);
}

main().catch(async error => {
  console.error("Dagelijkse synchronisatie mislukt:", error);
  const catalog = await readJson(CATALOG_PATH, { products: [], warnings: [] });
  await writeJson(CATALOG_PATH, { ...catalog, status: "failed", failedAt: new Date().toISOString(), warnings: [...(catalog.warnings || []), error.message].slice(-200) });
  process.exitCode = 1;
});
