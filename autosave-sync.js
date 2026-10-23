import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Iedere 5 minuten proberen de voortgang naar GitHub op te slaan.
// Via CHECKPOINT_MINUTES kan dit eventueel in de workflow worden aangepast.
const CHECKPOINT_MINUTES = Math.max(
  1,
  Number(process.env.CHECKPOINT_MINUTES || 5)
);

const CHECKPOINT_INTERVAL = CHECKPOINT_MINUTES * 60 * 1000;

let checkpointRunning = false;
let syncFinished = false;
let shuttingDown = false;

async function git(args) {
  return execFileAsync("git", args, {
    maxBuffer: 50 * 1024 * 1024
  });
}

async function createCheckpoint(reason = "autosave") {
  if (checkpointRunning) {
    console.log(
      `[checkpoint] Overgeslagen (${reason}): vorige checkpoint is nog bezig`
    );
    return;
  }

  checkpointRunning = true;

  try {
    console.log("");
    console.log("========================================");
    console.log(`[checkpoint] Start: ${reason}`);
    console.log("========================================");

    // Git-identiteit instellen
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

    // Alle gewijzigde en nieuwe bestanden toevoegen
    await git(["add", "-A"]);

    // Controleren of er daadwerkelijk iets gewijzigd is
    const { stdout: status } = await git([
      "status",
      "--porcelain"
    ]);

    if (!status.trim()) {
      console.log(
        "[checkpoint] Geen nieuwe bestanden om op te slaan"
      );
      return;
    }

    console.log("[checkpoint] Wijzigingen gevonden:");
    console.log(status.trim());

    const timestamp = new Date().toISOString();

    // Wijzigingen committen
    await git([
      "commit",
      "-m",
      `Autosave FootballshirtsNL ${timestamp}`
    ]);

    console.log("[checkpoint] Commit aangemaakt");

    // Eerst de actuele main ophalen voordat we pushen.
    // --autostash voorkomt problemen met eventuele lokale wijzigingen.
    try {
      const { stdout, stderr } = await git([
        "pull",
        "--rebase",
        "--autostash",
        "origin",
        "main"
      ]);

      if (stdout?.trim()) {
        console.log(stdout.trim());
      }

      if (stderr?.trim()) {
        console.log(stderr.trim());
      }

      console.log("[checkpoint] Remote main bijgewerkt");
    } catch (error) {
      console.log(
        "[checkpoint] Pull/rebase gaf een melding:"
      );

      console.log(
        error.stderr ||
        error.stdout ||
        error.message
      );

      // Als een rebase actief is geraakt, proberen we die veilig af te breken.
      try {
        await git(["rebase", "--abort"]);
      } catch {
        // Geen actieve rebase, dus niets doen.
      }
    }

    // Checkpoint naar main pushen
    try {
      const { stdout, stderr } = await git([
        "push",
        "origin",
        "HEAD:main"
      ]);

      if (stdout?.trim()) {
        console.log(stdout.trim());
      }

      if (stderr?.trim()) {
        console.log(stderr.trim());
      }

      console.log(
        `[checkpoint] SUCCES: voortgang opgeslagen ${timestamp}`
      );
    } catch (error) {
      console.error(
        "[checkpoint] Push mislukt:"
      );

      console.error(
        error.stderr ||
        error.stdout ||
        error.message
      );
    }
  } catch (error) {
    console.error(
      `[checkpoint] Checkpoint mislukt (${reason}):`
    );

    console.error(
      error.stderr ||
      error.stdout ||
      error.message
    );
  } finally {
    checkpointRunning = false;

    console.log("========================================");
    console.log("");
  }
}

async function waitForCheckpoint() {
  while (checkpointRunning) {
    await new Promise(resolve =>
      setTimeout(resolve, 1000)
    );
  }
}

async function finalCheckpoint(reason) {
  await waitForCheckpoint();
  await createCheckpoint(reason);
}

console.log("");
console.log("========================================");
console.log("FootballshirtsNL autosave gestart");
console.log(
  `Checkpoint iedere ${CHECKPOINT_MINUTES} minuten`
);
console.log("sync.js wordt nu gestart");
console.log("========================================");
console.log("");

// sync.js als apart Node-proces starten.
// Alle uitvoer van sync.js blijft rechtstreeks zichtbaar in GitHub Actions.
const sync = spawn(
  process.execPath,
  ["sync.js"],
  {
    stdio: "inherit",
    env: process.env
  }
);

// Periodiek gewijzigde bestanden naar GitHub pushen.
const checkpointTimer = setInterval(() => {
  if (!syncFinished && !shuttingDown) {
    createCheckpoint("periodieke autosave");
  }
}, CHECKPOINT_INTERVAL);

// Zorgt ervoor dat de timer het Node-proces niet onnodig vasthoudt
// wanneer sync.js al beëindigd is.
checkpointTimer.unref();

sync.on("error", async error => {
  console.error("");
  console.error("[autosave] sync.js kon niet worden gestart");
  console.error(error);

  syncFinished = true;
  shuttingDown = true;

  clearInterval(checkpointTimer);

  await finalCheckpoint(
    "laatste opslag na startfout"
  );

  process.exitCode = 1;
});

sync.on("exit", async (code, signal) => {
  syncFinished = true;
  shuttingDown = true;

  clearInterval(checkpointTimer);

  console.log("");
  console.log("========================================");

  if (signal) {
    console.log(
      `[autosave] sync.js beëindigd door signaal: ${signal}`
    );
  } else {
    console.log(
      `[autosave] sync.js beëindigd met code: ${code}`
    );
  }

  console.log(
    "[autosave] Laatste checkpoint wordt uitgevoerd"
  );

  console.log("========================================");

  await finalCheckpoint(
    "laatste opslag na einde sync.js"
  );

  if (signal) {
    process.exitCode = 1;
  } else {
    process.exitCode =
      typeof code === "number" ? code : 1;
  }
});

async function handleShutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log("");
  console.log(
    `[autosave] ${signal} ontvangen`
  );

  console.log(
    "[autosave] Probeer laatste voortgang op te slaan"
  );

  clearInterval(checkpointTimer);

  await finalCheckpoint(
    `noodopslag ${signal}`
  );

  if (!sync.killed) {
    try {
      sync.kill(signal);
    } catch (error) {
      console.error(
        "[autosave] Kon sync.js niet stoppen:",
        error.message
      );
    }
  }
}

process.on("SIGINT", () => {
  handleShutdown("SIGINT");
});

process.on("SIGTERM", () => {
  handleShutdown("SIGTERM");
});

process.on("uncaughtException", async error => {
  console.error(
    "[autosave] Onverwachte fout:",
    error
  );

  clearInterval(checkpointTimer);

  await finalCheckpoint(
    "noodopslag na onverwachte fout"
  );

  process.exitCode = 1;
});

process.on("unhandledRejection", async reason => {
  console.error(
    "[autosave] Onverwerkte promise-fout:",
    reason
  );

  clearInterval(checkpointTimer);

  await finalCheckpoint(
    "noodopslag na promise-fout"
  );

  process.exitCode = 1;
});
