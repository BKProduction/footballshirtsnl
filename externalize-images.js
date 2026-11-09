'use strict';

const fs = require('fs');
const path = require('path');

const OWNER = 'BKProduction';
const REPO = 'footballshirtsnl';
const BRANCH = 'main';
const CDN_BASE = `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}`;
const DATA_DIR = path.join(__dirname, 'data');
const IMAGE_RE = /\.(avif|bmp|gif|jpeg|jpg|png|svg|webp)$/i;

function normalize(value) {
  return value.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

function convertString(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || /^(https?:|data:|blob:)/i.test(trimmed)) return value;
  const normalized = normalize(trimmed);
  if (!normalized.startsWith('assets/') || !IMAGE_RE.test(normalized)) return value;
  return `${CDN_BASE}/${normalized}`;
}

function convertDeep(value, stats) {
  if (typeof value === 'string') {
    const out = convertString(value);
    if (out !== value) stats.converted++;
    return out;
  }
  if (Array.isArray(value)) return value.map(v => convertDeep(v, stats));
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = convertDeep(value[key], stats);
  }
  return value;
}

function jsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsonFiles(p));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) out.push(p);
  }
  return out;
}

function main() {
  const files = jsonFiles(DATA_DIR);
  for (const name of ['catalog.json', 'products.json']) {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) files.push(p);
  }

  let converted = 0;
  let changed = 0;

  for (const file of [...new Set(files)]) {
    const original = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(original);
    const stats = { converted: 0 };
    convertDeep(data, stats);
    if (stats.converted) {
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
      changed++;
      converted += stats.converted;
      console.log(`[images] ${stats.converted} URL(s) aangepast: ${file}`);
    }
  }

  console.log(`[images] Klaar. ${converted} URL(s) aangepast in ${changed} bestand(en).`);
}

main();
