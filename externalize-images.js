import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OWNER = "BKProduction";
const REPO = "footballshirtsnl";
const BRANCH = "main";

const CDN_BASE =
  `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}`;

const DATA_DIR = path.join(__dirname, "data");

const IMAGE_EXTENSIONS =
  /\.(avif|bmp|gif|jpeg|jpg|png|svg|webp)$/i;

function normalizePath(value) {
  return value
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "");
}

function convertImageUrl(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return value;
  }

  if (/^(https?:|data:|blob:)/i.test(trimmed)) {
    return value;
  }

  const normalized = normalizePath(trimmed);

  if (!normalized.startsWith("assets/")) {
    return value;
  }

  if (!IMAGE_EXTENSIONS.test(normalized)) {
    return value;
  }

  return `${CDN_BASE}/${normalized}`;
}

function convertValue(value, stats) {
  if (typeof value === "string") {
    const converted = convertImageUrl(value);

    if (converted !== value) {
      stats.converted += 1;
    }

    return converted;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      convertValue(item, stats)
    );
  }

  if (value && typeof value === "object") {
    const result = {};

    for (const [key, child] of Object.entries(value)) {
      result[key] = convertValue(child, stats);
    }

    return result;
  }

  return value;
}

function findJsonFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files = [];

  for (
    const entry of fs.readdirSync(
      directory,
      { withFileTypes: true }
    )
  ) {
    const fullPath =
      path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...findJsonFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".json")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function processJsonFile(filePath) {
  const text =
    fs.readFileSync(filePath, "utf8");

  const data =
    JSON.parse(text);

  const stats = {
    converted: 0
  };

  const newData =
    convertValue(data, stats);

  if (stats.converted === 0) {
    console.log(
      `[images] Geen wijzigingen: ${filePath}`
    );

    return 0;
  }

  fs.writeFileSync(
    filePath,
    JSON.stringify(newData, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `[images] ${stats.converted} URL(s) aangepast: ${filePath}`
  );

  return stats.converted;
}

function main() {
  console.log(
    "=========================================="
  );

  console.log(
    "FootballshirtsNL externe afbeeldingen"
  );

  console.log(
    `CDN: ${CDN_BASE}`
  );

  console.log(
    "=========================================="
  );

  const files =
    findJsonFiles(DATA_DIR);

  for (
    const fileName of
    ["catalog.json", "products.json"]
  ) {
    const fullPath =
      path.join(__dirname, fileName);

    if (fs.existsSync(fullPath)) {
      files.push(fullPath);
    }
  }

  const uniqueFiles =
    [...new Set(files)];

  if (uniqueFiles.length === 0) {
    console.log(
      "[images] Geen JSON-bestanden gevonden."
    );

    return;
  }

  let totalConverted = 0;

  for (const filePath of uniqueFiles) {
    totalConverted +=
      processJsonFile(filePath);
  }

  console.log(
    "=========================================="
  );

  console.log(
    `[images] JSON-bestanden gecontroleerd: ${uniqueFiles.length}`
  );

  console.log(
    `[images] URL's omgezet: ${totalConverted}`
  );

  console.log(
    "=========================================="
  );
}

try {
  main();
} catch (error) {
  console.error(
    "[images] FOUT tijdens verwerken:"
  
