import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const SOURCES = [
  {
    key: "minkang",
    base: "https://minkang.x.yupoo.com",
    imageHost: "photo.yupoo.com/minkang",
    priority: 1,
    seedCategories: ["718623"]
  },
  {
    key: "yema007",
    base: "https://yema007.x.yupoo.com",
    imageHost: "photo.yupoo.com/yema007",
    priority: 2,
    seedCategories: []
  },
  {
    key: "popmo",
    base: "https://popmo.x.yupoo.com",
    imageHost: "photo.yupoo.com/popmo",
    priority: 3,
    seedCategories: []
  }
];

const MAX_INDEX_PAGES = Math.max(
  1,
  Number(process.env.SYNC_MAX_PAGES || 100)
);

const MAX_CATEGORY_PAGES = Math.max(
  1,
  Number(process.env.SYNC_CATEGORY_MAX_PAGES || 100)
);

const MAX_COLLECTION_PAGES = Math.max(
  1,
  Number(process.env.SYNC_COLLECTION_MAX_PAGES || 100)
);

const MAX_IMAGES = Math.max(
  1,
  Number(process.env.MAX_IMAGES_PER_ALBUM || 6)
);

const CONCURRENCY = Math.max(
  1,
  Number(process.env.SYNC_CONCURRENCY || 2)
);

const REQUEST_DELAY = Math.max(
  0,
  Number(process.env.SYNC_DELAY_MS || 180)
);

const limit = pLimit(CONCURRENCY);

const sleep = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

const COUNTRY_TEAMS = [
  "Argentina",
  "Australia",
  "Austria",
  "Belgium",
  "Brazil",
  "Canada",
  "Chile",
  "China",
  "Colombia",
  "Croatia",
  "Denmark",
  "Ecuador",
  "England",
  "France",
  "Germany",
  "Ghana",
  "Italy",
  "Japan",
  "Mexico",
  "Morocco",
  "Netherlands",
  "Nigeria",
  "Norway",
  "Poland",
  "Portugal",
  "Saudi Arabia",
  "Scotland",
  "Senegal",
  "South Korea",
  "Spain",
  "Sweden",
  "Switzerland",
  "Turkey",
  "Tunisia",
  "Uruguay",
  "USA",
  "United States",
  "Wales"
];

