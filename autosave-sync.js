import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CHECKPOINT_MINUTES = Math.max(
  1,
  Number(process.env.CHECKPOINT_MINUTES || 5)
);
const CHECKPOINT_INTERVAL = CHECKPOINT_MINUTES * 60 * 1000;
const TARGET_BRANCH = process.env.GITHUB_REF_NAME || "main";

let checkpointRunning = false;
let checkpointQueued = false;
let syncFinished = false;
let shuttingDown = false;

async function git(args, options = {}) {
  return execFileAsync("git", args, {
    maxBuffer: 100 * 1024 * 1024,
    ...options
  });
}

async function hasChanges() {
  const { stdout } = await git(["status", "--porcelain"]);
  return Boolean(stdout.trim());
}

async function createCheckpoint(reason = "automatisch") {
  if (checkpointRunning) {
    checkpointQueued = true;
    console.log(
      `[checkpoint] ${reason} staat klaar; huidig checkpoint wordt eerst afgerond.`
    );
    return false;
  }

  checkpointRunning = true;

  try {
    console.log("");
    console.log("========================================");
    console.log(`[checkpoint] Start: ${reason}`);
    console.log("========================================");

    await git(["config", "user.name", "footballshirtsnl-sync"]);
    await git([
      "config",
      "user.email",
      "footballshirtsnl-sync@users.noreply.github.com"
    ]);

    await git(["add", "-A"]);

    if (!(await hasChanges())) {
      console.log("[checkpoint] Geen nieuwe wijzigingen om op te slaan.");
      return true;
    }

    const timestamp = new Date().toISOString();

    await git([
      "commit",
      "-m",
      `Autosave FootballshirtsNL ${timestamp}`
    ]);

    console.log(`[checkpoint] Commit aangemaakt: ${timestamp}`);

    /*
     * BELANGRIJK:
     * Hier wordt bewust GEEN `git pull --rebase` uitgevoerd.
     * sync.js schrijft tijdens de run voortdurend bestanden. Een rebase kan
     * daardoor botsen met bestanden die op hetzelfde moment worden aangepast.
     * De workflow haalt bij de start al de actuele main-branch op en door de
     * concurrency-instelling draait er maar een synchronisatie tegelijk.
     */
    await git(["push", "origin", `HEAD:${TARGET_BRANCH}`]);

    console.log(
      `[checkpoint] SUCCESS: voortgang opgeslagen op ${TARGET_BRANCH}: ${timestamp}`
    );
    return true;
  } catch (error) {
    const details = String(
      error?.stderr || error?.stdout || error?.message || error
    ).trim();

    console.error(`[checkpoint] Opslaan mislukt (${reason}).`);
    if (details) {
      console.error(details);
    }

    /*
     * Een mislukt checkpoint stopt sync.js niet. De synchronisatie mag verder
     * werken en het volgende checkpoint probeert opnieuw op te slaan.
     */
    return false;
  } finally {
    checkpointRunning = false;

    if (checkpointQueued && !syncFinished && !shuttingDown) {
      checkpointQueued = false;
      setTimeout(() => {
        void createCheckpoint("ingehaald checkpoint");
      }, 1000);
    }
  }
}

const child = spawn(process.execPath, ["sync.js"], {
  stdio: "inherit",
  env: process.env
});

const timer = setInterval(() => {
  void createCheckpoint("periodiek");
}, CHECKPOINT_INTERVAL);

timer.unref();

async function stop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);

  console.log(`[autosave] ${signal} ontvangen; laatste checkpoint wordt gemaakt.`);

  if (!child.killed) {
    child.kill(signal);
  }

  while (checkpointRunning) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await createCheckpoint(`voor ${signal}`);
  process.exitCode = signal === "SIGTERM" ? 143 : 130;
}

process.on("SIGINT", () => {
  void stop("SIGINT");
});

process.on("SIGTERM", () => {
  void stop("SIGTERM");
});

child.on("error", async error => {
  syncFinished = true;
  clearInterval(timer);
  console.error("[autosave] sync.js kon niet worden gestart:", error);
  await createCheckpoint("na startfout");
  process.exitCode = 1;
});

child.on("exit", async (code, signal) => {
  syncFinished = true;
  clearInterval(timer);

  while (checkpointRunning) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const saved = await createCheckpoint("einde sync");

  if (!saved) {
    console.error("[autosave] Laatste checkpoint kon niet worden gepusht.");
  }

  if (signal) {
    console.error(`[autosave] sync.js gestopt door signaal ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
