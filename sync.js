import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG_PATH = "data/catalog.json";
const STATE_PATH = "data/sync-state.json";
const DISCOVERY_DIR = "data/discovery";
const ASSET_ROOT = "assets/products";

const SOURCES = [
  { key: "minkang", base: "https://minkang.x.yupoo.com", priority: 1, seedCategories: ["718623"] },
  { key: "yema007", base: "https://yema007.x.yupoo.com", priority: 2, seedCategories: [] },
  { key: "popmo", base: "https://popmo.x.yupoo.com", priority: 3, seedCategories: [] },
  { key: "dachang88", base: "https://dachang88.x.yupoo.com", priority: 4, mode: "shoes", seedCategories: [] },
  { key: "dongshanstore", base: "https://dongshanstore.x.yupoo.com", priority: 5, mode: "training", seedCategories: [] },
  { key: "aosendi", base: "https://aosendi.x.yupoo.com", priority: 6, mode: "training", seedCategories: [] }
];

const MAX_INDEX_PAGES = setting("SYNC_MAX_PAGES", 100);
const MAX_CATEGORY_PAGES = setting("SYNC_CATEGORY_MAX_PAGES", 100);
const MAX_CATEGORIES_PER_SOURCE = setting("SYNC_MAX_CATEGORIES_PER_SOURCE", 500);
const MAX_DISCOVERY_MINUTES = setting("SYNC_MAX_DISCOVERY_MINUTES", 45);
const MAX_IMAGES = setting("MAX_IMAGES_PER_ALBUM", 6);
const CONCURRENCY = setting("SYNC_CONCURRENCY", 2);
const BATCH_SIZE = setting("SYNC_BATCH_SIZE", 25);
const REQUEST_TIMEOUT = setting("SYNC_REQUEST_TIMEOUT_MS", 45000);
const REQUEST_RETRIES = setting("SYNC_REQUEST_RETRIES", 2);
const REQUEST_DELAY = Math.max(0, Number(process.env.SYNC_DELAY_MS || 250));
const SOURCE_FILTER = String(process.env.SYNC_SOURCE || "").trim().toLowerCase();
const RESET_DISCOVERY = String(process.env.SYNC_RESET_DISCOVERY || "").trim().toLowerCase();
const limit = pLimit(CONCURRENCY);

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

const COUNTRY_TEAMS = [
  "Argentina", "Australia", "Austria", "Belgium", "Brazil", "Canada", "Chile", "China",
  "Colombia", "Croatia", "Denmark", "Ecuador", "England", "France", "Germany", "Ghana",
  "Italy", "Japan", "Mexico", "Morocco", "Netherlands", "Nigeria", "Norway", "Poland",
  "Portugal", "Saudi Arabia", "Scotland", "Senegal", "South Korea", "Spain", "Sweden",
  "Switzerland", "Turkey", "Tunisia", "Uruguay", "USA", "United States", "Wales"
];

const SHOE_BRANDS = ["Nike", "Adidas", "Puma", "New Balance", "Mizuno", "Under Armour", "Joma"];
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
  ["Mizuno", "Alpha", ["mizuno alpha"]],
  ["Joma", "Top Flex", ["top flex"]]
];

function setting(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function absoluteUrl(base, value) {
  if (!value) return "";
  try {
    return new URL(value, base).href;
  } catch {
    return "";
  }
}

function safeName(value) {
  return normalize(value).replace(/\s+/g, "-") || "product";
}

function includesAny(text, terms) {
  const normalized = normalize(text);
  return terms.some(term => normalized.includes(normalize(term)));
}

function detectSeason(text) {
  let match = String(text).match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/);
  if (!match) return "Seizoen onbekend";

  const first = Number(match[1]);
  let second = Number(match[2]);

  if (match[2].length === 2) {
    second = Math.floor(first / 100) * 100 + second;
    if (second < first) second += 100;
  }

  return `${first}-${second}`;
}

function findClub(text) {
  const normalized = normalize(text);
  return LEAGUES
    .flatMap(([country, competition, clubs]) => clubs.map(club => ({ country, competition, club })))
    .sort((a, b) => b.club.length - a.club.length)
    .find(item => normalized.includes(normalize(item.club))) || null;
}

function findCountryTeam(text) {
  const normalized = normalize(text);
  return COUNTRY_TEAMS.find(country => normalized.includes(normalize(country))) || "";
}

