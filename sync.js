import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const base = (process.env.SOURCE_BASE || "https://minkang.x.yupoo.com").replace(/\/$/, "");
const pages = Number(process.env.SYNC_MAX_PAGES || 66);
const maxImages = Number(process.env.MAX_IMAGES_PER_ALBUM || 12);
const concurrency = Number(process.env.SYNC_CONCURRENCY || 3);
const limit = pLimit(Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const COUNTRY_TEAMS = [
  "Argentina", "Australia", "Austria", "Belgium", "Brazil", "Canada", "Chile", "China", "Colombia", "Croatia", "Denmark", "Ecuador", "England", "France", "Germany", "Ghana", "Italy", "Japan", "Mexico", "Morocco", "Netherlands", "Nigeria", "Norway", "Poland", "Portugal", "Saudi Arabia", "Scotland", "Senegal", "South Korea", "Spain", "Sweden", "Switzerland", "Uruguay", "USA", "United States", "Wales"
];

const LEAGUES = [
  { country: "Engeland", competition: "Premier League", clubs: ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham", "Leeds United", "Liverpool", "Manchester City", "Manchester United", "M-U", "Newcastle United", "Nottingham Forest", "Sunderland", "Tottenham", "West Ham", "Wolverhampton", "Wolves"] },
  { country: "Spanje", competition: "La Liga", clubs: ["Alavés", "Athletic Bilbao", "Atlético Madrid", "Barcelona", "Celta Vigo", "Elche", "Espanyol", "Getafe", "Girona", "Levante", "Mallorca", "Osasuna", "Rayo Vallecano", "Real Betis", "Real Madrid", "Real Oviedo", "Real Sociedad", "Sevilla", "Valencia", "Villarreal"] },
  { country: "Italië", competition: "Serie A", clubs: ["AC Milan", "Atalanta", "Bologna", "Cagliari", "Como", "Cremonese", "Fiorentina", "Genoa", "Inter Milan", "Inter", "Juventus", "Lazio", "Lecce", "Napoli", "Parma", "Pisa", "Roma", "Sassuolo", "Torino", "Udinese", "Verona"] },
  { country: "Duitsland", competition: "Bundesliga", clubs: ["Augsburg", "Bayer Leverkusen", "Bayern Munich", "Borussia Dortmund", "Borussia Mönchengladbach", "Eintracht Frankfurt", "FC Köln", "Freiburg", "Hamburg", "Heidenheim", "Hoffenheim", "Mainz", "RB Leipzig", "St. Pauli", "Stuttgart", "Union Berlin", "Werder Bremen", "Wolfsburg"] },
  { country: "Frankrijk", competition: "Ligue 1", clubs: ["Auxerre", "Angers", "Brest", "Le Havre", "Lens", "Lille", "Lorient", "Lyon", "Marseille", "Metz", "Monaco", "Nantes", "Nice", "Paris FC", "PSG", "Rennes", "Strasbourg", "Toulouse"] },
  { country: "Nederland", competition: "Eredivisie", clubs: ["Ajax", "AZ Alkmaar", "Excelsior", "Feyenoord", "Fortuna Sittard", "Go Ahead Eagles", "Groningen", "Heerenveen", "Heracles", "NAC Breda", "NEC", "PEC Zwolle", "PSV", "Sparta Rotterdam", "Telstar", "Twente", "Utrecht", "Volendam"] },
  { country: "Brazilië", competition: "Brasileiro Série A", clubs: ["Atlético Mineiro", "Bahia", "Botafogo", "Bragantino", "Ceará", "Corinthians", "Cruzeiro", "Flamengo", "Fluminense", "Fortaleza", "Grêmio", "Gremio", "Internacional", "Juventude", "Mirassol", "Palmeiras", "Santos", "São Paulo", "Sport Recife", "Vasco da Gama", "Vitória"] },
  { country: "Portugal", competition: "Primeira Liga", clubs: ["Benfica", "Boavista", "Braga", "Casa Pia", "Estoril", "Famalicão", "Farense", "Gil Vicente", "Moreirense", "Nacional", "Porto", "Rio Ave", "Santa Clara", "Sporting CP", "Vitória SC"] },
  { country: "Schotland", competition: "Scottish Premiership", clubs: ["Aberdeen", "Celtic", "Dundee", "Dundee United", "Falkirk", "Hearts", "Hibernian", "Kilmarnock", "Livingston", "Motherwell", "Rangers", "St Mirren"] },
  { country: "Verenigde Staten", competition: "MLS", clubs: ["Atlanta United", "Austin FC", "Charlotte FC", "Chicago Fire", "Columbus Crew", "DC United", "Inter Miami", "LA Galaxy", "Los Angeles FC", "Miami", "Nashville SC", "New York City", "New York Red Bulls", "Orlando City", "Philadelphia Union", "Portland Timbers", "Seattle Sounders", "Toronto FC", "Vancouver Whitecaps"] }
];

function normalize(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function startsWithName(title, name) {
  const t = normalize(title);
  const n = normalize(name);
  return t === n || t.startsWith(`${n} `);
}

function productType(title) {
  const t = normalize(title);
  const types = [];
  if (/\bretro\b/.test(t)) types.push("Retro");
  if (/\b(kids?|baby)\b/.test(t)) types.push("Kids");
  if (/\b(women|womens|ladies)\b/.test(t)) types.push("Dames");
  if (/\btraining\b|\beqt\b/.test(t)) types.push("Training");
  if (/\bgoalkeeper\b/.test(t)) types.push("Keepers");
  if (/\blong sleeve\b/.test(t)) types.push("Lange mouw");
  if (/\bplayer version\b/.test(t)) types.push("Player version");
  if (/\bspecial edition\b|\bcommemorative\b|\banniversary\b/.test(t)) types.push("Special edition");
  return types;
}

function clubFromTitle(title = "") {
  const cleaned = title.replace(/^\d+\s*/, "").trim();
  const season = cleaned.search(/\b(?:19|20)?\d{2}[/-]\d{2}\b|\b\d{2}[/-]\d{2}\b|\b2026\b/i);
  return season > 0 ? cleaned.slice(0, season).trim() : cleaned.split(/\s+/).slice(0, 2).join(" ") || "Overig";
}

function classify(title, sourceCollection = "") {
  const notice = /new notice|large stock|existing customers|contact customer/i.test(sourceCollection);
  const countryTeam = COUNTRY_TEAMS.find(name => startsWithName(title, name));
  if (countryTeam) return { section: "Landenteams", country: countryTeam, competition: "WK & landenteams", club: countryTeam, types: productType(title) };

  for (const league of LEAGUES) {
    const club = [...league.clubs].sort((a, b) => b.length - a.length).find(name => startsWithName(title, name));
    if (club) return { section: "Clubteams", country: league.country, competition: league.competition, club, types: productType(title) };
  }

  const cleanCollection = notice || !sourceCollection || sourceCollection === "Overige collectie" ? "" : sourceCollection.trim();
  if (/fifa world cup|national team|euro 20/i.test(cleanCollection)) {
    return { section: "Landenteams", country: countryTeam || "Overige landen", competition: "WK & landenteams", club: countryTeam || clubFromTitle(title), types: productType(title) };
  }
  if (cleanCollection && !/^new season$/i.test(cleanCollection)) {
    return { section: "Overige competities", country: "Overig", competition: cleanCollection, club: clubFromTitle(title), types: productType(title) };
  }
  return { section: "Nog te categoriseren", country: "Overig", competition: "Nog te categoriseren", club: clubFromTitle(title), types: productType(title) };
}

async function request(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 FootballshirtsNL-CatalogSync/5.0",
      "accept-language": "nl-NL,nl;q=0.9,en;q=0.8",
      referer: `${base}/`
    }
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    await sleep(1000 * attempt);
    return request(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

const html = async url => (await request(url)).text();
const absolute = url => !url ? null : url.startsWith("http") ? url : new URL(url, base).href;
const collectionId = (url = "") => url.match(/\/collections\/(\d+)/)?.[1] || url.match(/[?&]referrercate=(\d+)/)?.[1] || null;

async function loadPrevious() {
  try {
    return JSON.parse(await fs.readFile("data/catalog.json", "utf8"));
  } catch {
    return { albums: [] };
  }
}

async function getCollections() {
  const $ = cheerio.load(await html(`${base}/albums`));
  const map = new Map();
  $('a[href*="/collections/"]').each((_, el) => {
    const href = $(el).attr("href");
    const id = collectionId(href);
    const name = $(el).clone().children().remove().end().text().replace(/\s+/g, " ").trim();
    if (id && name && !/^\d+\s*(个)?$/.test(name)) map.set(id, name);
  });
  return map;
}

async function indexPage(page, collections) {
  await sleep(200);
  const $ = cheerio.load(await html(`${base}/albums?page=${page}`));
  const found = [];

  $('a[href*="/albums/"]').each((_, el) => {
    const href = $(el).attr("href");
    const id = href?.match(/\/albums\/(\d+)/)?.[1];
    if (!id) return;

    const card = $(el).closest("li,.album__main,.showindex__children,.album__item");
    const title = ($(el).attr("title") || card.find(".album__title,.showindex__children__title").text() || $(el).text()).replace(/\s+/g, " ").trim();
    if (!title) return;

    const cid = collectionId(href);
    const sourceCollection = collections.get(cid) || "";
    found.push({ sourceId: id, title, sourceUrl: absolute(href), collectionId: cid, sourceCollection, ...classify(title, sourceCollection) });
  });

  return [...new Map(found.map(album => [album.sourceId, album])).values()];
}

function imageCandidate($, el) {
  const raw = $(el).attr("data-origin-src") || $(el).attr("data-src") || $(el).attr("data-lazy") || $(el).attr("src");
  const url = absolute(raw);
  if (!url) return null;
  if (!/^https:\/\/photo\.yupoo\.com\/minkang\//i.test(url)) return null;
  if (/\/(?:square|small|thumb)[^/]*\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(url)) return null;
  return url;
}

function productImages($) {
  const urls = [];
  $("img").each((_, el) => {
    const url = imageCandidate($, el);
    if (url) urls.push(url);
  });
  return [...new Set(urls)].slice(0, maxImages);
}

async function localImagesExist(album) {
  if (!album?.images?.length) return false;
  const checks = await Promise.all(album.images.map(async image => {
    try {
      await fs.access(image.replace(/^\.\//, ""));
      return true;
    } catch {
      return false;
    }
  }));
  return checks.every(Boolean);
}

async function saveImage(url, id, index) {
  const dir = path.join("assets", "albums", String(id));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${String(index + 1).padStart(2, "0")}.webp`);
  const buffer = Buffer.from(await (await request(url)).arrayBuffer());
  await sharp(buffer)
    .rotate()
    .resize({ width: index === 0 ? 700 : 1200, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(file);
  return `./${file.replaceAll(path.sep, "/")}`;
}

async function inspectAlbum(album) {
  return limit(async () => {
    await sleep(250);
    const $ = cheerio.load(await html(album.sourceUrl));
    const title = ($("h1").first().text() || $("title").text().split("|")[0] || album.title).replace(/\s+/g, " ").trim();
    const sourceImages = productImages($);
    return { ...album, title, ...classify(title, album.sourceCollection), sourceImages };
  });
}

async function downloadAlbum(inspected) {
  const images = [];
  for (const [index, url] of inspected.sourceImages.entries()) {
    try {
      images.push(await saveImage(url, inspected.sourceId, index));
    } catch (error) {
      console.error(`Foto ${inspected.sourceId}/${index + 1}: ${error.message}`);
    }
  }

  return {
    ...inspected,
    coverUrl: images[0] || null,
    images,
    imageCount: images.length,
    updatedAt: new Date().toISOString()
  };
}

function sameArray(a = [], b = []) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

await fs.mkdir("data", { recursive: true });
await fs.mkdir("assets/albums", { recursive: true });

const previous = await loadPrevious();
const previousById = new Map((previous.albums || []).map(album => [String(album.sourceId), album]));
const collections = await getCollections();
const discovered = [];

let emptyPagesInARow = 0;
for (let page = 1; page <= pages; page++) {
  try {
    const pageAlbums = await indexPage(page, collections);
    discovered.push(...pageAlbums);
    emptyPagesInARow = pageAlbums.length ? 0 : emptyPagesInARow + 1;
    console.log(`Index ${page}/${pages}: ${pageAlbums.length} albums`);
    if (emptyPagesInARow >= 3) {
      console.log("Drie lege pagina's achter elkaar; indexeren gestopt.");
      break;
    }
  } catch (error) {
    console.error(`Index ${page}: ${error.message}`);
  }
}

const current = [...new Map(discovered.map(album => [String(album.sourceId), album])).values()];
const inspectedResults = await Promise.all(current.map(async item => {
  try {
    return await inspectAlbum(item);
  } catch (error) {
    console.error(`Albumcontrole ${item.sourceId}: ${error.message}`);
    return { ...item, sourceImages: null, inspectionFailed: true };
  }
}));

const albums = [];
let added = 0;
let changed = 0;
let unchanged = 0;
let repaired = 0;
let skipped = 0;

for (const item of inspectedResults) {
  const old = previousById.get(String(item.sourceId));
  const assetsOkay = old ? await localImagesExist(old) : false;
  const metadata = { ...old, ...item };
  delete metadata.inspectionFailed;

  if (item.inspectionFailed) {
    if (old && assetsOkay) {
      albums.push(old);
      skipped++;
    }
    continue;
  }

  const metadataChanged = Boolean(old) && ["title", "section", "country", "competition", "club", "sourceCollection"].some(key => old[key] !== metadata[key]);
  const remoteImagesChanged = !old || !Array.isArray(old.sourceImages) || !sameArray(old.sourceImages, item.sourceImages);
  const needsDownload = !old || !assetsOkay || remoteImagesChanged;

  if (!needsDownload) {
    const kept = {
      ...old,
      ...item,
      images: old.images,
      coverUrl: old.coverUrl || old.images?.[0] || null,
      imageCount: old.images?.length || 0,
      updatedAt: old.updatedAt
    };
    albums.push(kept);
    metadataChanged ? changed++ : unchanged++;
    continue;
  }

  try {
    const imported = await downloadAlbum(item);
    if (imported.images.length) {
      albums.push(imported);
      if (!old) added++;
      else if (!assetsOkay) repaired++;
      else changed++;
    } else if (old && assetsOkay) {
      albums.push(old);
      skipped++;
    }
  } catch (error) {
    console.error(`Album ${item.sourceId}: ${error.message}`);
    if (old && assetsOkay) {
      albums.push(old);
      skipped++;
    }
  }
}

const cleanAlbums = albums
  .filter(album => album.images?.length)
  .sort((a, b) => String(b.sourceId).localeCompare(String(a.sourceId), undefined, { numeric: true }));

const competitions = [...new Set(cleanAlbums.map(album => album.competition))].sort((a, b) => a.localeCompare(b, "nl"));
const stable = { source: base, total: cleanAlbums.length, competitions, albums: cleanAlbums };
const oldStable = { source: previous.source, total: previous.total, competitions: previous.competitions, albums: previous.albums };

if (JSON.stringify(stable) !== JSON.stringify(oldStable)) {
  const output = {
    lastSync: new Date().toISOString(),
    stats: { added, changed, unchanged, repaired, skipped },
    ...stable
  };
  await fs.writeFile("data/catalog.json.tmp", JSON.stringify(output, null, 2));
  await fs.rename("data/catalog.json.tmp", "data/catalog.json");
  console.log(`Bijgewerkt: nieuw ${added}, gewijzigd ${changed}, hersteld ${repaired}, ongewijzigd ${unchanged}, overgeslagen ${skipped}`);
} else {
  console.log("Geen inhoudelijke wijzigingen; catalogus niet aangepast.");
}

