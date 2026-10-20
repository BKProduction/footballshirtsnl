import fs from "node:fs/promises";
import * as cheerio from "cheerio";
import pLimit from "p-limit";

const base = process.env.SOURCE_BASE || "https://minkang.x.yupoo.com";
const pages = Number(process.env.SYNC_MAX_PAGES || 66);
const limit = pLimit(Number(process.env.SYNC_CONCURRENCY || 2));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function html(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": process.env.USER_AGENT || "CatalogSync/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  return response.text();
}

function abs(url) {
  if (!url) return null;

  return url.startsWith("http")
    ? url
    : new URL(url, base).href;
}

async function indexPage(page) {
  await sleep(400);

  const $ = cheerio.load(
    await html(`${base}/albums?page=${page}`)
  );

  const albums = [];

  $('a[href*="/albums/"]').each((_, element) => {
    const href = $(element).attr("href");
    const match = href?.match(/\/albums\/(\d+)/);

    if (!match) return;

    const card = $(element).closest(
      "li, .album__main, .showindex__children"
    );

    const title = (
      $(element).attr("title") ||
      card.find(".album__title,.showindex__children__title").text() ||
      $(element).text()
    ).trim();

    albums.push({
      sourceId: match[1],
      title,
      sourceUrl: abs(href)
    });
  });

  return [
    ...new Map(
      albums.map(album => [album.sourceId, album])
    ).values()
  ];
}

async function detail(album) {
  return limit(async () => {
    await sleep(500);

    const $ = cheerio.load(
      await html(album.sourceUrl)
    );

    const title = (
      $("h1").first().text() ||
      $("title").text().split("|")[0] ||
      album.title
    ).trim();

    const images = [];

    $("img").each((_, element) => {
      const src =
        $(element).attr("data-origin-src") ||
        $(element).attr("data-src") ||
        $(element).attr("src");

      if (!src) return;

      const url = abs(src);

      // Alleen echte Minkang productfoto's.
      // Logo's, iconen, data-images en Yupoo interfacebeelden
      // worden hierdoor niet meegenomen.
      if (
        !url ||
        !url.startsWith("https://photo.yupoo.com/minkang/")
      ) {
        return;
      }

      images.push(url);
    });

    const uniqueImages = [...new Set(images)];

    return {
      ...album,

      title,

      // Eerste echte productfoto wordt de albumcover.
      coverUrl:
        uniqueImages.length > 0
          ? uniqueImages[0]
          : null,

      images: uniqueImages,

      updatedAt: new Date().toISOString()
    };
  });
}

await fs.mkdir("data", {
  recursive: true
});

let previous = {
  albums: []
};

try {
  previous = JSON.parse(
    await fs.readFile(
      "data/catalog.json",
      "utf8"
    )
  );
} catch {
  // Eerste synchronisatie: nog geen bestaande catalogus.
}

const discovered = [];

for (let page = 1; page <= pages; page++) {
  try {
    const pageAlbums =
      await indexPage(page);

    discovered.push(...pageAlbums);

    console.log(
      `index ${page}/${pages}`
    );
  } catch (error) {
    console.error(
      `Index ${page} mislukt:`,
      error.message
    );
  }
}

const unique = [
  ...new Map(
    discovered.map(album => [
      album.sourceId,
      album
    ])
  ).values()
];

const old = new Map(
  previous.albums.map(album => [
    album.sourceId,
    album
  ])
);

const albums = [];

for (const album of unique) {
  try {
    albums.push(
      await detail(album)
    );
  } catch (error) {
    const previousAlbum =
      old.get(album.sourceId);

    if (previousAlbum) {
      albums.push(previousAlbum);
    } else {
      albums.push({
        ...album,
        coverUrl: null,
        images: [],
        error: error.message
      });
    }
  }
}

const output = {
  lastSync: new Date().toISOString(),
  source: base,
  total: albums.length,
  albums,
  warnings: []
};

await fs.writeFile(
  "data/catalog.json.tmp",
  JSON.stringify(output, null, 2)
);

await fs.rename(
  "data/catalog.json.tmp",
  "data/catalog.json"
);

console.log(
  `Klaar: ${albums.length} albums`
);

console.log(
  `Albums met foto's: ${
    albums.filter(
      album =>
        album.images &&
        album.images.length > 0
    ).length
  }`
);
