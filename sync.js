import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import sharp from "sharp";

const CATALOG = "data/catalog.json";
const TEMP = "data/catalog.json.tmp";
const ASSETS = "assets/products";
const SOURCES = [
  { key: "minkang", base: "https://minkang.x.yupoo.com" },
  { key: "yema007", base: "https://yema007.x.yupoo.com" },
  { key: "popmo", base: "https://popmo.x.yupoo.com" },
  { key: "dachang88", base: "https://dachang88.x.yupoo.com", shoesOnly: true },
  { key: "dongshanstore", base: "https://dongshanstore.x.yupoo.com", trainingOnly: true },
  { key: "aosendi", base: "https://aosendi.x.yupoo.com", trainingOnly: true }
];
const MAX_PAGES = Number(process.env.SYNC_MAX_PAGES || 100);
const MAX_IMAGES = Number(process.env.MAX_IMAGES_PER_ALBUM || 6);
const BATCH = Number(process.env.SYNC_BATCH_SIZE || 25);
const limit = pLimit(Number(process.env.SYNC_CONCURRENCY || 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const LEAGUES = [
  ["Engeland", "Premier League", ["Arsenal","Aston Villa","Bournemouth","Brentford","Brighton","Burnley","Chelsea","Crystal Palace","Everton","Fulham","Leeds United","Liverpool","Manchester City","Manchester United","Newcastle United","Nottingham Forest","Sunderland","Tottenham","West Ham","Wolverhampton"]],
  ["Spanje", "La Liga", ["Athletic Bilbao","Atletico Madrid","Barcelona","Real Betis","Real Madrid","Real Sociedad","Sevilla","Valencia","Villarreal"]],
  ["Italie", "Serie A", ["AC Milan","Atalanta","Bologna","Fiorentina","Inter Milan","Juventus","Lazio","Napoli","Roma"]],
  ["Duitsland", "Bundesliga", ["Bayern Munich","Bayer Leverkusen","Borussia Dortmund","Eintracht Frankfurt","RB Leipzig","Schalke 04","Werder Bremen"]],
  ["Frankrijk", "Ligue 1", ["Lille","Lyon","Marseille","Monaco","Nice","Paris Saint-Germain","PSG"]],
  ["Nederland", "Eredivisie", ["Ajax","AZ","Feyenoord","FC Twente","PSV","Sparta Rotterdam","FC Utrecht","Vitesse"]],
  ["Portugal", "Primeira Liga", ["Benfica","Porto","Sporting CP"]],
  ["Schotland", "Scottish Premiership", ["Celtic","Rangers"]],
  ["Turkije", "Super Lig", ["Besiktas","Fenerbahce","Galatasaray"]],
  ["Verenigde Staten", "MLS", ["Inter Miami","LA Galaxy","Los Angeles FC","New York City FC"]]
];
const COUNTRIES = ["Argentina","Australia","Belgium","Brazil","Canada","Chile","Colombia","Croatia","Denmark","Ecuador","England","France","Germany","Ghana","Italy","Japan","Mexico","Morocco","Netherlands","Nigeria","Norway","Poland","Portugal","Saudi Arabia","Scotland","Senegal","South Korea","Spain","Sweden","Switzerland","Turkey","Tunisia","Uruguay","USA","Wales"];
const SHOE_MODELS = [
  ["Nike","Mercurial",["mercurial","vapor","superfly"]], ["Nike","Phantom",["phantom","gx","luna"]], ["Nike","Tiempo",["tiempo","legend"]],
  ["Adidas","Predator",["predator"]], ["Adidas","F50",["f50"]], ["Adidas","Copa",["copa"]], ["Adidas","X",["speedportal","speedflow","crazyfast","adidas x"]],
  ["Puma","Future",["puma future"]], ["Puma","Ultra",["puma ultra"]], ["Puma","King",["puma king"]],
  ["Mizuno","Morelia",["morelia"]], ["Mizuno","Alpha",["mizuno alpha"]], ["Joma","Top Flex",["top flex"]], ["Joma","Overig model",["joma"]]
];
const SHOE_BRANDS = ["Nike","Adidas","Puma","New Balance","Mizuno","Under Armour","Joma"];

function norm(value="") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
function has(text, words) { const n=norm(text); return words.some(word => n.includes(norm(word))); }
function uniq(values) { return [...new Set(values.filter(Boolean))]; }
function absolute(base, value) { try { return new URL(value, base).href; } catch { return ""; } }
function season(text) {
  let m=String(text).match(/\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/);
  if (!m) return "Seizoen onbekend";
  const first=Number(m[1]); let second=Number(m[2]);
  if (m[2].length===2) { second=Math.floor(first/100)*100+second; if(second<first) second+=100; }
  return `${first}-${second}`;
}
function clubInfo(text) {
  const n=norm(text); const all=LEAGUES.flatMap(([country,competition,clubs])=>clubs.map(club=>({country,competition,club}))).sort((a,b)=>b.club.length-a.club.length);
  return all.find(item=>n.includes(norm(item.club))) || null;
}
function countryTeam(text) { const n=norm(text); return COUNTRIES.find(country=>n.includes(norm(country))) || ""; }

function classify(title, sourceCategory="", sourceKey="") {
  const text=`${title} ${sourceCategory}`; const n=norm(text); const year=season(text); const team=clubInfo(text); const country=countryTeam(text);

  if (sourceKey === "dongshanstore" || sourceKey === "aosendi") {
    if (team) return {section:"Trainingskleding",category:"Clubteams",subcategory:team.competition,club:team.club,country:team.country,competition:team.competition,season:year,types:["Trainingskleding"]};
    if (country) return {section:"Trainingskleding",category:"Landenteams",subcategory:country,club:country,country,competition:"Landenteams",season:year,types:["Trainingskleding"]};
    return {section:"Trainingskleding",category:"Overig",subcategory:sourceCategory||"Overig",club:"Overig",country:"",competition:"",season:year,types:["Trainingskleding"]};
  }

  const shoeWords=["football boot","football boots","soccer shoe","soccer shoes","soccer boot","soccer boots","cleats","voetbalschoen","voetbalschoenen","mercurial","phantom","tiempo","predator","f50","copa","speedportal","speedflow","crazyfast","joma","top flex",...SHOE_MODELS.flatMap(item=>item[2])];
  if (has(text,shoeWords) || sourceKey === "dachang88") {
    const brand=SHOE_BRANDS.find(value=>n.includes(norm(value))) || "Overig merk";
    const model=SHOE_MODELS.find(([b,,words])=>b===brand && words.some(word=>n.includes(norm(word))))?.[1] || "Overig model";
    return {section:"Voetbalschoenen",category:brand,subcategory:model,club:"",country:"",competition:"",season:"Seizoen onbekend",types:["Voetbalschoenen"]};
  }
  const training=has(text,["tracksuit","track suit","training suit","training set","training wear","training","pre match","prematch","windbreaker","hoodie","pants","shorts","trainingspak","trainingskleding"]);
  if (training) {
    if (team) return {section:"Trainingskleding",category:"Clubteams",subcategory:team.competition,club:team.club,country:team.country,competition:team.competition,season:year,types:["Trainingskleding"]};
    if (country) return {section:"Trainingskleding",category:"Landenteams",subcategory:country,club:country,country,competition:"Landenteams",season:year,types:["Trainingskleding"]};
    return {section:"Trainingskleding",category:"Overig",subcategory:"Overig",club:"Overig",country:"",competition:"",season:year,types:["Trainingskleding"]};
  }
  if (team) return {section:"Voetbal",category:"Clubteams",subcategory:team.competition,club:team.club,country:team.country,competition:team.competition,season:year,types:["Voetbalshirt"]};
  if (country) return {section:"Voetbal",category:"Landenteams",subcategory:country,club:country,country,competition:"Landenteams",season:year,types:["Voetbalshirt"]};
  const type=[["Tassen",["bag","backpack","tas"]],["Horloges",["watch","horloge"]],["Riemen",["belt","riem"]],["Jassen",["jacket","coat","jas"]]].find(([,words])=>has(text,words))?.[0]||"Overige producten";
  return {section:"Overige producten",category:type,subcategory:sourceCategory||"Overig",club:"",country:"",competition:"",season:"Seizoen onbekend",types:[type]};
}

class HttpError extends Error { constructor(status,url){super(`HTTP ${status} voor ${url}`);this.status=status;this.url=url;} }
async function request(url,binary=false) {
  await pause(Number(process.env.SYNC_DELAY_MS||250));
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),30000);
  try {
    const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 FootballshirtsNL/1.0"},signal:controller.signal});
    if(!response.ok) throw new HttpError(response.status,url);
    return binary?Buffer.from(await response.arrayBuffer()):await response.text();
  } finally { clearTimeout(timer); }
}
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
async function readCatalog(){try{const c=JSON.parse(await fs.readFile(CATALOG,"utf8"));return {...c,products:Array.isArray(c.products)?c.products:Array.isArray(c.albums)?c.albums:[]};}catch{return {products:[],warnings:[]};}}
async function writeCatalog(data){await fs.mkdir(path.dirname(CATALOG),{recursive:true});await fs.writeFile(TEMP,JSON.stringify(data,null,2)+"\n");await fs.rename(TEMP,CATALOG);}

