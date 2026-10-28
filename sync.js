import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG_PATH = "data/catalog.json";
const STATE_PATH = "data/sync-state.json";
const ASSET_ROOT = "assets/products";
const SOURCES = [
  { key: "minkang", base: "https://minkang.x.yupoo.com", priority: 1, seedCategories: ["718623"] },
  { key: "yema007", base: "https://yema007.x.yupoo.com", priority: 2, seedCategories: [] },
  { key: "popmo", base: "https://popmo.x.yupoo.com", priority: 3, seedCategories: [] },
  { key: "dachang88", base: "https://dachang88.x.yupoo.com", priority: 4, mode: "shoes", seedCategories: [] },
  { key: "dongshanstore", base: "https://dongshanstore.x.yupoo.com", priority: 5, mode: "training", seedCategories: [] },
  { key: "aosendi", base: "https://aosendi.x.yupoo.com", priority: 6, mode: "training", seedCategories: [] }
];
const MAX_PAGES = setting("SYNC_MAX_PAGES", 100);
const MAX_IMAGES = setting("MAX_IMAGES_PER_ALBUM", 6);
const CONCURRENCY = setting("SYNC_CONCURRENCY", 2);
const BATCH_SIZE = setting("SYNC_BATCH_SIZE", 25);
const REQUEST_TIMEOUT = setting("SYNC_REQUEST_TIMEOUT_MS", 45000);
const REQUEST_DELAY = Math.max(0, Number(process.env.SYNC_DELAY_MS || 250));
const SOURCE_FILTER = String(process.env.SYNC_SOURCE || "").trim().toLowerCase();
const limit = pLimit(CONCURRENCY);

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
const COUNTRIES = ["Argentina","Australia","Austria","Belgium","Brazil","Canada","Chile","China","Colombia","Croatia","Denmark","Ecuador","England","France","Germany","Ghana","Italy","Japan","Mexico","Morocco","Netherlands","Nigeria","Norway","Poland","Portugal","Saudi Arabia","Scotland","Senegal","South Korea","Spain","Sweden","Switzerland","Turkey","Tunisia","Uruguay","USA","United States","Wales"];
const SHOE_BRANDS = ["Nike","Adidas","Puma","New Balance","Mizuno","Under Armour","Joma"];
const SHOE_MODELS = [
  ["Nike","Mercurial",["mercurial","vapor","superfly"]],["Nike","Phantom",["phantom","gx","luna"]],["Nike","Tiempo",["tiempo","legend"]],
  ["Adidas","Predator",["predator"]],["Adidas","F50",["f50"]],["Adidas","Copa",["copa"]],["Adidas","X",["speedportal","speedflow","crazyfast","adidas x"]],
  ["Puma","Future",["puma future","future ultimate"]],["Puma","Ultra",["puma ultra","ultra ultimate"]],["Puma","King",["puma king"]],
  ["Mizuno","Morelia",["morelia"]],["Mizuno","Alpha",["mizuno alpha"]],["Joma","Top Flex",["top flex"]]
];

function setting(name, fallback) { const value=Number(process.env[name]||fallback); return Number.isFinite(value)&&value>0?Math.floor(value):fallback; }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function normalize(value="") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function absoluteUrl(base,value) { if(!value)return ""; try{return new URL(value,base).href;}catch{return "";} }
function includesAny(text,terms) { const n=normalize(text); return terms.some(term=>n.includes(normalize(term))); }
function safeName(value) { return normalize(value).replace(/\s+/g,"-")||"product"; }
function detectSeason(text) {
  let m=String(text).match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/);
  if(!m) return "Seizoen onbekend";
  const first=Number(m[1]); let second=Number(m[2]);
  if(m[2].length===2){second=Math.floor(first/100)*100+second;if(second<first)second+=100;}
  return `${first}-${second}`;
}
function findClub(text) { const n=normalize(text); return LEAGUES.flatMap(([country,competition,clubs])=>clubs.map(club=>({country,competition,club}))).sort((a,b)=>b.club.length-a.club.length).find(item=>n.includes(normalize(item.club)))||null; }
function findCountry(text) { const n=normalize(text); return COUNTRIES.find(country=>n.includes(normalize(country)))||""; }

