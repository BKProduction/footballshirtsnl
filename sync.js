import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG_PATH = "data/catalog.json";
const STATE_PATH = "data/sync-state.json";
const DISCOVERY_DIR = "data/discovery";
const ASSET_ROOT = "assets/products";
const SOURCES = [
  { key:"minkang", base:"https://minkang.x.yupoo.com", priority:1, seedCategories:["718623"] },
  { key:"yema007", base:"https://yema007.x.yupoo.com", priority:2, seedCategories:[] },
  { key:"popmo", base:"https://popmo.x.yupoo.com", priority:3, seedCategories:[] },
  { key:"dachang88", base:"https://dachang88.x.yupoo.com", priority:4, mode:"shoes", seedCategories:[] },
  { key:"dongshanstore", base:"https://dongshanstore.x.yupoo.com", priority:5, mode:"training", seedCategories:[] },
  { key:"aosendi", base:"https://aosendi.x.yupoo.com", priority:6, mode:"training", seedCategories:[] }
];
const MAX_INDEX_PAGES = setting("SYNC_MAX_PAGES",100);
const MAX_CATEGORY_PAGES = setting("SYNC_CATEGORY_MAX_PAGES",100);
const MAX_DISCOVERY_MINUTES = setting("SYNC_MAX_DISCOVERY_MINUTES",45);
const MAX_CATEGORIES = setting("SYNC_MAX_CATEGORIES_PER_SOURCE",500);
const MAX_IMAGES = setting("MAX_IMAGES_PER_ALBUM",6);
const BATCH_SIZE = setting("SYNC_BATCH_SIZE",25);
const REQUEST_TIMEOUT = setting("SYNC_REQUEST_TIMEOUT_MS",45000);
const REQUEST_RETRIES = setting("SYNC_REQUEST_RETRIES",2);
const REQUEST_DELAY = Math.max(0,Number(process.env.SYNC_DELAY_MS||250));
const SOURCE_FILTER = String(process.env.SYNC_SOURCE||"").trim().toLowerCase();
const limit = pLimit(setting("SYNC_CONCURRENCY",2));