function albumLinks(html,base,category="") {
  const $=cheerio.load(html); const map=new Map();
  $("a[href*='/albums/']").each((_,el)=>{const url=absolute(base,$(el).attr("href")).split("?")[0];if(!/\/albums\/\d+/.test(url))return;const title=$(el).attr("title")||$(el).find("img").attr("alt")||$(el).text().trim();map.set(url,{url,title,category});});
  return [...map.values()];
}
function categoryLinks(html,base){
  const $=cheerio.load(html); const map=new Map();
  $("a[href*='/categories/'], a[href*='/collections/']").each((_,el)=>{
    const url=absolute(base,$(el).attr("href")).split("?")[0];
    const title=$(el).attr("title")||$(el).text().trim();
    if(url) map.set(url,{url,title});
  });
  return [...map.values()];
}
async function discover(source){
  const albums=new Map(); let categories=[];
  try{categories=categoryLinks(await request(source.base),source.base);}catch(error){console.warn(`[${source.key}] startpagina: ${error.message}`);}
  const targets=categories.length?categories:[{url:`${source.base}/albums`,title:""}];
  for(const target of targets){for(let page=1;page<=MAX_PAGES;page++){const url=page===1?target.url:`${target.url}?page=${page}`;try{const found=albumLinks(await request(url),source.base,target.title);if(!found.length)break;found.forEach(item=>albums.set(item.url,item));}catch(error){if(error.status!==404)console.warn(`[${source.key}] ${url}: ${error.message}`);break;}}}
  console.log(`[${source.key}] ${albums.size} albums gevonden`); return [...albums.values()];
}
function albumData(html,fallback,base){const $=cheerio.load(html);const title=$("h1").first().text().trim()||$("meta[property='og:title']").attr("content")||fallback;const images=[];$("img").each((_,el)=>[$(el).attr("data-origin-src"),$(el).attr("data-src"),$(el).attr("src")].forEach(value=>{const url=absolute(base,value);if(/photo\.yupoo\.com|\.jpe?g(?:\?|$)|\.png(?:\?|$)|\.webp(?:\?|$)/i.test(url))images.push(url);}));return {title,images:uniq(images).slice(0,MAX_IMAGES)};}
async function saveImage(url,file){if(await exists(file))return;await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;await sharp(await request(url,true)).rotate().webp({quality:82}).toFile(temp);await fs.rename(temp,file);}
async function processAlbum(source,album,old){
  const data=albumData(await request(album.url),album.title,source.base);const sourceId=album.url.match(/\/albums\/(\d+)/)?.[1];const uniqueKey=`${source.key}:${sourceId}`;const folder=path.join(ASSETS,source.key,sourceId);const images=[];
  for(let i=0;i<data.images.length;i++){const file=path.join(folder,`${String(i+1).padStart(2,"0")}.webp`);try{await saveImage(data.images[i],file);}catch(error){console.warn(`[${source.key}] afbeelding overgeslagen: ${error.message}`);}if(await exists(file))images.push(file.replaceAll(path.sep,"/"));}
  if(!images.length&&old?.images)images.push(...old.images);
  return {uniqueKey,source:source.key,sourceId,sourceUrl:album.url,sourceCategory:album.category,title:data.title,...classify(data.title,album.category,source.key),images:uniq(images),coverUrl:images[0]||old?.coverUrl||"",imageCount:uniq(images).length,updatedAt:new Date().toISOString()};
}

