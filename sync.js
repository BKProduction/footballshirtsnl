import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG_PATH = "data/catalog.json";
const TEMP_CATALOG_PATH = "data/catalog.json.tmp";

const SOURCES = [
  { key: "minkang", base: "https://minkang.x.yupoo.com", imageHost: "photo.yupoo.com/minkang", priority: 1, seedCategories: ["718623"] },
  { key: "yema007", base: "https://yema007.x.yupoo.com", imageHost: "photo.yupoo.com/yema007", priority: 2, seedCategories: [] },
  { key: "popmo", base: "https://popmo.x.yupoo.com", imageHost: "photo.yupoo.com/popmo", priority: 3, seedCategories: [] }
];

const MAX_INDEX_PAGES = Math.max(1, Number(process.env.SYNC_MAX_PAGES || 100));
const MAX_CATEGORY_PAGES = Math.max(1, Number(process.env.SYNC_CATEGORY_MAX_PAGES || 100));
const MAX_COLLECTION_PAGES = Math.max(1, Number(process.env.SYNC_COLLECTION_MAX_PAGES || 100));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES_PER_ALBUM || 6));
const CONCURRENCY = Math.max(1, Number(process.env.SYNC_CONCURRENCY || 2));
const REQUEST_DELAY = Math.max(0, Number(process.env.SYNC_DELAY_MS || 180));
const BATCH_SIZE = Math.max(1, Number(process.env.SYNC_BATCH_SIZE || 25));
const limit = pLimit(CONCURRENCY);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const COUNTRY_TEAMS = [
  "Argentina", "Australia", "Austria", "Belgium", "Brazil", "Canada", "Chile", "China", "Colombia", "Croatia",
  "Denmark", "Ecuador", "England", "France", "Germany", "Ghana", "Italy", "Japan", "Mexico", "Morocco",
  "Netherlands", "Nigeria", "Norway", "Poland", "Portugal", "Saudi Arabia", "Scotland", "Senegal", "South Korea",
  "Spain", "Sweden", "Switzerland", "Turkey", "Tunisia", "Uruguay", "USA", "United States", "Wales"
];

