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

const IMAGE_RE =
  /\.(avif|bmp|gif|jpeg|jpg|png|svg|webp)$/i;

function normalize(value) {
  return value
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "");
}

function isAlreadyExternal(value) {
  return /^(https?:|data:|blob:)/i.test(value);
}

function convertString(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return value;
  }

  if (isAlreadyExternal(trimmed)) {
    return value;
  }

  const normalized = normalize(trimmed);

  if (!normalized.startsWith("assets/")) {
    return value;
  }

  if (!IMAGE_RE.test(normalized)) {
    return value;
  }

  return `${CDN_BASE}/${normalized}`;
}

function convertDeep(value, stats) {
  if (typeof value === "string") {
    const converted = convertString(value);

    if (converted !== value) {
      stats.converted += 1;
    }

    return converted;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      convertDeep(item, stats)
    );
  }

  if (value && typeof value ==
