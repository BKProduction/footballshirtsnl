import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG_PATH = "data/catalog.json";
const TEMP_CATALOG_PATH = "data/catalog.json.tmp";
const ASSET_ROOT = "assets/products";

const SOURCES = [
  { key: "minkang", base: "https://minkang.x.yupoo.com", priority: 1, seedCategories: ["718623"] },
  { key: "yema007", base: "https://yema007.x.yupoo.com", priority: 2, seedCategories: [] },
  { key: "popmo", base: "https://popmo.x.yupoo.com", priority: 3, seedCategories: [] }
];

const MAX_INDEX_PAGES = numberSetting("SYNC_MAX_PAGES", 100);
const MAX_CATEGORY_PAGES = numberSetting("SYNC_CATEGORY_MAX_PAGES", 100);
const MAX_IMAGES = numberSetting("MAX_IMAGES_PER_ALBUM", 6);
const CONCURRENCY = numberSetting("SYNC_CONCURRENCY", 2);
const REQUEST_DELAY = Math.max(0, Number(process.env.SYNC_DELAY_MS || 250));
const BATCH_SIZE = numberSetting("SYNC_BATCH_SIZE", 25);
const REQUEST_TIMEOUT = numberSetting("SYNC_REQUEST_TIMEOUT_MS", 30000);
const SOURCE_FILTER = String(process.env.SYNC_SOURCE || "").trim().toLowerCase();
const limit = pLimit(CONCURRENCY);

const COUNTRY_TEAMS = [
  "Argentina", "Australia", "Austria", "Belgium", "Brazil", "Canada", "Chile", "China",
  "Colombia", "Croatia", "Denmark", "Ecuador", "England", "France", "Germany", "Ghana",
  "Italy", "Japan", "Mexico", "Morocco", "Netherlands", "Nigeria", "Norway", "Poland",
  "Portugal", "Saudi Arabia", "Scotland", "Senegal", "South Korea", "Spain", "Sweden",
  "Switzerland", "Turkey", "Tunisia", "Uruguay", "USA", "United States", "Wales"
];

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

const SHOE_BRANDS = ["Nike", "Adidas", "Puma", "New Balance", "Mizuno", "Under Armour"];
const SHOE_MODELS = [
  ["Nike", "Mercurial", ["mercurial", "vapor", "superfly"]],
  ["Nike", "Phantom", ["phantom", "gx", "luna"]],
  ["Nike", "Tiempo", ["tiempo", "legend"]],
  ["Adidas", "Predator", ["predator"]],
  ["Adidas", "F50", ["f50"]],
  ["Adidas", "Copa", ["copa"]],
  ["Adidas", "X", ["speedportal", "speedflow", "crazyfast", "adidas x"]],
  ["Puma", "Future", ["puma future", "future ultimate"]],
  ["Puma", "Ultra", ["puma ultra", "ultra ultimate"]],
  ["Puma", "King", ["puma king"]],
  ["Mizuno", "Morelia", ["morelia"]],
  ["Mizuno", "Alpha", ["mizuno alpha"]]
];

function numberSetting(name, fallback) {
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

function safeName(value) {
  const result = normalize(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
  return result || "product";
}

function fullSeasonYear(shortYear) {
  const year = Number(shortYear);
  if (!Number.isFinite(year)) return null;
  return year >= 50 ? 1900 + year : 2000 + year;
}

function normalizeSeason(firstValue, secondValue) {
  let first = String(firstValue).length === 2 ? fullSeasonYear(firstValue) : Number(firstValue);
  if (!Number.isFinite(first)) return "";
  let second;
  if (String(secondValue).length === 4) second = Number(secondValue);
  else {
    second = Math.floor(first / 100) * 100 + Number(secondValue);
    if (second < first) second += 100;
  }
  return Number.isFinite(second) ? `${first}-${second}` : "";
}

function detectSeason(...values) {
  const text = values.filter(Boolean).join(" ");
  let match = text.match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)\d{2})\b/);
  if (match) return normalizeSeason(match[1], match[2]);
  match = text.match(/\b((?:19|20)\d{2})\s*[\/_-]\s*(\d{2})\b/);
  if (match) return normalizeSeason(match[1], match[2]);
  match = text.match(/\b(\d{2})\s*[\/_-]\s*(\d{2})\b/);
  if (match) return normalizeSeason(match[1], match[2]);
  match = text.match(/\b((?:19|20)\d{2})\b/);
  if (match) return `${match[1]}-${Number(match[1]) + 1}`;
  return "Seizoen onbekend";
}

