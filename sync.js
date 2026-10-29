import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

/* FootballshirtsNL incremental sync
 * - discovers all 9 sources daily
 * - processes only new products, missing images and explicit repairs
 * - never re-downloads a complete existing product on the first run
 */

const CATALOG = "data/catalog.json";
const STATE = "data/sync-state.json";
const DISCOVERY = "data/discovery";
const ASSETS = "assets/products";
const RUN_DATE = new Date().toISOString().slice(0, 10);
const CLASSIFICATION_VERSION = 1;
const SHOE_PHOTO_VERSION = 6;

const SOURCES = [
  { key: "minkang", base: "https://minkang.x.yupoo.com", priority: 1, seeds: ["718623"] },
  { key: "yema007", base: "https://yema007.x.yupoo.com", priority: 2, seeds: [] },
  { key: "popmo", base: "https://popmo.x.yupoo.com", priority: 3, seeds: [] },
  { key: "407131796", base: "https://407131796.x.yupoo.com", priority: 4, seeds: [] },
  { key: "yuhuaxieye1", base: "https://yuhuaxieye1.x.yupoo.com", priority: 5, seeds: [] },
  { key: "hema168", base: "https://hema168.x.yupoo.com", priority: 6, seeds: [] },
  { key: "dachang88", base: "https://dachang88.x.yupoo.com", priority: 7, mode: "shoes", seeds: [] },
  { key: "dongshanstore", base: "https://dongshanstore.x.yupoo.com", priority: 8, mode: "training", seeds: [] },
  { key: "aosendi", base: "https://aosendi.x.yupoo.com", priority: 9, mode: "training", seeds: [] }
];

const numberSetting = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const MAX_INDEX_PAGES = numberSetting("SYNC_MAX_PAGES", 100);
const MAX_CATEGORY_PAGES = numberSetting("SYNC_CATEGORY_MAX_PAGES", 100);
const MAX_CATEGORIES = numberSetting("SYNC_MAX_CATEGORIES_PER_SOURCE", 500);
const DISCOVERY_MINUTES = numberSetting("SYNC_MAX_DISCOVERY_MINUTES", 45);
const MAX_IMAGES = numberSetting("MAX_IMAGES_PER_ALBUM", 6);
const BATCH_SIZE = numberSetting("SYNC_BATCH_SIZE", 25);
const CONCURRENCY = numberSetting("SYNC_CONCURRENCY", 2);
const REQUEST_TIMEOUT = numberSetting("SYNC_REQUEST_TIMEOUT_MS", 45000);
const REQUEST_RETRIES = numberSetting("SYNC_REQUEST_RETRIES", 2);
const REQUEST_DELAY = Math.max(0, Number(process.env.SYNC_DELAY_MS || 250));
const SOURCE_FILTER = String(process.env.SYNC_SOURCE || "").trim().toLowerCase();
const FORCE_SOURCE = String(process.env.SYNC_FORCE_SOURCE || "").trim().toLowerCase();
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
const BRANDS = ["Nike", "Adidas", "Puma", "New Balance", "Mizuno", "Under Armour", "Joma"];
const MODELS = [
  ["Nike", "Mercurial", ["mercurial", "vapor", "superfly"]], ["Nike", "Phantom", ["phantom", "gx", "luna"]], ["Nike", "Tiempo", ["tiempo", "legend"]],
  ["Adidas", "Predator", ["predator"]], ["Adidas", "F50", ["f50"]], ["Adidas", "Copa", ["adidas copa"]], ["Adidas", "X", ["speedportal", "speedflow", "crazyfast", "adidas x"]],
  ["Puma", "Future", ["puma future"]], ["Puma", "Ultra", ["puma ultra"]], ["Puma", "King", ["puma king"]], ["Mizuno", "Morelia", ["morelia"]], ["Mizuno", "Alpha", ["mizuno alpha"]], ["Joma", "Top Flex", ["top flex"]]
];

