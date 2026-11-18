import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";

const CATALOG = "data/catalog.json";
const STATE = "data/sync-state.json";

const SOURCES = [
  { key: "minkang", base: "https://minkang.x.yupoo.com" },
  { key: "yema007", base: "https://yema007.x.yupoo.com" },
  { key: "popmo", base: "https://popmo.x.yupoo.com" },
  { key: "407131796", base: "https://407131796.x.yupoo.com" },
  { key: "yuhuaxieye1", base: "https://yuhuaxieye1.x.yupoo.com" },
  { key: "hema168", base: "https://hema168.x.yupoo.com" },
  { key: "dachang88", base: "https://dachang88.x.yupoo.com", mode: "shoes" },
  { key: "dongshanstore", base: "https://dongshanstore.x.yupoo.com", mode: "training" },
  { key: "aosendi", base: "https://aosendi.x.yupoo.com", mode: "training" },
  { key: "junhaoqiumi", base: "https://junhaoqiumi.x.yupoo.com" }
];

const RUN = new Date().toISOString().slice(0, 10);
const BATCH = 25;
const MAX_PAGES = 100;
const MAX_IMAGES = 6;
const CLASSIFICATION_VERSION = 7;
const PHOTO_VERSION = 12;
const limit = pLimit(2);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unique = values => [...new Set(values.filter(Boolean))];

