import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

const INTERVAL_MS = Number(process.env.AUTOSAVE_INTERVAL_MS || 300000);
let child;
let saving = false;
let stopping = false;

function git(args, allowFailure = false) {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!allowFailure && result.status !== 0) throw new Error(`git ${args.join(" ")} mislukt`);
  return result;
}

function hasChanges() {
  return Boolean(git(["status", "--porcelain"], true).stdout.trim());
}

function saveCheckpoint(label) {
  if (saving) return false;
  saving = true;
  try {
    console.log(`\n[checkpoint] Start: ${label}`);
    if (!hasChanges()) {
      console.log(`[checkpoint] Geen nieuwe wijzigingen (${label}).`);
      return true;
    }
    git(["add", "data/catalog.json", "data/sync-state.json", "assets/products"], true);
    if (!hasChanges()) {
      console.log(`[checkpoint] Geen relevante cataloguswijzigingen (${label}).`);
      return true;
    }
    git(["commit", "-m", `Autosave FootballshirtsNL ${new Date().toISOString()}`]);
    const push = git(["push", "origin", "HEAD:main"], true);
    if (push.status === 0) {
      console.log("[checkpoint] SUCCESS: voortgang opgeslagen.");
      return true;
    }
    console.warn("[checkpoint] Push uitgesteld. De sync blijft lokaal veilig doorgaan.");
    return false;
  } finally {
    saving = false;
  }
}

function preflight() {
  git(["config", "user.name", "github-actions[bot]"], true);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], true);
  if (hasChanges()) throw new Error("Werkmap bevat al wijzigingen voordat de sync start.");
  git(["pull", "--rebase", "origin", "main"]);
}

function finalPush() {
  saveCheckpoint("finale autosave");
  const test = git(["push", "origin", "HEAD:main"], true);
  if (test.status === 0) return;
  console.log("[checkpoint] Remote is gewijzigd. Na beëindiging van sync volgt veilige rebase.");
  git(["pull", "--rebase", "origin", "main"]);
  git(["push", "origin", "HEAD:main"]);
}

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[checkpoint] Signaal ${signal} ontvangen.`);
  if (child && !child.killed) child.kill("SIGTERM");
  setTimeout(() => child && !child.killed && child.kill("SIGKILL"), 10000).unref();
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

try {
  preflight();
  child = spawn(process.execPath, ["sync.js"], { stdio: "inherit", env: process.env });
  const interval = setInterval(() => saveCheckpoint("periodieke autosave"), INTERVAL_MS);
  const exitCode = await new Promise(resolve => child.on("exit", code => resolve(code ?? 1)));
  clearInterval(interval);
  finalPush();
  process.exitCode = exitCode;
} catch (error) {
  console.error(`[checkpoint] FATAAL: ${error.message}`);
  process.exitCode = 1;
}
