import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

/*
 * FootballshirtsNL - eenmalig en hervatbaar schoenfotoherstel
 *
 * Dit bestand wijzigt uitsluitend de images, coverUrl en imageCount van
 * bestaande dachang88-producten in data/catalog.json. De indeling van alle
 * producten en alle andere bronnen blijft volledig ongemoeid.
 */

const CATALOG_PATH = "data/catalog.json";
const STATE_PATH = "data/sync-state.json";
const DISCOVERY_PATH = "data/discovery/dachang88.json";
const CACHE_PATH = "data/shoe-photo-repair.json";
const ASSET_ROOT = "assets/products/dachang88";

const CONCURRENCY = numberSetting("SYNC_CONCURRENCY", 2);
const BATCH_SIZE = numberSetting("SYNC_BATCH_SIZE", 25);
const MAX_IMAGES = numberSetting("MAX_IMAGES_PER_ALBUM", 6);
const REQUEST_TIMEOUT = numberSetting("SYNC_REQUEST_TIMEOUT_MS", 45000);
const REQUEST_RETRIES = numberSetting("SYNC_REQUEST_RETRIES", 2);
const REQUEST_DELAY = Math.max(0, Number(process.env.SYNC_DELAY_MS || 250));
const PHOTO_REPAIR_VERSION = 3;
const BASE_URL = "https://dachang88.x.yupoo.com";
const limit = pLimit(CONCURRENCY);

function numberSetting(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unique = values => [...new Set(values.filter(Boolean))];

function absoluteUrl(base, value) {
  if (!value) return "";
  try {
    return new URL(value, base).href;
  } catch {
    return "";
  }
}

function sourceIdFromProduct(product) {
  return String(
    product.sourceId ||
    product.sourceUrl?.match(/\/albums\/(\d+)/)?.[1] ||
    product.uniqueKey?.split(":").at(-1) ||
    ""
  );
}

function albumIdFromUrl(url) {
  return String(url || "").match(/\/albums\/(\d+)/)?.[1] || "";
}

async function exists(file) {
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
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(temporary, file);
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
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 FootballshirtsNL/1.0",
          accept: binary
            ? "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml"
        },
        signal: controller.signal
      });

      if (!response.ok) throw new HttpError(response.status, url);
      return binary
        ? Buffer.from(await response.arrayBuffer())
        : await response.text();
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

function isPossibleProductImage(url = "") {
  const value = String(url).toLowerCase();
  if (!value || !value.includes("photo.yupoo.com")) return false;

  const forbidden = [
    "logo", "avatar", "favicon", "default", "placeholder", "loading",
    "qrcode", "qr_code", "icon", "sprite", "banner", "watermark"
  ];

  return !forbidden.some(word => value.includes(word));
}

function normalizeImageUrl(url) {
  return String(url || "")
    .replace(/\/(small|medium|thumb)\//i, "/large/")
    .replace(/!.*$/, "");
}

function candidateImagesFromHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const candidates = [];

  const add = value => {
    const url = normalizeImageUrl(absoluteUrl(pageUrl, value));
    if (isPossibleProductImage(url)) candidates.push(url);
  };

  $("meta[property='og:image'], meta[name='twitter:image']").each((_, element) => {
    add($(element).attr("content"));
  });

  const productSelectors = [
    ".showalbum__image img",
    ".showalbum__children img",
    ".album__photo img",
    ".photo img",
    "img[data-origin-src]",
    "img[data-src]"
  ];

  $(productSelectors.join(",")).each((_, element) => {
    add($(element).attr("data-origin-src"));
    add($(element).attr("data-src"));
    add($(element).attr("src"));
  });

  return unique(candidates).slice(0, 30);
}

function discoveryMap(discovery) {
  const map = new Map();
  for (const album of discovery?.albums || []) {
    const id = albumIdFromUrl(album.url || album.fetchUrl);
    if (id) map.set(id, album);
  }
  return map;
}