const norm = (value = "") => String(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const containsAny = (text, words) => {
  const n = norm(text);
  return words.some(word => n.includes(norm(word)));
};

const absoluteUrl = (base, value) => {
  if (!value) return "";
  try { return new URL(value, base).href; } catch { return ""; }
};

const TRANSLATE = [
  ["足球鞋", "Voetbalschoenen"], ["训练服", "Trainingskleding"],
  ["训练套装", "Trainingsset"], ["球衣", "Shirt"],
  ["短袖", "Korte mouw"], ["长袖", "Lange mouw"],
  ["套装", "Set"], ["外套", "Jas"], ["风衣", "Windjack"],
  ["卫衣", "Hoodie"], ["长裤", "Lange broek"], ["短裤", "Korte broek"],
  ["主场", "Thuis"], ["客场", "Uit"], ["球员版", "Spelersversie"],
  ["球迷版", "Fanversie"], ["复古", "Retro"], ["童装", "Kindermaat"],
  ["儿童", "Kinderen"], ["成人", "Volwassenen"], ["女款", "Dames"],
  ["守门员", "Keeper"], ["鞋子", "Schoenen"]
];

function cleanText(value, fallback = "") {
  let text = String(value ?? "");
  for (const [from, to] of TRANSLATE) text = text.split(from).join(` ${to} `);
  text = text.replace(/[\p{Script=Han}]+/gu, " ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

const CLUBS = [
  ["Premier League", "Arsenal", ["arsenal", "gunners"]],
  ["Premier League", "Aston Villa", ["aston villa"]],
  ["Premier League", "Bournemouth", ["bournemouth"]],
  ["Premier League", "Brentford", ["brentford"]],
  ["Premier League", "Brighton", ["brighton", "brighton hove albion"]],
  ["Premier League", "Burnley", ["burnley"]],
  ["Premier League", "Chelsea", ["chelsea"]],
  ["Premier League", "Crystal Palace", ["crystal palace"]],
  ["Premier League", "Everton", ["everton"]],
  ["Premier League", "Fulham", ["fulham"]],
  ["Premier League", "Leeds United", ["leeds united", "leeds"]],
  ["Premier League", "Leicester City", ["leicester city", "leicester"]],
  ["Premier League", "Liverpool", ["liverpool", "lfc"]],
  ["Premier League", "Manchester City", ["manchester city", "man city", "mancity"]],
  ["Premier League", "Manchester United", ["manchester united", "man united", "man utd", "manchester utd"]],
  ["Premier League", "Newcastle United", ["newcastle united", "newcastle"]],
  ["Premier League", "Nottingham Forest", ["nottingham forest", "nottm forest"]],
  ["Premier League", "Sunderland", ["sunderland"]],
  ["Premier League", "Tottenham Hotspur", ["tottenham hotspur", "tottenham", "spurs"]],
  ["Premier League", "West Ham United", ["west ham united", "west ham"]],
  ["Premier League", "Wolverhampton Wanderers", ["wolverhampton wanderers", "wolverhampton", "wolves"]],
  ["La Liga", "Athletic Bilbao", ["athletic bilbao", "athletic club", "bilbao"]],
  ["La Liga", "Atletico Madrid", ["atletico madrid", "atletico de madrid"]],
  ["La Liga", "Barcelona", ["fc barcelona", "barcelona", "barca", "fcb"]],
  ["La Liga", "Celta Vigo", ["celta vigo", "celta"]],
  ["La Liga", "Espanyol", ["espanyol"]],
  ["La Liga", "Las Palmas", ["las palmas"]],
  ["La Liga", "Real Betis", ["real betis", "betis"]],
  ["La Liga", "Real Madrid", ["real madrid"]],
  ["La Liga", "Real Sociedad", ["real sociedad"]],
  ["La Liga", "Real Valladolid", ["real valladolid", "valladolid"]],
  ["La Liga", "Sevilla", ["sevilla"]],
  ["La Liga", "Valencia", ["valencia"]],
  ["La Liga", "Villarreal", ["villarreal"]],
  ["Serie A", "AC Milan", ["ac milan"]],
  ["Serie A", "Atalanta", ["atalanta"]],
  ["Serie A", "Fiorentina", ["fiorentina"]],
  ["Serie A", "Inter Milan", ["inter milan", "internazionale"]],
  ["Serie A", "Juventus", ["juventus", "juve"]],
  ["Serie A", "Lazio", ["lazio"]],
  ["Serie A", "Napoli", ["napoli"]],
  ["Serie A", "Roma", ["as roma"]],
  ["Bundesliga", "Bayern Munchen", ["bayern munich", "bayern munchen", "fc bayern", "bayern"]],
  ["Bundesliga", "Bayer Leverkusen", ["bayer leverkusen", "leverkusen"]],
  ["Bundesliga", "Borussia Dortmund", ["borussia dortmund", "dortmund", "bvb"]],
  ["Bundesliga", "Eintracht Frankfurt", ["eintracht frankfurt", "frankfurt"]],
  ["Bundesliga", "FSV Mainz", ["fsv mainz", "mainz"]],
  ["Bundesliga", "RB Leipzig", ["rb leipzig", "leipzig"]],
  ["Bundesliga", "Schalke 04", ["schalke 04", "schalke"]],
  ["Bundesliga", "VfB Stuttgart", ["vfb stuttgart", "stuttgart"]],
  ["Bundesliga", "Union Berlin", ["union berlin"]],
  ["Bundesliga", "Werder Bremen", ["werder bremen"]],
  ["Bundesliga", "VfL Wolfsburg", ["vfl wolfsburg", "wolfsburg"]],
  ["Ligue 1", "Lens", ["rc lens"]],
  ["Ligue 1", "Lille", ["lille"]],
  ["Ligue 1", "Lyon", ["olympique lyon"]],
  ["Ligue 1", "Marseille", ["olympique marseille", "marseille"]],
  ["Ligue 1", "Monaco", ["as monaco"]],
  ["Ligue 1", "Paris Saint-Germain", ["paris saint germain", "psg"]],
  ["Eredivisie", "Ajax", ["ajax"]],
  ["Eredivisie", "AZ", ["az alkmaar", "alkmaar"]],
  ["Eredivisie", "Feyenoord", ["feyenoord"]],
  ["Eredivisie", "FC Twente", ["fc twente", "twente"]],
  ["Eredivisie", "FC Utrecht", ["fc utrecht"]],
  ["Eredivisie", "PSV", ["psv eindhoven", "psv"]],
  ["Primeira Liga", "Benfica", ["sl benfica", "benfica"]],
  ["Primeira Liga", "FC Porto", ["fc porto"]],
  ["Primeira Liga", "Sporting CP", ["sporting cp", "sporting lisbon", "sporting lisboa"]],
  ["Scottish Premiership", "Celtic", ["celtic"]],
  ["Scottish Premiership", "Rangers", ["glasgow rangers"]],
  ["Super Lig", "Besiktas", ["besiktas"]],
  ["Super Lig", "Fenerbahce", ["fenerbahce"]],
  ["Super Lig", "Galatasaray", ["galatasaray"]],
  ["MLS", "Inter Miami", ["inter miami"]],
  ["MLS", "LA Galaxy", ["la galaxy"]],
  ["MLS", "Los Angeles FC", ["los angeles fc", "lafc"]],
  ["MLS", "Seattle Sounders", ["seattle sounders"]],
  ["Saudi Pro League", "Al-Hilal", ["al hilal"]],
  ["Saudi Pro League", "Al-Ittihad", ["al ittihad"]],
  ["Saudi Pro League", "Al-Nassr", ["al nassr"]],
  ["Brasileirao Serie A", "Flamengo", ["flamengo"]],
  ["Brasileirao Serie A", "Fluminense", ["fluminense"]],
  ["Brasileirao Serie A", "Palmeiras", ["palmeiras"]],
  ["Brasileirao Serie A", "Santos", ["santos fc"]],
  ["Brasileirao Serie A", "Sao Paulo", ["sao paulo"]],
  ["Brasileirao Serie A", "Vasco da Gama", ["vasco da gama"]],
  ["Argentijnse Primera Division", "Boca Juniors", ["boca juniors"]],
  ["Argentijnse Primera Division", "River Plate", ["river plate"]]
];

const COUNTRIES = [
  ["Argentinie", ["argentina"]], ["Australie", ["australia"]],
  ["Belgie", ["belgium", "belgie"]], ["Brazilie", ["brazil", "brasil"]],
  ["Canada", ["canada"]], ["Chili", ["chile"]], ["Colombia", ["colombia"]],
  ["Costa Rica", ["costa rica"]], ["Denemarken", ["denmark"]],
  ["Duitsland", ["germany", "deutschland"]], ["Ecuador", ["ecuador"]],
  ["Engeland", ["england"]], ["Frankrijk", ["france"]], ["Ghana", ["ghana"]],
  ["Ierland", ["ireland"]], ["Italie", ["italy", "italia"]],
  ["Japan", ["japan"]], ["Kameroen", ["cameroon"]], ["Kroatie", ["croatia"]],
  ["Marokko", ["morocco", "maroc"]], ["Mexico", ["mexico"]],
  ["Nederland", ["netherlands", "holland"]], ["Nigeria", ["nigeria"]],
  ["Noorwegen", ["norway"]], ["Polen", ["poland"]], ["Portugal", ["portugal"]],
  ["Rusland", ["russia"]], ["Sovjet-Unie", ["soviet union", "ussr"]],
  ["Saoedi-Arabie", ["saudi arabia"]], ["Schotland", ["scotland"]],
  ["Senegal", ["senegal"]], ["Spanje", ["spain", "espana"]],
  ["Turkije", ["turkey", "turkiye"]], ["Uruguay", ["uruguay"]],
  ["Verenigde Staten", ["usa national", "usmnt", "team usa"]],
  ["Wales", ["wales"]], ["Zuid-Korea", ["south korea", "korea republic"]]
];

const PLAYERS = [
  ["Lionel Messi", ["lionel messi", "messi10", "messi 10", "messi 19", "messi 30", "messi"]],
  ["Cristiano Ronaldo", ["cristiano ronaldo", "ronaldo7", "ronaldo 7", "cr7"]],
  ["Ronaldo Nazario", ["ronaldo nazario", "ronaldo fenomeno", "r9"]],
  ["Neymar", ["neymar jr", "neymar"]], ["Kylian Mbappe", ["kylian mbappe", "mbappe"]],
  ["Erling Haaland", ["erling haaland", "haaland"]],
  ["Jude Bellingham", ["jude bellingham", "bellingham"]],
  ["Mohamed Salah", ["mohamed salah", "mo salah"]], ["David Beckham", ["david beckham", "beckham"]],
  ["Ronaldinho", ["ronaldinho"]], ["Zinedine Zidane", ["zinedine zidane", "zidane"]],
  ["Diego Maradona", ["diego maradona", "maradona"]], ["Pele", ["pele"]]
];

const SHOE_MODELS = [
  ["Nike", "Mercurial Vapor", ["mercurial vapor", "vapor 15", "vapor 16", "vapor 17"]],
  ["Nike", "Mercurial Superfly", ["mercurial superfly", "superfly"]],
  ["Nike", "Mercurial", ["mercurial"]], ["Nike", "Phantom GX", ["phantom gx"]],
  ["Nike", "Phantom Luna", ["phantom luna"]], ["Nike", "Phantom", ["nike phantom", "phantom"]],
  ["Nike", "Tiempo Legend", ["tiempo legend"]], ["Nike", "Tiempo", ["nike tiempo", "tiempo"]],
  ["Nike", "Premier", ["nike premier"]], ["Adidas", "Predator", ["adidas predator", "predator"]],
  ["Adidas", "F50", ["adidas f50", "f50"]], ["Adidas", "Copa Mundial", ["copa mundial"]],
  ["Adidas", "Copa Pure", ["copa pure"]], ["Adidas", "Copa Gloro", ["copa gloro"]],
  ["Adidas", "Copa", ["adidas copa", "copa"]], ["Adidas", "X Crazyfast", ["crazyfast"]],
  ["Adidas", "X Speedportal", ["speedportal"]], ["Adidas", "X Speedflow", ["speedflow"]],
  ["Puma", "Future", ["puma future"]], ["Puma", "Ultra", ["puma ultra"]],
  ["Puma", "King", ["puma king"]], ["Mizuno", "Morelia", ["mizuno morelia", "morelia"]],
  ["Mizuno", "Alpha", ["mizuno alpha"]], ["Joma", "Top Flex", ["joma top flex", "top flex"]],
  ["New Balance", "Furon", ["new balance furon", "furon"]],
  ["New Balance", "Tekela", ["new balance tekela", "tekela"]]
];

const SHOE_BRANDS = ["Nike", "Adidas", "Puma", "Mizuno", "Joma", "New Balance", "Umbro", "Lotto", "Diadora", "Asics"];
const TRAINING_WORDS = ["tracksuit", "track suit", "training suit", "training set", "training wear", "training shirt", "training top", "training pants", "pre match", "prematch", "warm up", "windbreaker", "trainingspak", "trainingsset", "hoodie", "sweatshirt", "jacket", "travel suit"];
const SHOE_WORDS = ["football boot", "soccer shoe", "soccer boot", "cleats", "mercurial", "superfly", "phantom gx", "tiempo", "predator", "adidas f50", "copa mundial", "copa pure", "copa gloro", "speedportal", "speedflow", "crazyfast", "puma future", "puma ultra", "mizuno morelia", "top flex"];
const FOOTBALL_WORDS = ["football", "soccer", "jersey", "shirt", "kit", "uniform", "home", "away", "third", "goalkeeper", "player version", "fan version", "retro", "classic", "football clubs", "national teams", "club teams"];
const IGNORE_WORDS = ["about us", "contact us", "how to order", "how to buy", "tutorial", "price list", "payment", "shipping", "whatsapp", "wechat", "qrcode", "qr code", "size chart", "sizes chart", "measurement", "customer service", "create your own design", "all over print", "menu 1", "menu 2", "menu1", "menu2", "video", "patch only", "patches only", "name set only", "nameset only", "fonts only", "link only"];

function findTeam(text) {
  const n = norm(text);
  const sorted = [...CLUBS].sort((a, b) => Math.max(...b[2].map(x => norm(x).length)) - Math.max(...a[2].map(x => norm(x).length)));
  for (const [competition, club, aliases] of sorted) if (aliases.some(alias => n.includes(norm(alias)))) return { competition, club };
  return null;
}
function findCountry(text) {
  const n = norm(text);
  for (const [country, aliases] of COUNTRIES) if (aliases.some(alias => n.includes(norm(alias)))) return country;
  return "";
}
function findPlayer(text) {
  const n = norm(text);
  for (const [player, aliases] of PLAYERS) if (aliases.some(alias => n.includes(norm(alias)))) return player;
  return "";
}
function findShoe(text) {
  const n = norm(text);
  for (const [brand, model, aliases] of SHOE_MODELS) if (aliases.some(alias => n.includes(norm(alias)))) return { brand, model };
  return { brand: SHOE_BRANDS.find(brand => n.includes(norm(brand))) || "Overige merken", model: "Overig model" };
}

function season(text) {
  const original = String(text ?? "");
  let match;
  const long = /\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/g;
  while ((match = long.exec(original)) !== null) {
    const first = Number(match[1]); let second = Number(match[2]);
    if (match[2].length === 2) { second = Math.floor(first / 100) * 100 + second; if (second < first) second += 100; }
    if (first >= 1980 && first <= 2099 && second === first + 1) return `${first}-${second}`;
  }
  const short = /(?:^|[^a-z0-9])(\d{2})\s*[\/_-]\s*(\d{2})(?=$|[^a-z0-9])/gi;
  while ((match = short.exec(original)) !== null) {
    const left = Number(match[1]), right = Number(match[2]);
    if (right !== (left + 1) % 100) continue;
    const first = left >= 80 ? 1900 + left : 2000 + left;
    return `${first}-${first + 1}`;
  }
  return "Seizoen onbekend";
}

function historicPlayerTeam(player, year) {
  if (year === "Seizoen onbekend") return null;
  const start = Number(year.slice(0, 4));
  if (player === "Lionel Messi") {
    if (start >= 2004 && start < 2021) return { competition: "La Liga", club: "Barcelona" };
    if (start >= 2021 && start < 2023) return { competition: "Ligue 1", club: "Paris Saint-Germain" };
    if (start >= 2023) return { competition: "MLS", club: "Inter Miami" };
  }
  if (player === "Cristiano Ronaldo") {
    if (start >= 2003 && start < 2009) return { competition: "Premier League", club: "Manchester United" };
    if (start >= 2009 && start < 2018) return { competition: "La Liga", club: "Real Madrid" };
    if (start >= 2018 && start < 2021) return { competition: "Serie A", club: "Juventus" };
    if (start >= 2021 && start < 2023) return { competition: "Premier League", club: "Manchester United" };
    if (start >= 2023) return { competition: "Saudi Pro League", club: "Al-Nassr" };
  }
  return null;
}

function classify(title, category, source) {
  const text = `${title} ${category}`, n = norm(text), year = season(text), player = findPlayer(text);
  const team = findTeam(text) || historicPlayerTeam(player, year), country = findCountry(text);
  const explicitTraining = containsAny(text, TRAINING_WORDS);
  const explicitMatchShirt = containsAny(text, ["match shirt", "match jersey", "home shirt", "away shirt", "third shirt", "home jersey", "away jersey", "third jersey", "player version", "fan version"]);
  const training = explicitTraining || (source.mode === "training" && !explicitMatchShirt);
  if (training) {
    if (team) return { section: "Trainingskleding", category: "Clubteams", subcategory: team.competition, competition: team.competition, club: team.club, country: "", player, season: year, types: ["Trainingskleding"] };
    if (country) return { section: "Trainingskleding", category: "Landenteams", subcategory: country, competition: "Landenteams", club: country, country, player, season: year, types: ["Trainingskleding"] };
    return { section: "Trainingskleding", category: "Overige trainingskleding", subcategory: "Overige trainingskleding", competition: "", club: "Overige trainingskleding", country: "", player, season: year, types: ["Trainingskleding"] };
  }
  const shoe = source.mode === "shoes" || containsAny(text, SHOE_WORDS) || n === "shoes" || n.startsWith("shoes ");
  if (shoe) { const found = findShoe(text); return { section: "Voetbalschoenen", category: found.brand, subcategory: found.model, competition: "", club: "", country: "", player: "", season: "Seizoen onbekend", types: ["Voetbalschoenen"] }; }
  if (team) return { section: "Voetbal", category: "Clubteams", subcategory: team.competition, competition: team.competition, club: team.club, country: "", player, season: year, types: ["Voetbalshirt"] };
  if (country) return { section: "Voetbal", category: "Landenteams", subcategory: country, competition: "Landenteams", club: country, country, player, season: year, types: ["Voetbalshirt"] };
  if (player || containsAny(text, FOOTBALL_WORDS)) return { section: "Voetbal", category: "Overig voetbal", subcategory: player || "Overig voetbal", competition: "Overig voetbal", club: player || "Overig voetbal", country: "", player, season: year, types: ["Voetbalshirt"] };
  return { section: "Overige producten", category: "Overige producten", subcategory: cleanText(category, "Overig"), competition: "", club: "", country: "", player: "", season: "Seizoen onbekend", types: ["Overig"] };
}

function meaningful(title, category = "") { const text = norm(`${title} ${category}`); return text && !IGNORE_WORDS.some(word => text.includes(norm(word))); }
class HttpError extends Error { constructor(status, url) { super(`HTTP ${status} for ${url}`); this.status = status; } }

async function request(url, binary = false, referer = "") {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(250); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const headers = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36", accept: binary ? "image/avif,image/webp,image/*,*/*" : "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9,nl;q=0.8" };
      if (referer) headers.referer = referer;
      const response = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
      if (!response.ok) throw new HttpError(response.status, url);
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (error) { if (error.status === 404 || attempt === 2) throw error; await sleep(1000 * (attempt + 1)); }
    finally { clearTimeout(timer); }
  }
}

async function read(file, fallback) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } }
async function write(file, data) { await fs.mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.tmp`; await fs.writeFile(temp, JSON.stringify(data, null, 2) + "\n"); await fs.rename(temp, file); }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }

function validImage(url = "") {
  const value = String(url).toLowerCase();
  return /^https?:\/\//.test(value) &&
    value.includes("photo.yupoo.com") &&
    !["logo", "avatar", "favicon", "default", "placeholder", "loading", "qrcode", "icon", "banner", "blank.gif", "spacer.gif"].some(word => value.includes(word));
}

function proxiedImage(url = "") {
  if (!validImage(url)) return "";
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=1200&output=webp&q=82`;
}
function srcset(value = "", base = "") { return String(value).split(",").map(item => absoluteUrl(base, item.trim().split(/\s+/)[0])).filter(validImage); }

