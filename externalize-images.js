import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CDN_BASE = "https://cdn.jsdelivr.net/gh/BKProduction/footballshirtsnl@main";
const DATA_DIR = path.join(__dirname, "data");
const IMAGE_EXTENSIONS = /\.(avif|bmp|gif|jpeg|jpg|png|svg|webp)$/i;

function convert(value, stats) {
  if (typeof value === "string") {
    const s = value.trim();
    if (!s || /^(https?:|data:|blob:)/i.test(s)) return value;
    const p = s.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
    if (!p.startsWith("assets/") || !IMAGE_EXTENSIONS.test(p)) return value;
    stats.count += 1;
    return `${CDN_BASE}/${p}`;
  }

  if (Array.isArray(value)) return value.map((v) => convert(v, stats));

  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = convert(value[key], stats);
  }

  return value;
}

function findJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findJsonFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) files.push(full);
  }
  return files;
}

const files = findJsonFiles(DATA_DIR);
for (const name of ["catalog.json", "products.json"]) {
  const full = path.join(__dirname, name);
  if (fs.existsSync(full)) files.push(full);
}

let total = 0;
for (const file of [...new Set(files)]) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const stats = { count: 0 };
  convert(data, stats);
  if (stats.count > 0) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`[images] ${stats.count} URL(s) aangepast: ${file}`);
    total += stats.count;
  }
}

console.log(`[images] Klaar. ${total} lokale afbeeldings-URL(s) omgezet.`);