const LEAGUES = [
  {
    country: "Engeland",
    competition: "Premier League",
    clubs: [
      "Arsenal",
      "Aston Villa",
      "Bournemouth",
      "Brentford",
      "Brighton",
      "Burnley",
      "Chelsea",
      "Crystal Palace",
      "Everton",
      "Fulham",
      "Leeds United",
      "Liverpool",
      "Manchester City",
      "Manchester United",
      "M-U",
      "Newcastle United",
      "Nottingham Forest",
      "Sunderland",
      "Tottenham",
      "West Ham",
      "Wolverhampton",
      "Wolves"
    ]
  },
  {
    country: "Spanje",
    competition: "La Liga",
    clubs: [
      "Alavés",
      "Athletic Bilbao",
      "Atlético Madrid",
      "Barcelona",
      "Celta Vigo",
      "Elche",
      "Espanyol",
      "Getafe",
      "Girona",
      "Levante",
      "Mallorca",
      "Osasuna",
      "Rayo Vallecano",
      "Real Betis",
      "Real Madrid",
      "Real Oviedo",
      "Real Sociedad",
      "Sevilla",
      "Valencia",
      "Villarreal"
    ]
  },
  {
    country: "Italië",
    competition: "Serie A",
    clubs: [
      "AC Milan",
      "Atalanta",
      "Bologna",
      "Cagliari",
      "Como",
      "Cremonese",
      "Fiorentina",
      "Genoa",
      "Inter Milan",
      "Inter",
      "Juventus",
      "Lazio",
      "Lecce",
      "Napoli",
      "Parma",
      "Pisa",
      "Roma",
      "Sassuolo",
      "Torino",
      "Udinese",
      "Venezia",
      "Verona"
    ]
  },
  {
    country: "Duitsland",
    competition: "Bundesliga",
    clubs: [
      "Augsburg",
      "Bayer Leverkusen",
      "Bayern Munich",
      "Borussia Dortmund",
      "Borussia Mönchengladbach",
      "Eintracht Frankfurt",
      "FC Köln",
      "Freiburg",
      "Hamburg",
      "Heidenheim",
      "Hoffenheim",
      "Mainz",
      "RB Leipzig",
      "St. Pauli",
      "Stuttgart",
      "Union Berlin",
      "Werder Bremen",
      "Wolfsburg"
    ]
  },
  {
    country: "Frankrijk",
    competition: "Ligue 1",
    clubs: [
      "Auxerre",
      "Angers",
      "Brest",
      "Le Havre",
      "Lens",
      "Lille",
      "Lorient",
      "Lyon",
      "Marseille",
      "Metz",
      "Monaco",
      "Nantes",
      "Nice",
      "Paris FC",
      "PSG",
      "Rennes",
      "Strasbourg",
      "Toulouse"
    ]
  },
  {
    country: "Nederland",
    competition: "Eredivisie",
    clubs: [
      "Ajax",
      "AZ Alkmaar",
      "Excelsior",
      "Feyenoord",
      "Fortuna Sittard",
      "Go Ahead Eagles",
      "Groningen",
      "Heerenveen",
      "Heracles",
      "NAC Breda",
      "NEC",
      "PEC Zwolle",
      "PSV",
      "Sparta Rotterdam",
      "Telstar",
      "Twente",
      "Utrecht",
      "Volendam"
    ]
  },
  {
    country: "Brazilië",
    competition: "Brasileiro Série A",
    clubs: [
      "Atlético Mineiro",
      "Bahia",
      "Botafogo",
      "Bragantino",
      "Ceará",
      "Corinthians",
      "Cruzeiro",
      "Flamengo",
      "Fluminense",
      "Fortaleza",
      "Grêmio",
      "Gremio",
      "Internacional",
      "Juventude",
      "Mirassol",
      "Palmeiras",
      "Santos",
      "São Paulo",
      "Sport Recife",
      "Vasco da Gama",
      "Vitória"
    ]
  },
  {
    country: "Portugal",
    competition: "Primeira Liga",
    clubs: [
      "Benfica",
      "Boavista",
      "Braga",
      "Casa Pia",
      "Estoril",
      "Famalicão",
      "Farense",
      "Gil Vicente",
      "Moreirense",
      "Nacional",
      "Porto",
      "Rio Ave",
      "Santa Clara",
      "Sporting CP",
      "Vitória SC"
    ]
  },
  {
    country: "Schotland",
    competition: "Scottish Premiership",
    clubs: [
      "Aberdeen",
      "Celtic",
      "Dundee",
      "Dundee United",
      "Falkirk",
      "Hearts",
      "Hibernian",
      "Kilmarnock",
      "Livingston",
      "Motherwell",
      "Rangers",
      "St Mirren"
    ]
  },
  {
    country: "Verenigde Staten",
    competition: "MLS",
    clubs: [
      "Atlanta United",
      "Austin FC",
      "Charlotte FC",
      "Chicago Fire",
      "Columbus Crew",
      "DC United",
      "Inter Miami",
      "LA Galaxy",
      "Los Angeles FC",
      "Nashville SC",
      "New York City",
      "New York Red Bulls",
      "Orlando City",
      "Philadelphia Union",
      "Portland Timbers",
      "Seattle Sounders",
      "Toronto FC",
      "Vancouver Whitecaps"
    ]
  }
];

const CATEGORY_OVERRIDES = {
  "minkang:718623": {
    section: "Voetbal",
    category: "Clubteams",
    subcategory: "La Liga",
    country: "Spanje",
    competition: "La Liga",
    club: "Barcelona"
  }
};

const NON_PRODUCT =
  /whats?app|contact|call me|feedback|faq|shipping|service center|how to (place )?order|how to buy|como comprar|size chart|business|notice|existing customers|tik ?tok|video$/i;