function collectImages($, source, album) {
  const images = [], add = value => { const url = absoluteUrl(source.base, value); if (validImage(url)) images.push(url); };
  $("meta[property='og:image'],meta[name='twitter:image'],img,source").each((_, element) => {
    for (const attribute of ["content", "data-origin-src", "data-original", "data-src", "data-lazy", "data-lazy-src", "data-image", "src"]) add($(element).attr(attribute));
    images.push(...srcset($(element).attr("srcset"), source.base), ...srcset($(element).attr("data-srcset"), source.base));
  });
  $("[style*='background-image']").each((_, element) => { const style = $(element).attr("style") || ""; const regex = /url\((['\"]?)(.*?)\1\)/gi; let match; while ((match = regex.exec(style)) !== null) add(match[2]); });
  add(album.preview); return unique(images).slice(0, MAX_IMAGES * 4);
}

function pageData(html, source, inherited = "") {
  const $ = cheerio.load(html), categories = new Map(), albums = new Map();
  $("a[href*='/categories/'],a[href*='/collections/']").each((_, element) => { const url = absoluteUrl(source.base, $(element).attr("href")).split("?")[0]; if (url) categories.set(url, { url, title: cleanText($(element).attr("title") || $(element).text(), "Overig") }); });
  $("a[href*='/albums/']").each((_, element) => {
    const fetchUrl = absoluteUrl(source.base, $(element).attr("href")), url = fetchUrl.split("?")[0]; if (!/\/albums\/\d+/.test(url)) return;
    const image = $(element).find("img").first(), candidates = [image.attr("data-origin-src"), image.attr("data-original"), image.attr("data-src"), image.attr("data-lazy-src"), image.attr("src")].map(value => absoluteUrl(source.base, value)).filter(validImage);
    const preview = unique([...candidates, ...srcset(image.attr("srcset"), source.base), ...srcset(image.attr("data-srcset"), source.base)])[0] || "";
    const id = url.match(/\/albums\/(\d+)/)?.[1] || "onbekend";
    albums.set(url, { url, fetchUrl, title: cleanText($(element).attr("title") || image.attr("alt") || $(element).text(), `Product ${id}`), category: cleanText(inherited, "Overig"), preview });
  });
  return { categories: [...categories.values()], albums: [...albums.values()] };
}

async function discover(source, state) {
  const albums = new Map(), categories = new Map(); state.deadCategories ||= {}; state.deadCategories[source.key] ||= []; const dead = new Set(state.deadCategories[source.key]);
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? `${source.base}/albums?tab=gallery` : `${source.base}/albums?tab=gallery&page=${page}`;
    try { const data = pageData(await request(url), source); data.albums.forEach(item => albums.set(item.url, item)); data.categories.forEach(item => categories.set(item.url, item)); if (!data.albums.length && page > 1) break; }
    catch (error) { if (error.status !== 404) console.warn(`[${source.key}] index: ${error.message}`); break; }
  }
  for (const category of categories.values()) {
    if (dead.has(category.url)) continue;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const separator = category.url.includes("?") ? "&" : "?";
      const categoryUrl = page === 1 ? category.url : `${category.url}${separator}page=${page}`;
      try {
        const before = albums.size;
        const data = pageData(await request(categoryUrl), source, category.title);
        data.albums.forEach(item => albums.set(item.url, item));
        if ((!data.albums.length || albums.size === before) && page > 1) break;
      } catch (error) {
        if (error.status === 404) {
          if (page === 1) dead.add(category.url);
          break;
        }
        console.warn(`[${source.key}] categoriepagina ${page}: ${error.message}`);
        break;
      }
    }
  }
  state.deadCategories[source.key] = [...dead]; await write(STATE, state); return [...albums.values()];
}

function albumData(html, album, source) {
  const $ = cheerio.load(html);
  return { title: cleanText($("h1").first().text() || $("meta[property='og:title']").attr("content") || $("title").text() || album.title, album.title), images: collectImages($, source, album) };
}

async function imageWorks(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 Chrome/129 Safari/537.36",
        accept: "image/avif,image/webp,image/*,*/*",
        range: "bytes=0-65535"
      }
    });
    const type = response.headers.get("content-type") || "";
    const length = Number(response.headers.get("content-length") || 0);
    if (response.body) await response.body.cancel();
    return response.ok && type.startsWith("image/") && (length === 0 || length >= 1024);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function externalImages(candidates, previous) {
  const urls = unique(candidates).filter(validImage).map(proxiedImage).filter(Boolean);
  const working = [];
  for (const url of urls) {
    if (working.length >= MAX_IMAGES) break;
    if (await imageWorks(url)) working.push(url);
  }
  if (working.length) return working;

  const old = unique([previous?.coverUrl, ...(previous?.images || [])])
    .filter(value => /^https?:\/\//.test(String(value || "")));
  for (const url of old) {
    if (await imageWorks(url)) return [url];
  }
  return [];
}
async function processAlbum(source, album, previous) {
  const id = album.url.match(/\/albums\/(\d+)/)?.[1] || "unknown", referer = album.fetchUrl || album.url;
  let detail = null; try { detail = albumData(await request(referer), album, source); } catch (error) { console.warn(`[${source.key}:${id}] albumdetail: ${error.message}`); }
  const title = detail?.title || album.title, raw = detail?.images?.length ? detail.images : album.preview ? [album.preview] : [];
  if (!meaningful(title, album.category)) return null;
  const images = await externalImages(raw, previous); if (!images.length) return null;
  return { ...(previous || {}), uniqueKey: `${source.key}:${id}`, source: source.key, sourceId: id, sourceUrl: album.url, sourceCategory: cleanText(album.category, "Overig"), title, ...classify(title, album.category, source), images, coverUrl: images[0], imageCount: images.length, classificationVersion: CLASSIFICATION_VERSION, photoVersion: PHOTO_VERSION, updatedAt: new Date().toISOString() };
}

function cleanExisting(product) {
  const source = SOURCES.find(item => item.key === product.source) || { key: product.source || "existing" }, title = cleanText(product.title, `Product ${product.sourceId || "Unknown"}`), sourceCategory = cleanText(product.sourceCategory, "Overig");
  return { ...product, title, ...classify(title, sourceCategory, source), sourceCategory };
}
function publishedImage(product) { return unique([product?.coverUrl, ...(product?.images || [])]).some(value => /^https?:\/\//.test(String(value || ""))); }
function complete(product) { return Boolean(product?.title && product?.section && product?.category && product?.subcategory && publishedImage(product) && product.classificationVersion >= CLASSIFICATION_VERSION && product.photoVersion >= PHOTO_VERSION); }
function publicProducts(map) { return [...map.values()].filter(Boolean).filter(item => meaningful(item.title, item.sourceCategory)).filter(publishedImage).sort((a, b) => String(a.section).localeCompare(String(b.section), "nl") || String(a.competition || "").localeCompare(String(b.competition || ""), "nl") || String(a.club || "").localeCompare(String(b.club || ""), "nl") || String(b.season || "").localeCompare(String(a.season || ""), "nl") || String(a.title).localeCompare(String(b.title), "nl")); }

async function save(map, warnings, source, status) {
  const products = publicProducts(map); await write(CATALOG, { lastSync: new Date().toISOString(), status, currentSource: source, productCount: products.length, products, warnings });
}

async function main() {
  const catalog = await read(CATALOG, { products: [], warnings: [] }), map = new Map(), state = await read(STATE, { sources: {} }), warnings = [];
  state.sources ||= {};
  for (const product of catalog.products || catalog.albums || []) { const cleaned = cleanExisting(product); map.set(cleaned.uniqueKey || `${cleaned.source}:${cleaned.sourceId}`, cleaned); }
  for (const source of SOURCES) {
    console.log(`[${source.key}] controle gestart`); const albums = await discover(source, state);
    const albumById = new Map(albums.map(album => [album.url.match(/\/albums\/(\d+)/)?.[1] || "unknown", album]));
    const currentState = state.sources[source.key] || {};
    const canResume =
      currentState.classificationVersion === CLASSIFICATION_VERSION &&
      currentState.photoVersion === PHOTO_VERSION &&
      Array.isArray(currentState.pendingIds) &&
      currentState.pendingIds.length > 0 &&
      Number.isInteger(currentState.nextIndex) &&
      currentState.nextIndex < currentState.pendingIds.length;

    const pendingIds = canResume
      ? currentState.pendingIds.filter(id => albumById.has(id))
      : albums
          .filter(album => {
            const id = album.url.match(/\/albums\/(\d+)/)?.[1] || "unknown";
            return !complete(map.get(`${source.key}:${id}`));
          })
          .map(album => album.url.match(/\/albums\/(\d+)/)?.[1] || "unknown");

    const work = pendingIds.map(id => albumById.get(id)).filter(Boolean);
    const startIndex = canResume ? Math.min(currentState.nextIndex || 0, work.length) : 0;
    console.log(`[${source.key}] ${albums.length} gevonden; ${work.length} te verwerken; hervat bij ${startIndex}`);

    state.sources[source.key] = {
      run: RUN,
      nextIndex: startIndex,
      total: work.length,
      discovered: albums.length,
      pendingIds,
      classificationVersion: CLASSIFICATION_VERSION,
      photoVersion: PHOTO_VERSION
    };
    await write(STATE, state);

    for (let offset = startIndex; offset < work.length; offset += BATCH) {
      const batch = work.slice(offset, offset + BATCH);
      const results = await Promise.all(batch.map(album => limit(async () => {
        const id = album.url.match(/\/albums\/(\d+)/)?.[1] || "unknown";
        const key = `${source.key}:${id}`;
        return { key, product: await processAlbum(source, album, map.get(key)) };
      })));
      for (const result of results) {
        if (result.product) map.set(result.key, result.product);
        else map.delete(result.key);
      }
      state.sources[source.key].nextIndex = Math.min(offset + results.length, work.length);
      await save(map, warnings, source.key, "running");
      await write(STATE, state);
    }
    state.sources[source.key] = {
      ...state.sources[source.key],
      nextIndex: work.length,
      pendingIds: [],
      completedAt: new Date().toISOString()
    };
    await write(STATE, state);
  }
  const products = publicProducts(map), counts = products.reduce((r, p) => { r.total++; if (p.section === "Voetbal") r.football++; if (p.section === "Trainingskleding") r.training++; if (p.section === "Voetbalschoenen") r.shoes++; if (p.section === "Overige producten") r.other++; return r; }, { total: 0, football: 0, training: 0, shoes: 0, other: 0 });
  await write(CATALOG, { lastSync: new Date().toISOString(), status: "completed", productCount: products.length, counts, products, warnings });
  state.completedAt = new Date().toISOString(); state.lastRun = RUN; state.counts = counts; await write(STATE, state);
  console.log(`[Catalogus] ${counts.total} producten; voetbal ${counts.football}; training ${counts.training}; schoenen ${counts.shoes}; overige ${counts.other}.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