function classify(album, source) {
  const text=[album.title,album.categoryTitle].filter(Boolean).join(" "); const n=normalize(text); const season=detectSeason(text); const club=findClub(text); const country=findCountry(text);
  if(source.mode==="training") {
    if(club)return{section:"Trainingskleding",category:"Clubteams",subcategory:club.competition,club:club.club,country:club.country,competition:club.competition,season,types:["Trainingskleding"]};
    if(country)return{section:"Trainingskleding",category:"Landenteams",subcategory:country,club:country,country,competition:"Landenteams",season,types:["Trainingskleding"]};
    return{section:"Trainingskleding",category:"Overig",subcategory:album.categoryTitle||"Overig",club:"Overig",country:"",competition:"",season,types:["Trainingskleding"]};
  }
  const shoeWords=["football boot","soccer shoe","cleats","voetbalschoen",...SHOE_MODELS.flatMap(item=>item[2])];
  if(source.mode==="shoes"||includesAny(text,shoeWords)) {
    const brand=SHOE_BRANDS.find(value=>n.includes(normalize(value)))||"Overig merk";
    const model=SHOE_MODELS.find(([b,,words])=>b===brand&&words.some(word=>n.includes(normalize(word))))?.[1]||"Overig model";
    return{section:"Voetbalschoenen",category:brand,subcategory:model,club:"",country:"",competition:"",season:"Seizoen onbekend",types:["Voetbalschoenen"]};
  }
  const trainingWords=["tracksuit","track suit","training suit","training set","training wear","training","pre match","prematch","windbreaker","jacket","hoodie","pants","shorts","trainingspak","trainingskleding"];
  if(includesAny(text,trainingWords)) {
    if(club)return{section:"Trainingskleding",category:"Clubteams",subcategory:club.competition,club:club.club,country:club.country,competition:club.competition,season,types:["Trainingskleding"]};
    if(country)return{section:"Trainingskleding",category:"Landenteams",subcategory:country,club:country,country,competition:"Landenteams",season,types:["Trainingskleding"]};
    return{section:"Trainingskleding",category:"Overig",subcategory:"Overig",club:"Overig",country:"",competition:"",season,types:["Trainingskleding"]};
  }
  if(club)return{section:"Voetbal",category:"Clubteams",subcategory:club.competition,club:club.club,country:club.country,competition:club.competition,season,types:["Voetbalshirt"]};
  if(country)return{section:"Voetbal",category:"Landenteams",subcategory:country,club:country,country,competition:"Landenteams",season,types:["Voetbalshirt"]};
  return{section:"Overige producten",category:"Overige producten",subcategory:album.categoryTitle||"Overig",club:"",country:"",competition:"",season:"Seizoen onbekend",types:["Overig"]};
}

class HttpError extends Error { constructor(status,url){super(`HTTP ${status} voor ${url}`);this.status=status;} }
async function request(url,binary=false,retries=2) {
  for(let attempt=0;attempt<=retries;attempt++) {
    await sleep(REQUEST_DELAY);
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT);
    try { const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 FootballshirtsNL/1.0",accept:binary?"image/avif,image/webp,image/*,*/*":"text/html,application/xhtml+xml"},signal:controller.signal}); if(!response.ok)throw new HttpError(response.status,url); return binary?Buffer.from(await response.arrayBuffer()):await response.text(); }
    catch(error){ if(error.status===404||attempt===retries)throw error; await sleep(1000*(attempt+1)); }
    finally{clearTimeout(timer);}
  }
}
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,"utf8"));}catch{return fallback;}}
async function atomicJson(file,data){await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;await fs.writeFile(temp,JSON.stringify(data,null,2)+"\n");await fs.rename(temp,file);}