async function main(){
  const old=await readCatalog();const map=new Map(old.products.map(p=>[p.uniqueKey||`${p.source}:${p.sourceId}`,p]));const warnings=[];let processed=0;
  await writeCatalog({...old,status:"running",startedAt:new Date().toISOString(),products:[...map.values()],warnings});
  for(const source of SOURCES){const albums=await discover(source);for(let offset=0;offset<albums.length;offset+=BATCH){const batch=albums.slice(offset,offset+BATCH);const results=await Promise.all(batch.map(album=>limit(async()=>{const key=`${source.key}:${album.url.match(/\/albums\/(\d+)/)?.[1]}`;try{return await processAlbum(source,album,map.get(key));}catch(error){if(error.status===404){console.log(`[${source.key}] niet bereikbaar en overgeslagen: ${album.url}`);return null;}warnings.push(`[${source.key}] ${album.url}: ${error.message}`);return null;}})));results.filter(Boolean).forEach(product=>map.set(product.uniqueKey,product));processed+=batch.length;await writeCatalog({lastSync:new Date().toISOString(),status:"running",currentSource:source.key,processedAlbums:processed,products:[...map.values()],warnings:warnings.slice(-200)});console.log(`[${source.key}] ${Math.min(offset+BATCH,albums.length)}/${albums.length}; checkpoint opgeslagen`);}}
  await writeCatalog({lastSync:new Date().toISOString(),status:"completed",processedAlbums:processed,products:[...map.values()],warnings:warnings.slice(-200)});console.log(`[Catalogus] ${map.size} producten opgeslagen in ${CATALOG}`);
}
main().catch(async error=>{console.error("Synchronisatie mislukt:",error);const old=await readCatalog();await writeCatalog({...old,status:"failed",failedAt:new Date().toISOString(),warnings:[...(old.warnings||[]),error.message].slice(-200)});process.exitCode=1;});