const unique = values => [...new Set(values.filter(Boolean))];
const HAN_RE = /[\p{Script=Han}]/u;
const HAN_GLOBAL_RE = /[\p{Script=Han}]+/gu;
const LEGACY_TO_ENGLISH = new Map([
  ["Voetbal", "Football"], ["Voetbalshirt", "Football Jersey"],
  ["Voetbalschoenen", "Football Boots"], ["Trainingskleding", "Training Wear"],
  ["Clubteams", "Club Teams"], ["Landenteams", "National Teams"],
  ["Overige producten", "Other Products"], ["Overige merken", "Other Brands"],
  ["Overige clubs", "Other Clubs"], ["Overig model", "Other Model"],
  ["Overig merk", "Other Brand"], ["Overig", "Other"],
  ["Seizoen onbekend", "Unknown Season"], ["Jassen", "Jackets"],
  ["Tassen", "Bags"], ["Horloges", "Watches"], ["Riemen", "Belts"]
]);

const CHINESE_TO_ENGLISH = [
  ["足球鞋", "Football Boots"], ["球鞋", "Football Boots"], ["训练服", "Training Wear"],
  ["训练套装", "Training Set"], ["运动套装", "Sports Set"], ["球衣", "Jersey"],
  ["短袖", "Short Sleeve"], ["长袖", "Long Sleeve"], ["套装", "Set"],
  ["外套", "Jacket"], ["夹克", "Jacket"], ["风衣", "Windbreaker"],
  ["卫衣", "Hoodie"], ["长裤", "Trousers"], ["短裤", "Shorts"],
  ["童装", "Kids"], ["儿童", "Kids"], ["成人", "Adult"],
  ["主场", "Home"], ["客场", "Away"], ["第三", "Third"],
  ["球员版", "Player Version"], ["球迷版", "Fan Version"], ["复古", "Retro"],
  ["新款", "New"], ["男款", "Men"], ["女款", "Women"],
  ["袜子", "Socks"], ["足球", "Football"], ["手套", "Gloves"],
  ["守门员", "Goalkeeper"], ["背包", "Backpack"], ["帽子", "Cap"]
];

function englishText(value, fallback = "") {
  let text = String(value ?? "");
  if (LEGACY_TO_ENGLISH.has(text.trim())) text = LEGACY_TO_ENGLISH.get(text.trim());
  for (const [chinese, english] of CHINESE_TO_ENGLISH) {
    text = text.split(chinese).join(` ${english} `);
  }
  text = text
    .replace(HAN_GLOBAL_RE, " ")
    .replace(/[，。；：！？【】（）《》、]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-_/|]+|[\s\-_/|]+$/g, "")
    .trim();
  return text || fallback;
}

function englishProduct(product) {
  const id = product.sourceId || String(product.uniqueKey || "").split(":").at(-1) || "Unknown";
  return {
    ...product,
    title: englishText(product.title, `Product ${id}`),
    sourceCategory: englishText(product.sourceCategory, "Other"),
    sourceCollection: englishText(product.sourceCollection, ""),
    section: englishText(product.section, "Other Products"),
    category: englishText(product.category, "Other Products"),
    subcategory: englishText(product.subcategory, "Other"),
    club: englishText(product.club, ""),
    country: englishText(product.country, ""),
    competition: englishText(product.competition, ""),
    types: Array.isArray(product.types) ? product.types.map(item => englishText(item)).filter(Boolean) : []
  };
}

const normalize = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const includesAny = (text, terms) => terms.some(term => normalize(text).includes(normalize(term)));
const absoluteUrl = (base, value) => { try { return new URL(value, base).href; } catch { return ""; } };
const safeName = value => normalize(value).replace(/\s+/g, "-") || "product";

function detectSeason(text) {
  let match = String(text).match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/);
  if (match) {
    const first = Number(match[1]); let second = Number(match[2]);
    if (match[2].length === 2) { second = Math.floor(first / 100) * 100 + second; if (second < first) second += 100; }
    return `${first}-${second}`;
  }
  match = String(text).match(/\b(\d{2})\s*[\/_-]\s*(\d{2})\b/);
  if (match) {
    const first = Number(match[1]) >= 50 ? 1900 + Number(match[1]) : 2000 + Number(match[1]);
    let second = Math.floor(first / 100) * 100 + Number(match[2]); if (second < first) second += 100;
    return `${first}-${second}`;
  }
  return "Unknown Season";
}

