import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG="data/catalog.json", STATE="data/sync-state.json", DISCOVERY="data/discovery", ASSETS="assets/products";
const SOURCES=[
 {key:"minkang",base:"https://minkang.x.yupoo.com",priority:1,seeds:["718623"]},
 {key:"yema007",base:"https://yema007.x.yupoo.com",priority:2,seeds:[]},
 {key:"popmo",base:"https://popmo.x.yupoo.com",priority:3,seeds:[]},
 {key:"dachang88",base:"https://dachang88.x.yupoo.com",priority:4,mode:"shoes",seeds:[]},
 {key:"dongshanstore",base:"https://dongshanstore.x.yupoo.com",priority:5,mode:"training",seeds:[]},
 {key:"aosendi",base:"https://aosendi.x.yupoo.com",priority:6,mode:"training",seeds:[]}
];
const num=(name,fallback)=>{const value=Number(process.env[name]||fallback);return Number.isFinite(value)&&value>0?Math.floor(value):fallback;};
const MAX_PAGES=num("SYNC_MAX_PAGES",100),MAX_CATEGORY_PAGES=num("SYNC_CATEGORY_MAX_PAGES",100),MAX_CATEGORIES=num("SYNC_MAX_CATEGORIES_PER_SOURCE",500),DISCOVERY_MINUTES=num("SYNC_MAX_DISCOVERY_MINUTES",45),MAX_IMAGES=num("MAX_IMAGES_PER_ALBUM",6),BATCH=num("SYNC_BATCH_SIZE",25),TIMEOUT=num("SYNC_REQUEST_TIMEOUT_MS",45000),RETRIES=num("SYNC_REQUEST_RETRIES",2),DELAY=Math.max(0,Number(process.env.SYNC_DELAY_MS||250));
const SOURCE_FILTER=String(process.env.SYNC_SOURCE||"").trim().toLowerCase();
const limit=pLimit(num("SYNC_CONCURRENCY",2));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const unique=values=>[...new Set(values.filter(Boolean))];
const norm=(value="")=>String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const has=(text,terms)=>terms.some(term=>norm(text).includes(norm(term)));
const absolute=(base,value)=>{try{return new URL(value,base).href;}catch{return"";}};
const safe=value=>norm(value).replace(/\s+/g,"-")||"product";

