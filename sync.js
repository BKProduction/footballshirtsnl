import fs from "node:fs/promises";
import cheerio from "cheerio";
import pLimit from "p-limit";
const base=process.env.SOURCE_BASE||"https://minkang.x.yupoo.com";
const pages=Number(process.env.SYNC_MAX_PAGES||66), limit=pLimit(Number(process.env.SYNC_CONCURRENCY||2));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function html(url){const r=await fetch(url,{headers:{"user-agent":process.env.USER_AGENT||"CatalogSync/1.0"}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text()}
function abs(u){return u?.startsWith("http")?u:new URL(u,base).href}
async function indexPage(page){await sleep(400);const $=cheerio.load(await html(`${base}/albums?page=${page}`));const out=[];
  $('a[href*="/albums/"]').each((_,a)=>{const href=$(a).attr('href');const m=href?.match(/\/albums\/(\d+)/);if(!m)return;const card=$(a).closest('li, .album__main, .showindex__children');const title=($(a).attr('title')||card.find('.album__title,.showindex__children__title').text()||$(a).text()).trim();const img=card.find('img').first();const src=img.attr('data-origin-src')||img.attr('data-src')||img.attr('src');out.push({sourceId:m[1],title,sourceUrl:abs(href),coverUrl:src?abs(src):null});});return [...new Map(out.map(x=>[x.sourceId,x])).values()];}
async function detail(a){return limit(async()=>{await sleep(500);const $=cheerio.load(await html(a.sourceUrl));const title=($('h1').first().text()||$('title').text().split('|')[0]||a.title).trim();const images=[];$('img').each((_,im)=>{const s=$(im).attr('data-origin-src')||$(im).attr('data-src')||$(im).attr('src');if(s&&/photo|image|yupoo|x\.yupoo/.test(s))images.push(abs(s));});return {...a,title,images:[...new Set(images)].filter(Boolean),updatedAt:new Date().toISOString()};});}
let previous={albums:[]};try{previous=JSON.parse(await fs.readFile('data/catalog.json','utf8'))}catch{}
const discovered=[];for(let p=1;p<=pages;p++){try{discovered.push(...await indexPage(p));console.log(`index ${p}/${pages}`)}catch(e){console.error(e.message)}}
const unique=[...new Map(discovered.map(x=>[x.sourceId,x])).values()];const old=new Map(previous.albums.map(x=>[x.sourceId,x]));const albums=[];
for(const a of unique){try{albums.push(await detail(a))}catch(e){albums.push(old.get(a.sourceId)||{...a,images:[],error:e.message})}}
const output={lastSync:new Date().toISOString(),source:base,total:albums.length,albums,warnings:[]};await fs.writeFile('data/catalog.json.tmp',JSON.stringify(output,null,2));await fs.rename('data/catalog.json.tmp','data/catalog.json');console.log(`klaar: ${albums.length} albums`);