function findClub(text) {
  const value = normalize(text);
  return LEAGUES.flatMap(([country, competition, clubs]) => clubs.map(club => ({ country, competition, club }))).sort((a, b) => b.club.length - a.club.length).find(item => value.includes(normalize(item.club))) || null;
}
function findCountry(text) { const value = normalize(text); return COUNTRIES.find(item => value.includes(normalize(item))) || ""; }

function classify(album, source) {
  const text = [album.title, album.categoryTitle].filter(Boolean).join(" ");
  const value = normalize(text), season = detectSeason(text), club = findClub(text), country = findCountry(text);
  const training = ["tracksuit", "track suit", "training suit", "training set", "training wear", "pre match", "prematch", "windbreaker", "trainingspak", "trainingskleding"];
  if (source.mode === "training" || includesAny(text, training)) {
    if (club) return { section: "Training Wear", category: "Club Teams", subcategory: club.competition, club: club.club, country: club.country, competition: club.competition, season, types: ["Training Wear"] };
    if (country) return { section: "Training Wear", category: "National Teams", subcategory: country, club: country, country, competition: "National Teams", season, types: ["Training Wear"] };
    return { section: "Training Wear", category: "Other", subcategory: album.categoryTitle || "Other", club: "Other", country: "", competition: "", season, types: ["Training Wear"] };
  }
  const explicit = ["football boot", "soccer shoe", "soccer boot", "cleats", "voetbalschoen"];
  const strong = ["mercurial", "superfly", "phantom gx", "phantom luna", "tiempo legend", "adidas predator", "adidas f50", "adidas copa", "speedportal", "speedflow", "crazyfast", "puma future", "puma ultra", "puma king", "mizuno morelia", "mizuno alpha", "joma top flex"];
  if (source.mode === "shoes" || includesAny(text, explicit) || includesAny(text, strong)) {
    const brand = BRANDS.find(item => value.includes(normalize(item))) || "Other Brands";
    const model = MODELS.find(([modelBrand, , words]) => modelBrand === brand && words.some(word => value.includes(normalize(word))))?.[1] || "Overig model";
    return { section: "Football Boots", category: brand, subcategory: model, club: "", country: "", competition: "", season: "Unknown Season", types: ["Football Boots"] };
  }
  if (club) return { section: "Football", category: "Club Teams", subcategory: club.competition, club: club.club, country: club.country, competition: club.competition, season, types: ["Football Jersey"] };
  if (country) return { section: "Football", category: "National Teams", subcategory: country, club: country, country, competition: "National Teams", season, types: ["Football Jersey"] };
  return { section: "Other Products", category: "Other Products", subcategory: album.categoryTitle || "Other", club: "", country: "", competition: "", season: "Unknown Season", types: ["Other"] };
}

class HttpError extends Error { constructor(status, url) { super(`HTTP ${status} voor ${url}`); this.status = status; } }
async function request(url, { binary = false, referer = "" } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
    await sleep(REQUEST_DELAY); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const headers = { "user-agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/129 Safari/537.36", accept: binary ? "image/avif,image/webp,image/*,*/*" : "text/html,application/xhtml+xml" };
      if (referer) { headers.referer = referer; headers.origin = new URL(referer).origin; }
      const response = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
      if (!response.ok) throw new HttpError(response.status, url);
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (error) { lastError = error; if (error.status === 404 || attempt === REQUEST_RETRIES) throw error; await sleep(1000 * (attempt + 1)); }
    finally { clearTimeout(timer); }
  }
  throw lastError;
}

async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } }
async function writeJson(file, data) { await fs.mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; await fs.writeFile(temporary, JSON.stringify(data, null, 2) + "\n"); await fs.rename(temporary, file); }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
const discoveryFile = source => path.join(DISCOVERY, `${source.key}.json`);
const productKey = (source, url) => `${source.key}:${url.match(/\/albums\/(\d+)/)?.[1] || safeName(url)}`;
function validImage(url = "") { const value = String(url).toLowerCase(); return value.includes("photo.yupoo.com") && !["logo", "avatar", "favicon", "default", "placeholder", "loading", "qrcode", "icon", "sprite", "banner", "watermark"].some(item => value.includes(item)); }