const LEAGUES=[
 ["Engeland","Premier League",["Arsenal","Aston Villa","Bournemouth","Brentford","Brighton","Burnley","Chelsea","Crystal Palace","Everton","Fulham","Leeds United","Liverpool","Manchester City","Manchester United","Newcastle United","Nottingham Forest","Sunderland","Tottenham","West Ham","Wolverhampton"]],
 ["Spanje","La Liga",["Athletic Bilbao","Atletico Madrid","Barcelona","Real Betis","Real Madrid","Real Sociedad","Sevilla","Valencia","Villarreal"]],
 ["Italie","Serie A",["AC Milan","Atalanta","Bologna","Fiorentina","Inter Milan","Juventus","Lazio","Napoli","Roma"]],
 ["Duitsland","Bundesliga",["Bayern Munich","Bayer Leverkusen","Borussia Dortmund","Eintracht Frankfurt","RB Leipzig","Schalke 04","Werder Bremen"]],
 ["Frankrijk","Ligue 1",["Lille","Lyon","Marseille","Monaco","Nice","Paris Saint-Germain","PSG"]],
 ["Nederland","Eredivisie",["Ajax","AZ","Feyenoord","FC Twente","PSV","Sparta Rotterdam","FC Utrecht","Vitesse"]],
 ["Portugal","Primeira Liga",["Benfica","Porto","Sporting CP"]],["Schotland","Scottish Premiership",["Celtic","Rangers"]],["Turkije","Super Lig",["Besiktas","Fenerbahce","Galatasaray"]],["Verenigde Staten","MLS",["Inter Miami","LA Galaxy","Los Angeles FC","New York City FC"]]
];
const COUNTRIES=["Argentina","Australia","Austria","Belgium","Brazil","Canada","Chile","China","Colombia","Croatia","Denmark","Ecuador","England","France","Germany","Ghana","Italy","Japan","Mexico","Morocco","Netherlands","Nigeria","Norway","Poland","Portugal","Saudi Arabia","Scotland","Senegal","South Korea","Spain","Sweden","Switzerland","Turkey","Tunisia","Uruguay","USA","United States","Wales"];
const BRANDS=["Nike","Adidas","Puma","New Balance","Mizuno","Under Armour","Joma"];
const MODELS=[
 ["Nike","Mercurial",["mercurial","vapor","superfly"]],["Nike","Phantom",["phantom","gx","luna"]],["Nike","Tiempo",["tiempo","legend"]],
 ["Adidas","Predator",["predator"]],["Adidas","F50",["f50"]],["Adidas","Copa",["adidas copa"]],["Adidas","X",["speedportal","speedflow","crazyfast","adidas x"]],
 ["Puma","Future",["puma future","future ultimate"]],["Puma","Ultra",["puma ultra","ultra ultimate"]],["Puma","King",["puma king"]],
 ["Mizuno","Morelia",["morelia"]],["Mizuno","Alpha",["mizuno alpha"]],["Joma","Top Flex",["top flex"]]
];
function season(text){const m=String(text).match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/);if(!m)return"Seizoen onbekend";const first=Number(m[1]);let second=Number(m[2]);if(m[2].length===2){second=Math.floor(first/100)*100+second;if(second<first)second+=100;}return`${first}-${second}`;}
function club(text){const n=norm(text);return LEAGUES.flatMap(([country,competition,clubs])=>clubs.map(club=>({country,competition,club}))).sort((a,b)=>b.club.length-a.club.length).find(item=>n.includes(norm(item.club)))||null;}
function country(text){const n=norm(text);return COUNTRIES.find(item=>n.includes(norm(item)))||"";}
function classify(item,source){
 const text=[item.title,item.categoryTitle,item.collectionTitle].filter(Boolean).join(" "),n=norm(text),year=season(text),team=club(text),nation=country(text);
 if(source.mode==="training"||has(text,["tracksuit","track suit","training suit","training set","training wear","pre match","prematch","windbreaker","trainingspak","trainingskleding"])){
  if(team)return{section:"Trainingskleding",category:"Clubteams",subcategory:team.competition,club:team.club,country:team.country,competition:team.competition,season:year,types:["Trainingskleding"]};
  if(nation)return{section:"Trainingskleding",category:"Landenteams",subcategory:nation,club:nation,country:nation,competition:"Landenteams",season:year,types:["Trainingskleding"]};
  return{section:"Trainingskleding",category:"Overig",subcategory:item.categoryTitle||"Overig",club:"Overig",country:"",competition:"",season:year,types:["Trainingskleding"]};
 }
 const explicit=["football boot","football boots","soccer shoe","soccer shoes","soccer boot","soccer boots","cleats","voetbalschoen","voetbalschoenen"];
 const strong=["mercurial","superfly","phantom gx","phantom luna","tiempo legend","adidas predator","adidas f50","adidas copa","speedportal","speedflow","crazyfast","puma future","puma ultra","puma king","mizuno morelia","mizuno alpha","joma top flex"];
 if(source.mode==="shoes"||has(text,explicit)||has(text,strong)){
  const brand=BRANDS.find(value=>n.includes(norm(value)))||"Overige merken";
  const model=MODELS.find(([b,,words])=>b===brand&&words.some(word=>n.includes(norm(word))))?.[1]||"Overig model";
  return{section:"Voetbalschoenen",category:brand,subcategory:model,club:"",country:"",competition:"",season:"Seizoen onbekend",types:["Voetbalschoenen"]};
 }
 if(team)return{section:"Voetbal",category:"Clubteams",subcategory:team.competition,club:team.club,country:team.country,competition:team.competition,season:year,types:["Voetbalshirt"]};
 if(nation)return{section:"Voetbal",category:"Landenteams",subcategory:nation,club:nation,country:nation,competition:"Landenteams",season:year,types:["Voetbalshirt"]};
 return{section:"Overige producten",category:"Overige producten",subcategory:item.categoryTitle||"Overig",club:"",country:"",competition:"",season:"Seizoen onbekend",types:["Overig"]};
}
class HttpError extends Error{constructor(status,url){super(`HTTP ${status} voor ${url}`);this.status=status;this.url=url;}}
async function request(url,binary=false){let last;for(let attempt=0;attempt<=RETRIES;attempt++){await sleep(DELAY);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT);try{const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 FootballshirtsNL/1.0",accept:binary?"image/avif,image/webp,image/*,*/*":"text/html,application/xhtml+xml"},signal:controller.signal});if(!response.ok)throw new HttpError(response.status,url);return binary?Buffer.from(await response.arrayBuffer()):await response.text();}catch(error){last=error;if(error.status===404||attempt===RETRIES)throw error;await sleep(1000*(attempt+1));}finally{clearTimeout(timer);}}throw last;}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,"utf8"));}catch{return fallback;}}
async function writeJson(file,data){await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;await fs.writeFile(temp,JSON.stringify(data,null,2)+"\n");await fs.rename(temp,file);}
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
function discoveryFile(source){return path.join(DISCOVERY,`${source.key}.json`);}
function freshDiscovery(source){return{version:3,source:source.key,phase:"index",indexPage:1,categories:(source.seeds||[]).map(id=>({url:`${source.base}/categories/${id}`,title:""})),categoryIndex:0,categoryPage:1,albums:[],complete:false};}
function extractPage(html,source,inherited=""){
 const $=cheerio.load(html),categories=new Map(),albums=new Map();
 $("a[href*='/categories/'],a[href*='/collections/']").each((_,el)=>{const url=absolute(source.base,$(el).attr("href")).split("?")[0];if(url)categories.set(url,{url,title:$(el).attr("title")||$(el).text().trim()});});
 $("a[href*='/albums/']").each((_,el)=>{const url=absolute(source.base,$(el).attr("href")).split("?")[0];if(!/\/albums\/\d+/.test(url))return;const img=$(el).find("img");albums.set(url,{url,title:$(el).attr("title")||img.attr("alt")||$(el).text().trim()||`Product ${url.match(/\/albums\/(\d+)/)?.[1]||""}`,categoryTitle:inherited,previewImage:absolute(source.base,img.attr("data-origin-src")||img.attr("data-src")||img.attr("src"))});});
 const next=$("a[rel='next'],a.next,.pagination-next a").first().attr("href");return{categories:[...categories.values()],albums:[...albums.values()],nextUrl:next?absolute(source.base,next):""};
}
function mergeAlbums(oldItems,newItems){const map=new Map(oldItems.map(x=>[x.url,x]));for(const item of newItems)map.set(item.url,{...(map.get(item.url)||{}),...item});return[...map.values()].sort((a,b)=>a.url.localeCompare(b.url,"en",{numeric:true}));}
async function saveDiscovery(source,d,state){d.updatedAt=new Date().toISOString();await writeJson(discoveryFile(source),d);state.sources[source.key]={...(state.sources[source.key]||{}),discoveryComplete:d.complete,discoveredAlbums:d.albums.length,categoryIndex:d.categoryIndex,categoryTotal:d.categories.length,updatedAt:d.updatedAt};await writeJson(STATE,state);}
async function discover(source,state){
 let d=await readJson(discoveryFile(source),freshDiscovery(source));if(d.complete)return d.albums;const deadline=Date.now()+DISCOVERY_MINUTES*60000;console.log(`[${source.key}] ontdekking hervat: ${d.phase}, albums=${d.albums.length}`);
 if(d.phase==="index"){while(d.indexPage<=MAX_PAGES){if(Date.now()>=deadline){await saveDiscovery(source,d,state);return null;}const url=d.indexPage===1?`${source.base}/albums`:`${source.base}/albums?page=${d.indexPage}`;console.log(`[${source.key}] ontdekking indexpagina ${d.indexPage}/${MAX_PAGES}`);try{const page=extractPage(await request(url),source);d.albums=mergeAlbums(d.albums,page.albums);const map=new Map(d.categories.map(x=>[x.url,x]));page.categories.forEach(x=>map.set(x.url,x));d.categories=[...map.values()].slice(0,MAX_CATEGORIES);d.indexPage++;await saveDiscovery(source,d,state);if((!page.albums.length&&!page.categories.length)||(!page.nextUrl&&d.indexPage>2))break;}catch(error){console.warn(`[${source.key}] index overgeslagen: ${error.message}`);d.indexPage++;await saveDiscovery(source,d,state);if(error.status===404)break;}}d.phase="categories";await saveDiscovery(source,d,state);}
 while(d.categoryIndex<d.categories.length){if(Date.now()>=deadline){await saveDiscovery(source,d,state);return null;}const c=d.categories[d.categoryIndex];if(d.categoryPage>MAX_CATEGORY_PAGES){d.categoryIndex++;d.categoryPage=1;continue;}console.log(`[${source.key}] ontdekking categorie ${d.categoryIndex+1}/${d.categories.length}, pagina ${d.categoryPage}`);const url=d.categoryPage===1?c.url:`${c.url}${c.url.includes("?")?"&":"?"}page=${d.categoryPage}`;try{const page=extractPage(await request(url),source,c.title);d.albums=mergeAlbums(d.albums,page.albums);d.categoryPage++;if(!page.albums.length||!page.nextUrl){d.categoryIndex++;d.categoryPage=1;}await saveDiscovery(source,d,state);}catch(error){console.warn(`[${source.key}] categorie overgeslagen: ${error.message}`);d.categoryIndex++;d.categoryPage=1;await saveDiscovery(source,d,state);}}
 d.complete=true;d.phase="complete";await saveDiscovery(source,d,state);console.log(`[${source.key}] ontdekking voltooid: ${d.albums.length} albums`);return d.albums;
}
function key(source,url){return`${source.key}:${url.match(/\/albums\/(\d+)/)?.[1]||safe(url)}`;}
async function saveImage(url,file){if(await exists(file))return;await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;await sharp(await request(url,true)).rotate().webp({quality:82}).toFile(temp);await fs.rename(temp,file);}
function extractAlbum(html,album,source){const $=cheerio.load(html),images=[];$("img").each((_,el)=>[$(el).attr("data-origin-src"),$(el).attr("data-src"),$(el).attr("src")].forEach(value=>{const url=absolute(source.base,value);if(/photo\.yupoo\.com|\.jpe?g(?:\?|$)|\.png(?:\?|$)|\.webp(?:\?|$)/i.test(url))images.push(url);}));return{title:$("h1").first().text().trim()||$("meta[property='og:title']").attr("content")||album.title,images:unique(images).slice(0,MAX_IMAGES)};}
async function buildProduct(source,album,previous,detail=null){const id=album.url.match(/\/albums\/(\d+)/)?.[1]||safe(album.url),folder=path.join(ASSETS,source.key,id),images=previous?.images?.length?[...previous.images]:[],incoming=detail?.images||(!images.length&&album.previewImage?[album.previewImage]:[]);if(!images.length)for(let i=0;i<incoming.length;i++){const file=path.join(folder,`${String(i+1).padStart(2,"0")}.webp`);try{await saveImage(incoming[i],file);}catch{}if(await exists(file))images.push(file.replaceAll(path.sep,"/"));}const title=detail?.title||album.title||`Product ${id}`;return{uniqueKey:key(source,album.url),source:source.key,sourceId:id,sourceUrl:album.url,sourceCategory:album.categoryTitle||"",title,...classify({...album,title},source),images:unique(images),coverUrl:images[0]||previous?.coverUrl||"",imageCount:unique(images).length,updatedAt:new Date().toISOString()};}
async function processAlbum(source,album,previous){try{return await buildProduct(source,album,previous,extractAlbum(await request(album.url),album,source));}catch(error){if(error.status===404&&source.mode==="shoes"){console.warn(`[${source.key}] albumpagina niet bereikbaar; ontdekkingsgegevens gebruikt: ${album.url}`);return buildProduct(source,album,previous);}throw error;}}
function sourceFor(product){return SOURCES.find(source=>source.key===product.source)||{key:product.source||"existing",mode:""};}
function reclassify(map){let changed=0;for(const [k,p] of map){const next=classify({title:p.title,categoryTitle:p.sourceCategory||"",collectionTitle:p.sourceCollection||""},sourceFor(p));if(p.section!==next.section||p.category!==next.category||p.subcategory!==next.subcategory)changed++;map.set(k,{...p,...next});}return changed;}
const sortProducts=(a,b)=>[a.section,a.category,a.subcategory,a.club,a.season,a.title].join("|").localeCompare([b.section,b.category,b.subcategory,b.club,b.season,b.title].join("|"),"nl");
async function saveCatalog(map,warnings,status,currentSource=""){await writeJson(CATALOG,{lastSync:new Date().toISOString(),status,currentSource:currentSource||undefined,products:[...map.values()].sort(sortProducts),warnings:warnings.slice(-200)});}
async function main(){
 const catalog=await readJson(CATALOG,{products:[],warnings:[]}),items=Array.isArray(catalog.products)?catalog.products:Array.isArray(catalog.albums)?catalog.albums:[],map=new Map(items.map(p=>[p.uniqueKey||`${p.source}:${p.sourceId}`,p])),state=await readJson(STATE,{version:3,sources:{}});state.version=3;state.sources||={};
 if(Number(state.classificationVersion||0)<3){console.log(`[classificatie] ${reclassify(map)} bestaande producten opnieuw ingedeeld`);state.sources.dachang88={...(state.sources.dachang88||{}),completed:false,discoveryComplete:false,nextIndex:0};await fs.rm(discoveryFile(SOURCES.find(s=>s.key==="dachang88")),{force:true});state.classificationVersion=3;await writeJson(STATE,state);await saveCatalog(map,[],"running","classificatie");}
 const warnings=[],sources=SOURCES.filter(s=>!SOURCE_FILTER||s.key===SOURCE_FILTER).sort((a,b)=>a.priority-b.priority);if(!sources.length)throw new Error(`Onbekende SYNC_SOURCE: ${SOURCE_FILTER}`);
 for(const source of sources){if(state.sources[source.key]?.completed){console.log(`[${source.key}] reeds voltooid; overgeslagen`);continue;}console.log(`\n[${source.key}] bron gestart`);const albums=await discover(source,state);if(!albums){await saveCatalog(map,warnings,"paused",source.key);return;}const start=Math.min(Number(state.sources[source.key]?.nextIndex||0),albums.length);console.log(`[${source.key}] ${albums.length} albums; hervat bij ${start}/${albums.length}`);for(let offset=start;offset<albums.length;offset+=BATCH){const batch=albums.slice(offset,offset+BATCH),results=await Promise.all(batch.map(album=>limit(async()=>{try{return await processAlbum(source,album,map.get(key(source,album.url)));}catch(error){if(error.status===404){console.warn(`[${source.key}] niet bereikbaar: ${album.url}`);return null;}warnings.push(`[${source.key}] ${album.url}: ${error.message}`);return null;}})));results.filter(Boolean).forEach(p=>map.set(p.uniqueKey,p));state.sources[source.key]={...(state.sources[source.key]||{}),nextIndex:offset+batch.length,total:albums.length,completed:offset+batch.length>=albums.length,updatedAt:new Date().toISOString()};await saveCatalog(map,warnings,"running",source.key);await writeJson(STATE,state);console.log(`[${source.key}] ${offset+batch.length}/${albums.length}; hervatpunt opgeslagen`);}state.sources[source.key]={...(state.sources[source.key]||{}),completed:true,nextIndex:albums.length,total:albums.length,completedAt:new Date().toISOString()};await writeJson(STATE,state);}
 state.completedAt=new Date().toISOString();await writeJson(STATE,state);await saveCatalog(map,warnings,"completed");console.log(`[Catalogus] ${map.size} producten opgeslagen.`);
}
main().catch(async error=>{console.error("Synchronisatie mislukt:",error);const catalog=await readJson(CATALOG,{products:[],warnings:[]});await writeJson(CATALOG,{...catalog,status:"failed",failedAt:new Date().toISOString(),warnings:[...(catalog.warnings||[]),error.message].slice(-200)});process.exitCode=1;});