function includesAny(text, terms) {
  const n = normalize(text);
  return terms.some(term => n.includes(normalize(term)));
}

function findClub(text) {
  const n = normalize(text);
  const candidates = LEAGUES.flatMap(([country, competition, clubs]) => clubs.map(club => ({ country, competition, club })));
  candidates.sort((a, b) => b.club.length - a.club.length);
  return candidates.find(item => n.includes(normalize(item.club))) || null;
}

function findCountryTeam(text) {
  const n = normalize(text);
  return COUNTRY_TEAMS.find(country => n.includes(normalize(country))) || "";
}

function classifyProduct(album) {
  const text = [album.title, album.categoryTitle, album.collectionTitle].filter(Boolean).join(" ");
  const n = normalize(text);
  const season = detectSeason(text);
  const clubInfo = findClub(text);
  const countryTeam = findCountryTeam(text);

  const shoeWords = ["football boot", "football boots", "soccer shoes", "soccer boot", "cleats", "boots", "voetbalschoen", "voetbalschoenen", ...SHOE_BRANDS, ...SHOE_MODELS.flatMap(([, , words]) => words)];
  if (includesAny(text, shoeWords)) {
    const brand = SHOE_BRANDS.find(item => n.includes(normalize(item))) || "Overig merk";
    const modelEntry = SHOE_MODELS.find(([entryBrand, , words]) => brand === entryBrand && words.some(word => n.includes(normalize(word))));
    return { section: "Voetbalschoenen", category: brand, subcategory: modelEntry?.[1] || "Overig model", club: "", country: "", competition: "", season: "Seizoen onbekend", types: ["Voetbalschoenen"] };
  }

  const trainingWords = ["tracksuit", "track suit", "training suit", "training set", "training wear", "training", "pre match", "prematch", "windbreaker", "jacket", "hoodie", "pants", "shorts", "trainingspak", "trainingskleding"];
  if (includesAny(text, trainingWords)) {
    const club = clubInfo?.club || countryTeam || "Overig";
    const subcategory = clubInfo?.competition || (countryTeam ? "Landenteams" : "Overig");
    return { section: "Trainingskleding", category: "Teams", subcategory, club, country: clubInfo?.country || countryTeam, competition: clubInfo?.competition || "", season, types: ["Trainingskleding"] };
  }

  const footballWords = ["jersey", "shirt", "kit", "soccer", "football", "voetbalshirt", "player version", "fan version", "retro"];
  if (clubInfo || countryTeam || includesAny(text, footballWords)) {
    if (countryTeam && !clubInfo) {
      return { section: "Voetbal", category: "Landenteams", subcategory: countryTeam, club: countryTeam, country: countryTeam, competition: "Landenteams", season, types: ["Voetbalshirt"] };
    }
    return { section: "Voetbal", category: "Clubteams", subcategory: clubInfo?.competition || "Overige clubs", club: clubInfo?.club || "Overig", country: clubInfo?.country || "", competition: clubInfo?.competition || "", season, types: ["Voetbalshirt"] };
  }

  const other = [
    ["Tassen", ["bag", "backpack", "tassen", "tas"]],
    ["Horloges", ["watch", "horloge"]],
    ["Riemen", ["belt", "riem"]],
    ["Jassen", ["jacket", "coat", "jas"]]
  ].find(([, words]) => includesAny(text, words));
  return { section: "Overige producten", category: other?.[0] || "Overige producten", subcategory: album.categoryTitle || album.collectionTitle || "Overig", club: "", country: "", competition: "", season: "Seizoen onbekend", types: [other?.[0] || "Overig"] };
}

async function request(url, binary = false) {
  await sleep(REQUEST_DELAY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 FootballshirtsNL/1.0", accept: binary ? "image/avif,image/webp,image/*,*/*" : "text/html,application/xhtml+xml" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} voor ${url}`);
    return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
  } finally { clearTimeout(timer); }
}

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function readCatalog() {
  try {
    const parsed = JSON.parse(await fs.readFile(CATALOG_PATH, "utf8"));
    return Array.isArray(parsed.products) ? parsed : { ...parsed, products: Array.isArray(parsed.albums) ? parsed.albums : [] };
  } catch { return { lastSync: null, status: "new", products: [], warnings: [] }; }
}