function albumRequestUrls(product, discoveredAlbum) {
  const canonical = product.sourceUrl || discoveredAlbum?.url || `${BASE_URL}/albums/${sourceIdFromProduct(product)}`;
  const discovered = discoveredAlbum?.fetchUrl || discoveredAlbum?.url || "";

  return unique([
    discovered,
    canonical,
    `${canonical}${canonical.includes("?") ? "&" : "?"}uid=1`,
    `${canonical}${canonical.includes("?") ? "&" : "?"}isSubCate=false`
  ]);
}

async function collectCandidates(product, discoveredAlbum) {
  const urls = albumRequestUrls(product, discoveredAlbum);
  let lastError;

  for (const pageUrl of urls) {
    try {
      const html = await request(pageUrl);
      const images = candidateImagesFromHtml(html, pageUrl);
      if (images.length) return { pageUrl, images };
    } catch (error) {
      lastError = error;
    }
  }

  const fallback = normalizeImageUrl(discoveredAlbum?.previewImage || "");
  if (isPossibleProductImage(fallback)) {
    return { pageUrl: urls[0] || product.sourceUrl, images: [fallback] };
  }

  if (lastError) {
    console.warn(`[dachang88] geen albumpagina voor ${sourceIdFromProduct(product)}: ${lastError.message}`);
  }

  return { pageUrl: urls[0] || product.sourceUrl, images: [] };
}

async function validDownloadedImage(url) {
  const buffer = await request(url, true);
  const metadata = await sharp(buffer).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);

  if (width < 300 || height < 300) {
    throw new Error(`afbeelding te klein (${width}x${height})`);
  }

  const ratio = Math.max(width / height, height / width);
  if (!Number.isFinite(ratio) || ratio > 3.5) {
    throw new Error(`ongeldige beeldverhouding (${ratio.toFixed(2)})`);
  }

  return buffer;
}

async function saveRealImage(url, file) {
  const buffer = await validDownloadedImage(url);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await sharp(buffer).rotate().webp({ quality: 82 }).toFile(temporary);
  await fs.rename(temporary, file);
}

function imageFrequency(cache) {
  const frequencies = new Map();
  for (const entry of Object.values(cache.albums || {})) {
    for (const url of unique(entry.images || [])) {
      frequencies.set(url, (frequencies.get(url) || 0) + 1);
    }
  }
  return frequencies;
}

function selectImages(entry, frequencies) {
  return unique(entry?.images || [])
    .filter(url => isPossibleProductImage(url))
    // Een identieke afbeelding bij veel albums is vrijwel zeker een site-logo.
    .filter(url => (frequencies.get(url) || 0) <= 3)
    .slice(0, MAX_IMAGES);
}

async function saveProgress(catalog, state, cache, products, index, phase) {
  cache.phase = phase;
  cache.nextIndex = index;
  cache.updatedAt = new Date().toISOString();

  state.shoePhotoRepair = {
    version: PHOTO_REPAIR_VERSION,
    phase,
    nextIndex: index,
    total: products.length,
    completed: false,
    updatedAt: cache.updatedAt
  };

  catalog.lastSync = cache.updatedAt;
  catalog.status = "running";
  catalog.currentSource = "dachang88-photo-repair";

  await writeJsonAtomic(CACHE_PATH, cache);
  await writeJsonAtomic(STATE_PATH, state);
  await writeJsonAtomic(CATALOG_PATH, catalog);
}