function classifyProduct(album, source) {
  const text = [album.title, album.categoryTitle, album.collectionTitle].filter(Boolean).join(" ");
  const normalized = normalize(text);
  const season = detectSeason(text);
  const clubInfo = findClub(text);
  const countryTeam = findCountryTeam(text);

  if (source.mode === "training") {
    if (clubInfo) {
      return { section: "Trainingskleding", category: "Clubteams", subcategory: clubInfo.competition, club: clubInfo.club, country: clubInfo.country, competition: clubInfo.competition, season, types: ["Trainingskleding"] };
    }
    if (countryTeam) {
      return { section: "Trainingskleding", category: "Landenteams", subcategory: countryTeam, club: countryTeam, country: countryTeam, competition: "Landenteams", season, types: ["Trainingskleding"] };
    }
    return { section: "Trainingskleding", category: "Overig", subcategory: album.categoryTitle || album.collectionTitle || "Overig", club: "Overig", country: "", competition: "", season, types: ["Trainingskleding"] };
  }

  const shoeWords = ["football boot", "football boots", "soccer shoe", "soccer shoes", "soccer boot", "soccer boots", "cleats", "voetbalschoen", "voetbalschoenen", ...SHOE_MODELS.flatMap(([, , words]) => words)];
  if (source.mode === "shoes" || includesAny(text, shoeWords)) {
    const brand = SHOE_BRANDS.find(item => normalized.includes(normalize(item))) || "Overig merk";
    const model = SHOE_MODELS.find(([entryBrand, , words]) => entryBrand === brand && words.some(word => normalized.includes(normalize(word))))?.[1] || "Overig model";
    return { section: "Voetbalschoenen", category: brand, subcategory: model, club: "", country: "", competition: "", season: "Seizoen onbekend", types: ["Voetbalschoenen"] };
  }

  const trainingWords = ["tracksuit", "track suit", "training suit", "training set", "training wear", "training", "pre match", "prematch", "windbreaker", "jacket", "hoodie", "pants", "shorts", "trainingspak", "trainingskleding"];
  if (includesAny(text, trainingWords)) {
    if (clubInfo) {
      return { section: "Trainingskleding", category: "Clubteams", subcategory: clubInfo.competition, club: clubInfo.club, country: clubInfo.country, competition: clubInfo.competition, season, types: ["Trainingskleding"] };
    }
    if (countryTeam) {
      return { section: "Trainingskleding", category: "Landenteams", subcategory: countryTeam, club: countryTeam, country: countryTeam, competition: "Landenteams", season, types: ["Trainingskleding"] };
    }
    return { section: "Trainingskleding", category: "Overig", subcategory: "Overig", club: "Overig", country: "", competition: "", season, types: ["Trainingskleding"] };
  }

  if (clubInfo) {
    return { section: "Voetbal", category: "Clubteams", subcategory: clubInfo.competition, club: clubInfo.club, country: clubInfo.country, competition: clubInfo.competition, season, types: ["Voetbalshirt"] };
  }

  if (countryTeam) {
    return { section: "Voetbal", category: "Landenteams", subcategory: countryTeam, club: countryTeam, country: countryTeam, competition: "Landenteams", season, types: ["Voetbalshirt"] };
  }

  const other = [
    ["Tassen", ["bag", "backpack", "tassen", "tas"]],
    ["Horloges", ["watch", "horloge"]],
    ["Riemen", ["belt", "riem"]],
    ["Jassen", ["jacket", "coat", "jas"]]
  ].find(([, words]) => includesAny(text, words));

  return { section: "Overige producten", category: other?.[0] || "Overige producten", subcategory: album.categoryTitle || album.collectionTitle || "Overig", club: "", country: "", competition: "", season: "Seizoen onbekend", types: [other?.[0] || "Overig"] };
}

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} voor ${url}`);
    this.status = status;
    this.url = url;
  }
}

async function request(url, binary = false, retries = REQUEST_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await sleep(REQUEST_DELAY);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 FootballshirtsNL/1.0",
          accept: binary ? "image/avif,image/webp,image/*,*/*" : "text/html,application/xhtml+xml"
        },
        signal: controller.signal
      });

      if (!response.ok) throw new HttpError(response.status, url);
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (error) {
      lastError = error;
      if (error?.status === 404 || attempt === retries) throw error;
      await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(temp, file);
}

function mergeAlbums(existing, incoming) {
  const map = new Map(existing.map(album => [album.url, album]));
  for (const album of incoming) {
    const previous = map.get(album.url) || {};
    map.set(album.url, { ...previous, ...album, categoryTitle: album.categoryTitle || previous.categoryTitle || "" });
  }
  return [...map.values()].sort((a, b) => a.url.localeCompare(b.url, "en", { numeric: true }));
}

function extractPage(html, source, inheritedTitle = "") {
  const $ = cheerio.load(html);
  const categories = new Map();
  const albums = new Map();

  $("a[href*='/categories/'], a[href*='/collections/']").each((_, element) => {
    const url = absoluteUrl(source.base, $(element).attr("href")).split("?")[0];
    if (!url) return;
    const title = $(element).attr("title") || $(element).text().trim() || inheritedTitle;
    categories.set(url, { url, title });
  });

  $("a[href*='/albums/']").each((_, element) => {
    const url = absoluteUrl(source.base, $(element).attr("href")).split("?")[0];
    if (!/\/albums\/\d+/.test(url)) return;
    const title = $(element).attr("title") || $(element).find("img").attr("alt") || $(element).text().trim() || `Product ${url.match(/\/albums\/(\d+)/)?.[1] || ""}`;
    albums.set(url, { url, title, categoryTitle: inheritedTitle });
  });

  const nextHref = $("a[rel='next'], a.next, .pagination-next a").first().attr("href");
  return {
    categories: [...categories.values()],
    albums: [...albums.values()],
    nextUrl: nextHref ? absoluteUrl(source.base, nextHref) : ""
  };
}

function discoveryFile(source) {
  return path.join(DISCOVERY_DIR, `${source.key}.json`);
}

function defaultDiscovery(source) {
  return {
    version: 2,
    source: source.key,
    phase: "index",
    indexPage: 1,
    categories: (source.seedCategories || []).map(id => ({ url: `${source.base}/categories/${id}`, title: "" })),
    categoryIndex: 0,
    categoryPage: 1,
    albums: [],
    complete: false,
    updatedAt: new Date().toISOString()
  };
}

async function saveDiscovery(source, discovery, state) {
  discovery.updatedAt = new Date().toISOString();
  await writeJsonAtomic(discoveryFile(source), discovery);
  state.sources[source.key] = {
    ...(state.sources[source.key] || {}),
    discoveryPhase: discovery.phase,
    discoveryComplete: discovery.complete,
    discoveredAlbums: discovery.albums.length,
    categoryIndex: discovery.categoryIndex,
    categoryTotal: discovery.categories.length,
    updatedAt: discovery.updatedAt
  };
  await writeJsonAtomic(STATE_PATH, state);
}

async function discoverAlbums(source, state) {
  let discovery = await readJson(discoveryFile(source), defaultDiscovery(source));

  if (RESET_DISCOVERY === source.key || RESET_DISCOVERY === "all") {
    discovery = defaultDiscovery(source);
    await saveDiscovery(source, discovery, state);
  }

  if (discovery.complete) {
    console.log(`[${source.key}] ontdekking reeds voltooid: ${discovery.albums.length} albums uit cache`);
    return discovery.albums;
  }

  const startedAt = Date.now();
  const deadline = startedAt + MAX_DISCOVERY_MINUTES * 60 * 1000;
  console.log(`[${source.key}] ontdekking hervat: fase=${discovery.phase}, categorie=${discovery.categoryIndex}/${discovery.categories.length}, albums=${discovery.albums.length}`);

  if (discovery.phase === "index") {
    while (discovery.indexPage <= MAX_INDEX_PAGES) {
      if (Date.now() >= deadline) {
        await saveDiscovery(source, discovery, state);
        console.log(`[${source.key}] ontdekkingslimiet bereikt; indexpagina ${discovery.indexPage} opgeslagen`);
        return null;
      }

      const url = discovery.indexPage === 1 ? `${source.base}/albums` : `${source.base}/albums?page=${discovery.indexPage}`;
      console.log(`[${source.key}] ontdekking indexpagina ${discovery.indexPage}/${MAX_INDEX_PAGES}`);

      try {
        const page = extractPage(await request(url), source);
        discovery.albums = mergeAlbums(discovery.albums, page.albums);
        const categoryMap = new Map(discovery.categories.map(item => [item.url, item]));
        for (const category of page.categories.slice(0, MAX_CATEGORIES_PER_SOURCE)) categoryMap.set(category.url, category);
        discovery.categories = [...categoryMap.values()].slice(0, MAX_CATEGORIES_PER_SOURCE);
        discovery.indexPage += 1;
        await saveDiscovery(source, discovery, state);

        if (!page.albums.length && !page.categories.length) break;
        if (!page.nextUrl && discovery.indexPage > 2) break;
      } catch (error) {
        console.warn(`[${source.key}] indexpagina ${discovery.indexPage} overgeslagen: ${error.message}`);
        discovery.indexPage += 1;
        await saveDiscovery(source, discovery, state);
        if (error?.status === 404) break;
      }
    }

    discovery.phase = "categories";
    discovery.categoryIndex = Number(discovery.categoryIndex || 0);
    discovery.categoryPage = Number(discovery.categoryPage || 1);
    await saveDiscovery(source, discovery, state);
  }

  while (discovery.phase === "categories" && discovery.categoryIndex < discovery.categories.length) {
    if (Date.now() >= deadline) {
      await saveDiscovery(source, discovery, state);
      console.log(`[${source.key}] ontdekkingslimiet bereikt; categorie ${discovery.categoryIndex}/${discovery.categories.length}, pagina ${discovery.categoryPage} opgeslagen`);
      return null;
    }

    const category = discovery.categories[discovery.categoryIndex];
    console.log(`[${source.key}] ontdekking categorie ${discovery.categoryIndex + 1}/${discovery.categories.length}, pagina ${discovery.categoryPage}/${MAX_CATEGORY_PAGES}: ${category.title || category.url}`);

    if (discovery.categoryPage > MAX_CATEGORY_PAGES) {
      discovery.categoryIndex += 1;
      discovery.categoryPage = 1;
      await saveDiscovery(source, discovery, state);
      continue;
    }

    const separator = category.url.includes("?") ? "&" : "?";
    const url = discovery.categoryPage === 1 ? category.url : `${category.url}${separator}page=${discovery.categoryPage}`;

    try {
      const page = extractPage(await request(url), source, category.title);
      discovery.albums = mergeAlbums(discovery.albums, page.albums);
      discovery.categoryPage += 1;
      await saveDiscovery(source, discovery, state);

      if (!page.albums.length || !page.nextUrl) {
        discovery.categoryIndex += 1;
        discovery.categoryPage = 1;
        await saveDiscovery(source, discovery, state);
      }
    } catch (error) {
      console.warn(`[${source.key}] categoriepagina overgeslagen: ${error.message}`);
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
  const imageUrls = [];

  $("img").each((_, element) => {
    const values = [$(element).attr("data-origin-src"), $(element).attr("data-src"), $(element).attr("src")];
    for (const value of values) {
      const url = absoluteUrl(source.base, value);
      if (/photo\.yupoo\.com|\.jpe?g(?:\?|$)|\.png(?:\?|$)|\.webp(?:\?|$)/i.test(url)) {
        imageUrls.push(url.replace(/\/(small|medium|thumb)\//i, "/large/"));
      }
    }
  });

  $("meta[property='og:image']").each((_, element) => {
    imageUrls.push(absoluteUrl(source.base, $(element).attr("content")));
  });

  return {
    title: String(title).replace(/\s+/g, " ").trim(),
    images: unique(imageUrls).slice(0, MAX_IMAGES)
  };
}

async function saveImage(url, file) {
  if (await fileExists(file)) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await sharp(await request(url, true)).rotate().webp({ quality: 82 }).toFile(temp);
  await fs.rename(temp, file);
}

function productKey(source, albumUrl) {
  return `${source.key}:${albumUrl.match(/\/albums\/(\d+)/)?.[1] || safeName(albumUrl)}`;
}

async function processAlbum(source, album, previous) {
  const extracted = extractAlbum(await request(album.url), album, source);
  const sourceId = album.url.match(/\/albums\/(\d+)/)?.[1] || safeName(album.url);
  const folder = path.join(ASSET_ROOT, source.key, sourceId);
  const publicImages = [];

  for (let index = 0; index < extracted.images.length; index++) {
    const name = `${String(index + 1).padStart(2, "0")}.webp`;
    const file = path.join(folder, name);
    try {
      await saveImage(extracted.images[index], file);
    } catch (error) {
      console.warn(`[${source.key}] ${sourceId} foto ${index + 1}: ${error.message}`);
    }
    if (await fileExists(file)) publicImages.push(`${folder.replaceAll(path.sep, "/")}/${name}`);
  }

  if (!publicImages.length && previous?.images?.length) publicImages.push(...previous.images);

  return {
    uniqueKey: productKey(source, album.url),
    source: source.key,
    sourceId,
    sourceUrl: album.url,
    sourceCategory: album.categoryTitle || "",
    title: extracted.title,
    ...classifyProduct({ ...album, title: extracted.title }, source),
    images: unique(publicImages),
    coverUrl: publicImages[0] || previous?.coverUrl || "",
    imageCount: unique(publicImages).length,
    updatedAt: new Date().toISOString()
  };
}

function sortProducts(a, b) {
  return [a.section, a.category, a.subcategory, a.club, a.season, a.title]
    .join("|")
    .localeCompare([b.section, b.category, b.subcategory, b.club, b.season, b.title].join("|"), "nl");
}

async function saveCatalog(productMap, warnings, status, sourceKey = "") {
  await writeJsonAtomic(CATALOG_PATH, {
    lastSync: new Date().toISOString(),
    status,
    currentSource: sourceKey || undefined,
    products: [...productMap.values()].sort(sortProducts),
    warnings: warnings.slice(-200)
  });
}

async function main() {
  const catalog = await readJson(CATALOG_PATH, { products: [], warnings: [] });
  const existingProducts = Array.isArray(catalog.products) ? catalog.products : Array.isArray(catalog.albums) ? catalog.albums : [];
  const productMap = new Map(existingProducts.map(product => [product.uniqueKey || `${product.source}:${product.sourceId}`, product]));
  const state = await readJson(STATE_PATH, { version: 2, sources: {} });
  state.version = 2;
  state.sources ||= {};

  const warnings = [];
  const sources = SOURCES
    .filter(source => !SOURCE_FILTER || source.key === SOURCE_FILTER)
    .sort((a, b) => a.priority - b.priority);

  if (!sources.length) throw new Error(`Onbekende SYNC_SOURCE: ${SOURCE_FILTER}`);

  for (const source of sources) {
    const sourceState = state.sources[source.key] || {};

    if (sourceState.completed === true) {
      console.log(`[${source.key}] reeds voltooid; bron volledig overgeslagen`);
      continue;
    }

    console.log(`\n[${source.key}] bron gestart`);
    const albums = await discoverAlbums(source, state);

    if (!albums) {
      console.log(`[${source.key}] ontdekking gepauzeerd en opgeslagen; volgende run hervat deze bron`);
      await saveCatalog(productMap, warnings, "paused", source.key);
      return;
    }

    const refreshedState = state.sources[source.key] || {};
    const startIndex = Math.min(Number(refreshedState.nextIndex || 0), albums.length);
    console.log(`[${source.key}] ${albums.length} albums; verwerking hervat bij ${startIndex}/${albums.length}`);

    for (let offset = startIndex; offset < albums.length; offset += BATCH_SIZE) {
      const batch = albums.slice(offset, offset + BATCH_SIZE);
      const results = await Promise.all(batch.map(album => limit(async () => {
        const key = productKey(source, album.url);
        try {
          return await processAlbum(source, album, productMap.get(key));
        } catch (error) {
          if (error?.status === 404) {
            console.warn(`[${source.key}] niet bereikbaar en overgeslagen: ${album.url}`);
            return null;
          }
          const message = `[${source.key}] ${album.url}: ${error.message}`;
          warnings.push(message);
          console.warn(message);
          return null;
        }
      })));

      for (const product of results.filter(Boolean)) productMap.set(product.uniqueKey, product);

      state.sources[source.key] = {
        ...(state.sources[source.key] || {}),
        discoveryComplete: true,
        nextIndex: offset + batch.length,
        total: albums.length,
        completed: offset + batch.length >= albums.length,
        updatedAt: new Date().toISOString()
      };

      await saveCatalog(productMap, warnings, "running", source.key);
      await writeJsonAtomic(STATE_PATH, state);
      console.log(`[${source.key}] ${offset + batch.length}/${albums.length}; hervatpunt opgeslagen`);
    }

    state.sources[source.key] = {
      ...(state.sources[source.key] || {}),
      nextIndex: albums.length,
      total: albums.length,
      completed: true,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await writeJsonAtomic(STATE_PATH, state);
    console.log(`[${source.key}] bron volledig voltooid`);
  }

  state.completedAt = new Date().toISOString();
  await writeJsonAtomic(STATE_PATH, state);
  await saveCatalog(productMap, warnings, "completed");
  console.log(`[Catalogus] ${productMap.size} producten opgeslagen; alle bronnen voltooid.`);
}

main().catch(async error => {
  console.error("Synchronisatie mislukt:", error);
  const catalog = await readJson(CATALOG_PATH, { products: [], warnings: [] });
  await writeJsonAtomic(CATALOG_PATH, {
    ...catalog,
    status: "failed",
    failedAt: new Date().toISOString(),
    warnings: [...(catalog.warnings || []), error.message].slice(-200)
  });
  process.exitCode = 1;
});