function extractPage(html, source, inherited = "") {
  const $ = cheerio.load(html), categories = new Map(), albums = new Map();
  $("a[href*='/categories/'],a[href*='/collections/']").each((_, element) => { const url = absoluteUrl(source.base, $(element).attr("href")).split("?")[0]; if (url) categories.set(url, { url, title: englishText($(element).attr("title") || $(element).text().trim(), "Other") }); });
  $("a[href*='/albums/']").each((_, element) => {
    const fetchUrl = absoluteUrl(source.base, $(element).attr("href")), url = fetchUrl.split("?")[0]; if (!/\/albums\/\d+/.test(url)) return;
    const image = $(element).find("img"), previewImage = [image.attr("data-origin-src"), image.attr("data-src"), image.attr("src")].map(item => absoluteUrl(source.base, item)).find(validImage) || "";
    albums.set(url, { url, fetchUrl, title: englishText($(element).attr("title") || image.attr("alt") || $(element).text().trim(), `Product ${url.match(/\/albums\/(\d+)/)?.[1] || ""}`), categoryTitle: englishText(inherited, "Other"), previewImage });
  });
  const next = $("a[rel='next'],a.next,.pagination-next a").first().attr("href");
  return { categories: [...categories.values()], albums: [...albums.values()], nextUrl: next ? absoluteUrl(source.base, next) : "" };
}
function mergeAlbums(existing, incoming) { const map = new Map(existing.map(item => [item.url, item])); incoming.forEach(item => map.set(item.url, { ...(map.get(item.url) || {}), ...item })); return [...map.values()].sort((a, b) => a.url.localeCompare(b.url, "en", { numeric: true })); }
const freshDiscovery = source => ({ runDate: RUN_DATE, phase: "index", indexPage: 1, categories: (source.seeds || []).map(id => ({ url: `${source.base}/categories/${id}`, title: "" })), categoryIndex: 0, categoryPage: 1, albums: [], complete: false });
async function saveDiscovery(source, discovery, state) { discovery.updatedAt = new Date().toISOString(); await writeJson(discoveryFile(source), discovery); state.discovery ||= {}; state.discovery[source.key] = { runDate: RUN_DATE, complete: discovery.complete, albums: discovery.albums.length, updatedAt: discovery.updatedAt }; await writeJson(STATE, state); }

async function discover(source, state) {
  let discovery = await readJson(discoveryFile(source), freshDiscovery(source));
  if (discovery.runDate !== RUN_DATE) discovery = freshDiscovery(source);
  if (discovery.complete) return discovery.albums;
  const deadline = Date.now() + DISCOVERY_MINUTES * 60000;
  if (discovery.phase === "index") {
    while (discovery.indexPage <= MAX_INDEX_PAGES) {
      if (Date.now() >= deadline) { await saveDiscovery(source, discovery, state); return null; }
      const url = discovery.indexPage === 1 ? `${source.base}/albums` : `${source.base}/albums?page=${discovery.indexPage}`;
      try {
        const page = extractPage(await request(url), source); discovery.albums = mergeAlbums(discovery.albums, page.albums);
        const categoryMap = new Map(discovery.categories.map(item => [item.url, item])); page.categories.forEach(item => categoryMap.set(item.url, item)); discovery.categories = [...categoryMap.values()].slice(0, MAX_CATEGORIES); discovery.indexPage++; await saveDiscovery(source, discovery, state);
        if ((!page.albums.length && !page.categories.length) || (!page.nextUrl && discovery.indexPage > 2)) break;
      } catch (error) { console.warn(`[${source.key}] index overgeslagen: ${error.message}`); discovery.indexPage++; await saveDiscovery(source, discovery, state); if (error.status === 404) break; }
    }
    discovery.phase = "categories"; await saveDiscovery(source, discovery, state);
  }
  while (discovery.categoryIndex < discovery.categories.length) {
    if (Date.now() >= deadline) { await saveDiscovery(source, discovery, state); return null; }
    const category = discovery.categories[discovery.categoryIndex];
    if (discovery.categoryPage > MAX_CATEGORY_PAGES) { discovery.categoryIndex++; discovery.categoryPage = 1; continue; }
    const url = discovery.categoryPage === 1 ? category.url : `${category.url}${category.url.includes("?") ? "&" : "?"}page=${discovery.categoryPage}`;
    try { const page = extractPage(await request(url), source, category.title); discovery.albums = mergeAlbums(discovery.albums, page.albums); discovery.categoryPage++; if (!page.albums.length || !page.nextUrl) { discovery.categoryIndex++; discovery.categoryPage = 1; } await saveDiscovery(source, discovery, state); }
    catch (error) { console.warn(`[${source.key}] categorie overgeslagen: ${error.message}`); discovery.categoryIndex++; discovery.categoryPage = 1; await saveDiscovery(source, discovery, state); }
  }
  discovery.complete = true; discovery.phase = "complete"; await saveDiscovery(source, discovery, state); return discovery.albums;
}