function extractLinks(html,source) {
  const $=cheerio.load(html); const categories=new Map(); const albums=new Map();
  $("a[href*='/categories/'],a[href*='/collections/']").each((_,el)=>{const url=absoluteUrl(source.base,$(el).attr("href")).split("?")[0];if(url)categories.set(url,{url,title:$(el).attr("title")||$(el).text().trim()});});
  $("a[href*='/albums/']").each((_,el)=>{const url=absoluteUrl(source.base,$(el).attr("href")).split("?")[0];if(/\/albums\/\d+/.test(url))albums.set(url,{url,title:$(el).attr("title")||$(el).find("img").attr("alt")||$(el).text().trim(),categoryTitle:""});});
  return{categories:[...categories.values()],albums:[...albums.values()]};
}
async function discover(source) {
  const albums=new Map(); let categories=[];
  try{const first=extractLinks(await request(`${source.base}/albums`),source);categories=first.categories;first.albums.forEach(a=>albums.set(a.url,a));}catch(error){console.warn(`[${source.key}] startpagina: ${error.message}`);}
  for(const id of source.seedCategories||[])categories.push({url:`${source.base}/categories/${id}`,title:""});
  const targets=categories.length?categories:[{url:`${source.base}/albums`,title:""}];
  for(const target of new Map(targets.map(x=>[x.url,x])).values()) {
    for(let page=1;page<=MAX_PAGES;page++) {
      const url=page===1?target.url:`${target.url}${target.url.includes("?")?"&":"?"}page=${page}`;
      try{const found=extractLinks(await request(url),source).albums;if(!found.length)break;found.forEach(a=>albums.set(a.url,{...a,categoryTitle:target.title}));}
      catch(error){if(error.status!==404)console.warn(`[${source.key}] ${url}: ${error.message}`);break;}
    }
  }
  return [...albums.values()].sort((a,b)=>a.url.localeCompare(b.url,"en",{numeric:true}));
}
function extractAlbum(html,album,source){const $=cheerio.load(html);const title=$("h1").first().text().trim()||$("meta[property='og:title']").attr("content")||album.title;const images=[];$("img").each((_,el)=>[$(el).attr("data-origin-src"),$(el).attr("data-src"),$(el).attr("src")].forEach(value=>{const url=absoluteUrl(source.base,value);if(/photo\.yupoo\.com|\.jpe?g(?:\?|$)|\.png(?:\?|$)|\.webp(?:\?|$)/i.test(url))images.push(url.replace(/\/(small|medium|thumb)\//i,"/large/"));}));return{title:String(title).replace(/\s+/g," ").trim(),images:unique(images).slice(0,MAX_IMAGES)};}
async function saveImage(url,file){if(await exists(file))return;await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;await sharp(await request(url,true)).rotate().webp({quality:82}).toFile(temp);await fs.rename(temp,file);}
function key(source,url){return`${source.key}:${url.match(/\/albums\/(\d+)/)?.[1]||safeName(url)}`;}
async function processAlbum(source,album,previous){const extracted=extractAlbum(await request(album.url),album,source);const sourceId=album.url.match(/\/albums\/(\d+)/)?.[1]||safeName(album.url);const folder=path.join(ASSET_ROOT,source.key,sourceId);const images=[];for(let i=0;i<extracted.images.length;i++){const file=path.join(folder,`${String(i+1).padStart(2,"0")}.webp`);try{await saveImage(extracted.images[i],file);}catch(error){console.warn(`[${source.key}] ${sourceId} foto ${i+1}: ${error.message}`);}if(await exists(file))images.push(file.replaceAll(path.sep,"/"));}if(!images.length&&previous?.images)images.push(...previous.images);return{uniqueKey:key(source,album.url),source:source.key,sourceId,sourceUrl:album.url,sourceCategory:album.categoryTitle||"",title:extracted.title,...classify({...album,title:extracted.title},source),images:unique(images),coverUrl:images[0]||previous?.coverUrl||"",imageCount:unique(images).length,updatedAt:new Date().toISOString()};}
function sortProducts(a,b){return[a.section,a.category,a.subcategory,a.club,a.season,a.title].join("|").localeCompare([b.section,b.category,b.subcategory,b.club,b.season,b.title].join("|"),"nl");}

async function main(){
  const catalog=await readJson(CATALOG_PATH,{products:[],warnings:[]});
  const products=Array.isArray(catalog.products)?catalog.products:Array.isArray(catalog.albums)?catalog.albums:[];
  const map=new Map(products.map(p=>[p.uniqueKey||`${p.source}:${p.sourceId}`,p]));
  const state=await readJson(STATE_PATH,{version:1,sources:{}}); const warnings=[];
  const sources=SOURCES.filter(s=>!SOURCE_FILTER||s.key===SOURCE_FILTER).sort((a,b)=>a.priority-b.priority);
  if(!sources.length)throw new Error(`Onbekende SYNC_SOURCE: ${SOURCE_FILTER}`);
  for(const source of sources){
    const albums=await discover(source); const saved=state.sources[source.key]||{}; let start=saved.completed?albums.length:Math.min(Number(saved.nextIndex||0),albums.length);
    console.log(`[${source.key}] ${albums.length} albums; hervatten bij ${start}/${albums.length}`);
    for(let offset=start;offset<albums.length;offset+=BATCH_SIZE){
      const batch=albums.slice(offset,offset+BATCH_SIZE);
      const results=await Promise.all(batch.map(album=>limit(async()=>{try{return await processAlbum(source,album,map.get(key(source,album.url)));}catch(error){const message=`[${source.key}] ${album.url}: ${error.message}`;if(error.status!==404)warnings.push(message);console.warn(error.status===404?`[${source.key}] niet bereikbaar en overgeslagen: ${album.url}`:message);return null;}})));
      results.filter(Boolean).forEach(product=>map.set(product.uniqueKey,product));
      state.sources[source.key]={nextIndex:offset+batch.length,total:albums.length,completed:offset+batch.length>=albums.length,updatedAt:new Date().toISOString()};
      await atomicJson(CATALOG_PATH,{lastSync:new Date().toISOString(),status:"running",currentSource:source.key,products:[...map.values()].sort(sortProducts),warnings:warnings.slice(-200)});
      await atomicJson(STATE_PATH,state);
      console.log(`[${source.key}] ${offset+batch.length}/${albums.length}; hervatpunt opgeslagen`);
    }
  }
  state.completedAt=new Date().toISOString();
  await atomicJson(STATE_PATH,state);
  await atomicJson(CATALOG_PATH,{lastSync:new Date().toISOString(),status:"completed",products:[...map.values()].sort(sortProducts),warnings:warnings.slice(-200)});
  console.log(`[Catalogus] ${map.size} producten opgeslagen.`);
}
main().catch(async error=>{console.error("Synchronisatie mislukt:",error);const catalog=await readJson(CATALOG_PATH,{products:[],warnings:[]});await atomicJson(CATALOG_PATH,{...catalog,status:"failed",failedAt:new Date().toISOString(),warnings:[...(catalog.warnings||[]),error.message].slice(-200)});process.exitCode=1;});
