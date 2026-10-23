import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CHECKPOINT_MINUTES = Math.max(
  1,
  Number(process.env.CHECKPOINT_MINUTES || 5)
);

const CHECKPOINT_INTERVAL = CHECKPOINT_MINUTES * 60 * 1000;

let checkpointRunning = false;
let syncFinished = false;

async function git(args) {
  return execFileAsync("git", args, {
    maxBuffer: 20 * 1024 * 1024
  });
}

async function createCheckpoint(reason = "autosave") {
  if (checkpointRunning) {
    console.log("[checkpoint] Vorige checkpoint is nog bezig; overgeslagen");
    return;
  }

  checkpointRunning = true;

  try {
    console.log(`[checkpoint] Start checkpoint: ${reason}`);

    await git([
      "config",
      "user.name",
      "footballshirtsnl-sync"
    ]);

    await git([
      "config",
      "user.email",
      "footballshirtsnl-sync@users.noreply.github.com"
    ]);

    await git(["add", "-A"]);

    const { stdout: status } = await git([
      "status",
      "--porcelain"
    ]);

    if (!status.trim()) {
      console.log("[checkpoint] Geen nieuwe bestanden om op te slaan");
      return;
    }

    const timestamp = new Date().toISOString();

    await git([
      "commit",
      "-m",
      `Autosave FootballshirtsNL ${timestamp}`
    ]);

    /*
     * Een eerdere checkpoint kan ondertussen de remote branch
     * gewijzigd hebben. Daarom eerst rebasen voordat we pushen.
     */
    try {
      await git([
        "pull",
        "--rebase",
        "--autostash",
        "origin",
        "main"
      ]);
    } catch (error) {
      console.log(
        "[checkpoint] Pull/rebase niet gelukt:",
        error.stderr || error.message
      );
    }

    await git([
      "push",
      "origin",
      "HEAD:main"
    ]);

    console.log(
      `[checkpoint] Voortgang opgeslagen en gepusht: ${timestamp}`
    );
  } catch (error) {
    console.error(
      "[checkpoint] Opslaan mislukt:",
      error.stderr || error.stdout || error.message
    );
  } finally {
    checkpointRunning = false;
  }
}

console.log(
  `[autosave] sync.js wordt gestart; checkpoint iedere ${CHECKPOINT_MINUTES} minuten`
);

const sync = spawn(
  process.execPath,
  ["sync.js"],
  {
    stdio: "inherit",
    env: process.env
  }
);

const checkpointTimer = setInterval(() => {
  if (!syncFinished) {
    createCheckpoint("periodiek");
  }
}, CHECKPOINT_INTERVAL);

sync.on("error", async error => {
  console.error("[autosave] sync.js kon niet worden gestart:", error);

  syncFinished = true;
  clearInterval(checkpointTimer);

  await createCheckpoint("sync startfout");

  process.exitCode = 1;
});

sync.on("exit", async (code, signal) => {
  syncFinished = true;
  clearInterval(checkpointTimer);

  if (signal) {
    console.log(`[autosave] sync.js beëindigd door signaal: ${signal}`);
  } else {
    console.log(`[autosave] sync.js beëindigd met code: ${code}`);
  }

  /*
   * Ook bij het einde van sync.js nog één checkpoint proberen.
   * Zo worden de laatst geschreven catalogus/foto's meegenomen.
   */
  await createCheckpoint("einde sync");

  if (signal || code !== 0) {
    process.exitCode = code || 1;
  } else {
    process.exitCode = 0;
  }
});

process.on("SIGINT", async () => {
  console.log("[autosave] SIGINT ontvangen");

  clearInterval(checkpointTimer);

  await createCheckpoint("SIGINT");

  if (!sync.killed) {
    sync.kill("SIGINT");
  }
});

process.on("SIGTERM", async () => {
  console.log("[autosave] SIGTERM ontvangen");

  clearInterval(checkpointTimer);

  await createCheckpoint("SIGTERM");

  if (!sync.killed) {
    sync.kill("SIGTERM");
  }
});