function normalize(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function textOf($, element) {
  return (
    $(element).attr("title") ||
    $(element).text() ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function absolute(source, url) {
  if (!url) return null;

  try {
    return url.startsWith("http")
      ? url
      : new URL(url, source.base).href;
  } catch {
    return null;
  }
}

function albumId(url = "") {
  return url.match(/\/albums\/(\d+)/)?.[1] || null;
}

function categoryId(url = "") {
  return url.match(/\/categories\/(\d+)/)?.[1] || null;
}

function collectionId(url = "") {
  return (
    url.match(/\/collections\/(\d+)/)?.[1] ||
    url.match(/[?&]referrercate=(\d+)/)?.[1] ||
    null
  );
}

function startsWithName(title, name) {
  const normalizedTitle = normalize(title);
  const normalizedName = normalize(name);

  return (
    normalizedTitle === normalizedName ||
    normalizedTitle.startsWith(`${normalizedName} `) ||
    normalizedTitle.includes(` ${normalizedName} `)
  );
}

function productTypes(title) {
  const normalizedTitle = normalize(title);
  const output = [];

  if (/\bretro\b/.test(normalizedTitle)) {
    output.push("Retro");
  }

  if (/\b(kids?|baby|youth)\b/.test(normalizedTitle)) {
    output.push("Kids");
  }

  if (/\b(women|womens|ladies)\b/.test(normalizedTitle)) {
    output.push("Dames");
  }

  if (/\btraining|pre match|tracksuit\b/.test(normalizedTitle)) {
    output.push("Training");
  }

  if (/\bgoalkeeper\b/.test(normalizedTitle)) {
    output.push("Keepers");
  }

  if (/\blong sleeve\b/.test(normalizedTitle)) {
    output.push("Lange mouw");
  }

  if (/\bplayer version\b/.test(normalizedTitle)) {
    output.push("Player version");
  }

  if (
    /\bspecial edition|commemorative|anniversary\b/.test(
      normalizedTitle
    )
  ) {
    output.push("Special edition");
  }

  return output;
}

function clubFromTitle(title = "") {
  const cleaned = title.replace(/^\d+\s*/, "").trim();

  const position = cleaned.search(
    /\b(?:19|20)?\d{2}[/-]\d{2}\b|\b\d{2}[/-]\d{2}\b|\b202[0-9]\b/i
  );

  if (position > 0) {
    return cleaned.slice(0, position).trim();
  }

  return (
    cleaned.split(/\s+/).slice(0, 3).join(" ") ||
    "Overig"
  );
}

function productClass(
  title,
  sourceCollection = "",
  sourceCategory = "",
  sourceKey = "",
  catId = null
) {
  const override =
    CATEGORY_OVERRIDES[`${sourceKey}:${catId}`];

  if (override) {
    return {
      ...override,
      types: productTypes(title)
    };
  }

  const all = normalize(
    `${title} ${sourceCollection} ${sourceCategory}`
  );

  if (
    /\b(handbag|hand bag|shoulder bag|tote bag|crossbody|clutch|purse|wallet|backpack|rucksack|travel bag|duffle|duffel|bag)\b/.test(
      all
    )
  ) {
    return {
      section: "Mode & accessoires",
      category: "Tassen",
      subcategory: /backpack|rucksack/.test(all)
        ? "Rugzakken"
        : /travel|duff/.test(all)
          ? "Reistassen"
          : /wallet|purse/.test(all)
            ? "Portemonnees"
            : "Handtassen",
      country: "Overig",
      competition: "",
      club: "",
      types: []
    };
  }

  if (
    /\b(watch|watches|chronograph|timepiece)\b/.test(all)
  ) {
    return {
      section: "Mode & accessoires",
      category: "Horloges",
      subcategory: "Horloges",
      country: "Overig",
      competition: "",
      club: "",
      types: []
    };
  }

  if (/\b(belt|belts)\b/.test(all)) {
    return {
      section: "Mode & accessoires",
      category: "Riemen",
      subcategory: "Riemen",
      country: "Overig",
      competition: "",
      club: "",
      types: []
    };
  }

  if (
    /\b(shoe|shoes|sneaker|sneakers|trainer shoes|boots|sandals|slippers|cleats)\b/.test(
      all
    )
  ) {
    return {
      section: "Schoenen",
      category: "Schoenen",
      subcategory: /cleats|football boots/.test(all)
        ? "Voetbalschoenen"
        : /sandals|slippers/.test(all)
          ? "Sandalen & slippers"
          : "Sneakers",
      country: "Overig",
      competition: "",
      club: "",
      types: []
    };
  }

  if (
    /\b(ball|football|soccer ball|basketball|volleyball)\b/.test(
      all
    ) &&
    !/shirt|jersey|kit|clothes|uniform/.test(all)
  ) {
    return {
      section: "Sportartikelen",
      category: "Ballen",
      subcategory: /basketball/.test(all)
        ? "Basketballen"
        : /volleyball/.test(all)
          ? "Volleyballen"
          : "Voetballen",
      country: "Overig",
      competition: "",
      club: "",
      types: []
    };
  }

  if (
    /\b(cap|hat|scarf|glove|sunglasses|jewelry|necklace|bracelet|earring|sock|socks)\b/.test(
      all
    )
  ) {
    return {
      section: "Mode & accessoires",
      category: "Accessoires",
      subcategory: "Accessoires",
      country: "Overig",
      competition: "",
      club: "",
      types: []
    };
  }

  const nationalTeam = COUNTRY_TEAMS.find(name =>
    startsWithName(title, name)
  );

  if (nationalTeam) {
    return {
      section: "Voetbal",
      category: "Landenteams",
      subcategory: "WK & landenteams",
      country: nationalTeam,
      competition: "WK & landenteams",
      club: nationalTeam,
      types: productTypes(title)
    };
  }

  for (const league of LEAGUES) {
    const club = [...league.clubs]
      .sort((first, second) => second.length - first.length)
      .find(name => startsWithName(title, name));

    if (club) {
      return {
        section: "Voetbal",
        category: "Clubteams",
        subcategory: league.competition,
        country: league.country,
        competition: league.competition,
        club,
        types: productTypes(title)
      };
    }
  }

  if (
    /\b(jersey|shirt|football|soccer|kit|uniform|training|windbreaker|tracksuit)\b/.test(
      all
    )
  ) {
    return {
      section: "Voetbal",
      category: "Overige voetbalproducten",
      subcategory:
        sourceCategory ||
        sourceCollection ||
        "Overig",
      country: "Overig",
      competition:
        sourceCategory ||
        sourceCollection ||
        "Overig",
      club: clubFromTitle(title),
      types: productTypes(title)
    };
  }

  if (
    /\b(t shirt|tshirt|hoodie|sweater|jacket|coat|pants|shorts|dress|skirt|clothing|apparel)\b/.test(
      all
    )
  ) {
    return {
      section: "Mode & kleding",
      category: "Kleding",
      subcategory:
        sourceCategory ||
        sourceCollection ||
        "Overige kleding",
      country: "Overig",
      competition: "",
      club: "",
      types: []
    };
  }

  return {
    section: "Overige producten",
    category: "Overige producten",
    subcategory:
      sourceCategory ||
      sourceCollection ||
      "Nog te categoriseren",
    country: "Overig",
    competition: "",
    club: "",
    types: []
  };
}

async function request(source, url, attempt = 1) {
  await sleep(REQUEST_DELAY);

  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 FootballshirtsNL-MultiSourceSync/1.0",
      "accept-language":
        "nl-NL,nl;q=0.9,en;q=0.8",
      referer: `${source.base}/`
    }
  });

  if (
    (response.status === 429 || response.status >= 500) &&
    attempt < 4
  ) {
    await sleep(1000 * attempt);
    return request(source, url, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  return response;
}

async function html(source, url) {
  const response = await request(source, url);
  return response.text();
}

async function loadPrevious() {
  try {
    return JSON.parse(
      await fs.readFile("data/catalog.json", "utf8")
    );
  } catch {
    return {
      products: [],
      albums: []
    };
  }
}

function pageTitle($, fallback = "") {
  return (
    $("h1").first().text() ||
    $("title").text().split("|")[0] ||
    fallback
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks($, source, context = {}) {
  const products = [];

  $('a[href*="/albums/"]').each((_, element) => {
    const href = $(element).attr("href");
    const sourceId = albumId(href);

    if (!sourceId) return;

    const card = $(element).closest(
      "li,.album__main,.showindex__children,.album__item"
    );

    const title = (
      $(element).attr("title") ||
      card
        .find(
          ".album__title,.showindex__children__title"
        )
        .text() ||
      $(element).text()
    )
      .replace(/\s+/g, " ")
      .trim();

    if (!title || NON_PRODUCT.test(title)) return;

    const foundCategoryId =
      context.categoryId || categoryId(href);

    const foundCollectionId =
      context.collectionId || collectionId(href);

    const sourceCollection =
      context.sourceCollection || "";

    const sourceCategory =
      context.sourceCategory || "";

    products.push({
      source: source.key,
      sourcePriority: source.priority,
      sourceId: String(sourceId),
      uniqueKey: `${source.key}:${sourceId}`,
      title,
      sourceUrl: absolute(source, href),
      categoryId: foundCategoryId,
      collectionId: foundCollectionId,
      sourceCollection,
      sourceCategory,
      ...productClass(
        title,
        sourceCollection,
        sourceCategory,
        source.key,
        foundCategoryId
      )
    });
  });

  return [
    ...new Map(
      products.map(product => [
        product.uniqueKey,
        product
      ])
    ).values()
  ];
}

function extractNavigation($, source) {
  const categories = new Map();
  const collections = new Map();

  $('a[href*="/categories/"]').each((_, element) => {
    const href = $(element).attr("href");
    const id = categoryId(href);

    if (!id) return;

    categories.set(id, {
      id,
      name: textOf($, element),
      url: `${source.base}/categories/${id}?isSubCate=true`
    });
  });

  $('a[href*="/collections/"]').each((_, element) => {
    const href = $(element).attr("href");
    const id = collectionId(href);

    if (!id) return;

    collections.set(id, {
      id,
      name: textOf($, element),
      url: `${source.base}/collections/${id}`
    });
  });

  return {
    categories: [...categories.values()],
    collections: [...collections.values()]
  };
}

async function discoverSeeds(source) {
  const categories = new Map(
    (source.seedCategories || []).map(id => [
      id,
      {
        id,
        name: "",
        url: `${source.base}/categories/${id}?isSubCate=true`
      }
    ])
  );

  const collections = new Map();

  for (const url of [
    `${source.base}/`,
    `${source.base}/albums`,
    `${source.base}/categories`
  ]) {
    try {
      const $ = cheerio.load(await html(source, url));
      const navigation = extractNavigation($, source);

      for (const item of navigation.categories) {
        categories.set(item.id, item);
      }

      for (const item of navigation.collections) {
        collections.set(item.id, item);
      }
    } catch (error) {
      console.error(
        `[${source.key}] navigatie ${url}: ${error.message}`
      );
    }
  }

  return {
    categories: [...categories.values()],
    collections: [...collections.values()]
  };
}

async function crawlPaged(
  source,
  urlFactory,
  maxPages,
  context
) {
  const products = [];
  let emptyPages = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = urlFactory(page);

    try {
      const $ = cheerio.load(await html(source, url));

      const name = pageTitle(
        $,
        context.name || ""
      );

      const found = extractLinks($, source, {
        ...context,
        sourceCategory:
          context.sourceCategory || name,
        sourceCollection:
          context.sourceCollection || name
      });

      products.push(...found);

      console.log(
        `[${source.key}] ${context.kind} ${context.id || "index"} pagina ${page}: ${found.length}`
      );

      emptyPages = found.length
        ? 0
        : emptyPages + 1;

      if (emptyPages >= 2) {
        break;
      }
    } catch (error) {
      console.error(
        `[${source.key}] ${context.kind} ${context.id || "index"} pagina ${page}: ${error.message}`
      );

      break;
    }
  }

  return products;
}

async function discoverSource(source) {
  const found = [];

  found.push(
    ...await crawlPaged(
      source,
      page => `${source.base}/albums?page=${page}`,
      MAX_INDEX_PAGES,
      {
        kind: "index",
        name: ""
      }
    )
  );

  const seeds = await discoverSeeds(source);

  for (const category of seeds.categories) {
    found.push(
      ...await crawlPaged(
        source,
        page =>
          `${source.base}/categories/${category.id}?isSubCate=true&page=${page}`,
        MAX_CATEGORY_PAGES,
        {
          kind: "categorie",
          id: category.id,
          name: category.name,
          categoryId: category.id,
          sourceCategory: category.name
        }
      )
    );
  }

  for (const collection of seeds.collections) {
    found.push(
      ...await crawlPaged(
        source,
        page =>
          `${source.base}/collections/${collection.id}?page=${page}`,
        MAX_COLLECTION_PAGES,
        {
          kind: "collectie",
          id: collection.id,
          name: collection.name,
          collectionId: collection.id,
          sourceCollection: collection.name
        }
      )
    );
  }

  return [
    ...new Map(
      found.map(product => [
        product.uniqueKey,
        product
      ])
    ).values()
  ];
}

function sourceImageUrls($, source) {
  const urls = [];

  $("img").each((_, element) => {
    const raw =
      $(element).attr("data-origin-src") ||
      $(element).attr("data-src") ||
      $(element).attr("data-lazy") ||
      $(element).attr("src");

    const url = absolute(source, raw);

    if (!url) return;

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      return;
    }

    const host = parsed.host.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (
      host !== "photo.yupoo.com" &&
      !host.endsWith(".yupoo.com")
    ) {
      return;
    }

    if (
      source.imageHost &&
      !url
        .toLowerCase()
        .includes(source.imageHost.toLowerCase())
    ) {
      return;
    }

    if (
      /\/(square|small|thumb)[^/]*\.(jpg|jpeg|png|webp)$/.test(
        pathname
      )
    ) {
      return;
    }

    urls.push(url);
  });

  return unique(urls).slice(0, MAX_IMAGES);
}

async function inspectProduct(product) {
  const source = SOURCES.find(
    item => item.key === product.source
  );

  return limit(async () => {
    const $ = cheerio.load(
      await html(source, product.sourceUrl)
    );

    const title = pageTitle($, product.title);
    const sourceImages = sourceImageUrls($, source);

    return {
      ...product,
      title,
      ...productClass(
        title,
        product.sourceCollection,
        product.sourceCategory,
        product.source,
        product.categoryId
      ),
      sourceImages
    };
  });
}

async function fileExists(file) {
  if (!file) return false;

  try {
    await fs.access(
      file.replace(/^\.\//, "")
    );

    return true;
  } catch {
    return false;
  }
}

async function localImagesExist(product) {
  if (!product?.images?.length) {
    return false;
  }

  const checks = await Promise.all(
    product.images.map(image => fileExists(image))
  );

  return checks.every(Boolean);
}

function localImageLocation(product, index) {
  const directory = path.join(
    "assets",
    "products",
    product.source,
    String(product.sourceId)
  );

  const filename =
    `${String(index + 1).padStart(2, "0")}.webp`;

  const file = path.join(
    directory,
    filename
  );

  return {
    directory,
    file,
    publicPath:
      `./${file.replaceAll(path.sep, "/")}`
  };
}

async function saveImage(product, url, index) {
  const location = localImageLocation(
    product,
    index
  );

  await fs.mkdir(
    location.directory,
    { recursive: true }
  );

  /*
   * Een bestaande afbeelding wordt niet opnieuw
   * gedownload of verwerkt.
   */
  if (await fileExists(location.file)) {
    console.log(
      `[${product.source}] Foto ${product.sourceId}/${index + 1} bestaat al; behouden`
    );

    return location.publicPath;
  }

  const source = SOURCES.find(
    item => item.key === product.source
  );

  const response = await request(source, url);

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  /*
   * Eerst naar een tijdelijk bestand schrijven.
   * Daardoor blijft bij een fout geen beschadigd
   * definitief webp-bestand achter.
   */
  const temporaryFile =
    `${location.file}.tmp`;

  try {
    await sharp(buffer)
      .rotate()
      .resize({
        width: index === 0 ? 700 : 1200,
        withoutEnlargement: true
      })
      .webp({
        quality: 80
      })
      .toFile(temporaryFile);

    await fs.rename(
      temporaryFile,
      location.file
    );

    console.log(
      `[${product.source}] Foto ${product.sourceId}/${index + 1} opgeslagen`
    );

    return location.publicPath;
  } catch (error) {
    try {
      await fs.rm(
        temporaryFile,
        { force: true }
      );
    } catch {
      // Tijdelijk bestand bestond niet meer.
    }

    throw error;
  }
}

async function downloadProduct(
  product,
  oldProduct = null
) {
  const images = [];

  for (
    let index = 0;
    index < product.sourceImages.length;
    index++
  ) {
    const url = product.sourceImages[index];

    const location = localImageLocation(
      product,
      index
    );

    /*
     * Als bijvoorbeeld 01.webp al bestaat,
     * wordt het bestand direct hergebruikt.
     */
    if (await fileExists(location.file)) {
      images.push(location.publicPath);

      console.log(
        `[${product.source}] Foto ${product.sourceId}/${index + 1} bestaat al; niet opnieuw gedownload`
      );

      continue;
    }

    /*
     * Controleer ook of het oude catalogusrecord
     * op deze positie een geldig bestand heeft.
     */
    const oldImage =
      oldProduct?.images?.[index];

    if (
      oldImage &&
      await fileExists(oldImage)
    ) {
      images.push(oldImage);

      console.log(
        `[${product.source}] Foto ${product.sourceId}/${index + 1} uit bestaande catalogus behouden`
      );

      continue;
    }

    try {
      const savedImage = await saveImage(
        product,
        url,
        index
      );

      images.push(savedImage);
    } catch (error) {
      console.error(
        `[${product.source}] Foto ${product.sourceId}/${index + 1}: ${error.message}`
      );

      /*
       * Als een download mislukt, wordt een eventueel
       * bestaand oud bestand niet uit de catalogus verwijderd.
       */
      if (
        oldImage &&
        await fileExists(oldImage)
      ) {
        images.push(oldImage);

        console.log(
          `[${product.source}] Oude foto ${product.sourceId}/${index + 1} na downloadfout behouden`
        );
      }
    }
  }

  /*
   * Bestaande geldige afbeeldingen behouden wanneer
   * de bron tijdelijk minder afbeeldingen teruggeeft.
   */
  for (const oldImage of oldProduct?.images || []) {
    if (
      images.length >= MAX_IMAGES
    ) {
      break;
    }

    if (
      !images.includes(oldImage) &&
      await fileExists(oldImage)
    ) {
      images.push(oldImage);
    }
  }

  const limitedImages =
    images.slice(0, MAX_IMAGES);

  return {
    ...product,
    coverUrl:
      limitedImages[0] ||
      oldProduct?.coverUrl ||
      null,
    images: limitedImages,
    imageCount: limitedImages.length,
    updatedAt: new Date().toISOString()
  };
}

const sameArray = (first = [], second = []) =>
  first.length === second.length &&
  first.every(
    (value, index) => value === second[index]
  );

function duplicateKey(product) {
  return normalize(
    [
      product.title,
      product.section,
      product.category,
      product.subcategory,
      product.club
    ].join(" ")
  );
}

await fs.mkdir(
  "data",
  { recursive: true }
);

await fs.mkdir(
  "assets/products",
  { recursive: true }
);

const previous = await loadPrevious();

const previousProducts =
  previous.products ||
  previous.albums ||
  [];

const previousByKey = new Map(
  previousProducts.map(product => [
    product.uniqueKey ||
      `${product.source || "minkang"}:${product.sourceId}`,
    product
  ])
);

const discovered = [];

for (const source of SOURCES) {
  try {
    const sourceProducts =
      await discoverSource(source);

    discovered.push(...sourceProducts);

    console.log(
      `[${source.key}] totaal ontdekt: ${sourceProducts.length}`
    );
  } catch (error) {
    console.error(
      `[${source.key}] bron overgeslagen: ${error.message}`
    );
  }
}

const current = [
  ...new Map(
    discovered.map(product => [
      product.uniqueKey,
      product
    ])
  ).values()
];

const inspected = await Promise.all(
  current.map(async product => {
    try {
      return await inspectProduct(product);
    } catch (error) {
      console.error(
        `[${product.source}] Albumcontrole ${product.sourceId}: ${error.message}`
      );

      return {
        ...product,
        inspectionFailed: true
      };
    }
  })
);

const products = [];

let added = 0;
let changed = 0;
let unchanged = 0;
let repaired = 0;
let skipped = 0;

for (const item of inspected) {
  const old = previousByKey.get(
    item.uniqueKey
  );

  const assetsOkay = old
    ? await localImagesExist(old)
    : false;

  if (item.inspectionFailed) {
    if (old && assetsOkay) {
      products.push(old);
      skipped++;
    }

    continue;
  }

  const metadataChanged =
    Boolean(old) &&
    [
      "title",
      "section",
      "category",
      "subcategory",
      "country",
      "competition",
      "club",
      "sourceCollection",
      "sourceCategory",
      "categoryId",
      "collectionId"
    ].some(key => old[key] !== item[key]);

  const remoteChanged =
    !old ||
    !Array.isArray(old.sourceImages) ||
    !sameArray(
      old.sourceImages,
      item.sourceImages
    );

  /*
   * Ook opnieuw verwerken wanneer het bestaande product
   * minder afbeeldingen heeft dan de bron nu aanbiedt.
   */
  const missingImages =
    Boolean(old) &&
    (old.images?.length || 0) <
      Math.min(
        item.sourceImages.length,
        MAX_IMAGES
      );

  const needsDownload =
    !old ||
    !assetsOkay ||
    remoteChanged ||
    missingImages;

  if (!needsDownload) {
    products.push({
      ...old,
      ...item,
      images: old.images,
      coverUrl:
        old.coverUrl ||
        old.images?.[0] ||
        null,
      imageCount:
        old.images?.length || 0,
      updatedAt: old.updatedAt
    });

    if (metadataChanged) {
      changed++;
    } else {
      unchanged++;
    }

    continue;
  }

  try {
    const imported = await downloadProduct(
      item,
      old
    );

    if (imported.images.length) {
      products.push(imported);

      if (!old) {
        added++;
      } else if (!assetsOkay) {
        repaired++;
      } else {
        changed++;
      }
    } else if (old && assetsOkay) {
      products.push(old);
      skipped++;
    }
  } catch (error) {
    console.error(
      `[${item.source}] Product ${item.sourceId}: ${error.message}`
    );

    if (old && assetsOkay) {
      products.push(old);
      skipped++;
    }
  }
}

const winners = new Map();

for (const product of products) {
  const key = duplicateKey(product);
  const currentWinner = winners.get(key);

  if (
    !currentWinner ||
    product.sourcePriority <
      currentWinner.sourcePriority
  ) {
    winners.set(key, product);
  }
}

const cleanProducts = [
  ...winners.values()
]
  .filter(product => product.images?.length)
  .sort(
    (first, second) =>
      first.section.localeCompare(
        second.section,
        "nl"
      ) ||
      first.category.localeCompare(
        second.category,
        "nl"
      ) ||
      first.title.localeCompare(
        second.title,
        "nl"
      )
  );

const sections = unique(
  cleanProducts.map(product => product.section)
).sort((first, second) =>
  first.localeCompare(second, "nl")
);

const categories = unique(
  cleanProducts.map(product => product.category)
).sort((first, second) =>
  first.localeCompare(second, "nl")
);

const competitions = unique(
  cleanProducts.map(
    product => product.competition
  )
).sort((first, second) =>
  first.localeCompare(second, "nl")
);

const stable = {
  sources: SOURCES.map(
    ({ key, base, priority }) => ({
      key,
      base,
      priority
    })
  ),
  total: cleanProducts.length,
  sections,
  categories,
  competitions,
  products: cleanProducts
};

const oldStable = {
  sources: previous.sources,
  total: previous.total,
  sections: previous.sections,
  categories: previous.categories,
  competitions: previous.competitions,
  products:
    previous.products ||
    previous.albums
};

if (
  JSON.stringify(stable) !==
  JSON.stringify(oldStable)
) {
  const output = {
    lastSync: new Date().toISOString(),
    stats: {
      discovered: current.length,
      added,
      changed,
      unchanged,
      repaired,
      skipped,
      duplicatesRemoved:
        products.length -
        cleanProducts.length
    },
    ...stable
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
    `Bijgewerkt: ${cleanProducts.length} producten; nieuw ${added}, gewijzigd ${changed}, hersteld ${repaired}, dubbelen verwijderd ${products.length - cleanProducts.length}`
  );
} else {
  console.log(
    "Geen inhoudelijke wijzigingen; catalogus niet aangepast."
  );
}