async function main() {
  const catalog = await readJson(CATALOG_PATH, { products: [], warnings: [] });
  const state = await readJson(STATE_PATH, { sources: {} });
  const discovery = await readJson(DISCOVERY_PATH, { albums: [] });

  if (!Array.isArray(catalog.products)) {
    throw new Error("data/catalog.json bevat geen products-lijst");
  }

  const targets = catalog.products.filter(product => product.source === "dachang88");
  if (!targets.length) {
    throw new Error("Geen bestaande dachang88-producten gevonden in data/catalog.json");
  }

  if (Number(state.shoePhotoRepair?.version || 0) === PHOTO_REPAIR_VERSION && state.shoePhotoRepair?.completed === true) {
    console.log(`[dachang88] schoenfotoherstel versie ${PHOTO_REPAIR_VERSION} is al voltooid; niets gewijzigd`);
    return;
  }

  const discovered = discoveryMap(discovery);
  const cache = await readJson(CACHE_PATH, {
    version: PHOTO_REPAIR_VERSION,
    phase: "collect",
    nextIndex: 0,
    albums: {}
  });

  if (cache.version !== PHOTO_REPAIR_VERSION) {
    cache.version = PHOTO_REPAIR_VERSION;
    cache.phase = "collect";
    cache.nextIndex = 0;
    cache.albums = {};
  }

  console.log(`[dachang88] alleen schoenfotoherstel gestart voor ${targets.length} producten`);

  if (cache.phase === "collect") {
    for (let offset = Number(cache.nextIndex || 0); offset < targets.length; offset += BATCH_SIZE) {
      const batch = targets.slice(offset, offset + BATCH_SIZE);
      const results = await Promise.all(batch.map(product => limit(async () => {
        const id = sourceIdFromProduct(product);
        const entry = await collectCandidates(product, discovered.get(id));
        return { id, entry };
      })));

      for (const { id, entry } of results) {
        cache.albums[id] = entry;
      }

      await saveProgress(catalog, state, cache, targets, offset + batch.length, "collect");
      console.log(`[dachang88] fotolinks ${offset + batch.length}/${targets.length} verzameld`);
    }

    cache.phase = "download";
    cache.nextIndex = 0;
    await saveProgress(catalog, state, cache, targets, 0, "download");
  }

  const frequencies = imageFrequency(cache);

  for (let offset = Number(cache.nextIndex || 0); offset < targets.length; offset += BATCH_SIZE) {
    const batch = targets.slice(offset, offset + BATCH_SIZE);

    await Promise.all(batch.map(product => limit(async () => {
      const id = sourceIdFromProduct(product);
      const selected = selectImages(cache.albums[id], frequencies);
      const folder = path.join(ASSET_ROOT, id);
      const stored = [];

      // Pas verwijderen nadat bruikbare, niet-herhaalde productfoto's zijn gevonden.
      if (selected.length) {
        await fs.rm(folder, { recursive: true, force: true });
      }

      for (let index = 0; index < selected.length; index++) {
        const file = path.join(folder, `${String(index + 1).padStart(2, "0")}.webp`);
        try {
          await saveRealImage(selected[index], file);
          stored.push(file.replaceAll(path.sep, "/"));
        } catch (error) {
          console.warn(`[dachang88] ${id} foto ${index + 1} overgeslagen: ${error.message}`);
        }
      }

      if (stored.length) {
        product.images = stored;
        product.coverUrl = stored[0];
        product.imageCount = stored.length;
        product.updatedAt = new Date().toISOString();
      } else {
        // Een oude logo-afbeelding niet opnieuw als geldige foto registreren.
        product.images = [];
        product.coverUrl = "";
        product.imageCount = 0;
        product.updatedAt = new Date().toISOString();
      }
    })));

    await saveProgress(catalog, state, cache, targets, offset + batch.length, "download");
    console.log(`[dachang88] echte schoenfoto's ${offset + batch.length}/${targets.length} verwerkt`);
  }

  const completedAt = new Date().toISOString();
  cache.phase = "completed";
  cache.nextIndex = targets.length;
  cache.completedAt = completedAt;

  state.shoePhotoRepair = {
    version: PHOTO_REPAIR_VERSION,
    phase: "completed",
    nextIndex: targets.length,
    total: targets.length,
    completed: true,
    completedAt
  };

  catalog.lastSync = completedAt;
  catalog.status = "completed";
  delete catalog.currentSource;

  await writeJsonAtomic(CACHE_PATH, cache);
  await writeJsonAtomic(STATE_PATH, state);
  await writeJsonAtomic(CATALOG_PATH, catalog);

  console.log(`[dachang88] schoenfotoherstel voltooid voor ${targets.length} producten`);
}

main().catch(async error => {
  console.error("Schoenfotoherstel mislukt:", error);
  const catalog = await readJson(CATALOG_PATH, { products: [], warnings: [] });
  catalog.status = "failed";
  catalog.failedAt = new Date().toISOString();
  catalog.warnings = [...(catalog.warnings || []), error.message].slice(-200);
  await writeJsonAtomic(CATALOG_PATH, catalog);
  process.exitCode = 1;
});
