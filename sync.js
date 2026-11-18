import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG = "data/catalog.json";
const STATE = "data/sync-state.json";
const ASSETS = "assets/products";

const SOURCES = [
  {
    key: "minkang",
    base: "https://minkang.x.yupoo.com"
  },
  {
    key: "yema007",
    base: "https://yema007.x.yupoo.com"
  },
  {
    key: "popmo",
    base: "https://popmo.x.yupoo.com"
  },
  {
    key: "407131796",
    base: "https://407131796.x.yupoo.com"
  },
  {
    key: "yuhuaxieye1",
    base: "https://yuhuaxieye1.x.yupoo.com"
  },
  {
    key: "hema168",
    base: "https://hema168.x.yupoo.com"
  },
  {
    key: "dachang88",
    base: "https://dachang88.x.yupoo.com",
    mode: "shoes"
  },
  {
    key: "dongshanstore",
    base: "https://dongshanstore.x.yupoo.com",
    mode: "training"
  },
  {
    key: "aosendi",
    base: "https://aosendi.x.yupoo.com",
    mode: "training"
  }
];

const RUN = new Date().toISOString().slice(0, 10);
const BATCH = 25;
const MAX_PAGES = 100;
const MAX_IMAGES = 6;
const CLASSIFICATION_VERSION = 3;
const SHOE_PHOTO_VERSION = 8;

const limit = pLimit(2);

const sleep = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

const unique = values =>
  [...new Set(values.filter(Boolean))];

const norm = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const has = (text, words) => {
  const normalizedText = norm(text);

  return words.some(word => {
    const normalizedWord = norm(word);
    return normalizedWord && normalizedText.includes(normalizedWord);
  });
};

const abs = (base, value) => {
  if (!value) return "";

  try {
    return new URL(value, base).href;
  } catch {
    return "";
  }
};

const TRANSLATE = [
  ["足球鞋", "Voetbalschoenen"],
  ["训练服", "Trainingskleding"],
  ["训练套装", "Trainingsset"],
  ["球衣", "Shirt"],
  ["短袖", "Korte mouw"],
  ["长袖", "Lange mouw"],
  ["套装", "Set"],
  ["外套", "Jas"],
  ["风衣", "Windjack"],
  ["卫衣", "Hoodie"],
  ["长裤", "Lange broek"],
  ["短裤", "Korte broek"],
  ["主场", "Thuis"],
  ["客场", "Uit"],
  ["球员版", "Spelersversie"],
  ["球迷版", "Fanversie"],
  ["复古", "Retro"],
  ["童装", "Kindermaat"],
  ["儿童", "Kinderen"],
  ["成人", "Volwassenen"],
  ["女款", "Dames"],
  ["守门员", "Keeper"],
  ["篮球", "Basketbal"],
  ["帽子", "Pet"],
  ["袜子", "Sokken"],
  ["鞋子", "Schoenen"]
];

