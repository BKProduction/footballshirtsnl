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