async function writeCatalog(catalog) {
  await fs.mkdir(path.dirname(CATALOG_PATH), { recursive: true });
  const output = JSON.stringify(catalog, null, 2) + "\n";
  await fs.writeFile(TEMP_CATALOG_PATH, output, "utf8");
  await fs.rename(TEMP_CATALOG_PATH, CATALOG_PATH);
}

function extractCategoryLinks(html, source) {
  const $ = cheerio.load(html);
  const links = [];
  $("a[href*='/categories/']").each((_, element) => {
    const href = $(element).attr("href");
    const title = $(element).text().trim() || $(element).attr("title") || "";
    const url = absoluteUrl(source.base, href);
    if (url) links.push({ url: url.split("?")[0], title });
  });
  return unique(links.map(item => `${item.url}\t${item.title}`)).map(row => { const [url, title] = row.split("\t"); return { url, title }; });
}

function extractAlbumLinks(html, baseUrl, categoryTitle = "") {
  const $ = cheerio.load(html);
  const albums = [];
  $("a[href*='/albums/']").each((_, element) => {
    const href = $(element).attr("href");
    const url = absoluteUrl(baseUrl, href)?.split("?")[0];
    if (!url || !/\/albums\/\d+/.test(url)) return;
    const title = $(element).attr("title") || $(element).find("img").attr("alt") || $(element).text().trim();
    albums.push({ url, title: title || `Product ${url.match(/\/albums\/(\d+)/)?.[1] || ""}`, categoryTitle });
  });
  const map = new Map();
  for (const album of albums) if (!map.has(album.url)) map.set(album.url, album);
  return [...map.values()];
}

function nextPageUrl(html, baseUrl) {
  const $ = cheerio.load(html);
  const href = $("a[rel='next'], a.next, .pagination-next a").first().attr("href");
  return href ? absoluteUrl(baseUrl, href) : "";
}

async function discoverAlbums(source) {
  const categories = [];
  for (const id of source.seedCategories) categories.push({ url: `${source.base}/categories/${id}`, title: "" });
  try { categories.push(...extractCategoryLinks(await request(source.base), source)); } catch (error) { console.warn(`[${source.key}] Startpagina: ${error.message}`); }
  const categoryMap = new Map(categories.map(item => [item.url, item]));
  const albums = new Map();
  if (!categoryMap.size) {
    for (let page = 1; page <= MAX_INDEX_PAGES; page++) {
      const url = page === 1 ? `${source.base}/albums` : `${source.base}/albums?page=${page}`;
      try {
        const html = await request(url);
        const found = extractAlbumLinks(html, source.base);
        if (!found.length) break;
        found.forEach(album => albums.set(album.url, album));
      } catch (error) { console.warn(`[${source.key}] Index ${page}: ${error.message}`); break; }
    }
  }
  for (const category of categoryMap.values()) {
    let url = category.url;
    for (let page = 1; page <= MAX_CATEGORY_PAGES && url; page++) {
      try {
        const html = await request(url);
        const found = extractAlbumLinks(html, source.base, category.title);
        found.forEach(album => albums.set(album.url, album));
        const next = nextPageUrl(html, source.base);
        if (!next || next === url) break;
        url = next;
      } catch (error) { console.warn(`[${source.key}] Categorie ${category.url}: ${error.message}`); break; }
    }
  }
  console.log(`[${source.key}] ${albums.size} albums gevonden`);
  return [...albums.values()];
}

