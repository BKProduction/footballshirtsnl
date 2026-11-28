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
  { key: "junhaoqiumi", base: "https://junhaoqiumi.x.yupoo.com" },
  { key: "wanli1688", base: "https://wanli1688.x.yupoo.com" },
  { key: "tangma2088", base: "https://m.tangma2088.com", start: "https://m.tangma2088.com/categoryen_394.html", mode: "fashion", scraper: "tangma" }
];

const RUN = new Date().toISOString().slice(0, 10);
const BATCH = 25;
const MAX_PAGES = 100;
const MAX_IMAGES = 6;
const CLASSIFICATION_VERSION = 7;
const PHOTO_VERSION = 12;
const MAX_RUNTIME_MS = 5 * 60 * 60 * 1000 + 10 * 60 * 1000;
const START_TIME = Date.now();
const limit = pLimit(2);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unique = values => [...new Set(values.filter(Boolean))];
const runtimeAlmostReached = () => Date.now() - START_TIME >= MAX_RUNTIME_MS;
const runtimeMinutes = () => Math.floor((Date.now() - START_TIME) / 60000);
const norm = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const containsAny = (text, words) => words.some(word => norm(text).includes(norm(word)));
const absoluteUrl = (base, value) => { if (!value) return ""; try { return new URL(value, base).href; } catch { return ""; } };

