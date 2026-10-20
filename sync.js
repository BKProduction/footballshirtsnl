import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const base = process.env.SOURCE_BASE || "https://minkang.x.yupoo.com";
const pages = Number(process.env.SYNC_MAX_PAGES || 66);
const maxImages = Number(process.env.MAX_IMAGES_PER_ALBUM || 8);
const limit = pLimit(Number(process.env.SYNC_CONCURRENCY || 3));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(url) {
  const response = await fetch(url, { headers: {
    "user-agent": "Mozilla/5.0 FootballshirtsNL-CatalogSync/3.0",
    referer: `${base}/`
  }});
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}
const html = async url => (await request(url)).text();
const absolute = url => !url ? null : url.startsWith("http") ? url : new URL(url, base).href;

function collectionId(url = "") {
  return url.match(/\/collections\/(\d+)/)?.[1] || url.match(/[?&]referrercate=(\d+)/)?.[1] || null;
}
function clubFromTitle(title = "") {
  const cleaned = title.replace(/^\d+\s*/, "").trim();
  const season = cleaned.search(/\b(?:19|20)?\d{2}[/-]\d{2}\b|\b\d{2}[/-]\d{2}\b|\b2026\b/i);
  return season > 0 ? cleaned.slice(0, season).trim() : cleaned.split(/\s+/).slice(0, 2).join(" ") || "Overig";
}
async function loadPrevious() {
  try { return JSON.parse(await fs.readFile("data/catalog.json", "utf8")); }
  catch { return { albums: [] }; }
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
    const title = ($(el).attr("title") || card.find(".album__title,.showindex__children__title").text() || $(el).text()).replace(/\s+/g," ").trim();
    if (!title) return;
    const cid = collectionId(href);
    found.push({ sourceId:id, title, sourceUrl:absolute(href), collectionId:cid,
      competition:collections.get(cid) || "Overige collectie", club:clubFromTitle(title) });
  });
  return [...new Map(found.map(a => [a.sourceId, a])).values()];
}
function productImages($) {
  const urls = [];
  $("img").each((_, el) => {
    const url = absolute($(el).attr("data-origin-src") || $(el).attr("data-src") || $(el).attr("src"));
    if (url?.startsWith("https://photo.yupoo.com/minkang/") && !/\/(?:square|small)\.jpg(?:\?|$)/i.test(url)) urls.push(url);
  });
  return [...new Set(urls)].slice(0, maxImages);
}
async function localImagesExist(album) {
  if (!album?.images?.length) return false;
  const checks = await Promise.all(album.images.map(async image => {
    try { await fs.access(image.replace(/^\.\//, "")); return true; } catch { return false; }
  }));
  return checks.every(Boolean);
}
async function saveImage(url, id, index) {
  const dir = path.join("assets","albums",id);
  await fs.mkdir(dir, { recursive:true });
  const file = path.join(dir, `${String(index+1).padStart(2,"0")}.webp`);
  const buffer = Buffer.from(await (await request(url)).arrayBuffer());
  await sharp(buffer).rotate().resize({ width:index === 0 ? 700 : 1200, withoutEnlargement:true }).webp({quality:80}).toFile(file);
  return `./${file.replaceAll(path.sep,"/")}`;
}
async function importAlbum(album) {
  return limit(async () => {
    await sleep(250);
    const $ = cheerio.load(await html(album.sourceUrl));
    const title = ($("h1").first().text() || $("title").text().split("|")[0] || album.title).replace(/\s+/g," ").trim();
    const remote = productImages($);
    const images = [];
    for (let i=0; i<remote.length; i++) {
      try { images.push(await saveImage(remote[i], album.sourceId, i)); }
      catch (e) { console.error(`Foto ${album.sourceId}/${i+1}: ${e.message}`); }
    }
    return {...album, title, club:clubFromTitle(title), coverUrl:images[0] || null, images, imageCount:images.length, updatedAt:new Date().toISOString()};
  });
}

await fs.mkdir("data", {recursive:true});
await fs.mkdir("assets/albums", {recursive:true});
const previous = await loadPrevious();
const previousById = new Map((previous.albums || []).map(a => [String(a.sourceId), a]));
const collections = await getCollections();
const discovered = [];
for (let page=1; page<=pages; page++) {
  try { discovered.push(...await indexPage(page, collections)); console.log(`Index ${page}/${pages}`); }
  catch (e) { console.error(`Index ${page}: ${e.message}`); }
}
const current = [...new Map(discovered.map(a => [a.sourceId,a])).values()];
const albums = [];
let added=0, changed=0, unchanged=0, repaired=0;
for (const item of current) {
  const old = previousById.get(String(item.sourceId));
  const metadataChanged = old && (old.title !== item.title || old.competition !== item.competition || old.club !== item.club);
  const assetsOkay = old ? await localImagesExist(old) : false;
  if (old && !metadataChanged && assetsOkay) {
    albums.push(old); unchanged++; continue;
  }
  try {
    const imported = await importAlbum(item);
    if (imported.images.length) albums.push(imported);
    if (!old) added++; else if (!assetsOkay) repaired++; else changed++;
  } catch (e) {
    console.error(`Album ${item.sourceId}: ${e.message}`);
    if (old && assetsOkay) albums.push(old);
  }
}
const competitions = [...new Set(albums.map(a => a.competition))].sort((a,b)=>a.localeCompare(b,"nl"));
const output = { lastSync:new Date().toISOString(), source:base, total:albums.length,
  stats:{added,changed,unchanged,repaired,removed:Math.max(0,previousById.size-albums.length)}, competitions, albums, warnings:[] };
const next = JSON.stringify(output,null,2);
let before = ""; try { before = await fs.readFile("data/catalog.json","utf8"); } catch {}
if (before !== next) {
  await fs.writeFile("data/catalog.json.tmp", next);
  await fs.rename("data/catalog.json.tmp","data/catalog.json");
  console.log(`Wijzigingen opgeslagen: nieuw ${added}, gewijzigd ${changed}, hersteld ${repaired}`);
} else {
  console.log("Geen wijzigingen gevonden; catalogus niet aangepast.");
}