function extractAlbum(html, album, source) {
  const $ = cheerio.load(html), images = [], add = raw => { const url = absoluteUrl(source.base, raw); if (validImage(url)) images.push(url); };
  $("meta[property='og:image'],meta[name='twitter:image']").each((_, element) => add($(element).attr("content")));
  $(".showalbum__image img,.showalbum__children img,.album__photo img,.photo img,img[data-origin-src],img[data-src]").each((_, element) => { add($(element).attr("data-origin-src")); add($(element).attr("data-src")); add($(element).attr("src")); });
  return { title: englishText($("h1").first().text().trim() || $("meta[property='og:title']").attr("content") || album.title, `Product ${album.url.match(/\/albums\/(\d+)/)?.[1] || ""}`), images: unique(images).slice(0, MAX_IMAGES) };
}

async function downloadImage(url, file, referer) {
  if (await exists(file)) return true;
  try {
    const buffer = await request(url, { binary: true, referer }), metadata = await sharp(buffer).metadata();
    if (Number(metadata.width || 0) < 300 || Number(metadata.height || 0) < 300) return false;
    await fs.mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; await sharp(buffer).rotate().webp({ quality: 82 }).toFile(temporary); await fs.rename(temporary, file); return true;
  } catch (error) { console.warn(`[foto] ${error.message}`); return false; }
}

function completeProduct(product) {
  if (!product) return false;
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  return Boolean(product.title && product.section && product.category && product.subcategory && (images.length || product.coverUrl));
}

function needsWork(album, source, previous, state) {
  if (FORCE_SOURCE === source.key || FORCE_SOURCE === "all") return true;
  if (!previous) return true;
  if (!completeProduct(previous)) return true;
  if (Number(previous.classificationVersion || 0) < CLASSIFICATION_VERSION) return true;
  if (source.mode === "shoes" && Number(previous.shoePhotoVersion || 0) < SHOE_PHOTO_VERSION) return true;
  return false;
}

async function processAlbum(source, album, previous) {
  const id = album.url.match(/\/albums\/(\d+)/)?.[1] || safeName(album.url), folder = path.join(ASSETS, source.key, id), referer = album.fetchUrl || album.url;
  let detail = null;
  try { detail = extractAlbum(await request(referer), album, source); } catch (error) { if (error.status !== 404) console.warn(`[${source.key}] album ${id}: ${error.message}`); }
  const candidates = unique(detail?.images?.length ? detail.images : (album.previewImage ? [album.previewImage] : [])).filter(validImage).slice(0, MAX_IMAGES);
  let images = [];
  if (source.mode === "shoes") {
    images = candidates.length ? candidates : (previous?.images || []).filter(validImage).slice(0, MAX_IMAGES);
  } else {
    for (let index = 0; index < candidates.length; index++) {
      const file = path.join(folder, `${String(index + 1).padStart(2, "0")}.webp`);
      if (await downloadImage(candidates[index], file, referer)) images.push(file.replaceAll(path.sep, "/"));
    }
    if (!images.length && previous?.images?.length) images.push(...previous.images);
  }
  const title = englishText(detail?.title || album.title || previous?.title, `Product ${id}`);
  return englishProduct({ ...(previous || {}), uniqueKey: productKey(source, album.url), source: source.key, sourceId: id, sourceUrl: album.url, sourceCategory: album.categoryTitle || previous?.sourceCategory || "", title, ...classify({ ...album, title }, source), images, coverUrl: images[0] || previous?.coverUrl || "", imageCount: images.length, classificationVersion: CLASSIFICATION_VERSION, shoePhotoVersion: source.mode === "shoes" ? SHOE_PHOTO_VERSION : previous?.shoePhotoVersion, updatedAt: new Date().toISOString() });
}

