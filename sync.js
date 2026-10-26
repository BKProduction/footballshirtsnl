import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG_PATH = "data/catalog.json";
const TEMP_CATALOG_PATH = "data/catalog.json.tmp";

const SOURCES = [
  { key: "minkang", base: "https://minkang.x.yupoo.com", imageHost: "photo.yupoo.com/minkang", priority: 1, forcedSection: "", seedCategories: ["718623"] },
  { key: "yema007", base: "https://yema007.x.yupoo.com", imageHost: "photo.yupoo.com/yema007", priority: 2, forcedSection: "", seedCategories: [] },
  { key: "popmo", base: "https://popmo.x.yupoo.com", imageHost: "photo.yupoo.com/popmo", priority: 3, forcedSection: "", seedCategories: [] },
  { key: "dongshanstore", base: "https://dongshanstore.x.yupoo.com", imageHost: "photo.yupoo.com/dongshanstore", priority: 4, forcedSection: "Trainingskleding", seedCategories: [] },
  { key: "aosendi", base: "https://aosendi.x.yupoo.com", imageHost: "photo.yupoo.com/aosendi", priority: 5, forcedSection: "Trainingskleding", seedCategories: [] }
];

const MAX_INDEX_PAGES = Math.max(1, Number(process.env.SYNC_MAX_PAGES || 100));
const MAX_CATEGORY_PAGES = Math.max(1, Number(process.env.SYNC_CATEGORY_MAX_PAGES || 100));
const MAX_COLLECTION_PAGES = Math.max(1, Number(process.env.SYNC_COLLECTION_MAX_PAGES || 100));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES_PER_ALBUM || 6));
const CONCURRENCY = Math.max(1, Number(process.env.SYNC_CONCURRENCY || 2));
const REQUEST_DELAY = Math.max(0, Number(process.env.SYNC_DELAY_MS || 180));
const BATCH_SIZE = Math.max(1, Number(process.env.SYNC_BATCH_SIZE || 25));
const RESUME_REWIND_BATCHES = Math.max(0, Number(process.env.SYNC_RESUME_REWIND_BATCHES || 2));
const limit = pLimit(CONCURRENCY);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const CLUBS = [
  "Manchester United","Manchester City","Real Madrid","Atletico Madrid","Atlético Madrid","Bayern Munich","Borussia Dortmund","Inter Milan","AC Milan","Paris Saint Germain","Paris","PSG","Tottenham","Liverpool","Arsenal","Chelsea","Barcelona","Ajax","Feyenoord","PSV","Juventus","Napoli","Roma","Marseille","Benfica","Porto","Sporting CP","Flamengo","Palmeiras","Inter Miami","LA Galaxy"
];
const COUNTRIES = [
  "Argentina","Australia","Austria","Belgium","Brazil","Canada","Chile","China","Colombia","Croatia","Denmark","Ecuador","England","France","Germany","Ghana","Italy","Japan","Mexico","Morocco","Netherlands","Nigeria","Norway","Poland","Portugal","Saudi Arabia","Scotland","Senegal","South Korea","Spain","Sweden","Switzerland","Turkey","Tunisia","Uruguay","USA","United States","Wales"
];
const NON_PRODUCT = /whats?app|contact|call me|feedback|faq|shipping|service center|how to (place )?order|how to buy|como comprar|size chart|business|notice|existing customers|tik ?tok|video$/i;
const SIZE_CHART = /size chart|size reference|sizing|尺码|尺寸|参考表/i;