const LEAGUES = [
  ["Engeland", "Premier League", ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham", "Leeds United", "Liverpool", "Manchester City", "Manchester United", "Newcastle United", "Nottingham Forest", "Sunderland", "Tottenham", "West Ham", "Wolverhampton", "Wolves"]],
  ["Spanje", "La Liga", ["Alavés", "Athletic Bilbao", "Atlético Madrid", "Barcelona", "Celta Vigo", "Elche", "Espanyol", "Getafe", "Girona", "Levante", "Mallorca", "Osasuna", "Rayo Vallecano", "Real Betis", "Real Madrid", "Real Oviedo", "Real Sociedad", "Sevilla", "Valencia", "Villarreal"]],
  ["Italië", "Serie A", ["AC Milan", "Atalanta", "Bologna", "Cagliari", "Como", "Cremonese", "Fiorentina", "Genoa", "Inter Milan", "Inter", "Juventus", "Lazio", "Lecce", "Napoli", "Parma", "Pisa", "Roma", "Sassuolo", "Torino", "Udinese", "Venezia", "Verona"]],
  ["Duitsland", "Bundesliga", ["Augsburg", "Bayer Leverkusen", "Bayern Munich", "Borussia Dortmund", "Borussia Mönchengladbach", "Eintracht Frankfurt", "FC Köln", "Freiburg", "Hamburg", "Heidenheim", "Hoffenheim", "Mainz", "RB Leipzig", "St. Pauli", "Stuttgart", "Union Berlin", "Werder Bremen", "Wolfsburg"]],
  ["Frankrijk", "Ligue 1", ["Auxerre", "Angers", "Brest", "Le Havre", "Lens", "Lille", "Lorient", "Lyon", "Marseille", "Metz", "Monaco", "Nantes", "Nice", "Paris FC", "PSG", "Rennes", "Strasbourg", "Toulouse"]],
  ["Nederland", "Eredivisie", ["Ajax", "AZ Alkmaar", "Excelsior", "Feyenoord", "Fortuna Sittard", "Go Ahead Eagles", "Groningen", "Heerenveen", "Heracles", "NAC Breda", "NEC", "PEC Zwolle", "PSV", "Sparta Rotterdam", "Telstar", "Twente", "Utrecht", "Volendam"]],
  ["Brazilië", "Brasileiro Série A", ["Atlético Mineiro", "Bahia", "Botafogo", "Bragantino", "Ceará", "Corinthians", "Cruzeiro", "Flamengo", "Fluminense", "Fortaleza", "Grêmio", "Gremio", "Internacional", "Juventude", "Mirassol", "Palmeiras", "Santos", "São Paulo", "Sport Recife", "Vasco da Gama", "Vitória"]],
  ["Portugal", "Primeira Liga", ["Benfica", "Boavista", "Braga", "Casa Pia", "Estoril", "Famalicão", "Farense", "Gil Vicente", "Moreirense", "Nacional", "Porto", "Rio Ave", "Santa Clara", "Sporting CP", "Vitória SC"]],
  ["Schotland", "Scottish Premiership", ["Aberdeen", "Celtic", "Dundee", "Dundee United", "Falkirk", "Hearts", "Hibernian", "Kilmarnock", "Livingston", "Motherwell", "Rangers", "St Mirren"]],
  ["Verenigde Staten", "MLS", ["Atlanta United", "Austin FC", "Charlotte FC", "Chicago Fire", "Columbus Crew", "DC United", "Inter Miami", "LA Galaxy", "Los Angeles FC", "Nashville SC", "New York City", "New York Red Bulls", "Orlando City", "Philadelphia Union", "Portland Timbers", "Seattle Sounders", "Toronto FC", "Vancouver Whitecaps"]]
].map(([country, competition, clubs]) => ({ country, competition, clubs }));

const CATEGORY_OVERRIDES = {
  "minkang:718623": { section: "Voetbal", category: "Clubteams", subcategory: "La Liga", country: "Spanje", competition: "La Liga", club: "Barcelona" }
};

const NON_PRODUCT = /whats?app|contact|call me|feedback|faq|shipping|service center|how to (place )?order|how to buy|como comprar|size chart|business|notice|existing customers|tik ?tok|video$/i;

function safeText(value, fallback = "") { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function normalize(value = "") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function absolute(source, url) { if (!url) return null; try { return url.startsWith("http") ? url : new URL(url, source.base).href; } catch { return null; } }
function albumId(url = "") { return url.match(/\/albums\/(\d+)/)?.[1] || null; }
function categoryId(url = "") { return url.match(/\/categories\/(\d+)/)?.[1] || null; }
function collectionId(url = "") { return url.match(/\/collections\/(\d+)/)?.[1] || url.match(/[?&]referrercate=(\d+)/)?.[1] || null; }
function startsWithName(title, name) { const t = normalize(title), n = normalize(name); return t === n || t.startsWith(`${n} `) || t.includes(` ${n} `); }

function productSeason(title = "") {
  const text = String(title);
  const split = text.match(/\b((?:19|20)?\d{2})\s*[\/-]\s*((?:19|20)?\d{2})\b/);
  if (split) {
    let start = split[1], end = split[2];
    if (start.length === 2) start = Number(start) >= 70 ? `19${start}` : `20${start}`;
    if (end.length === 4) end = end.slice(-2);
    return `${start}/${end}`;
  }
  return text.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || "Onbekend seizoen";
}

function productTypes(title) {
  const t = normalize(title), out = [];
  if (/\bretro\b/.test(t)) out.push("Retro");
  if (/\b(kids?|baby|youth)\b/.test(t)) out.push("Kids");
  if (/\b(women|womens|ladies)\b/.test(t)) out.push("Dames");
  if (/\btraining|pre match|tracksuit\b/.test(t)) out.push("Training");
  if (/\bgoalkeeper\b/.test(t)) out.push("Keepers");
  if (/\blong sleeve\b/.test(t)) out.push("Lange mouw");
  if (/\bplayer version\b/.test(t)) out.push("Player version");
  if (/\bspecial edition|commemorative|anniversary\b/.test(t)) out.push("Special edition");
  return out;
}

function clubFromTitle(title = "") {
  const cleaned = String(title).replace(/^\d+\s*/, "").trim();
  const position = cleaned.search(/\b(?:19|20)?\d{2}[\/-]\d{2}\b|\b\d{2}[\/-]\d{2}\b|\b202[0-9]\b/i);
  return position > 0 ? cleaned.slice(0, position).trim() : cleaned.split(/\s+/).slice(0, 3).join(" ") || "Overig";
}

function productClass(title, sourceCollection = "", sourceCategory = "", sourceKey = "", catId = null) {
  const override = CATEGORY_OVERRIDES[`${sourceKey}:${catId}`];
  if (override) return { ...override, season: productSeason(title), types: productTypes(title) };
  const all = normalize(`${title} ${sourceCollection} ${sourceCategory}`);
  const base = { country: "Overig", competition: "", club: "", season: productSeason(title), types: [] };
  if (/\b(handbag|shoulder bag|tote bag|crossbody|clutch|purse|wallet|backpack|rucksack|travel bag|duffle|duffel|bag)\b/.test(all)) return { ...base, section: "Mode & accessoires", category: "Tassen", subcategory: /backpack|rucksack/.test(all) ? "Rugzakken" : /travel|duff/.test(all) ? "Reistassen" : /wallet|purse/.test(all) ? "Portemonnees" : "Handtassen" };
  if (/\b(watch|watches|chronograph|timepiece)\b/.test(all)) return { ...base, section: "Mode & accessoires", category: "Horloges", subcategory: "Horloges" };
  if (/\b(belt|belts)\b/.test(all)) return { ...base, section: "Mode & accessoires", category: "Riemen", subcategory: "Riemen" };
  if (/\b(shoe|shoes|sneaker|sneakers|boots|sandals|slippers|cleats)\b/.test(all)) return { ...base, section: "Schoenen", category: "Schoenen", subcategory: /cleats|football boots/.test(all) ? "Voetbalschoenen" : /sandals|slippers/.test(all) ? "Sandalen & slippers" : "Sneakers" };
  const nationalTeam = COUNTRY_TEAMS.find(name => startsWithName(title, name));
  if (nationalTeam) return { section: "Voetbal", category: "Landenteams", subcategory: "WK & landenteams", country: nationalTeam, competition: "WK & landenteams", club: nationalTeam, season: productSeason(title), types: productTypes(title) };
  for (const league of LEAGUES) {
    const club = [...league.clubs].sort((a, b) => b.length - a.length).find(name => startsWithName(title, name));
    if (club) return { section: "Voetbal", category: "Clubteams", subcategory: league.competition, country: league.country, competition: league.competition, club, season: productSeason(title), types: productTypes(title) };
  }
  if (/\b(jersey|shirt|football|soccer|kit|uniform|training|windbreaker|tracksuit)\b/.test(all)) return { section: "Voetbal", category: "Overige voetbalproducten", subcategory: sourceCategory || sourceCollection || "Overig", country: "Overig", competition: sourceCategory || sourceCollection || "Overig", club: clubFromTitle(title), season: productSeason(title), types: productTypes(title) };
  return { ...base, section: "Overige producten", category: "Overige producten", subcategory: sourceCategory || sourceCollection || "Nog te categoriseren" };
}

function sanitizeProduct(product = {}) {
  const source = safeText(product.source, "minkang"), sourceId = safeText(product.sourceId, "onbekend");
  return { ...product, source, sourceId, uniqueKey: safeText(product.uniqueKey, `${source}:${sourceId}`), sourcePriority: Number.isFinite(Number(product.sourcePriority)) ? Number(product.sourcePriority) : 99, title: safeText(product.title, `${source}-${sourceId}`), section: safeText(product.section, "Overige producten"), category: safeText(product.category, "Overige producten"), subcategory: safeText(product.subcategory, "Nog te categoriseren"), country: safeText(product.country, "Overig"), competition: safeText(product.competition), club: safeText(product.club), season: safeText(product.season, productSeason(product.title)), types: Array.isArray(product.types) ? product.types : [], images: Array.isArray(product.images) ? product.images.filter(Boolean) : [], sourceImages: Array.isArray(product.sourceImages) ? product.sourceImages.filter(Boolean) : [] };
}

async function request(source, url, attempt = 1) {
  await sleep(REQUEST_DELAY);
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 FootballshirtsNL-MultiSourceSync/4.0", "accept-language": "nl-NL,nl;q=0.9,en;q=0.8", referer: `${source.base}/` } });
  if ((response.status === 429 || response.status >= 500) && attempt < 4) { await sleep(1000 * attempt); return request(source, url, attempt + 1); }
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}
async function html(source, url) { return (await request(source, url)).text(); }
async function loadPrevious() { try { return JSON.parse(await fs.readFile(CATALOG_PATH, "utf8")); } catch { return { products: [], albums: [] }; } }
function pageTitle($, fallback = "") { return safeText($("h1").first().text() || $("title").text().split("|")[0], fallback); }

function extractLinks($, source, context = {}) {
  const products = [];
  $('a[href*="/albums/"]').each((_, element) => {
    const href = $(element).attr("href"), id = albumId(href); if (!id) return;
    const card = $(element).closest("li,.album__main,.showindex__children,.album__item");
    const title = safeText($(element).attr("title") || card.find(".album__title,.showindex__children__title").text() || $(element).text());
    if (!title || NON_PRODUCT.test(title)) return;
    const cat = context.categoryId || categoryId(href), collection = context.collectionId || collectionId(href), sourceCollection = safeText(context.sourceCollection), sourceCategory = safeText(context.sourceCategory);
    products.push(sanitizeProduct({ source: source.key, sourcePriority: source.priority, sourceId: String(id), uniqueKey: `${source.key}:${id}`, title, sourceUrl: absolute(source, href), categoryId: cat, collectionId: collection, sourceCollection, sourceCategory, ...productClass(title, sourceCollection, sourceCategory, source.key, cat) }));
  });
  return [...new Map(products.map(p => [p.uniqueKey, p])).values()];
}

function extractNavigation($) {
  const categories = new Map(), collections = new Map();
  $('a[href*="/categories/"]').each((_, e) => { const id = categoryId($(e).attr("href")); if (id) categories.set(id, { id, name: safeText($(e).attr("title") || $(e).text()) }); });
  $('a[href*="/collections/"]').each((_, e) => { const id = collectionId($(e).attr("href")); if (id) collections.set(id, { id, name: safeText($(e).attr("title") || $(e).text()) }); });
  return { categories: [...categories.values()], collections: [...collections.values()] };
}

async function discoverSeeds(source) {
  const categories = new Map((source.seedCategories || []).map(id => [id, { id, name: "" }])), collections = new Map();
  for (const url of [`${source.base}/`, `${source.base}/albums`, `${source.base}/categories`]) {
    try { const nav = extractNavigation(cheerio.load(await html(source, url))); for (const item of nav.categories) categories.set(item.id, item); for (const item of nav.collections) collections.set(item.id, item); }
    catch (error) { console.error(`[${source.key}] navigatie ${url}: ${error.message}`); }
  }
  return { categories: [...categories.values()], collections: [...collections.values()] };
}

async function crawlPaged(source, urlFactory, maxPages, context) {
  const products = []; let emptyPages = 0;
  for (let page = 1; page <= maxPages; page++) {
    try {
      const $ = cheerio.load(await html(source, urlFactory(page))), name = pageTitle($, context.name || "");
      const found = extractLinks($, source, { ...context, sourceCategory: context.sourceCategory || name, sourceCollection: context.sourceCollection || name });
      products.push(...found); console.log(`[${source.key}] ${context.kind} ${context.id || "index"} pagina ${page}: ${found.length}`);
      emptyPages = found.length ? 0 : emptyPages + 1; if (emptyPages >= 2) break;
    } catch (error) { console.error(`[${source.key}] ${context.kind} ${context.id || "index"} pagina ${page}: ${error.message}`); break; }
  }
  return products;
}

async function discoverSource(source) {
  const found = [...await crawlPaged(source, page => `${source.base}/albums?page=${page}`, MAX_INDEX_PAGES, { kind: "index", name: "" })];
  const seeds = await discoverSeeds(source);
  for (const c of seeds.categories) found.push(...await crawlPaged(source, page => `${source.base}/categories/${c.id}?isSubCate=true&page=${page}`, MAX_CATEGORY_PAGES, { kind: "categorie", id: c.id, name: c.name, categoryId: c.id, sourceCategory: c.name }));
  for (const c of seeds.collections) found.push(...await crawlPaged(source, page => `${source.base}/collections/${c.id}?page=${page}`, MAX_COLLECTION_PAGES, { kind: "collectie", id: c.id, name: c.name, collectionId: c.id, sourceCollection: c.name }));
  return [...new Map(found.map(p => [p.uniqueKey, p])).values()];
}

function sourceImageUrls($, source) {
  const urls = [];
  $("img").each((_, e) => {
    const raw = $(e).attr("data-origin-src") || $(e).attr("data-src") || $(e).attr("data-lazy") || $(e).attr("src"), url = absolute(source, raw); if (!url) return;
    let parsed; try { parsed = new URL(url); } catch { return; }
    const host = parsed.host.toLowerCase(), pathname = parsed.pathname.toLowerCase();
    if (host !== "photo.yupoo.com" && !host.endsWith(".yupoo.com")) return;
    if (source.imageHost && !url.toLowerCase().includes(source.imageHost.toLowerCase())) return;
    if (/\/(square|small|thumb)[^/]*\.(jpg|jpeg|png|webp)$/.test(pathname)) return;
    urls.push(url);
  });
  return unique(urls).slice(0, MAX_IMAGES);
}

async function inspectProduct(product) {
  const source = SOURCES.find(item => item.key === product.source);
  return limit(async () => { const $ = cheerio.load(await html(source, product.sourceUrl)), title = pageTitle($, product.title); return sanitizeProduct({ ...product, title, ...productClass(title, product.sourceCollection, product.sourceCategory, product.source, product.categoryId), sourceImages: sourceImageUrls($, source) }); });
}
async function fileExists(file) { if (!file) return false; try { await fs.access(file.replace(/^\.\//, "")); return true; } catch { return false; } }
function imageLocation(product, index) { const directory = path.join("assets", "products", product.source, String(product.sourceId)), file = path.join(directory, `${String(index + 1).padStart(2, "0")}.webp`); return { directory, file, publicPath: `./${file.replaceAll(path.sep, "/")}` }; }

async function saveImage(product, url, index) {
  const loc = imageLocation(product, index); await fs.mkdir(loc.directory, { recursive: true }); if (await fileExists(loc.file)) return loc.publicPath;
  const source = SOURCES.find(item => item.key === product.source), buffer = Buffer.from(await (await request(source, url)).arrayBuffer()), tmp = `${loc.file}.tmp`;
  try { await sharp(buffer).rotate().resize({ width: index === 0 ? 700 : 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(tmp); await fs.rename(tmp, loc.file); console.log(`[${product.source}] Foto ${product.sourceId}/${index + 1} opgeslagen`); return loc.publicPath; }
  catch (error) { await fs.rm(tmp, { force: true }).catch(() => {}); throw error; }
}

async function downloadProduct(product, oldProduct = null) {
  const images = [];
  for (let i = 0; i < product.sourceImages.length; i++) {
    const loc = imageLocation(product, i), oldImage = oldProduct?.images?.[i];
    if (await fileExists(loc.file)) { images.push(loc.publicPath); continue; }
    if (oldImage && await fileExists(oldImage)) { images.push(oldImage); continue; }
    try { images.push(await saveImage(product, product.sourceImages[i], i)); } catch (error) { console.error(`[${product.source}] Foto ${product.sourceId}/${i + 1}: ${error.message}`); if (oldImage && await fileExists(oldImage)) images.push(oldImage); }
  }
  for (const oldImage of oldProduct?.images || []) { if (images.length >= MAX_IMAGES) break; if (!images.includes(oldImage) && await fileExists(oldImage)) images.push(oldImage); }
  const limited = images.slice(0, MAX_IMAGES);
  return sanitizeProduct({ ...product, coverUrl: limited[0] || oldProduct?.coverUrl || null, images: limited, imageCount: limited.length, updatedAt: new Date().toISOString() });
}

function duplicateKey(product) { return normalize([product.title, product.section, product.category, product.subcategory, product.club, product.season].join(" ")); }
function hasAllExpectedImages(current, old) { const expected = Math.min(current.sourceImages.length, MAX_IMAGES); return expected > 0 && (old?.images?.length || 0) >= expected; }

await fs.mkdir("data", { recursive: true });
await fs.mkdir("assets/products", { recursive: true });
const previous = await loadPrevious(), previousProducts = previous.products || previous.albums || [];
const productMap = new Map(previousProducts.map(raw => { const p = sanitizeProduct(raw); return [p.uniqueKey, p]; }));
const stats = { discovered: 0, added: 0, changed: 0, unchanged: 0, repaired: 0, skipped: 0, duplicatesRemoved: 0, batchesSaved: 0 };

async function writeCatalog(label, status = "in-progress") {
  const winners = new Map();
  for (const raw of productMap.values()) {
    const p = sanitizeProduct(raw); if (!p.images.length) continue; const key = duplicateKey(p), current = winners.get(key);
    if (!current || p.sourcePriority < current.sourcePriority) winners.set(key, p);
  }
  const products = [...winners.values()].sort((a, b) => String(a.section).localeCompare(String(b.section), "nl") || String(a.category).localeCompare(String(b.category), "nl") || String(a.subcategory).localeCompare(String(b.subcategory), "nl") || String(a.club).localeCompare(String(b.club), "nl") || String(a.season).localeCompare(String(b.season), "nl") || String(a.title).localeCompare(String(b.title), "nl"));
  stats.duplicatesRemoved = productMap.size - products.length;
  const output = {
    lastSync: new Date().toISOString(), syncState: { status, label, batchSize: BATCH_SIZE, maxImages: MAX_IMAGES }, stats: { ...stats },
    sources: SOURCES.map(({ key, base, priority }) => ({ key, base, priority })), total: products.length,
    sections: unique(products.map(p => safeText(p.section, "Overige producten"))).sort((a, b) => a.localeCompare(b, "nl")),
    categories: unique(products.map(p => safeText(p.category, "Overige producten"))).sort((a, b) => a.localeCompare(b, "nl")),
    competitions: unique(products.map(p => safeText(p.competition))).sort((a, b) => a.localeCompare(b, "nl")),
    seasons: unique(products.map(p => safeText(p.season, "Onbekend seizoen"))).sort((a, b) => b.localeCompare(a, "nl")), products
  };
  await fs.writeFile(TEMP_CATALOG_PATH, JSON.stringify(output, null, 2)); await fs.rename(TEMP_CATALOG_PATH, CATALOG_PATH); stats.batchesSaved++;
  console.log(`[batch] Catalogus opgeslagen: ${label}; ${products.length} producten`);
}

for (const source of SOURCES) {
  let discovered = [];
  try { discovered = await discoverSource(source); stats.discovered += discovered.length; console.log(`[${source.key}] totaal ontdekt: ${discovered.length}`); }
  catch (error) { console.error(`[${source.key}] bron overgeslagen: ${error.message}`); continue; }
  for (let start = 0; start < discovered.length; start += BATCH_SIZE) {
    const batch = discovered.slice(start, start + BATCH_SIZE);
    const inspected = await Promise.all(batch.map(async p => { try { return await inspectProduct(p); } catch (error) { console.error(`[${p.source}] Albumcontrole ${p.sourceId}: ${error.message}`); return { ...p, inspectionFailed: true }; } }));
    for (const item of inspected) {
      const old = productMap.get(item.uniqueKey); if (item.inspectionFailed) { stats.skipped++; continue; }
      const metadataChanged = Boolean(old) && ["title", "section", "category", "subcategory", "country", "competition", "club", "season", "sourceCollection", "sourceCategory", "categoryId", "collectionId"].some(key => old[key] !== item[key]);
      const complete = old ? hasAllExpectedImages(item, old) : false;
      if (old && complete && !metadataChanged) { productMap.set(item.uniqueKey, sanitizeProduct({ ...old, ...item, images: old.images, coverUrl: old.coverUrl || old.images?.[0] || null, imageCount: old.images?.length || 0, updatedAt: old.updatedAt })); stats.unchanged++; continue; }
      try { const imported = await downloadProduct(item, old); if (imported.images.length) { productMap.set(item.uniqueKey, imported); if (!old) stats.added++; else if (!complete) stats.repaired++; else stats.changed++; } else stats.skipped++; }
      catch (error) { console.error(`[${item.source}] Product ${item.sourceId}: ${error.message}`); stats.skipped++; }
    }
    await writeCatalog(`${source.key} ${Math.min(start + BATCH_SIZE, discovered.length)}/${discovered.length}`);
  }
}

await writeCatalog("voltooid", "completed");
console.log(`Klaar: nieuw ${stats.added}, gewijzigd ${stats.changed}, hersteld ${stats.repaired}, batches ${stats.batchesSaved}`);
