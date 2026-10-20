import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const base = process.env.SOURCE_BASE || "https://minkang.x.yupoo.com";
const pages = Number(process.env.SYNC_MAX_PAGES || 66);
const concurrency = Number(process.env.SYNC_CONCURRENCY || 3);
const maxImages = Number(process.env.MAX_IMAGES_PER_ALBUM || 8);
const limit = pLimit(concurrency);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchResponse(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 FootballshirtsNL-CatalogSync/2.0",
      "referer": base + "/"
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

async function html(url) {
  return (await fetchResponse(url)).text();
}

function absolute(url) {
  if (!url) return null;
  return url.startsWith("http") ? url : new URL(url, base).href;
}

function collectionIdFromUrl(url) {
  if (!url) return null;
  const byCollection = url.match(/\/collections\/(\d+)/);
  const byReferrer = url.match(/[?&]referrercate=(\d+)/);
  return byCollection?.[1] || byReferrer?.[1] || null;
}

function clubFromTitle(title) {
  const cleaned = (title || "").replace(/^\d+\s*/, "").trim();
  const season = cleaned.search(/\b(?:19|20)?\d{2}[/-]\d{2}\b|\b\d{2}[/-]\d{2}\b|\b2026\b/i);
  if (season > 0) return cleaned.slice(0, season).trim();
  return cleaned.split(/\s+/).slice(0, 2).join(" ") || "Overig";
}

async function getCollections() {
  const $ = cheerio.load(await html(`${base}/albums`));
  const collections = new Map();
  $('a[href*="/collections/"]').each((_, element) => {
    const href = $(element).attr("href");
    const id = collectionIdFromUrl(href);
    const name = $(element).clone().children().remove().end().text().replace(/\s+/g, " ").trim();
    if (id && name && !/^\d+\s*(个)?$/.test(name)) collections.set(id, name);
  });
  return collections;
}

async function indexPage(page, collections) {
  await sleep(250);
  const $ = cheerio.load(await html(`${base}/albums?page=${page}`));
  const albums = [];

  $('a[href*="/albums/"]').each((_, element) => {
    const href = $(element).attr("href");
    const match = href?.match(/\/albums\/(\d+)/);
    if (!match) return;

    const card = $(element).closest("li, .album__main, .showindex__children, .album__item");
    const rawTitle = (
      $(element).attr("title") ||
      card.find(".album__title,.showindex__children__title").text() ||
      $(element).text()
    ).replace(/\s+/g, " ").trim();
    if (!rawTitle) return;

    const collectionId = collectionIdFromUrl(href);
    albums.push({
      sourceId: match[1],
      title: rawTitle,
      sourceUrl: absolute(href),
      collectionId,
      competition: collections.get(collectionId) || "Overige collectie",
      club: clubFromTitle(rawTitle)
    });
  });

  return [...new Map(albums.map(album => [album.sourceId, album])).values()];
}

function productImages($) {
  const found = [];
  $('img').each((_, element) => {
    const src = $(element).attr("data-origin-src") || $(element).attr("data-src") || $(element).attr("src");
    const url = absolute(src);
    if (!url || !url.startsWith("https://photo.yupoo.com/minkang/")) return;
    if (/\/(?:square|small)\.jpg(?:\?|$)/i.test(url)) return;
    found.push(url);
  });
  return [...new Set(found)].slice(0, maxImages);
}

async function saveImage(remoteUrl, albumId, index) {
  const directory = path.join("assets", "albums", albumId);
  await fs.mkdir(directory, { recursive: true });
  const filename = `${String(index + 1).padStart(2, "0")}.webp`;
  const destination = path.join(directory, filename);
  const buffer = Buffer.from(await (await fetchResponse(remoteUrl)).arrayBuffer());
  await sharp(buffer)
    .rotate()
    .resize({ width: index === 0 ? 700 : 1200, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(destination);
  return `./assets/albums/${albumId}/${filename}`;
}

async function detail(album) {
  return limit(async () => {
    await sleep(300);
    const $ = cheerio.load(await html(album.sourceUrl));
    const title = ($("h1").first().text() || $("title").text().split("|")[0] || album.title).replace(/\s+/g, " ").trim();
    const remoteImages = productImages($);
    const images = [];

    for (let index = 0; index < remoteImages.length; index++) {
      try {
        images.push(await saveImage(remoteImages[index], album.sourceId, index));
      } catch (error) {
        console.error(`Foto ${album.sourceId}/${index + 1} mislukt: ${error.message}`);
      }
    }

    return {
      ...album,
      title,
      club: clubFromTitle(title),
      coverUrl: images[0] || null,
      images,
      imageCount: images.length,
      updatedAt: new Date().toISOString()
    };
  });
}

await fs.mkdir("data", { recursive: true });
await fs.rm("assets/albums", { recursive: true, force: true });
await fs.mkdir("assets/albums", { recursive: true });

const collections = await getCollections();
console.log(`Collecties gevonden: ${collections.size}`);

const discovered = [];
for (let page = 1; page <= pages; page++) {
  try {
    discovered.push(...await indexPage(page, collections));
    console.log(`Index ${page}/${pages}`);
  } catch (error) {
    console.error(`Index ${page} mislukt: ${error.message}`);
  }
}

const unique = [...new Map(discovered.map(album => [album.sourceId, album])).values()];
const albums = [];
for (let index = 0; index < unique.length; index++) {
  try {
    albums.push(await detail(unique[index]));
  } catch (error) {
    console.error(`Album ${unique[index].sourceId} mislukt: ${error.message}`);
  }
  if ((index + 1) % 25 === 0) console.log(`Albums verwerkt: ${index + 1}/${unique.length}`);
}

const usable = albums.filter(album => album.images.length > 0);
const competitions = [...new Set(usable.map(album => album.competition))].sort((a, b) => a.localeCompare(b, "nl"));
const output = {
  lastSync: new Date().toISOString(),
  source: base,
  total: usable.length,
  competitions,
  albums: usable,
  warnings: []
};

await fs.writeFile("data/catalog.json.tmp", JSON.stringify(output, null, 2));
await fs.rename("data/catalog.json.tmp", "data/catalog.json");
console.log(`Klaar: ${usable.length} albums met lokale foto's`);