function safeText(value, fallback = "") { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function normalize(value = "") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function absolute(source, url) { if (!url) return null; try { return url.startsWith("http") ? url : new URL(url, source.base).href; } catch { return null; } }
function albumId(url = "") { return url.match(/\/albums\/(\d+)/)?.[1] || null; }
function categoryId(url = "") { return url.match(/\/categories\/(\d+)/)?.[1] || null; }
function collectionId(url = "") { return url.match(/\/collections\/(\d+)/)?.[1] || url.match(/[?&]referrercate=(\d+)/)?.[1] || null; }
function containsName(text, name) { const t = normalize(text), n = normalize(name); return t === n || t.startsWith(`${n} `) || t.includes(` ${n} `) || t.endsWith(` ${n}`); }

function fullYear(shortYear) { const y = Number(shortYear); return y >= 50 ? 1900 + y : 2000 + y; }
function productSeason(title = "") {
  const text = String(title);
  let match = text.match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)\d{2})\b/);
  if (match) return `${match[1]}/${match[2].slice(-2)}`;
  match = text.match(/\b((?:19|20)\d{2})\s*[\/_-]\s*(\d{2})\b/);
  if (match) return `${match[1]}/${match[2]}`;
  match = text.match(/\b(\d{2})\s*[\/_-]\s*(\d{2})\b/);
  if (match) return `${fullYear(match[1])}/${match[2]}`;
  return text.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || "Onbekend seizoen";
}