const sortProducts = (a, b) => [a.section, a.category, a.subcategory, a.club, a.season, a.title].join("|").localeCompare([b.section, b.category, b.subcategory, b.club, b.season, b.title].join("|"), "nl");
async function saveCatalog(map, warnings, status, currentSource = "") { await writeJson(CATALOG, { lastSync: new Date().toISOString(), status, currentSource: currentSource || undefined, products: [...map.values()].sort(sortProducts), warnings: warnings.slice(-200) }); }

async function main() {
  const catalog = await readJson(CATALOG, { products: [], warnings: [] });
  const products = Array.isArray(catalog.products) ? catalog.products : Array.isArray(catalog.albums) ? catalog.albums : [];
  const map = new Map(products.map(product => { const cleaned = englishProduct(product); return [cleaned.uniqueKey || `${cleaned.source}:${cleaned.sourceId}`, cleaned]; }));
  const state = await readJson(STATE, { version: 7, discovery: {}, incremental: {} }); state.version = 7; state.discovery ||= {}; state.incremental ||= {};
  const warnings = [], sources = SOURCES.filter(source => !SOURCE_FILTER || source.key === SOURCE_FILTER).sort((a, b) => a.priority - b.priority);
  if (!sources.length) throw new Error(`Onbekende SYNC_SOURCE: ${SOURCE_FILTER}`);

  for (const source of sources) {
    console.log(`\n[${source.key}] incrementele controle gestart`);
    const albums = await discover(source, state);
    if (!albums) { await saveCatalog(map, warnings, "paused", source.key); return; }

    const work = albums.filter(album => needsWork(album, source, map.get(productKey(source, album.url)), state));
    console.log(`[${source.key}] ${albums.length} gevonden; ${work.length} nieuw/onvolledig/te corrigeren; ${albums.length - work.length} ongewijzigd overgeslagen`);

    const saved = state.incremental[source.key];
    let start = saved?.runDate === RUN_DATE && saved?.workSignature === work.map(item => item.url).join("|").slice(-4000) ? Number(saved.nextIndex || 0) : 0;
    const signature = work.map(item => item.url).join("|").slice(-4000);

    for (let offset = start; offset < work.length; offset += BATCH_SIZE) {
      const batch = work.slice(offset, offset + BATCH_SIZE);
      const results = await Promise.all(batch.map(album => limit(async () => {
        try { return await processAlbum(source, album, map.get(productKey(source, album.url))); }
        catch (error) { const message = `[${source.key}] ${album.url}: ${error.message}`; warnings.push(message); console.warn(message); return null; }
      })));
      results.filter(Boolean).forEach(product => map.set(product.uniqueKey, product));
      state.incremental[source.key] = { runDate: RUN_DATE, workSignature: signature, nextIndex: offset + batch.length, totalWork: work.length, completed: offset + batch.length >= work.length, updatedAt: new Date().toISOString() };
      await saveCatalog(map, warnings, "running", source.key); await writeJson(STATE, state);
      console.log(`[${source.key}] ${offset + batch.length}/${work.length} correcties opgeslagen`);
    }

    state.incremental[source.key] = { runDate: RUN_DATE, workSignature: signature, nextIndex: work.length, totalWork: work.length, completed: true, completedAt: new Date().toISOString() };
    await writeJson(STATE, state);
  }

  state.lastCompletedIncrementalRun = RUN_DATE; state.completedAt = new Date().toISOString(); await writeJson(STATE, state); await saveCatalog(map, warnings, "completed");
  console.log(`[Catalogus] ${map.size} producten opgeslagen; alleen noodzakelijke correcties uitgevoerd.`);
}

main().catch(async error => {
  console.error("Incrementele synchronisatie mislukt:", error);
  const catalog = await readJson(CATALOG, { products: [], warnings: [] });
  await writeJson(CATALOG, { ...catalog, status: "failed", failedAt: new Date().toISOString(), warnings: [...(catalog.warnings || []), error.message].slice(-200) });
  process.exitCode = 1;
});
