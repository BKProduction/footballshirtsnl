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

const BATCH_SIZE = Math.max(
  1,
  Number(process.env.SYNC_BATCH_SIZE || 25)
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
    url.match(/[?&