const LEAGUES = [
 ["Engeland","Premier League",["Arsenal","Aston Villa","Bournemouth","Brentford","Brighton","Burnley","Chelsea","Crystal Palace","Everton","Fulham","Leeds United","Liverpool","Manchester City","Manchester United","Newcastle United","Nottingham Forest","Sunderland","Tottenham","West Ham","Wolverhampton"]],
 ["Spanje","La Liga",["Athletic Bilbao","Atletico Madrid","Barcelona","Real Betis","Real Madrid","Real Sociedad","Sevilla","Valencia","Villarreal"]],
 ["Italie","Serie A",["AC Milan","Atalanta","Bologna","Fiorentina","Inter Milan","Juventus","Lazio","Napoli","Roma"]],
 ["Duitsland","Bundesliga",["Bayern Munich","Bayer Leverkusen","Borussia Dortmund","Eintracht Frankfurt","RB Leipzig","Schalke 04","Werder Bremen"]],
 ["Frankrijk","Ligue 1",["Lille","Lyon","Marseille","Monaco","Nice","Paris Saint-Germain","PSG"]],
 ["Nederland","Eredivisie",["Ajax","AZ","Feyenoord","FC Twente","PSV","Sparta Rotterdam","FC Utrecht","Vitesse"]],
 ["Portugal","Primeira Liga",["Benfica","Porto","Sporting CP"]],
 ["Schotland","Scottish Premiership",["Celtic","Rangers"]],
 ["Turkije","Super Lig",["Besiktas","Fenerbahce","Galatasaray"]],
 ["Verenigde Staten","MLS",["Inter Miami","LA Galaxy","Los Angeles FC","New York City FC"]]
];
const COUNTRIES=["Argentina","Australia","Austria","Belgium","Brazil","Canada","Chile","China","Colombia","Croatia","Denmark","Ecuador","England","France","Germany","Ghana","Italy","Japan","Mexico","Morocco","Netherlands","Nigeria","Norway","Poland","Portugal","Saudi Arabia","Scotland","Senegal","South Korea","Spain","Sweden","Switzerland","Turkey","Tunisia","Uruguay","USA","United States","Wales"];
const SHOE_BRANDS=["Nike","Adidas","Puma","New Balance","Mizuno","Under Armour","Joma"];
const SHOE_MODELS=[
 ["Nike","Mercurial",["mercurial","vapor","superfly"]],["Nike","Phantom",["phantom","gx","luna"]],["Nike","Tiempo",["tiempo","legend"]],
 ["Adidas","Predator",["predator"]],["Adidas","F50",["f50"]],["Adidas","Copa",["copa"]],["Adidas","X",["speedportal","speedflow","crazyfast","adidas x"]],
 ["Puma","Future",["puma future","future ultimate"]],["Puma","Ultra",["puma ultra","ultra ultimate"]],["Puma","King",["puma king"]],
 ["Mizuno","Morelia",["morelia"]],["Mizuno","Alpha",["mizuno alpha"]],["Joma","Top Flex",["top flex"]]
];
function setting(n,f){const v=Number(process.env[n]||f);return Number.isFinite(v)&&v>0?Math.floor(v):f;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function norm(v=""){return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function unique(v){return[...new Set(v.filter(Boolean))];}
function absolute(base,v){if(!v)return"";try{return new URL(v,base).href;}catch{return"";}}
function canonical(url){try{const u=new URL(url);return`${u.origin}${u.pathname}`;}catch{return url.split("?")[0];}}
function albumId(url){return canonical(url).match(/\/albums\/(\d+)/)?.[1]||"";}
function includesAny(t,terms){const n=norm(t);return terms.some(x=>n.includes(norm(x)));}
function season(t){const m=String(t).match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/);if(!m)return"Seizoen onbekend";const a=Number(m[1]);let b=Number(m[2]);if(m[2].length===2){b=Math.floor(a/100)*100+b;if(b<a)b+=100;}return`${a}-${b}`;}
function club(t){const n=norm(t);return LEAGUES.flatMap(([country,competition,clubs])=>clubs.map(club=>({country,competition,club}))).sort((a,b)=>b.club.length-a.club.length).find(x=>n.includes(norm(x.club)))||null;}
function country(t){const n=norm(t);return COUNTRIES.find(x=>n.includes(norm(x)))||"";}
function classify(product,source){const t=[product.title,product.categoryTitle].filter(Boolean).join(" "),n=norm(t),s=season(t),c=club(t),land=country(t);
 if(source.mode==="training"||includesAny(t,["tracksuit","track suit","training suit","training set","training wear","training","pre match","prematch","windbreaker","hoodie","pants","shorts","trainingspak","trainingskleding"])){
  if(c)return{section:"Trainingskleding",category:"Clubteams",subcategory:c.competition,club:c.club,country:c.country,competition:c.competition,season:s,types:["Trainingskleding"]};
  if(land)return{section:"Trainingskleding",category:"Landenteams",subcategory:land,club:land,country:land,competition:"Landenteams",season:s,types:["Trainingskleding"]};
  return{section:"Trainingskleding",category:"Overig",subcategory:product.categoryTitle||"Overig",club:"Overig",country:"",competition:"",season:s,types:["Trainingskleding"]};
 }
 const shoeTerms=["football boot","soccer shoe","soccer boot","cleats","voetbalschoen",...SHOE_MODELS.flatMap(x=>x[2])];
 if(source.mode==="shoes"||includesAny(t,shoeTerms)){const brand=SHOE_BRANDS.find(x=>n.includes(norm(x)))||"Overig merk";const model=SHOE_MODELS.find(([b,,words])=>b===brand&&words.some(w=>n.includes(norm(w))))?.[1]||"Overig model";return{section:"Voetbalschoenen",category:brand,subcategory:model,club:"",country:"",competition:"",season:"Seizoen onbekend",types:["Voetbalschoenen"]};}
 if(c)return{section:"Voetbal",category:"Clubteams",subcategory:c.competition,club:c.club,country:c.country,competition:c.competition,season:s,types:["Voetbalshirt"]};
 if(land)return{section:"Voetbal",category:"Landenteams",subcategory:land,club:land,country:land,competition:"Landenteams",season:s,types:["Voetbalshirt"]};
 return{section:"Overige producten",category:"Overige producten",subcategory:product.categoryTitle||"Overig",club:"",country:"",competition:"",season:"Seizoen onbekend",types:["Overig"]};
}
class HttpError extends Error{constructor(status,url){super(`HTTP ${status} voor ${url}`);this.status=status;this.url=url;}}
async function request(url,binary=false){let last;for(let i=0;i<=REQUEST_RETRIES;i++){await sleep(REQUEST_DELAY);const c=new AbortController(),timer=setTimeout(()=>c.abort(),REQUEST_TIMEOUT);try{const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 FootballshirtsNL/1.0",accept:binary?"image/avif,image/webp,image/*,*/*":"text/html,application/xhtml+xml",referer:new URL(url).origin+"/"},signal:c.signal});if(!r.ok)throw new HttpError(r.status,url);return binary?Buffer.from(await r.arrayBuffer()):await r.text();}catch(e){last=e;if(e.status===404||i===REQUEST_RETRIES)throw e;await sleep(1000*(i+1));}finally{clearTimeout(timer);}}throw last;}
async function exists(f){try{await fs.access(f);return true;}catch{return false;}}
async function readJson(f,d){try{return JSON.parse(await fs.readFile(f,"utf8"));}catch{return d;}}
async function writeJson(f,d){await fs.mkdir(path.dirname(f),{recursive:true});const tmp=`${f}.tmp`;await fs.writeFile(tmp,JSON.stringify(d,null,2)+"\n");await fs.rename(tmp,f);}
function mergeAlbums(a,b){const m=new Map(a.map(x=>[canonical(x.url),x]));for(const x of b){const k=canonical(x.url),old=m.get(k)||{};m.set(k,{...old,...x,url:x.url||old.url,categoryTitle:x.categoryTitle||old.categoryTitle||"",thumbnailUrls:unique([...(old.thumbnailUrls||[]),...(x.thumbnailUrls||[])])});}return[...m.values()].sort((x,y)=>canonical(x.url).localeCompare(canonical(y.url),"en",{numeric:true}));}
function extractPage(html,source,categoryTitle=""){const $=cheerio.load(html),categories=new Map(),albums=new Map();
 $("a[href*='/categories/'],a[href*='/collections/']").each((_,el)=>{const url=absolute(source.base,$(el).attr("href"));if(!url)return;const key=canonical(url),title=$(el).attr("title")||$(el).text().trim()||categoryTitle;categories.set(key,{url:key,title});});
 $("a[href*='/albums/']").each((_,el)=>{const raw=$(el).attr("href"),url=absolute(source.base,raw);if(!albumId(url))return;const card=$(el).closest("li,.album__main,.showindex__children,.album__item"),title=$(el).attr("title")||card.find(".album__title,.showindex__children__title").text().trim()||$(el).find("img").attr("alt")||$(el).text().trim()||`Product ${albumId(url)}`;const thumbs=[];card.find("img").add($(el).find("img")).each((__,img)=>[$(img).attr("data-origin-src"),$(img).attr("data-src"),$(img).attr("src")].forEach(v=>{const u=absolute(source.base,v);if(u)thumbs.push(u);}));albums.set(canonical(url),{url,title,categoryTitle,thumbnailUrls:unique(thumbs)});});
 return{categories:[...categories.values()],albums:[...albums.values()]};}
function discoveryPath(s){return path.join(DISCOVERY_DIR,`${s.key}.json`);}
function initialDiscovery(s){return{version:3,source:s.key,phase:"index",indexPage:1,categories:(s.seedCategories||[]).map(id=>({url:`${s.base}/categories/${id}`,title:""})),categoryIndex:0,categoryPage:1,albums:[],complete:false};}
async function saveDiscovery(s,d,state){d.updatedAt=new Date().toISOString();await writeJson(discoveryPath(s),d);state.sources[s.key]={...(state.sources[s.key]||{}),discoveryComplete:d.complete,discoveryPhase:d.phase,discoveredAlbums:d.albums.length,categoryIndex:d.categoryIndex,categoryTotal:d.categories.length,updatedAt:d.updatedAt};await writeJson(STATE_PATH,state);}
async function discover(s,state){let d=await readJson(discoveryPath(s),initialDiscovery(s));if(d.complete){console.log(`[${s.key}] ontdekking uit cache: ${d.albums.length} albums`);return d.albums;}const deadline=Date.now()+MAX_DISCOVERY_MINUTES*60000;console.log(`[${s.key}] ontdekking hervat: ${d.phase}, albums=${d.albums.length}`);
 if(d.phase==="index"){while(d.indexPage<=MAX_INDEX_PAGES){if(Date.now()>=deadline){await saveDiscovery(s,d,state);return null;}const url=d.indexPage===1?`${s.base}/albums?tab=gallery`:`${s.base}/albums?page=${d.indexPage}&tab=gallery`;console.log(`[${s.key}] ontdekking indexpagina ${d.indexPage}/${MAX_INDEX_PAGES}`);try{const p=extractPage(await request(url),s);d.albums=mergeAlbums(d.albums,p.albums);const cm=new Map(d.categories.map(x=>[canonical(x.url),x]));p.categories.forEach(x=>cm.set(canonical(x.url),x));d.categories=[...cm.values()].slice(0,MAX_CATEGORIES);d.indexPage++;await saveDiscovery(s,d,state);if(!p.albums.length&&d.indexPage>2)break;}catch(e){console.warn(`[${s.key}] index overgeslagen: ${e.message}`);d.indexPage++;await saveDiscovery(s,d,state);break;}}d.phase="categories";await saveDiscovery(s,d,state);}
 while(d.categoryIndex<d.categories.length){if(Date.now()>=deadline){await saveDiscovery(s,d,state);return null;}const cat=d.categories[d.categoryIndex];if(d.categoryPage>MAX_CATEGORY_PAGES){d.categoryIndex++;d.categoryPage=1;continue;}const sep=cat.url.includes("?")?"&":"?",url=d.categoryPage===1?`${cat.url}?tab=gallery`:`${cat.url}${sep}page=${d.categoryPage}&tab=gallery`;console.log(`[${s.key}] ontdekking categorie ${d.categoryIndex+1}/${d.categories.length}, pagina ${d.categoryPage}`);try{const p=extractPage(await request(url),s,cat.title);d.albums=mergeAlbums(d.albums,p.albums);d.categoryPage++;await saveDiscovery(s,d,state);if(!p.albums.length){d.categoryIndex++;d.categoryPage=1;await saveDiscovery(s,d,state);}}catch(e){console.warn(`[${s.key}] categorie overgeslagen: ${e.message}`);d.categoryIndex++;d.categoryPage=1;await saveDiscovery(s,d,state);}}
 d.phase="complete";d.complete=true;await saveDiscovery(s,d,state);console.log(`[${s.key}] ontdekking voltooid: ${d.albums.length} albums`);return d.albums;}
function albumPage(html,album,source){const $=cheerio.load(html),title=$("h1").first().text().trim()||$("meta[property='og:title']").attr("content")||album.title,images=[];$("img").each((_,el)=>[$(el).attr("data-origin-src"),$(el).attr("data-src"),$(el).attr("src")].forEach(v=>{const u=absolute(source.base,v);if(/photo\.yupoo\.com|\.jpe?g(?:\?|$)|\.png(?:\?|$)|\.webp(?:\?|$)/i.test(u))images.push(u);}));$("meta[property='og:image']").each((_,el)=>images.push(absolute(source.base,$(el).attr("content"))));return{title:String(title).replace(/\s+/g," ").trim(),images:unique(images).slice(0,MAX_IMAGES)};}
async function saveImage(url,file){if(await exists(file))return;await fs.mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.tmp`;await sharp(await request(url,true)).rotate().webp({quality:82}).toFile(tmp);await fs.rename(tmp,file);}
function productKey(s,url){return`${s.key}:${albumId(url)}`;}
async function processAlbum(source,album,old){let details={title:album.title,images:album.thumbnailUrls||[]};try{details=albumPage(await request(album.url),album,source);}catch(e){console.warn(`[${source.key}] albumpagina niet bereikbaar; ontdekkingsgegevens gebruikt: ${canonical(album.url)}`);}const id=albumId(album.url),folder=path.join(ASSET_ROOT,source.key,id),images=[];for(let i=0;i<details.images.length&&i<MAX_IMAGES;i++){const file=path.join(folder,`${String(i+1).padStart(2,"0")}.webp`);try{await saveImage(details.images[i],file);}catch(e){console.warn(`[${source.key}] foto ${id}/${i+1} overgeslagen: ${e.message}`);}if(await exists(file))images.push(file.replaceAll(path.sep,"/"));}if(!images.length&&old?.images?.length)images.push(...old.images);return{uniqueKey:productKey(source,album.url),source:source.key,sourceId:id,sourceUrl:album.url,sourceCategory:album.categoryTitle||"",title:details.title,...classify({...album,title:details.title},source),images:unique(images),coverUrl:images[0]||old?.coverUrl||"",imageCount:unique(images).length,updatedAt:new Date().toISOString()};}
function sortProducts(a,b){return[a.section,a.category,a.subcategory,a.club,a.season,a.title].join("|").localeCompare([b.section,b.category,b.subcategory,b.club,b.season,b.title].join("|"),"nl");}
async function saveCatalog(map,warnings,status,currentSource=""){await writeJson(CATALOG_PATH,{lastSync:new Date().toISOString(),status,currentSource:currentSource||undefined,total:map.size,products:[...map.values()].sort(sortProducts),warnings:warnings.slice(-200)});}
async function main(){const catalog=await readJson(CATALOG_PATH,{products:[],warnings:[]}),existing=Array.isArray(catalog.products)?catalog.products:Array.isArray(catalog.albums)?catalog.albums:[],map=new Map(existing.map(p=>[p.uniqueKey||`${p.source}:${p.sourceId}`,p])),state=await readJson(STATE_PATH,{version:3,sources:{}}),warnings=[];state.version=3;state.sources||={};
 for(const p of map.values()){const source=SOURCES.find(s=>s.key===p.source)||{};Object.assign(p,classify({title:p.title,categoryTitle:p.sourceCategory},source));}console.log(`[classificatie] ${map.size} bestaande producten opnieuw ingedeeld`);
 const sources=SOURCES.filter(s=>!SOURCE_FILTER||s.key===SOURCE_FILTER).sort((a,b)=>a.priority-b.priority);if(!sources.length)throw new Error(`Onbekende SYNC_SOURCE: ${SOURCE_FILTER}`);
 for(const source of sources){const ss=state.sources[source.key]||{};if(ss.completed){console.log(`[${source.key}] reeds voltooid; overgeslagen`);continue;}console.log(`[${source.key}] bron gestart`);const albums=await discover(source,state);if(!albums){await saveCatalog(map,warnings,"paused",source.key);console.log(`[${source.key}] ontdekking gepauzeerd; volgende run hervat`);return;}const start=Math.min(Number((state.sources[source.key]||{}).nextIndex||0),albums.length);console.log(`[${source.key}] ${albums.length} albums; verwerking hervat bij ${start}/${albums.length}`);
  for(let offset=start;offset<albums.length;offset+=BATCH_SIZE){const batch=albums.slice(offset,offset+BATCH_SIZE),results=await Promise.all(batch.map(a=>limit(async()=>{try{return await processAlbum(source,a,map.get(productKey(source,a.url)));}catch(e){warnings.push(`[${source.key}] ${canonical(a.url)}: ${e.message}`);return null;}})));results.filter(Boolean).forEach(p=>map.set(p.uniqueKey,p));state.sources[source.key]={...(state.sources[source.key]||{}),nextIndex:offset+batch.length,total:albums.length,completed:offset+batch.length>=albums.length,updatedAt:new Date().toISOString()};await saveCatalog(map,warnings,"running",source.key);await writeJson(STATE_PATH,state);console.log(`[${source.key}] ${offset+batch.length}/${albums.length}; hervatpunt opgeslagen`);}
  state.sources[source.key]={...(state.sources[source.key]||{}),nextIndex:albums.length,total:albums.length,completed:true,completedAt:new Date().toISOString()};await writeJson(STATE_PATH,state);console.log(`[${source.key}] bron volledig voltooid`);
 }
 state.completedAt=new Date().toISOString();await writeJson(STATE_PATH,state);await saveCatalog(map,warnings,"completed");console.log(`[Catalogus] ${map.size} producten; alle bronnen voltooid`);
}
main().catch(async e=>{console.error("Synchronisatie mislukt:",e);const c=await readJson(CATALOG_PATH,{products:[],warnings:[]});await writeJson(CATALOG_PATH,{...c,status:"failed",failedAt:new Date().toISOString(),warnings:[...(c.warnings||[]),e.message].slice(-200)});process.exitCode=1;});