const TRANSLATE = [
  ["足球鞋", "Voetbalschoenen"], ["训练服", "Trainingskleding"], ["训练套装", "Trainingsset"],
  ["球衣", "Shirt"], ["短袖", "Korte mouw"], ["长袖", "Lange mouw"], ["套装", "Set"],
  ["外套", "Jas"], ["风衣", "Windjack"], ["卫衣", "Hoodie"], ["长裤", "Lange broek"],
  ["短裤", "Korte broek"], ["主场", "Thuis"], ["客场", "Uit"], ["球员版", "Spelersversie"],
  ["球迷版", "Fanversie"], ["复古", "Retro"], ["童装", "Kindermaat"], ["儿童", "Kinderen"],
  ["成人", "Volwassenen"], ["女款", "Dames"], ["守门员", "Keeper"], ["鞋子", "Schoenen"]
];
function cleanText(value, fallback = "") {
  let text = String(value ?? "");
  for (const [from, to] of TRANSLATE) text = text.split(from).join(` ${to} `);
  text = text.replace(/[\p{Script=Han}]+/gu, " ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

const CLUBS = [
  ["Premier League","Arsenal",["arsenal","gunners"]],["Premier League","Aston Villa",["aston villa"]],["Premier League","Chelsea",["chelsea"]],["Premier League","Liverpool",["liverpool","lfc"]],["Premier League","Manchester City",["manchester city","man city","mancity"]],["Premier League","Manchester United",["manchester united","man united","man utd"]],["Premier League","Newcastle United",["newcastle united","newcastle"]],["Premier League","Tottenham Hotspur",["tottenham hotspur","tottenham","spurs"]],
  ["La Liga","Atletico Madrid",["atletico madrid","atletico de madrid"]],["La Liga","Barcelona",["fc barcelona","barcelona","barca","fcb"]],["La Liga","Real Betis",["real betis","betis"]],["La Liga","Real Madrid",["real madrid"]],["La Liga","Sevilla",["sevilla"]],["La Liga","Valencia",["valencia"]],
  ["Serie A","AC Milan",["ac milan"]],["Serie A","Inter Milan",["inter milan","internazionale"]],["Serie A","Juventus",["juventus","juve"]],["Serie A","Napoli",["napoli"]],["Serie A","Roma",["as roma"]],
  ["Bundesliga","Bayern Munchen",["bayern munich","bayern munchen","fc bayern","bayern"]],["Bundesliga","Bayer Leverkusen",["bayer leverkusen","leverkusen"]],["Bundesliga","Borussia Dortmund",["borussia dortmund","dortmund","bvb"]],["Bundesliga","RB Leipzig",["rb leipzig","leipzig"]],
  ["Ligue 1","Marseille",["olympique marseille","marseille"]],["Ligue 1","Paris Saint-Germain",["paris saint germain","psg"]],
  ["Eredivisie","Ajax",["ajax"]],["Eredivisie","AZ",["az alkmaar"]],["Eredivisie","Feyenoord",["feyenoord"]],["Eredivisie","FC Twente",["fc twente","twente"]],["Eredivisie","FC Utrecht",["fc utrecht"]],["Eredivisie","PSV",["psv eindhoven","psv"]],
  ["Primeira Liga","Benfica",["sl benfica","benfica"]],["Primeira Liga","FC Porto",["fc porto"]],["Primeira Liga","Sporting CP",["sporting cp","sporting lisbon"]],
  ["Scottish Premiership","Celtic",["celtic"]],["Scottish Premiership","Rangers",["glasgow rangers"]],
  ["Super Lig","Besiktas",["besiktas"]],["Super Lig","Fenerbahce",["fenerbahce"]],["Super Lig","Galatasaray",["galatasaray"]],
  ["MLS","Inter Miami",["inter miami"]],["MLS","LA Galaxy",["la galaxy"]],["MLS","Los Angeles FC",["los angeles fc","lafc"]],
  ["Saudi Pro League","Al-Hilal",["al hilal"]],["Saudi Pro League","Al-Ittihad",["al ittihad"]],["Saudi Pro League","Al-Nassr",["al nassr"]],
  ["Brasileirao Serie A","Flamengo",["flamengo"]],["Brasileirao Serie A","Palmeiras",["palmeiras"]],["Argentijnse Primera Division","Boca Juniors",["boca juniors"]],["Argentijnse Primera Division","River Plate",["river plate"]]
];
const COUNTRIES = [["Argentinie",["argentina"]],["Belgie",["belgium","belgie"]],["Brazilie",["brazil","brasil"]],["Duitsland",["germany","deutschland"]],["Engeland",["england"]],["Frankrijk",["france"]],["Italie",["italy","italia"]],["Marokko",["morocco","maroc"]],["Nederland",["netherlands","holland"]],["Portugal",["portugal"]],["Schotland",["scotland"]],["Spanje",["spain","espana"]],["Turkije",["turkey","turkiye"]],["Uruguay",["uruguay"]],["Verenigde Staten",["usa national","usmnt","team usa"]]];
const PLAYERS = [["Lionel Messi",["lionel messi","messi10","messi 10","messi"]],["Cristiano Ronaldo",["cristiano ronaldo","ronaldo7","ronaldo 7","cr7"]],["Neymar",["neymar jr","neymar"]],["Kylian Mbappe",["kylian mbappe","mbappe"]],["Erling Haaland",["erling haaland","haaland"]],["Jude Bellingham",["jude bellingham","bellingham"]],["Mohamed Salah",["mohamed salah","mo salah"]]];
const SHOE_MODELS = [["Nike","Mercurial",["mercurial"]],["Nike","Phantom",["phantom"]],["Nike","Tiempo",["tiempo"]],["Adidas","Predator",["predator"]],["Adidas","F50",["adidas f50","f50"]],["Adidas","Copa",["adidas copa","copa"]],["Puma","Future",["puma future"]],["Puma","Ultra",["puma ultra"]],["Mizuno","Morelia",["mizuno morelia","morelia"]],["Joma","Top Flex",["top flex"]]];
const SHOE_BRANDS = ["Nike","Adidas","Puma","Mizuno","Joma","New Balance","Umbro","Lotto","Diadora","Asics"];
const TRAINING_WORDS = ["tracksuit","track suit","training suit","training set","training wear","training shirt","training top","training pants","pre match","prematch","warm up","windbreaker","trainingspak","trainingsset","hoodie","sweatshirt","jacket","travel suit"];
const SHOE_WORDS = ["football boot","soccer shoe","soccer boot","cleats","mercurial","superfly","phantom gx","tiempo","predator","adidas f50","copa mundial","copa pure","crazyfast","puma future","puma ultra","mizuno morelia","top flex"];
const FOOTBALL_WORDS = ["football","soccer","jersey","shirt","kit","uniform","home","away","third","goalkeeper","player version","fan version","retro","classic","football clubs","national teams","club teams"];
const IGNORE_WORDS = ["about us","contact us","how to order","how to buy","tutorial","price list","payment","shipping","whatsapp","wechat","qrcode","qr code","size chart","measurement","customer service","video","patch only","nameset only","fonts only","link only","shipping record","feedback"];

function findTeam(text) { const n = norm(text); const sorted = [...CLUBS].sort((a,b)=>Math.max(...b[2].map(x=>norm(x).length))-Math.max(...a[2].map(x=>norm(x).length))); for (const [competition,club,aliases] of sorted) if (aliases.some(alias=>n.includes(norm(alias)))) return {competition,club}; return null; }
function findCountry(text) { const n=norm(text); for (const [country,aliases] of COUNTRIES) if (aliases.some(alias=>n.includes(norm(alias)))) return country; return ""; }
function findPlayer(text) { const n=norm(text); for (const [player,aliases] of PLAYERS) if (aliases.some(alias=>n.includes(norm(alias)))) return player; return ""; }
function findShoe(text) { const n=norm(text); for (const [brand,model,aliases] of SHOE_MODELS) if (aliases.some(alias=>n.includes(norm(alias)))) return {brand,model}; return {brand:SHOE_BRANDS.find(brand=>n.includes(norm(brand)))||"Overige merken",model:"Overig model"}; }
function season(text) { const s=String(text??""); let m; const long=/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/g; while((m=long.exec(s))){const a=Number(m[1]);let b=Number(m[2]);if(m[2].length===2){b=Math.floor(a/100)*100+b;if(b<a)b+=100;}if(a>=1980&&a<=2099&&b===a+1)return `${a}-${b}`;} return "Seizoen onbekend"; }
function historicPlayerTeam(player, year) { if(year==="Seizoen onbekend") return null; const start=Number(year.slice(0,4)); if(player==="Lionel Messi"){if(start<2021)return{competition:"La Liga",club:"Barcelona"};if(start<2023)return{competition:"Ligue 1",club:"Paris Saint-Germain"};return{competition:"MLS",club:"Inter Miami"};} if(player==="Cristiano Ronaldo"){if(start<2009)return{competition:"Premier League",club:"Manchester United"};if(start<2018)return{competition:"La Liga",club:"Real Madrid"};if(start<2021)return{competition:"Serie A",club:"Juventus"};if(start<2023)return{competition:"Premier League",club:"Manchester United"};return{competition:"Saudi Pro League",club:"Al-Nassr"};} return null; }

function classify(title, category, source) {
  const text=`${title} ${category}`; const n=norm(text); const year=season(text); const player=findPlayer(text); const team=findTeam(text)||historicPlayerTeam(player,year); const country=findCountry(text);
  if(source.scraper==="tangma"||source.mode==="fashion") return {section:"Fashion",category:"Fashion",subcategory:cleanText(category,"Fashion"),competition:"",club:"",country:"",player:"",season:"Seizoen onbekend",types:["Fashion"]};
  const explicitTraining=containsAny(text,TRAINING_WORDS); const explicitMatchShirt=containsAny(text,["match shirt","match jersey","home shirt","away shirt","third shirt","home jersey","away jersey","third jersey","player version","fan version"]); const training=explicitTraining||(source.mode==="training"&&!explicitMatchShirt);
  if(training){if(team)return{section:"Trainingskleding",category:"Clubteams",subcategory:team.competition,competition:team.competition,club:team.club,country:"",player,season:year,types:["Trainingskleding"]};if(country)return{section:"Trainingskleding",category:"Landenteams",subcategory:country,competition:"Landenteams",club:country,country,player,season:year,types:["Trainingskleding"]};return{section:"Trainingskleding",category:"Overige trainingskleding",subcategory:"Overige trainingskleding",competition:"",club:"Overige trainingskleding",country:"",player,season:year,types:["Trainingskleding"]};}
  const shoe=source.mode==="shoes"||containsAny(text,SHOE_WORDS)||n==="shoes"||n.startsWith("shoes "); if(shoe){const found=findShoe(text);return{section:"Voetbalschoenen",category:found.brand,subcategory:found.model,competition:"",club:"",country:"",player:"",season:"Seizoen onbekend",types:["Voetbalschoenen"]};}
  if(team)return{section:"Voetbal",category:"Clubteams",subcategory:team.competition,competition:team.competition,club:team.club,country:"",player,season:year,types:["Voetbalshirt"]};
  if(country)return{section:"Voetbal",category:"Landenteams",subcategory:country,competition:"Landenteams",club:country,country,player,season:year,types:["Voetbalshirt"]};
  if(player||containsAny(text,FOOTBALL_WORDS))return{section:"Voetbal",category:"Overig voetbal",subcategory:player||"Overig voetbal",competition:"Overig voetbal",club:player||"Overig voetbal",country:"",player,season:year,types:["Voetbalshirt"]};
  return{section:"Overige producten",category:"Overige producten",subcategory:cleanText(category,"Overig"),competition:"",club:"",country:"",player:"",season:"Seizoen onbekend",types:["Overig"]};
}
const meaningful=(title,category="")=>{const text=norm(`${title} ${category}`);return text&&!IGNORE_WORDS.some(word=>text.includes(norm(word)));};
class HttpError extends Error{constructor(status,url){super(`HTTP ${status} for ${url}`);this.status=status;}}
async function request(url){for(let attempt=0;attempt<3;attempt++){await sleep(250);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);try{const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36",accept:"text/html,application/xhtml+xml","accept-language":"en-US,en;q=0.9,nl;q=0.8"},signal:controller.signal,redirect:"follow"});if(!response.ok)throw new HttpError(response.status,url);return await response.text();}catch(error){if(error.status===404||attempt===2)throw error;await sleep(1000*(attempt+1));}finally{clearTimeout(timer);}}}
async function read(file,fallback){try{return JSON.parse(await fs.readFile(file,"utf8"));}catch{return fallback;}}
async function write(file,data){await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;await fs.writeFile(temp,JSON.stringify(data,null,2)+"\n");await fs.rename(temp,file);}
function validImage(url=""){const value=String(url).toLowerCase();return /^https?:\/\//.test(value)&&value.includes("photo.yupoo.com")&&!["logo","avatar","favicon","default","placeholder","loading","qrcode","icon","banner","blank.gif","spacer.gif"].some(word=>value.includes(word));}
const proxiedImage=url=>validImage(url)?`https://wsrv.nl/?url=${encodeURIComponent(url)}&w=1200&output=webp&q=82`:"";
const srcset=(value="",base="")=>String(value).split(",").map(item=>absoluteUrl(base,item.trim().split(/\s+/)[0])).filter(validImage);
function collectImages($,source,album){const images=[];const add=value=>{const url=absoluteUrl(source.base,value);if(validImage(url))images.push(url);};$("meta[property='og:image'],meta[name='twitter:image'],img,source").each((_,el)=>{for(const attr of ["content","data-origin-src","data-original","data-src","data-lazy","data-lazy-src","data-image","src"])add($(el).attr(attr));images.push(...srcset($(el).attr("srcset"),source.base),...srcset($(el).attr("data-srcset"),source.base));});$("[style*='background-image']").each((_,el)=>{const regex=/url\((['"]?)(.*?)\1\)/gi;let m;while((m=regex.exec($(el).attr("style")||"")))add(m[2]);});add(album.preview);return unique(images).slice(0,MAX_IMAGES*4);}
function pageData(html,source,inherited=""){const $=cheerio.load(html);const categories=new Map(),albums=new Map();$("a[href*='/categories/'],a[href*='/collections/']").each((_,el)=>{const url=absoluteUrl(source.base,$(el).attr("href")).split("?")[0];if(url)categories.set(url,{url,title:cleanText($(el).attr("title")||$(el).text(),"Overig")});});$("a[href*='/albums/']").each((_,el)=>{const fetchUrl=absoluteUrl(source.base,$(el).attr("href"));const url=fetchUrl.split("?")[0];if(!/\/albums\/\d+/.test(url))return;const image=$(el).find("img").first();const preview=unique([image.attr("data-origin-src"),image.attr("data-original"),image.attr("data-src"),image.attr("data-lazy-src"),image.attr("src")].map(v=>absoluteUrl(source.base,v)).filter(validImage).concat(srcset(image.attr("srcset"),source.base),srcset(image.attr("data-srcset"),source.base)))[0]||"";const id=url.match(/\/albums\/(\d+)/)?.[1]||"onbekend";albums.set(url,{url,fetchUrl,title:cleanText($(el).attr("title")||image.attr("alt")||$(el).text(),`Product ${id}`),category:cleanText(inherited,"Overig"),preview});});return{categories:[...categories.values()],albums:[...albums.values()]};}

// Aparte Tangma-scraper voor de eigen mobiele Tangma-website.
function tangmaImage(url = "") {
  const value = String(url).toLowerCase();
  return /^https?:\/\//.test(value) &&
    !["logo", "favicon", "loading", "qrcode", "icon", "banner", "blank.gif", "spacer.gif"].some(word => value.includes(word)) &&
    /\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(value);
}
function tangmaPageData(html, source, inherited = "Fashion") {
  const $ = cheerio.load(html);
  const categories = new Map();
  const products = new Map();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") || "";
    const url = absoluteUrl(source.base, href);
    const title = cleanText($(element).attr("title") || $(element).text(), inherited);
    if (/categoryen_\d+\.html/i.test(url)) categories.set(url.split("#")[0], { url: url.split("#")[0], title });
    if (/producten_\d+(?:_\d+)?\.html/i.test(url)) {
      const image = $(element).find("img").first();
      const preview = ["data-original", "data-src", "data-lazy-src", "src"].map(attr => absoluteUrl(source.base, image.attr(attr))).find(tangmaImage) || "";
      const id = url.match(/producten_(\d+(?:_\d+)?)\.html/i)?.[1] || url;
      products.set(url.split("#")[0], { url: url.split("#")[0], fetchUrl: url, sourceId: id, title, category: inherited, preview });
    }
  });
  return { categories: [...categories.values()], albums: [...products.values()] };
}
async function discoverTangma(source, state) {
  const products = new Map();
  const queue = [{ url: source.start, title: "Fashion" }];
  const visited = new Set();
  while (queue.length && !runtimeAlmostReached()) {
    const current = queue.shift();
    if (!current?.url || visited.has(current.url)) continue;
    visited.add(current.url);
    try {
      const data = tangmaPageData(await request(current.url), source, current.title);
      for (const product of data.albums) if (meaningful(product.title, product.category)) products.set(product.url, product);
      for (const category of data.categories) if (!visited.has(category.url)) queue.push(category);
    } catch (error) {
      if (error.status !== 404) console.warn(`[${source.key}] Tangma-pagina ${current.url}: ${error.message}`);
    }
  }
  state.deadCategories ||= {};
  state.deadCategories[source.key] ||= [];
  await write(STATE, state);
  return [...products.values()];
}
async function discoverDefault(source,state){const albums=new Map(),categories=new Map();state.deadCategories||={};state.deadCategories[source.key]||=[];const dead=new Set(state.deadCategories[source.key]);for(let page=1;page<=MAX_PAGES&&!runtimeAlmostReached();page++){const url=page===1?`${source.base}/albums?tab=gallery`:`${source.base}/albums?tab=gallery&page=${page}`;try{const data=pageData(await request(url),source);data.albums.forEach(x=>albums.set(x.url,x));data.categories.forEach(x=>categories.set(x.url,x));if(!data.albums.length&&page>1)break;}catch(error){if(error.status!==404)console.warn(`[${source.key}] index: ${error.message}`);break;}}for(const category of categories.values()){if(runtimeAlmostReached()||dead.has(category.url))continue;for(let page=1;page<=MAX_PAGES&&!runtimeAlmostReached();page++){const url=page===1?category.url:`${category.url}${category.url.includes("?")?"&":"?"}page=${page}`;try{const before=albums.size;const data=pageData(await request(url),source,category.title);data.albums.forEach(x=>albums.set(x.url,x));if((!data.albums.length||albums.size===before)&&page>1)break;}catch(error){if(error.status===404&&page===1)dead.add(category.url);break;}}}state.deadCategories[source.key]=[...dead];await write(STATE,state);return[...albums.values()];}
async function discover(source,state){return source.scraper==="tangma"?discoverTangma(source,state):discoverDefault(source,state);}
function sourceItemId(item) {
  return item?.sourceId ||
    item?.url?.match(/\/albums\/(\d+)/)?.[1] ||
    item?.url?.match(/producten_(\d+(?:_\d+)?)\.html/i)?.[1] ||
    "unknown";
}
function collectTangmaImages($, source, album) {
  const images = [];
  const add = value => { const url = absoluteUrl(source.base, value); if (tangmaImage(url)) images.push(url); };
  $("meta[property='og:image'],meta[name='twitter:image'],img,source").each((_, element) => {
    for (const attribute of ["content", "data-original", "data-src", "data-lazy-src", "src"]) add($(element).attr(attribute));
    for (const value of String($(element).attr("srcset") || "").split(",")) add(value.trim().split(/\s+/)[0]);
  });
  add(album.preview);
  return unique(images).slice(0, MAX_IMAGES * 4);
}
function albumData(html,album,source){const $=cheerio.load(html);return{title:cleanText($("h1").first().text()||$("meta[property='og:title']").attr("content")||$("title").text()||album.title,album.title),images:source.scraper==="tangma"?collectTangmaImages($,source,album):collectImages($,source,album)};}
async function imageWorks(url){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch(url,{method:"GET",redirect:"follow",signal:controller.signal,headers:{"user-agent":"Mozilla/5.0 Chrome/129 Safari/537.36",accept:"image/avif,image/webp,image/*,*/*",range:"bytes=0-65535"}});const type=response.headers.get("content-type")||"";const length=Number(response.headers.get("content-length")||0);if(response.body)await response.body.cancel();return response.ok&&type.startsWith("image/")&&(length===0||length>=1024);}catch{return false;}finally{clearTimeout(timer);}}
async function externalImages(candidates,previous){const urls=unique(candidates).filter(url => validImage(url) || tangmaImage(url)).map(url => `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=1200&output=webp&q=82`).filter(Boolean),working=[];for(const url of urls){if(working.length>=MAX_IMAGES||runtimeAlmostReached())break;if(await imageWorks(url))working.push(url);}if(working.length)return working;for(const url of unique([previous?.coverUrl,...(previous?.images||[])]).filter(x=>/^https?:\/\//.test(String(x||"")))){if(runtimeAlmostReached())break;if(await imageWorks(url))return[url];}return[];}
async function processAlbum(source,album,previous){const id=sourceItemId(album);let detail=null;try{detail=albumData(await request(album.fetchUrl||album.url),album,source);}catch(error){console.warn(`[${source.key}:${id}] albumdetail: ${error.message}`);}const title=detail?.title||album.title;const raw=detail?.images?.length?detail.images:album.preview?[album.preview]:[];if(!meaningful(title,album.category))return null;const images=await externalImages(raw,previous);if(!images.length)return null;return{...(previous||{}),uniqueKey:`${source.key}:${id}`,source:source.key,sourceId:id,sourceUrl:album.url,sourceCategory:cleanText(album.category,"Overig"),title,...classify(title,album.category,source),images,coverUrl:images[0],imageCount:images.length,classificationVersion:CLASSIFICATION_VERSION,photoVersion:PHOTO_VERSION,updatedAt:new Date().toISOString()};}
function cleanExisting(product){const source=SOURCES.find(x=>x.key===product.source)||{key:product.source||"existing"};const title=cleanText(product.title,`Product ${product.sourceId||"Unknown"}`),sourceCategory=cleanText(product.sourceCategory,"Overig");return{...product,title,...classify(title,sourceCategory,source),sourceCategory};}
const publishedImage=product=>unique([product?.coverUrl,...(product?.images||[])]).some(v=>/^https?:\/\//.test(String(v||"")));
const complete=product=>Boolean(product?.title&&product?.section&&product?.category&&product?.subcategory&&publishedImage(product)&&product.classificationVersion>=CLASSIFICATION_VERSION&&product.photoVersion>=PHOTO_VERSION);
const publicProducts=map=>[...map.values()].filter(Boolean).filter(x=>meaningful(x.title,x.sourceCategory)).filter(publishedImage).sort((a,b)=>String(a.section).localeCompare(String(b.section),"nl")||String(a.competition||"").localeCompare(String(b.competition||""),"nl")||String(a.club||"").localeCompare(String(b.club||""),"nl")||String(b.season||"").localeCompare(String(a.season||""),"nl")||String(a.title).localeCompare(String(b.title),"nl"));
async function save(map,warnings,source,status){const products=publicProducts(map);await write(CATALOG,{lastSync:new Date().toISOString(),status,currentSource:source,productCount:products.length,products,warnings});}
async function gracefulStop(map,state,warnings,sourceKey){console.log(`[Runtime] Veilige runtimegrens bereikt na ${runtimeMinutes()} minuten.`);await save(map,warnings,sourceKey,"paused");state.pausedAt=new Date().toISOString();state.pauseReason="safe-runtime-limit";await write(STATE,state);}

async function main(){const catalog=await read(CATALOG,{products:[],warnings:[]});const map=new Map();const state=await read(STATE,{sources:{}});const warnings=[];state.sources||={};for(const product of catalog.products||catalog.albums||[]){const cleaned=cleanExisting(product);map.set(cleaned.uniqueKey||`${cleaned.source}:${cleaned.sourceId}`,cleaned);}for(const source of SOURCES){if(runtimeAlmostReached()){await gracefulStop(map,state,warnings,source.key);return;}console.log(`[${source.key}] controle gestart`);const albums=await discover(source,state);if(runtimeAlmostReached()){await gracefulStop(map,state,warnings,source.key);return;}const albumById=new Map(albums.map(album=>[sourceItemId(album),album]));const current=state.sources[source.key]||{};const canResume=current.classificationVersion===CLASSIFICATION_VERSION&&current.photoVersion===PHOTO_VERSION&&Array.isArray(current.pendingIds)&&current.pendingIds.length>0&&Number.isInteger(current.nextIndex)&&current.nextIndex<current.pendingIds.length;const pendingIds=canResume?current.pendingIds.filter(id=>albumById.has(id)):albums.filter(album=>{const id=sourceItemId(album);return !complete(map.get(`${source.key}:${id}`));}).map(album=>sourceItemId(album));const work=pendingIds.map(id=>albumById.get(id)).filter(Boolean);const startIndex=canResume?Math.min(current.nextIndex||0,work.length):0;state.sources[source.key]={run:RUN,nextIndex:startIndex,total:work.length,discovered:albums.length,pendingIds,classificationVersion:CLASSIFICATION_VERSION,photoVersion:PHOTO_VERSION};await write(STATE,state);for(let offset=startIndex;offset<work.length;offset+=BATCH){if(runtimeAlmostReached()){await gracefulStop(map,state,warnings,source.key);return;}const batch=work.slice(offset,offset+BATCH);const results=await Promise.all(batch.map(album=>limit(async()=>{const id=sourceItemId(album);const key=`${source.key}:${id}`;return{key,product:await processAlbum(source,album,map.get(key))};})));for(const result of results){if(result.product)map.set(result.key,result.product);else map.delete(result.key);}state.sources[source.key].nextIndex=Math.min(offset+results.length,work.length);await save(map,warnings,source.key,"running");await write(STATE,state);console.log(`[${source.key}] checkpoint ${state.sources[source.key].nextIndex}/${work.length}; runtime ${runtimeMinutes()} min`);}state.sources[source.key]={...state.sources[source.key],nextIndex:work.length,pendingIds:[],completedAt:new Date().toISOString()};await write(STATE,state);console.log(`[${source.key}] gereed`);}const products=publicProducts(map);const counts=products.reduce((r,p)=>{r.total++;if(p.section==="Voetbal")r.football++;if(p.section==="Trainingskleding")r.training++;if(p.section==="Voetbalschoenen")r.shoes++;if(p.section==="Fashion")r.fashion++;if(p.section==="Overige producten")r.other++;return r;},{total:0,football:0,training:0,shoes:0,fashion:0,other:0});await write(CATALOG,{lastSync:new Date().toISOString(),status:"completed",productCount:products.length,counts,products,warnings});state.completedAt=new Date().toISOString();state.lastRun=RUN;state.counts=counts;delete state.pausedAt;delete state.pauseReason;await write(STATE,state);console.log(`[Catalogus] ${counts.total} producten; voetbal ${counts.football}; training ${counts.training}; schoenen ${counts.shoes}; fashion ${counts.fashion}; overige ${counts.other}.`);}
main().catch(error=>{console.error(error);process.exitCode=1;});