function extractAlbum(html, album, source) {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().trim() || $("meta[property='og:title']").attr("content") || album.title;
  const imageUrls = [];
  $("img").each((_, element) => {
    const values = [$(element).attr("data-origin-src"), $(element).attr("data-src"), $(element).attr("src")];
    for (const value of values) {
      const url = absoluteUrl(source.base, value);
      if (/photo\.yupoo\.com|\.jpe?g(?:\?|$)|\.png(?:\?|$)|\.webp(?:\?|$)/i.test(url)) imageUrls.push(url.replace(/\/(small|medium|thumb)\//i, "/large/"));
    }
  });
  $("meta[property='og:image']").each((_, element) => imageUrls.push(absoluteUrl(source.base, $(element).attr("content"))));
  return { title: String(title).replace(/\s+/g, " ").trim(), images: unique(imageUrls).slice(0, MAX_IMAGES) };
}

async function saveImage(url, file) {
  if (await fileExists(file)) return;
  const temp = `${file}.tmp`;
  const buffer = await request(url, true);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp(buffer).rotate().webp({ quality: 82 }).toFile(temp);
  await fs.rename(temp, file);
}

function productKey(source, albumUrl) {
  return `${source.key}:${albumUrl.match(/\/albums\/(\d+)/)?.[1] || safeName(albumUrl)}`;
}

async function processAlbum(source, album, previous) {
  const html = await request(album.url);
  const extracted = extractAlbum(html, album, source);
  const sourceId = album.url.match(/\/albums\/(\d+)/)?.[1] || safeName(album.url);
  const uniqueKey = productKey(source, album.url);
  const classification = classifyProduct({ ...album, title: extracted.title });
  const folder = path.join(ASSET_ROOT, source.key, sourceId);
  const publicImages = [];
  for (let index = 0; index < extracted.images.length; index++) {
    const name = `${String(index + 1).padStart(2, "0")}.webp`;
    const file = path.join(folder, name);
    try { await saveImage(extracted.images[index], file); } catch (error) { console.warn(`[${source.key}] ${sourceId} foto ${index + 1}: ${error.message}`); }
    if (await fileExists(file)) publicImages.push(`${folder.replaceAll(path.sep, "/")}/${name}`);
  }
  if (!publicImages.length && previous?.images?.length) publicImages.push(...previous.images);
  return {
    uniqueKey, source: source.key, sourceId, sourceUrl: album.url, sourceCategory: album.categoryTitle || "",
    title: extracted.title, ...classification, images: unique(publicImages), coverUrl: publicImages[0] || previous?.coverUrl || "",
    imageCount: unique(publicImages).length, updatedAt: new Date().toISOString()
  };
}

function sortProducts(a, b) {
  return [a.section, a.category, a.subcategory, a.club, a.season, a.title].join("|").localeCompare([b.section, b.category, b.subcategory, b.club, b.season, b.title].join("|"), "nl");
}

async function main() {
  const previousCatalog = await readCatalog();
  const productMap = new Map(previousCatalog.products.map(product => [product.uniqueKey || `${product.source}:${product.sourceId}`, product]));
  const warnings = [];
  const sources = SOURCES.filter(source => !SOURCE_FILTER || source.key === SOURCE_FILTER);
  if (!sources.length) throw new Error(`Onbekende SYNC_SOURCE: ${SOURCE_FILTER}`);
  let completed = 0;

  await writeCatalog({ ...previousCatalog, status: "running", startedAt: new Date().toISOString(), products: [...productMap.values()], warnings });

  for (const source of sources.sort((a, b) => a.priority - b.priority)) {
    const albums = await discoverAlbums(source);
    for (let offset = 0; offset < albums.length; offset += BATCH_SIZE) {
      const batch = albums.slice(offset, offset + BATCH_SIZE);
      const results = await Promise.all(batch.map(album => limit(async () => {
        const key = productKey(source, album.url);
        try { return await processAlbum(source, album, productMap.get(key)); }
        catch (error) { warnings.push(`[${source.key}] ${album.url}: ${error.message}`); console.error(warnings.at(-1)); return null; }
      })));
      for (const product of results.filter(Boolean)) productMap.set(product.uniqueKey, product);
      completed += batch.length;
      await writeCatalog({
        lastSync: new Date().toISOString(), status: "running", currentSource: source.key, processedAlbums: completed,
        products: [...productMap.values()].sort(sortProducts), warnings: warnings.slice(-200)
      });
      console.log(`[${source.key}] ${Math.min(offset + batch.length, albums.length)}/${albums.length} verwerkt; checkpoint opgeslagen`);
    }
  }

  await writeCatalog({
    lastSync: new Date().toISOString(), status: "completed", processedAlbums: completed,
    products: [...productMap.values()].sort(sortProducts), warnings: warnings.slice(-200)
  });
  console.log(`[Catalogus] ${productMap.size} producten opgeslagen in ${CATALOG_PATH}`);
}

main().catch(async error => {
  console.error("Synchronisatie mislukt:", error);
  try {
    const catalog = await readCatalog();
    await writeCatalog({ ...catalog, status: "failed", failedAt: new Date().toISOString(), warnings: [...(catalog.warnings || []), error.message].slice(-200) });
  } catch {}
  process.exitCode = 1;
});