function normalizedSeason(value = "") {
  const match = String(value).match(/\b((?:19|20)?\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/);
  if (!match) return normalize(value);
  let first = match[1].length === 2 ? fullYear(match[1]) : Number(match[1]);
  let second = match[2].length === 4 ? Number(match[2]) : Math.floor(first / 100) * 100 + Number(match[2]);
  if (second < first) second += 100;
  return `${first}-${second}`;
}

function productTypes(title = "") {
  const t = normalize(title), out = [];
  if (/\bretro\b/.test(t)) out.push("Retro");
  if (/\b(kids?|baby|youth)\b/.test(t) || /儿童/.test(title)) out.push("Kids");
  if (/\b(women|womens|ladies)\b/.test(t)) out.push("Dames");
  if (/\btraining|pre match|tracksuit\b/.test(t) || /训练/.test(title)) out.push("Training");
  if (/\bgoalkeeper\b/.test(t)) out.push("Keepers");
  if (/\blong sleeve\b/.test(t) || /长袖/.test(title)) out.push("Lange mouw");
  if (/\bshort sleeve\b/.test(t) || /短袖/.test(title)) out.push("Korte mouw");
  if (/\bplayer version\b/.test(t)) out.push("Player version");
  if (/\bspecial edition|commemorative|anniversary\b/.test(t)) out.push("Special edition");
  return out;
}

function trainingSubtype(text = "") {
  const t = normalize(text);
  if (/kids?|youth/.test(t) || /儿童/.test(text)) return "Kids";
  if (/windbreaker|windproof/.test(t) || /风衣/.test(text)) return "Windjacks";
  if (/hood|hoodie/.test(t) || /连帽/.test(text)) return "Hoodies";
  if (/jacket|coat/.test(t) || /夹克|外套/.test(text)) return "Jassen";
  if (/short sleeve/.test(t) || /短袖/.test(text)) return "Korte mouw";
  if (/long sleeve/.test(t) || /长袖/.test(text)) return "Lange mouw";
  if (/half zip|quarter zip/.test(t) || /半拉/.test(text)) return "Half-zip";
  if (/tracksuit|training suit|set/.test(t) || /套装/.test(text)) return "Trainingspakken";
  return "Overige trainingskleding";
}

function footballShoeBrand(text = "") {
  const t = normalize(text);
  for (const [pattern, label] of [[/\bnike\b/,"Nike"],[/\badidas\b/,"Adidas"],[/\bpuma\b/,"Puma"],[/\bnew balance\b/,"New Balance"],[/\bmizuno\b/,"Mizuno"],[/\bunder armour\b/,"Under Armour"],[/\bumbro\b/,"Umbro"]]) if (pattern.test(t)) return label;
  return "Overige merken";
}
function footballShoeModel(text = "") {
  const t = normalize(text);
  const models = [["mercurial","Mercurial"],["phantom","Phantom"],["tiempo","Tiempo"],["predator","Predator"],["f50","F50"],["copa","Copa"],["crazyfast","X Crazyfast"],["future","Future"],["ultra","Ultra"],["puma king","King"],["tekela","Tekela"],["furon","Furon"],["morelia","Morelia"],["monarcida","Monarcida"]];
  return models.find(([key]) => t.includes(key))?.[1] || "Overige modellen";
}
function isFootballShoe(text = "") {
  const t = normalize(text);
  const explicit = /\bfootball boots?\b|\bsoccer cleats?\b|\bfootball shoes?\b|\bsoccer shoes?\b|\bcleats?\b/.test(t);
  const model = /\bmercurial\b|\bphantom\b|\btiempo\b|\bpredator\b|\bf50\b|\bcopa\b|\bcrazyfast\b|\btekela\b|\bfuron\b|\bmorelia\b|\bmonarcida\b/.test(t);
  const pumaModel = /\bpuma\b/.test(t) && /\bfuture\b|\bultra\b|\bking\b/.test(t);
  const sole = /\bfg\b|\bag\b|\btf\b|\bmg\b|\bsg\b|\bic\b|\bfg mg\b|\bag pro\b|\bfirm ground\b|\bartificial grass\b|\bturf\b|\bsoft ground\b/.test(t);
  const brand = /\bnike\b|\badidas\b|\bpuma\b|\bnew balance\b|\bmizuno\b|\bunder armour\b|\bumbro\b/.test(t);
  return explicit || model || pumaModel || (sole && brand);
}
function isRegularShoe(text = "") { return /\bshoe\b|\bshoes\b|\bsneaker\b|\bsneakers\b|\btrainer\b|\btrainers\b|\bboots\b|\bsandals\b|\bslippers\b/.test(normalize(text)); }

function productClass(title, sourceCollection = "", sourceCategory = "", source = {}) {
  const combined = `${title} ${sourceCollection} ${sourceCategory}`;
  const season = productSeason(title), types = productTypes(combined);
  const sortedClubs = [...CLUBS].sort((a,b) => b.length-a.length);
  const sortedCountries = [...COUNTRIES].sort((a,b) => b.length-a.length);
  const club = sortedClubs.find(name => containsName(combined, name)) || "";
  const country = sortedCountries.find(name => containsName(combined, name)) || "";

  if (source.forcedSection === "Trainingskleding") return { section:"Trainingskleding", category:club?"Clubteams":country?"Landenteams":"Overige trainingskleding", subcategory:trainingSubtype(combined), country:country||"Overig", competition:"", club:club||country||"Overig", season, types:unique(["Training",...types]) };

  const all = normalize(combined);
  if (/\b(handbag|shoulder bag|tote bag|crossbody|clutch|purse|wallet|backpack|rucksack|travel bag|duffle|duffel|bag)\b/.test(all)) return { section:"Mode & accessoires", category:"Tassen", subcategory:/backpack|rucksack/.test(all)?"Rugzakken":/travel|duff/.test(all)?"Reistassen":/wallet|purse/.test(all)?"Portemonnees":"Handtassen", country:"Overig", competition:"", club:"", season, types:[] };
  if (/\b(watch|watches|chronograph|timepiece)\b/.test(all)) return { section:"Mode & accessoires", category:"Horloges", subcategory:"Horloges", country:"Overig", competition:"", club:"", season, types:[] };
  if (/\b(belt|belts)\b/.test(all)) return { section:"Mode & accessoires", category:"Riemen", subcategory:"Riemen", country:"Overig", competition:"", club:"", season, types:[] };
  if (isFootballShoe(combined)) return { section:"Schoenen", category:"Voetbalschoenen", subcategory:footballShoeBrand(combined), country:"Overig", competition:"", club:footballShoeModel(combined), season, types:[] };
  if (isRegularShoe(combined)) return { section:"Schoenen", category:/sandals|slippers/.test(all)?"Sandalen & slippers":"Sneakers", subcategory:/sandals|slippers/.test(all)?"Sandalen & slippers":footballShoeBrand(combined), country:"Overig", competition:"", club:"", season, types:[] };
  if (country) return { section:"Voetbal", category:"Landenteams", subcategory:"WK & landenteams", country, competition:"WK & landenteams", club:country, season, types };
  if (club) return { section:"Voetbal", category:"Clubteams", subcategory:"Clubteams", country:"Overig", competition:"Clubteams", club, season, types };
  if (/\b(jersey|shirt|football|soccer|kit|uniform|training|windbreaker|tracksuit)\b/.test(all)) return { section:"Voetbal", category:"Overige voetbalproducten", subcategory:sourceCategory||sourceCollection||"Overig", country:"Overig", competition:sourceCategory||sourceCollection||"Overig", club:"Overig", season, types };
  return { section:"Overige producten", category:"Overige producten", subcategory:sourceCategory||sourceCollection||"Nog te categoriseren", country:"Overig", competition:"", club:"", season, types:[] };
}

function sanitizeProduct(product = {}) {
  const source = safeText(product.source,"onbekend"), sourceId = safeText(product.sourceId,"onbekend");
  return { ...product, source, sourceId, uniqueKey:safeText(product.uniqueKey,`${source}:${sourceId}`), sourcePriority:Number.isFinite(Number(product.sourcePriority))?Number(product.sourcePriority):99, title:safeText(product.title,`${source}-${sourceId}`), section:safeText(product.section,"Overige producten"), category:safeText(product.category,"Overige producten"), subcategory:safeText(product.subcategory,"Nog te categoriseren"), country:safeText(product.country,"Overig"), competition:safeText(product.competition), club:safeText(product.club), season:safeText(product.season,productSeason(product.title)), types:Array.isArray(product.types)?product.types:[], images:Array.isArray(product.images)?product.images.filter(Boolean):[], sourceImages:Array.isArray(product.sourceImages)?product.sourceImages.filter(Boolean):[] };
}

async function request(source,url,attempt=1){ await sleep(REQUEST_DELAY); const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 FootballshirtsNL-MultiSourceSync/6.0","accept-language":"nl-NL,nl;q=0.9,en;q=0.8",referer:`${source.base}/`}}); if((response.status===429||response.status>=500)&&attempt<4){await sleep(1000*attempt);return request(source,url,attempt+1);} if(!response.ok)throw new Error(`${response.status} ${url}`);return response; }
async function html(source,url){return(await request(source,url)).text();}
async function loadPrevious(){try{return JSON.parse(await fs.readFile(CATALOG_PATH,"utf8"));}catch{return{products:[],albums:[]};}}
function pageTitle($,fallback=""){return safeText($("h1").first().text()||$("title").text().split("|")[0],fallback);}

function extractLinks($,source,context={}){const products=[];$('a[href*="/albums/"]').each((_,element)=>{const href=$(element).attr("href"),id=albumId(href);if(!id)return;const card=$(element).closest("li,.album__main,.showindex__children,.album__item");const title=safeText($(element).attr("title")||card.find(".album__title,.showindex__children__title").text()||$(element).text());if(!title||NON_PRODUCT.test(title)||SIZE_CHART.test(title))return;const sourceCollection=safeText(context.sourceCollection),sourceCategory=safeText(context.sourceCategory);products.push(sanitizeProduct({source:source.key,sourcePriority:source.priority,sourceId:String(id),uniqueKey:`${source.key}:${id}`,title,sourceUrl:absolute(source,href),categoryId:context.categoryId||categoryId(href),collectionId:context.collectionId||collectionId(href),sourceCollection,sourceCategory,...productClass(title,sourceCollection,sourceCategory,source)}));});return[...new Map(products.map(p=>[p.uniqueKey,p])).values()];}
function extractNavigation($){const categories=new Map(),collections=new Map();$('a[href*="/categories/"]').each((_,e)=>{const id=categoryId($(e).attr("href"));if(id)categories.set(id,{id,name:safeText($(e).attr("title")||$(e).text())});});$('a[href*="/collections/"]').each((_,e)=>{const id=collectionId($(e).attr("href"));if(id)collections.set(id,{id,name:safeText($(e).attr("title")||$(e).text())});});return{categories:[...categories.values()],collections:[...collections.values()]};}
async function discoverSeeds(source){const categories=new Map((source.seedCategories||[]).map(id=>[id,{id,name:""}])),collections=new Map();for(const url of[`${source.base}/`,`${source.base}/albums`,`${source.base}/categories`]){try{const nav=extractNavigation(cheerio.load(await html(source,url)));for(const i of nav.categories)categories.set(i.id,i);for(const i of nav.collections)collections.set(i.id,i);}catch(error){console.error(`[${source.key}] navigatie ${url}: ${error.message}`);}}return{categories:[...categories.values()],collections:[...collections.values()]};}
async function crawlPaged(source,urlFactory,maxPages,context){const products=[];let empty=0;for(let page=1;page<=maxPages;page++){try{const $=cheerio.load(await html(source,urlFactory(page))),name=pageTitle($,context.name||"");const found=extractLinks($,source,{...context,sourceCategory:context.sourceCategory||name,sourceCollection:context.sourceCollection||name});products.push(...found);console.log(`[${source.key}] ${context.kind} ${context.id||"index"} pagina ${page}: ${found.length}`);empty=found.length?0:empty+1;if(empty>=2)break;}catch(error){console.error(`[${source.key}] ${context.kind} ${context.id||"index"} pagina ${page}: ${error.message}`);break;}}return products;}
async function discoverSource(source){const found=[...await crawlPaged(source,p=>`${source.base}/albums?page=${p}`,MAX_INDEX_PAGES,{kind:"index",name:""})];const seeds=await discoverSeeds(source);for(const c of seeds.categories)found.push(...await crawlPaged(source,p=>`${source.base}/categories/${c.id}?isSubCate=true&page=${p}`,MAX_CATEGORY_PAGES,{kind:"categorie",id:c.id,name:c.name,categoryId:c.id,sourceCategory:c.name}));for(const c of seeds.collections)found.push(...await crawlPaged(source,p=>`${source.base}/collections/${c.id}?page=${p}`,MAX_COLLECTION_PAGES,{kind:"collectie",id:c.id,name:c.name,collectionId:c.id,sourceCollection:c.name}));return[...new Map(found.map(p=>[p.uniqueKey,p])).values()];}

function sourceImageUrls($,source){const urls=[];$("img").each((_,e)=>{const raw=$(e).attr("data-origin-src")||$(e).attr("data-src")||$(e).attr("data-lazy")||$(e).attr("src"),url=absolute(source,raw);if(!url)return;let parsed;try{parsed=new URL(url);}catch{return;}const host=parsed.host.toLowerCase(),pathname=parsed.pathname.toLowerCase();if(host!=="photo.yupoo.com"&&!host.endsWith(".yupoo.com"))return;if(source.imageHost&&!url.toLowerCase().includes(source.imageHost.toLowerCase()))return;if(/\/(square|small|thumb)[^/]*\.(jpg|jpeg|png|webp)$/.test(pathname))return;urls.push(url);});return unique(urls).slice(0,MAX_IMAGES);}
async function inspectProduct(product){const source=SOURCES.find(s=>s.key===product.source);return limit(async()=>{const $=cheerio.load(await html(source,product.sourceUrl)),title=pageTitle($,product.title);return sanitizeProduct({...product,title,...productClass(title,product.sourceCollection,product.sourceCategory,source),sourceImages:sourceImageUrls($,source)});});}
async function fileExists(file){if(!file)return false;try{await fs.access(file.replace(/^\.\//,""));return true;}catch{return false;}}
function imageLocation(product,index){const directory=path.join("assets","products",product.source,String(product.sourceId)),file=path.join(directory,`${String(index+1).padStart(2,"0")}.webp`);return{directory,file,publicPath:`./${file.replaceAll(path.sep,"/")}`};}
async function saveImage(product,url,index){const loc=imageLocation(product,index);await fs.mkdir(loc.directory,{recursive:true});if(await fileExists(loc.file))return loc.publicPath;const source=SOURCES.find(s=>s.key===product.source),buffer=Buffer.from(await(await request(source,url)).arrayBuffer()),tmp=`${loc.file}.tmp`;try{await sharp(buffer).rotate().resize({width:index===0?700:1200,withoutEnlargement:true}).webp({quality:80}).toFile(tmp);await fs.rename(tmp,loc.file);return loc.publicPath;}catch(error){await fs.rm(tmp,{force:true}).catch(()=>{});throw error;}}
async function downloadProduct(product,old=null){const images=[];for(let i=0;i<product.sourceImages.length;i++){const loc=imageLocation(product,i),oldImage=old?.images?.[i];if(await fileExists(loc.file)){images.push(loc.publicPath);continue;}if(oldImage&&await fileExists(oldImage)){images.push(oldImage);continue;}try{images.push(await saveImage(product,product.sourceImages[i],i));}catch(error){console.error(`[${product.source}] Foto ${product.sourceId}/${i+1}: ${error.message}`);if(oldImage&&await fileExists(oldImage))images.push(oldImage);}}for(const oldImage of old?.images||[]){if(images.length>=MAX_IMAGES)break;if(!images.includes(oldImage)&&await fileExists(oldImage))images.push(oldImage);}const limited=images.slice(0,MAX_IMAGES);return sanitizeProduct({...product,coverUrl:limited[0]||old?.coverUrl||null,images:limited,imageCount:limited.length,updatedAt:new Date().toISOString()});}
function duplicateKey(p){return [normalize(p.title.replace(/\b((?:19|20)?\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/g,normalizedSeason(p.season))),normalize(p.section),normalize(p.category),normalize(p.subcategory),normalize(p.club),normalizedSeason(p.season),normalize((p.types||[]).slice().sort().join(" "))].join("|");}
function hasAllExpectedImages(current,old){const expected=Math.min(current.sourceImages.length,MAX_IMAGES);return expected>0&&(old?.images?.length||0)>=expected;}

await fs.mkdir("data",{recursive:true});await fs.mkdir("assets/products",{recursive:true});
const previous=await loadPrevious(),previousProducts=previous.products||previous.albums||[];
const previousProgress=previous.syncProgress||{};
const canResume=previous.syncState?.status==="in-progress"&&previousProgress.currentSource;
const completedSources=new Set(canResume&&Array.isArray(previousProgress.completedSources)?previousProgress.completedSources:[]);
let resumeSource=canResume?String(previousProgress.currentSource):"";
let resumeNextIndex=canResume?Math.max(0,Number(previousProgress.nextIndex||0)):0;
let activeProgress={currentSource:resumeSource,nextIndex:resumeNextIndex,totalForSource:Number(previousProgress.totalForSource||0),completedSources:[...completedSources]};
console.log(canResume?`[resume] Hervatten bij ${resumeSource} vanaf ongeveer ${resumeNextIndex}`:"[resume] Nieuwe totale synchronisatie gestart.");

const productMap=new Map(previousProducts.map(raw=>{const p=sanitizeProduct(raw);return[p.uniqueKey,p];}));
const stats={discovered:0,added:0,changed:0,unchanged:0,repaired:0,skipped:0,duplicatesRemoved:0,batchesSaved:0};

async function writeCatalog(label,status="in-progress"){
  const winners=new Map();for(const raw of productMap.values()){const p=sanitizeProduct(raw);if(!p.images.length)continue;const key=duplicateKey(p),current=winners.get(key);if(!current||p.sourcePriority<current.sourcePriority)winners.set(key,p);}
  const products=[...winners.values()].sort((a,b)=>String(a.section).localeCompare(String(b.section),"nl")||String(a.category).localeCompare(String(b.category),"nl")||String(a.subcategory).localeCompare(String(b.subcategory),"nl")||String(a.club).localeCompare(String(b.club),"nl")||String(a.season).localeCompare(String(b.season),"nl")||String(a.title).localeCompare(String(b.title),"nl"));
  stats.duplicatesRemoved=productMap.size-products.length;
  const output={lastSync:new Date().toISOString(),syncState:{status,label,batchSize:BATCH_SIZE,maxImages:MAX_IMAGES},syncProgress:{...activeProgress,completedSources:[...completedSources]},stats:{...stats},sources:SOURCES.map(({key,base,priority,forcedSection})=>({key,base,priority,forcedSection})),total:products.length,sections:unique(products.map(p=>p.section)).sort((a,b)=>a.localeCompare(b,"nl")),categories:unique(products.map(p=>p.category)).sort((a,b)=>a.localeCompare(b,"nl")),competitions:unique(products.map(p=>p.competition)).sort((a,b)=>a.localeCompare(b,"nl")),seasons:unique(products.map(p=>p.season)).sort((a,b)=>b.localeCompare(a,"nl")),products};
  await fs.writeFile(TEMP_CATALOG_PATH,JSON.stringify(output,null,2));await fs.rename(TEMP_CATALOG_PATH,CATALOG_PATH);stats.batchesSaved++;console.log(`[batch] Catalogus opgeslagen: ${label}; ${products.length} producten`);
}

for(const source of SOURCES){
  if(canResume&&completedSources.has(source.key)){console.log(`[resume] ${source.key} al voltooid; overgeslagen.`);continue;}
  let discovered=[];
  try{discovered=await discoverSource(source);stats.discovered+=discovered.length;console.log(`[${source.key}] totaal ontdekt: ${discovered.length}`);}catch(error){console.error(`[${source.key}] bron overgeslagen: ${error.message}`);continue;}
  let startIndex=0;
  if(canResume&&source.key===resumeSource){startIndex=Math.max(0,resumeNextIndex-(RESUME_REWIND_BATCHES*BATCH_SIZE));console.log(`[resume] ${source.key} hervat op ${startIndex}/${discovered.length}.`);}
  activeProgress={currentSource:source.key,nextIndex:startIndex,totalForSource:discovered.length,completedSources:[...completedSources]};
  for(let start=startIndex;start<discovered.length;start+=BATCH_SIZE){
    const batch=discovered.slice(start,start+BATCH_SIZE);
    const inspected=await Promise.all(batch.map(async p=>{try{return await inspectProduct(p);}catch(error){console.error(`[${p.source}] Albumcontrole ${p.sourceId}: ${error.message}`);return{...p,inspectionFailed:true};}}));
    for(const item of inspected){const old=productMap.get(item.uniqueKey);if(item.inspectionFailed){stats.skipped++;continue;}const metadataChanged=Boolean(old)&&["title","section","category","subcategory","country","competition","club","season","sourceCollection","sourceCategory","categoryId","collectionId"].some(key=>old[key]!==item[key]);const complete=old?hasAllExpectedImages(item,old):false;if(old&&complete&&!metadataChanged){productMap.set(item.uniqueKey,sanitizeProduct({...old,...item,images:old.images,coverUrl:old.coverUrl||old.images?.[0]||null,imageCount:old.images?.length||0,updatedAt:old.updatedAt}));stats.unchanged++;continue;}try{const imported=await downloadProduct(item,old);if(imported.images.length){productMap.set(item.uniqueKey,imported);if(!old)stats.added++;else if(!complete)stats.repaired++;else stats.changed++;}else stats.skipped++;}catch(error){console.error(`[${item.source}] Product ${item.sourceId}: ${error.message}`);stats.skipped++;}}
    activeProgress={currentSource:source.key,nextIndex:Math.min(start+BATCH_SIZE,discovered.length),totalForSource:discovered.length,completedSources:[...completedSources]};
    await writeCatalog(`${source.key} ${activeProgress.nextIndex}/${discovered.length}`);
  }
  completedSources.add(source.key);resumeSource="";resumeNextIndex=0;activeProgress={currentSource:"",nextIndex:0,totalForSource:0,completedSources:[...completedSources]};await writeCatalog(`${source.key} voltooid`,`in-progress`);
}

completedSources.clear();activeProgress={currentSource:"",nextIndex:0,totalForSource:0,completedSources:[]};
await writeCatalog("voltooid","completed");
console.log(`Klaar: nieuw ${stats.added}, gewijzigd ${stats.changed}, hersteld ${stats.repaired}, batches ${stats.batchesSaved}`);