function english(value, fallback = "") {
  let text = String(value ?? "");

  for (const [source, replacement] of TRANSLATE) {
    text = text.split(source).join(` ${replacement} `);
  }

  text = text
    .replace(/[\p{Script=Han}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || fallback;
}

const CLUBS = [
  {
    competition: "Premier League",
    club: "Arsenal",
    aliases: ["arsenal", "the gunners"]
  },
  {
    competition: "Premier League",
    club: "Aston Villa",
    aliases: ["aston villa", "villa"]
  },
  {
    competition: "Premier League",
    club: "Bournemouth",
    aliases: ["bournemouth", "afc bournemouth"]
  },
  {
    competition: "Premier League",
    club: "Brentford",
    aliases: ["brentford"]
  },
  {
    competition: "Premier League",
    club: "Brighton",
    aliases: ["brighton", "brighton hove albion"]
  },
  {
    competition: "Premier League",
    club: "Burnley",
    aliases: ["burnley"]
  },
  {
    competition: "Premier League",
    club: "Chelsea",
    aliases: ["chelsea"]
  },
  {
    competition: "Premier League",
    club: "Crystal Palace",
    aliases: ["crystal palace", "palace"]
  },
  {
    competition: "Premier League",
    club: "Everton",
    aliases: ["everton"]
  },
  {
    competition: "Premier League",
    club: "Fulham",
    aliases: ["fulham"]
  },
  {
    competition: "Premier League",
    club: "Leeds United",
    aliases: ["leeds united", "leeds"]
  },
  {
    competition: "Premier League",
    club: "Leicester City",
    aliases: ["leicester city", "leicester"]
  },
  {
    competition: "Premier League",
    club: "Liverpool",
    aliases: ["liverpool", "lfc"]
  },
  {
    competition: "Premier League",
    club: "Manchester City",
    aliases: ["manchester city", "man city", "mancity"]
  },
  {
    competition: "Premier League",
    club: "Manchester United",
    aliases: [
      "manchester united",
      "man united",
      "man utd",
      "manchester utd",
      "manu"
    ]
  },
  {
    competition: "Premier League",
    club: "Newcastle United",
    aliases: ["newcastle united", "newcastle"]
  },
  {
    competition: "Premier League",
    club: "Nottingham Forest",
    aliases: ["nottingham forest", "nottm forest"]
  },
  {
    competition: "Premier League",
    club: "Sunderland",
    aliases: ["sunderland"]
  },
  {
    competition: "Premier League",
    club: "Tottenham Hotspur",
    aliases: ["tottenham hotspur", "tottenham", "spurs"]
  },
  {
    competition: "Premier League",
    club: "West Ham United",
    aliases: ["west ham united", "west ham"]
  },
  {
    competition: "Premier League",
    club: "Wolverhampton Wanderers",
    aliases: [
      "wolverhampton wanderers",
      "wolverhampton",
      "wolves"
    ]
  },

  {
    competition: "La Liga",
    club: "Athletic Bilbao",
    aliases: ["athletic bilbao", "athletic club", "bilbao"]
  },
  {
    competition: "La Liga",
    club: "Atlético Madrid",
    aliases: [
      "atletico madrid",
      "atlético madrid",
      "atletico de madrid"
    ]
  },
  {
    competition: "La Liga",
    club: "Barcelona",
    aliases: ["fc barcelona", "barcelona", "barca", "fcb"]
  },
  {
    competition: "La Liga",
    club: "Cádiz",
    aliases: ["cadiz", "cádiz"]
  },
  {
    competition: "La Liga",
    club: "Celta Vigo",
    aliases: ["celta vigo", "celta"]
  },
  {
    competition: "La Liga",
    club: "Espanyol",
    aliases: ["espanyol"]
  },
  {
    competition: "La Liga",
    club: "Getafe",
    aliases: ["getafe"]
  },
  {
    competition: "La Liga",
    club: "Las Palmas",
    aliases: ["las palmas"]
  },
  {
    competition: "La Liga",
    club: "Leganés",
    aliases: ["leganes", "leganés"]
  },
  {
    competition: "La Liga",
    club: "Málaga",
    aliases: ["malaga", "málaga"]
  },
  {
    competition: "La Liga",
    club: "Osasuna",
    aliases: ["osasuna"]
  },
  {
    competition: "La Liga",
    club: "Real Betis",
    aliases: ["real betis", "betis"]
  },
  {
    competition: "La Liga",
    club: "Real Madrid",
    aliases: ["real madrid"]
  },
  {
    competition: "La Liga",
    club: "Real Sociedad",
    aliases: ["real sociedad"]
  },
  {
    competition: "La Liga",
    club: "Real Valladolid",
    aliases: ["real valladolid", "valladolid"]
  },
  {
    competition: "La Liga",
    club: "Real Zaragoza",
    aliases: ["real zaragoza", "zaragoza"]
  },
  {
    competition: "La Liga",
    club: "Sevilla",
    aliases: ["sevilla"]
  },
  {
    competition: "La Liga",
    club: "Valencia",
    aliases: ["valencia"]
  },
  {
    competition: "La Liga",
    club: "Villarreal",
    aliases: ["villarreal"]
  },

  {
    competition: "Serie A",
    club: "AC Milan",
    aliases: ["ac milan", "milan"]
  },
  {
    competition: "Serie A",
    club: "Atalanta",
    aliases: ["atalanta"]
  },
  {
    competition: "Serie A",
    club: "Bologna",
    aliases: ["bologna"]
  },
  {
    competition: "Serie A",
    club: "Cagliari",
    aliases: ["cagliari"]
  },
  {
    competition: "Serie A",
    club: "Fiorentina",
    aliases: ["fiorentina"]
  },
  {
    competition: "Serie A",
    club: "Inter Milan",
    aliases: [
      "inter milan",
      "internazionale",
      "inter"
    ]
  },
  {
    competition: "Serie A",
    club: "Juventus",
    aliases: ["juventus", "juve"]
  },
  {
    competition: "Serie A",
    club: "Lazio",
    aliases: ["lazio"]
  },
  {
    competition: "Serie A",
    club: "Napoli",
    aliases: ["napoli"]
  },
  {
    competition: "Serie A",
    club: "Parma",
    aliases: ["parma"]
  },
  {
    competition: "Serie A",
    club: "Roma",
    aliases: ["as roma", "roma"]
  },
  {
    competition: "Serie A",
    club: "Torino",
    aliases: ["torino"]
  },
  {
    competition: "Serie A",
    club: "Venezia",
    aliases: ["venezia"]
  },

  {
    competition: "Bundesliga",
    club: "Bayern München",
    aliases: [
      "bayern munich",
      "bayern münchen",
      "bayern munchen",
      "fc bayern",
      "bayern"
    ]
  },
  {
    competition: "Bundesliga",
    club: "Bayer Leverkusen",
    aliases: [
      "bayer leverkusen",
      "bayer 04 leverkusen",
      "leverkusen"
    ]
  },
  {
    competition: "Bundesliga",
    club: "Borussia Dortmund",
    aliases: [
      "borussia dortmund",
      "dortmund",
      "bvb"
    ]
  },
  {
    competition: "Bundesliga",
    club: "Eintracht Frankfurt",
    aliases: [
      "eintracht frankfurt",
      "frankfurt"
    ]
  },
  {
    competition: "Bundesliga",
    club: "FSV Mainz",
    aliases: ["fsv mainz", "mainz"]
  },
  {
    competition: "Bundesliga",
    club: "Hamburger SV",
    aliases: ["hamburger sv", "hamburg", "hsv"]
  },
  {
    competition: "Bundesliga",
    club: "RB Leipzig",
    aliases: ["rb leipzig", "leipzig"]
  },
  {
    competition: "Bundesliga",
    club: "Schalke 04",
    aliases: ["schalke 04", "schalke"]
  },
  {
    competition: "Bundesliga",
    club: "VfB Stuttgart",
    aliases: ["vfb stuttgart", "stuttgart"]
  },
  {
    competition: "Bundesliga",
    club: "Union Berlin",
    aliases: ["union berlin"]
  },
  {
    competition: "Bundesliga",
    club: "Werder Bremen",
    aliases: ["werder bremen", "sv werder bremen"]
  },
  {
    competition: "Bundesliga",
    club: "VfL Wolfsburg",
    aliases: ["vfl wolfsburg", "wolfsburg"]
  },

  {
    competition: "Ligue 1",
    club: "Lens",
    aliases: ["rc lens", "lens"]
  },
  {
    competition: "Ligue 1",
    club: "Lille",
    aliases: ["lille"]
  },
  {
    competition: "Ligue 1",
    club: "Lyon",
    aliases: ["olympique lyon", "lyon"]
  },
  {
    competition: "Ligue 1",
    club: "Marseille",
    aliases: ["olympique marseille", "marseille"]
  },
  {
    competition: "Ligue 1",
    club: "Monaco",
    aliases: ["as monaco", "monaco"]
  },
  {
    competition: "Ligue 1",
    club: "Nice",
    aliases: ["ogc nice", "nice"]
  },
  {
    competition: "Ligue 1",
    club: "Paris Saint-Germain",
    aliases: [
      "paris saint germain",
      "paris saint-germain",
      "psg"
    ]
  },
  {
    competition: "Ligue 1",
    club: "Rennes",
    aliases: ["rennes", "stade rennais"]
  },
  {
    competition: "Ligue 1",
    club: "Strasbourg",
    aliases: ["strasbourg"]
  },

  {
    competition: "Eredivisie",
    club: "Ajax",
    aliases: ["ajax"]
  },
  {
    competition: "Eredivisie",
    club: "AZ",
    aliases: ["az alkmaar", "alkmaar", "az"]
  },
  {
    competition: "Eredivisie",
    club: "Feyenoord",
    aliases: ["feyenoord"]
  },
  {
    competition: "Eredivisie",
    club: "FC Twente",
    aliases: ["fc twente", "twente"]
  },
  {
    competition: "Eredivisie",
    club: "FC Utrecht",
    aliases: ["fc utrecht"]
  },
  {
    competition: "Eredivisie",
    club: "PSV",
    aliases: ["psv eindhoven", "psv"]
  },
  {
    competition: "Eredivisie",
    club: "Sparta Rotterdam",
    aliases: ["sparta rotterdam"]
  },
  {
    competition: "Eredivisie",
    club: "Vitesse",
    aliases: ["vitesse"]
  },

  {
    competition: "Primeira Liga",
    club: "Benfica",
    aliases: ["sl benfica", "benfica"]
  },
  {
    competition: "Primeira Liga",
    club: "FC Porto",
    aliases: ["fc porto", "porto"]
  },
  {
    competition: "Primeira Liga",
    club: "Sporting CP",
    aliases: [
      "sporting cp",
      "sporting lisbon",
      "sporting lisboa"
    ]
  },

  {
    competition: "Scottish Premiership",
    club: "Celtic",
    aliases: ["celtic"]
  },
  {
    competition: "Scottish Premiership",
    club: "Rangers",
    aliases: ["glasgow rangers", "rangers"]
  },

  {
    competition: "Süper Lig",
    club: "Beşiktaş",
    aliases: ["besiktas", "beşiktaş"]
  },
  {
    competition: "Süper Lig",
    club: "Fenerbahçe",
    aliases: ["fenerbahce", "fenerbahçe"]
  },
  {
    competition: "Süper Lig",
    club: "Galatasaray",
    aliases: ["galatasaray"]
  },

  {
    competition: "MLS",
    club: "Atlanta United",
    aliases: ["atlanta united"]
  },
  {
    competition: "MLS",
    club: "Charlotte FC",
    aliases: ["charlotte fc", "charlotte"]
  },
  {
    competition: "MLS",
    club: "Columbus Crew",
    aliases: ["columbus crew"]
  },
  {
    competition: "MLS",
    club: "DC United",
    aliases: ["dc united", "d c united"]
  },
  {
    competition: "MLS",
    club: "FC Dallas",
    aliases: ["fc dallas", "dallas"]
  },
  {
    competition: "MLS",
    club: "Houston Dynamo",
    aliases: ["houston dynamo"]
  },
  {
    competition: "MLS",
    club: "Inter Miami",
    aliases: ["inter miami", "miami"]
  },
  {
    competition: "MLS",
    club: "LA Galaxy",
    aliases: ["la galaxy"]
  },
  {
    competition: "MLS",
    club: "Los Angeles FC",
    aliases: ["los angeles fc", "lafc"]
  },
  {
    competition: "MLS",
    club: "Minnesota United",
    aliases: ["minnesota united"]
  },
  {
    competition: "MLS",
    club: "New York City FC",
    aliases: ["new york city fc", "new york city"]
  },
  {
    competition: "MLS",
    club: "New York Red Bulls",
    aliases: [
      "new york red bulls",
      "new york red bull"
    ]
  },
  {
    competition: "MLS",
    club: "Orlando City",
    aliases: ["orlando city"]
  },
  {
    competition: "MLS",
    club: "Philadelphia Union",
    aliases: ["philadelphia union"]
  },
  {
    competition: "MLS",
    club: "Portland Timbers",
    aliases: ["portland timbers"]
  },
  {
    competition: "MLS",
    club: "Seattle Sounders",
    aliases: ["seattle sounders"]
  },
  {
    competition: "MLS",
    club: "Toronto FC",
    aliases: ["toronto fc", "toronto"]
  },
  {
    competition: "MLS",
    club: "Vancouver Whitecaps",
    aliases: ["vancouver whitecaps"]
  },

  {
    competition: "Saudi Pro League",
    club: "Al-Hilal",
    aliases: ["al hilal", "al-hilal"]
  },
  {
    competition: "Saudi Pro League",
    club: "Al-Ittihad",
    aliases: ["al ittihad", "al-ittihad"]
  },
  {
    competition: "Saudi Pro League",
    club: "Al-Nassr",
    aliases: ["al nassr", "al-nassr"]
  },
  {
    competition: "Saudi Pro League",
    club: "Al-Ahli",
    aliases: ["al ahli", "al-ahli"]
  },

  {
    competition: "Liga MX",
    club: "América",
    aliases: [
      "club america",
      "club américa",
      "america"
    ]
  },
  {
    competition: "Liga MX",
    club: "Atlas",
    aliases: ["atlas"]
  },
  {
    competition: "Liga MX",
    club: "Chivas",
    aliases: ["chivas", "guadalajara"]
  },
  {
    competition: "Liga MX",
    club: "Monterrey",
    aliases: ["monterrey"]
  },
  {
    competition: "Liga MX",
    club: "Necaxa",
    aliases: ["necaxa"]
  },
  {
    competition: "Liga MX",
    club: "Pachuca",
    aliases: ["pachuca"]
  },
  {
    competition: "Liga MX",
    club: "Puebla",
    aliases: ["puebla"]
  },
  {
    competition: "Liga MX",
    club: "Pumas UNAM",
    aliases: ["pumas unam", "pumas"]
  },
  {
    competition: "Liga MX",
    club: "Santos Laguna",
    aliases: ["santos laguna"]
  },
  {
    competition: "Liga MX",
    club: "Tigres UANL",
    aliases: ["tigres uanl", "tigres"]
  },
  {
    competition: "Liga MX",
    club: "Tijuana",
    aliases: ["tijuana"]
  },
  {
    competition: "Liga MX",
    club: "Toluca",
    aliases: ["toluca"]
  },

  {
    competition: "Brasileirão Série A",
    club: "Athletico Paranaense",
    aliases: [
      "athletico paranaense",
      "atletico paranaense"
    ]
  },
  {
    competition: "Brasileirão Série A",
    club: "Atlético Mineiro",
    aliases: [
      "atletico mineiro",
      "atlético mineiro"
    ]
  },
  {
    competition: "Brasileirão Série A",
    club: "Bahia",
    aliases: ["bahia"]
  },
  {
    competition: "Brasileirão Série A",
    club: "Botafogo",
    aliases: ["botafogo"]
  },
  {
    competition: "Brasileirão Série A",
    club: "Corinthians",
    aliases: ["corinthians"]
  },
  {
    competition: "Brasileirão Série A",
    club: "Cruzeiro",
    aliases: ["cruzeiro"]
  },
  {
    competition: "Brasileirão Série A",
    club: "Flamengo",
    aliases: ["flamengo"]
  },
  {
    competition: "Brasileirão Série A",
    club: "Fluminense",
    aliases: ["fluminense"]
  },
  {
    competition: "Brasileirão Série A",
    club: "Fortaleza",
    aliases: ["fortaleza"]
  },
  {
    competition: "Brasileirão Série A",
    club: "Grêmio",
    aliases: ["gremio", "grêmio"]
  },
  {
    competition: "Brasileirão Série A",
    club: "Internacional",
    aliases: [
      "sc internacional",
      "internacional"
    ]
  },
  {
    competition: "Brasileirão Série A",
    club: "Palmeiras",
    aliases: ["palmeiras"]
  },
  {
    competition: "Brasileirão Série A",
    club: "Santos",
    aliases: ["santos fc", "santos"]
  },
  {
    competition: "Brasileirão Série A",
    club: "São Paulo",
    aliases: ["sao paulo", "são paulo"]
  },
  {
    competition: "Brasileirão Série A",
    club: "Vasco da Gama",
    aliases: ["vasco da gama", "vasco"]
  },

  {
    competition: "Argentijnse Primera División",
    club: "Boca Juniors",
    aliases: ["boca juniors", "boca"]
  },
  {
    competition: "Argentijnse Primera División",
    club: "River Plate",
    aliases: ["river plate"]
  },

  {
    competition: "Chileense Primera División",
    club: "Colo-Colo",
    aliases: ["colo colo", "colo-colo"]
  },
  {
    competition: "Chileense Primera División",
    club: "Universidad Católica",
    aliases: [
      "universidad catolica",
      "universidad católica",
      "la catolica"
    ]
  },

  {
    competition: "Uruguayaanse Primera División",
    club: "Peñarol",
    aliases: ["penarol", "peñarol"]
  },

  {
    competition: "Japanse J1 League",
    club: "Vissel Kobe",
    aliases: ["vissel kobe"]
  }
];

const COUNTRY_ALIASES = [
  ["Argentinië", ["argentina", "argentinie"]],
  ["Australië", ["australia", "australie"]],
  ["België", ["belgium", "belgie", "belgique"]],
  ["Brazilië", ["brazil", "brasil", "brazilie"]],
  ["Canada", ["canada"]],
  ["Chili", ["chile"]],
  ["China", ["china"]],
  ["Colombia", ["colombia"]],
  ["Costa Rica", ["costa rica"]],
  ["Denemarken", ["denmark", "danmark", "denemarken"]],
  ["Duitsland", ["germany", "deutschland", "duitsland"]],
  ["Ecuador", ["ecuador"]],
  ["Engeland", ["england", "engeland"]],
  ["Frankrijk", ["france", "frankrijk"]],
  ["Ghana", ["ghana"]],
  ["Ierland", ["ireland", "eire", "ierland"]],
  ["Italië", ["italy", "italia", "italie"]],
  ["Ivoorkust", ["ivory coast", "cote d ivoire"]],
  ["Japan", ["japan"]],
  ["Kameroen", ["cameroon", "cameroun", "kameroen"]],
  ["Kroatië", ["croatia", "kroatie"]],
  ["Marokko", ["morocco", "maroc", "marokko"]],
  ["Mexico", ["mexico"]],
  ["Nederland", ["netherlands", "holland", "nederland"]],
  ["Nigeria", ["nigeria"]],
  ["Noorwegen", ["norway", "norge", "noorwegen"]],
  ["Oekraïne", ["ukraine", "oekraine"]],
  ["Polen", ["poland", "polska", "polen"]],
  ["Portugal", ["portugal"]],
  ["Rusland", ["russia", "rusland"]],
  [
    "Sovjet-Unie",
    [
      "soviet union",
      "ussr",
      "sovjet unie"
    ]
  ],
  ["Saoedi-Arabië", ["saudi arabia", "saoedi arabie"]],
  ["Schotland", ["scotland", "schotland"]],
  ["Senegal", ["senegal"]],
  ["Servië", ["serbia", "servie"]],
  ["Spanje", ["spain", "espana", "spanje"]],
  ["Tunesië", ["tunisia", "tunesie"]],
  ["Turkije", ["turkey", "turkiye", "turkije"]],
  ["Uruguay", ["uruguay"]],
  [
    "Verenigde Staten",
    [
      "united states",
      "usa national",
      "usmnt",
      "team usa"
    ]
  ],
  ["Wales", ["wales"]],
  ["Zuid-Afrika", ["south africa", "zuid afrika"]],
  [
    "Zuid-Korea",
    [
      "south korea",
      "korea republic",
      "zuid korea"
    ]
  ],
  [
    "Zwitserland",
    [
      "switzerland",
      "suisse",
      "zwitserland"
    ]
  ]
];

const PLAYER_RULES = [
  {
    player: "Lionel Messi",
    aliases: [
      "lionel messi",
      "messi10",
      "messi 10",
      "messi 19",
      "messi 30",
      "messi"
    ]
  },
  {
    player: "Cristiano Ronaldo",
    aliases: [
      "cristiano ronaldo",
      "ronaldo7",
      "ronaldo 7",
      "cr7"
    ]
  },
  {
    player: "Ronaldo Nazário",
    aliases: [
      "ronaldo nazario",
      "ronaldo fenómeno",
      "ronaldo fenomeno",
      "r9"
    ]
  },
  {
    player: "Neymar",
    aliases: ["neymar jr", "neymar"]
  },
  {
    player: "Kylian Mbappé",
    aliases: ["kylian mbappe", "mbappe"]
  },
  {
    player: "Erling Haaland",
    aliases: ["erling haaland", "haaland"]
  },
  {
    player: "Jude Bellingham",
    aliases: ["jude bellingham", "bellingham"]
  },
  {
    player: "Mohamed Salah",
    aliases: ["mohamed salah", "mo salah", "salah"]
  },
  {
    player: "David Beckham",
    aliases: ["david beckham", "beckham"]
  },
  {
    player: "Ronaldinho",
    aliases: ["ronaldinho"]
  },
  {
    player: "Zinedine Zidane",
    aliases: ["zinedine zidane", "zidane"]
  },
  {
    player: "Diego Maradona",
    aliases: ["diego maradona", "maradona"]
  },
  {
    player: "Pelé",
    aliases: ["pele", "pelé"]
  }
];

const PLAYER_CLUB_HISTORY = [
  {
    player: "Lionel Messi",
    seasons: [
      {
        from: 2004,
        to: 2021,
        competition: "La Liga",
        club: "Barcelona"
      },
      {
        from: 2021,
        to: 2023,
        competition: "Ligue 1",
        club: "Paris Saint-Germain"
      },
      {
        from: 2023,
        to: 2099,
        competition: "MLS",
        club: "Inter Miami"
      }
    ]
  },
  {
    player: "Cristiano Ronaldo",
    seasons: [
      {
        from: 2003,
        to: 2009,
        competition: "Premier League",
        club: "Manchester United"
      },
      {
        from: 2009,
        to: 2018,
        competition: "La Liga",
        club: "Real Madrid"
      },
      {
        from: 2018,
        to: 2021,
        competition: "Serie A",
        club: "Juventus"
      },
      {
        from: 2021,
        to: 2023,
        competition: "Premier League",
        club: "Manchester United"
      },
      {
        from: 2023,
        to: 2099,
        competition: "Saudi Pro League",
        club: "Al-Nassr"
      }
    ]
  }
];

const SHOE_MODELS = [
  {
    brand: "Nike",
    model: "Mercurial Vapor",
    aliases: [
      "mercurial vapor",
      "vapor 15",
      "vapor 16",
      "vapor 17"
    ]
  },
  {
    brand: "Nike",
    model: "Mercurial Superfly",
    aliases: [
      "mercurial superfly",
      "superfly"
    ]
  },
  {
    brand: "Nike",
    model: "Mercurial",
    aliases: ["mercurial"]
  },
  {
    brand: "Nike",
    model: "Phantom GX",
    aliases: ["phantom gx"]
  },
  {
    brand: "Nike",
    model: "Phantom Luna",
    aliases: ["phantom luna"]
  },
  {
    brand: "Nike",
    model: "Phantom",
    aliases: ["nike phantom", "phantom"]
  },
  {
    brand: "Nike",
    model: "Tiempo Legend",
    aliases: ["tiempo legend"]
  },
  {
    brand: "Nike",
    model: "Tiempo",
    aliases: ["nike tiempo", "tiempo"]
  },
  {
    brand: "Nike",
    model: "Premier",
    aliases: ["nike premier"]
  },

  {
    brand: "Adidas",
    model: "Predator",
    aliases: ["adidas predator", "predator"]
  },
  {
    brand: "Adidas",
    model: "F50",
    aliases: ["adidas f50", "f50"]
  },
  {
    brand: "Adidas",
    model: "Copa Mundial",
    aliases: ["copa mundial"]
  },
  {
    brand: "Adidas",
    model: "Copa Pure",
    aliases: ["copa pure"]
  },
  {
    brand: "Adidas",
    model: "Copa Gloro",
    aliases: ["copa gloro"]
  },
  {
    brand: "Adidas",
    model: "Copa",
    aliases: ["adidas copa", "copa"]
  },
  {
    brand: "Adidas",
    model: "X Crazyfast",
    aliases: ["crazyfast", "x crazyfast"]
  },
  {
    brand: "Adidas",
    model: "X Speedportal",
    aliases: ["speedportal", "x speedportal"]
  },
  {
    brand: "Adidas",
    model: "X Speedflow",
    aliases: ["speedflow", "x speedflow"]
  },
  {
    brand: "Adidas",
    model: "X",
    aliases: ["adidas x"]
  },

  {
    brand: "Puma",
    model: "Future",
    aliases: ["puma future"]
  },
  {
    brand: "Puma",
    model: "Ultra",
    aliases: ["puma ultra"]
  },
  {
    brand: "Puma",
    model: "King",
    aliases: ["puma king"]
  },

  {
    brand: "Mizuno",
    model: "Morelia",
    aliases: ["mizuno morelia", "morelia"]
  },
  {
    brand: "Mizuno",
    model: "Alpha",
    aliases: ["mizuno alpha"]
  },
  {
    brand: "Mizuno",
    model: "Monarcida",
    aliases: ["monarcida"]
  },

  {
    brand: "Joma",
    model: "Top Flex",
    aliases: ["joma top flex", "top flex"]
  },

  {
    brand: "New Balance",
    model: "Furon",
    aliases: ["new balance furon", "furon"]
  },
  {
    brand: "New Balance",
    model: "Tekela",
    aliases: ["new balance tekela", "tekela"]
  }
];

const SHOE_BRANDS = [
  "Nike",
  "Adidas",
  "Puma",
  "Mizuno",
  "Joma",
  "New Balance",
  "Under Armour",
  "Umbro",
  "Lotto",
  "Diadora",
  "Asics"
];

const TRAINING_WORDS = [
  "tracksuit",
  "track suit",
  "training suit",
  "training set",
  "training wear",
  "training jersey",
  "training shirt",
  "training top",
  "training pants",
  "training pant",
  "training shorts",
  "pre match",
  "prematch",
  "warm up",
  "warmup",
  "windbreaker",
  "wind breaker",
  "trainingspak",
  "trainingsset",
  "trainingskleding",
  "hoodie",
  "sweatshirt",
  "jacket",
  "coat",
  "polo",
  "travel suit"
];

const SHOE_WORDS = [
  "football boot",
  "football boots",
  "soccer shoe",
  "soccer shoes",
  "soccer boot",
  "soccer boots",
  "cleats",
  "fg",
  "ag",
  "tf",
  "ic",
  "sg",
  "mercurial",
  "superfly",
  "phantom gx",
  "phantom luna",
  "tiempo",
  "predator",
  "adidas f50",
  "copa mundial",
  "copa pure",
  "copa gloro",
  "speedportal",
  "speedflow",
  "crazyfast",
  "puma future",
  "puma ultra",
  "mizuno morelia",
  "top flex"
];

const FOOTBALL_WORDS = [
  "football",
  "soccer",
  "jersey",
  "shirt",
  "kit",
  "uniform",
  "home",
  "away",
  "third",
  "goalkeeper",
  "player version",
  "fan version",
  "retro",
  "classic",
  "football clubs",
  "national teams",
  "club teams",
  "landenteams",
  "clubteams"
];

const IGNORE_ALBUM_WORDS = [
  "about us",
  "contact us",
  "how to order",
  "how to buy",
  "tutorial",
  "purchase tutorial",
  "produto preco tutorial",
  "price list",
  "prices",
  "payment",
  "shipping",
  "whatsapp",
  "wechat",
  "qrcode",
  "qr code",
  "size chart",
  "sizes chart",
  "measurement",
  "measurements",
  "customer service",
  "create your own design",
  "all over print",
  "menu 1",
  "menu 2",
  "menu1",
  "menu2",
  "video",
  "patch only",
  "patches only",
  "name set only",
  "nameset only",
  "fonts only",
  "link only"
];

function isMeaningfulAlbum(title, category = "") {
  const text = norm(`${title} ${category}`);

  if (!text) return false;

  return !IGNORE_ALBUM_WORDS.some(word =>
    text.includes(norm(word))
  );
}

function findPlayer(text) {
  const normalizedText = norm(text);

  return (
    PLAYER_RULES.find(rule =>
      rule.aliases.some(alias =>
        normalizedText.includes(norm(alias))
      )
    ) || null
  );
}

function findCountry(text) {
  const normalizedText = norm(text);

  for (const [country, aliases] of COUNTRY_ALIASES) {
    for (const alias of aliases) {
      if (normalizedText.includes(norm(alias))) {
        return country;
      }
    }
  }

  return "";
}

function findTeam(text) {
  const normalizedText = norm(text);

  const sorted = [...CLUBS].sort((a, b) => {
    const longestA = Math.max(
      ...a.aliases.map(alias => norm(alias).length)
    );
    const longestB = Math.max(
      ...b.aliases.map(alias => norm(alias).length)
    );

    return longestB - longestA;
  });

  for (const entry of sorted) {
    for (const alias of entry.aliases) {
      const normalizedAlias = norm(alias);

      if (
        normalizedAlias &&
        normalizedText.includes(normalizedAlias)
      ) {
        return {
          competition: entry.competition,
          club: entry.club
        };
      }
    }
  }

  return null;
}

function findShoe(text) {
  const normalizedText = norm(text);

  for (const entry of SHOE_MODELS) {
    if (
      entry.aliases.some(alias =>
        normalizedText.includes(norm(alias))
      )
    ) {
      return {
        brand: entry.brand,
        model: entry.model
      };
    }
  }

  const brand =
    SHOE_BRANDS.find(item =>
      normalizedText.includes(norm(item))
    ) || "Overige merken";

  return {
    brand,
    model: "Overig model"
  };
}

function season(text) {
  const original = String(text ?? "");

  const fourDigitPattern =
    /\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/g;

  let match;

  while ((match = fourDigitPattern.exec(original)) !== null) {
    const first = Number(match[1]);
    let second = Number(match[2]);

    if (match[2].length === 2) {
      second =
        Math.floor(first / 100) * 100 +
        Number(match[2]);

      if (second < first) second += 100;
    }

    if (
      first >= 1980 &&
      first <= 2099 &&
      second === first + 1
    ) {
      return `${first}-${second}`;
    }
  }

  const shortPattern =
    /(?:^|[^a-z0-9])(\d{2})\s*[\/_-]\s*(\d{2})(?=$|[^a-z0-9])/gi;

  while ((match = shortPattern.exec(original)) !== null) {
    const left = Number(match[1]);
    const right = Number(match[2]);

    /*
     * Alleen opeenvolgende seizoensjaren accepteren.
     *
     * Hierdoor worden onder andere deze waarden geweigerd:
     * 39-45 maten
     * 39-4514 modelcodes
     * 20-1 productnummers
     * 10-19 rugnummers
     */
    if (right !== (left + 1) % 100) continue;

    const first = left >= 80 ? 1900 + left : 2000 + left;
    const second = first + 1;

    return `${first}-${second}`;
  }

  return "Seizoen onbekend";
}

function playerClubFromSeason(playerName, seasonValue) {
  if (!playerName) return null;
  if (seasonValue === "Seizoen onbekend") return null;

  const firstYear = Number(seasonValue.slice(0, 4));
  if (!Number.isFinite(firstYear)) return null;

  const history = PLAYER_CLUB_HISTORY.find(
    item => item.player === playerName
  );

  if (!history) return null;

  const period = history.seasons.find(
    item => firstYear >= item.from && firstYear < item.to
  );

  if (!period) return null;

  return {
    competition: period.competition,
    club: period.club
  };
}

function classify(title, category, source) {
  const text = `${title} ${category}`;
  const normalizedText = norm(text);
  const year = season(text);
  const directTeam = findTeam(text);
  const country = findCountry(text);
  const playerRule = findPlayer(text);

  const historicPlayerTeam =
    !directTeam && playerRule
      ? playerClubFromSeason(playerRule.player, year)
      : null;

  const resolvedTeam = directTeam || historicPlayerTeam;

  const training =
    source.mode === "training" ||
    has(text, TRAINING_WORDS);

  if (training) {
    if (resolvedTeam) {
      return {
        section: "Trainingskleding",
        category: "Clubteams",
        subcategory: resolvedTeam.competition,
        competition: resolvedTeam.competition,
        club: resolvedTeam.club,
        country: "",
        player: playerRule?.player || "",
        season: year,
        types: ["Trainingskleding"]
      };
    }

    if (country) {
      return {
        section: "Trainingskleding",
        category: "Landenteams",
        subcategory: country,
        competition: "Landenteams",
        club: country,
        country,
        player: playerRule?.player || "",
        season: year,
        types: ["Trainingskleding"]
      };
    }

    return {
      section: "Trainingskleding",
      category: "Overige trainingskleding",
      subcategory: "Overige trainingskleding",
      competition: "",
      club: "Overige trainingskleding",
      country: "",
      player: playerRule?.player || "",
      season: year,
      types: ["Trainingskleding"]
    };
  }

  const shoe =
    source.mode === "shoes" ||
    has(text, SHOE_WORDS) ||
    normalizedText === "shoes" ||
    normalizedText.startsWith("shoes ");

  if (shoe) {
    const found = findShoe(text);

    return {
      section: "Voetbalschoenen",
      category: found.brand,
      subcategory: found.model,
      competition: "",
      club: "",
      country: "",
      player: "",
      season: "Seizoen onbekend",
      types: ["Voetbalschoenen"]
    };
  }

  if (resolvedTeam) {
    return {
      section: "Voetbal",
      category: "Clubteams",
      subcategory: resolvedTeam.competition,
      competition: resolvedTeam.competition,
      club: resolvedTeam.club,
      country: "",
      player: playerRule?.player || "",
      season: year,
      types: ["Voetbalshirt"]
    };
  }

  if (country) {
    return {
      section: "Voetbal",
      category: "Landenteams",
      subcategory: country,
      competition: "Landenteams",
      club: country,
      country,
      player: playerRule?.player || "",
      season: year,
      types: ["Voetbalshirt"]
    };
  }

  if (playerRule || has(text, FOOTBALL_WORDS)) {
    return {
      section: "Voetbal",
      category: "Overig voetbal",
      subcategory:
        playerRule?.player || "Overig voetbal",
      competition: "Overig voetbal",
      club: playerRule?.player || "Overig voetbal",
      country: "",
      player: playerRule?.player || "",
      season: year,
      types: ["Voetbalshirt"]
    };
  }

  const cleanedCategory = english(category, "Overig");

  return {
    section: "Overige producten",
    category: "Overige producten",
    subcategory: cleanedCategory,
    competition: "",
    club: "",
    country: "",
    player: "",
    season: "Seizoen onbekend",
    types: ["Overig"]
  };
}

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

async function request(url, binary = false, referer = "") {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(250);

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      45000
    );

    try {
      const headers = {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/129.0 Safari/537.36",
        accept: binary
          ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
          : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,nl;q=0.8"
      };

      if (referer) headers.referer = referer;

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "follow"
      });

      if (!response.ok) {
        throw new HttpError(response.status, url);
      }

      if (binary) {
        return Buffer.from(await response.arrayBuffer());
      }

      return await response.text();
    } catch (error) {
      if (error.status === 404 || attempt === 2) {
        throw error;
      }

      await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Download mislukt: ${url}`);
}

async function read(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function write(file, data) {
  await fs.mkdir(path.dirname(file), {
    recursive: true
  });

  const temporaryFile = `${file}.tmp`;

  await fs.writeFile(
    temporaryFile,
    JSON.stringify(data, null, 2) + "\n"
  );

  await fs.rename(temporaryFile, file);
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function validImageUrl(url = "") {
  const value = String(url).toLowerCase();

  if (!value) return false;

  if (
    !value.startsWith("http://") &&
    !value.startsWith("https://")
  ) {
    return false;
  }

  const blocked = [
    "logo",
    "avatar",
    "favicon",
    "default",
    "placeholder",
    "loading",
    "qrcode",
    "qr-code",
    "icon",
    "banner",
    "transparent.gif",
    "blank.gif",
    "spacer.gif"
  ];

  return !blocked.some(item => value.includes(item));
}

function parseSrcset(value = "", base = "") {
  return String(value)
    .split(",")
    .map(item => item.trim().split(/\s+/)[0])
    .map(item => abs(base, item))
    .filter(validImageUrl);
}

function collectImageCandidates($, source, album) {
  const candidates = [];

  const add = value => {
    const url = abs(source.base, value);

    if (validImageUrl(url)) {
      candidates.push(url);
    }
  };

  const addSrcset = value => {
    for (const url of parseSrcset(value, source.base)) {
      candidates.push(url);
    }
  };

  $(
    [
      "meta[property='og:image']",
      "meta[name='twitter:image']",
      "img",
      "source"
    ].join(",")
  ).each((_, element) => {
    add($(element).attr("content"));
    add($(element).attr("data-origin-src"));
    add($(element).attr("data-original"));
    add($(element).attr("data-src"));
    add($(element).attr("data-lazy"));
    add($(element).attr("data-lazy-src"));
    add($(element).attr("data-image"));
    add($(element).attr("src"));

    addSrcset($(element).attr("srcset"));
    addSrcset($(element).attr("data-srcset"));
  });

  $("[style*='background-image']").each((_, element) => {
    const style = $(element).attr("style") || "";
    const matches = style.match(
      /background-image\s*:\s*url$$(['"]?)(.*?)\1$$/gi
    );

    for (const match of matches || []) {
      const urlMatch = match.match(
        /url$$(['"]?)(.*?)\1$$/i
      );

      add(urlMatch?.[2]);
    }
  });

  add(album.preview);

  return unique(candidates).slice(0, MAX_IMAGES * 4);
}

function pageData(html, source, inherited = "") {
  const $ = cheerio.load(html);
  const categories = new Map();
  const albums = new Map();

  $(
    "a[href*='/categories/'],a[href*='/collections/']"
  ).each((_, element) => {
    const url = abs(
      source.base,
      $(element).attr("href")
    ).split("?")[0];

    if (!url) return;

    categories.set(url, {
      url,
      title: english(
        $(element).attr("title") ||
          $(element).text(),
        "Overig"
      )
    });
  });

  $("a[href*='/albums/']").each((_, element) => {
    const fetchUrl = abs(
      source.base,
      $(element).attr("href")
    );

    const url = fetchUrl.split("?")[0];

    if (!/\/albums\/\d+/.test(url)) return;

    const image = $(element).find("img").first();

    const previewCandidates = [
      image.attr("data-origin-src"),
      image.attr("data-original"),
      image.attr("data-src"),
      image.attr("data-lazy-src"),
      image.attr("src")
    ]
      .map(value => abs(source.base, value))
      .filter(validImageUrl);

    const srcsetCandidates = [
      ...parseSrcset(
        image.attr("data-srcset"),
        source.base
      ),
      ...parseSrcset(
        image.attr("srcset"),
        source.base
      )
    ];

    const preview = unique([
      ...previewCandidates,
      ...srcsetCandidates
    ])[0] || "";

    const albumId =
      url.match(/\/albums\/(\d+)/)?.[1] ||
      "onbekend";

    const title = english(
      $(element).attr("title") ||
        image.attr("alt") ||
        $(element).text(),
      `Product ${albumId}`
    );

    albums.set(url, {
      url,
      fetchUrl,
      title,
      category: english(inherited, "Overig"),
      preview
    });
  });

  return {
    categories: [...categories.values()],
    albums: [...albums.values()]
  };
}

async function discover(source, state) {
  const albums = new Map();
  const categories = new Map();

  state.deadCategories ||= {};
  state.deadCategories[source.key] ||= [];

  const dead = new Set(
    state.deadCategories[source.key]
  );

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      page === 1
        ? `${source.base}/albums`
        : `${source.base}/albums?page=${page}`;

    try {
      const data = pageData(
        await request(url),
        source
      );

      data.albums.forEach(album =>
        albums.set(album.url, album)
      );

      data.categories.forEach(category =>
        categories.set(category.url, category)
      );

      if (!data.albums.length && page > 1) {
        break;
      }
    } catch (error) {
      if (error.status !== 404) {
        console.warn(
          `[${source.key}] index: ${error.message}`
        );
      }

      break;
    }
  }

  for (const category of categories.values()) {
    if (dead.has(category.url)) continue;

    try {
      const data = pageData(
        await request(category.url),
        source,
        category.title
      );

      data.albums.forEach(album =>
        albums.set(album.url, album)
      );
    } catch (error) {
      if (error.status === 404) {
        dead.add(category.url);
      } else {
        console.warn(
          `[${source.key}] categorie: ${error.message}`
        );
      }
    }
  }

  state.deadCategories[source.key] = [...dead];

  await write(STATE, state);

  if (dead.size) {
    console.log(
      `[${source.key}] ${dead.size} bekende ` +
        "404-categorie
