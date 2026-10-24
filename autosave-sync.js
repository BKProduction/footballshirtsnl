import { spawn, spawnSync } from "node:child_process";

const intervalMinutes = Math.max(
  1,
  Number(process.env.CHECKPOINT_MINUTES || 5)
);

const intervalMs = intervalMinutes * 60 * 1000;

let busy = false;
let finished = false;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });
}

function checkpoint(label = "automatic checkpoint") {
  if (busy) {
    console.log(
      `[checkpoint] Overgeslagen: vorig checkpoint is nog bezig (${label}).`
    );
    return;
  }

  busy = true;

  try {
    console.log(
      "========================================"
    );
    console.log(
      `[checkpoint] Start: ${label}`
    );
    console.log(
      "========================================"
    );

    /*
     * Alleen de bestanden opslaan die tijdens de sync
     * daadwerkelijk worden aangepast.
     *
     * BELANGRIJK:
     * Geen git pull / rebase tijdens een draaiende sync.
     * sync.js kan catalog.json namelijk ondertussen alweer
     * wijzigen en dat kan conflicten veroorzaken.
     */
    run(
      "git",
      [
        "add",
        "assets/products",
        "data/catalog.json"
      ],
      {
        stdio: "ignore"
      }
    );

    const diff = spawnSync(
      "git",
      [
        "diff",
        "--cached",
        "--quiet"
      ]
    );

    if (diff.status === 0) {
      console.log(
        `[checkpoint] Geen nieuwe wijzigingen (${label}).`
      );
      return;
    }

    console.log(
      "[checkpoint] Wijzigingen gevonden."
    );

    run(
      "git",
      [
        "config",
        "user.name",
        "github-actions[bot]"
      ]
    );

    run(
      "git",
      [
        "config",
        "user.email",
        "41898282+github-actions[bot]@users.noreply.github.com"
      ]
    );

    const stamp = new Date().toISOString();

    const commit = run(
      "git",
      [
        "commit",
        "-m",
        `Autosave FootballshirtsNL ${stamp}`
      ]
    );

    if (commit.status !== 0) {
      console.log(
        "[checkpoint] Commit mislukt."
      );
      return;
    }

    console.log(
      "[checkpoint] Commit aangemaakt."
    );

    const branch =
      process.env.GITHUB_REF_NAME || "main";

    /*
     * Eerst normaal pushen.
     *
     * Er hoort tijdens deze workflow geen andere writer
     * nodig te zijn. Als main tóch gewijzigd is, gaan we
     * NIET automatisch rebasen terwijl sync.js actief is.
     *
     * Dat voorkomt beschadiging of conflicten in
     * data/catalog.json.
     */
    const push = run(
      "git",
      [
        "push",
        "origin",
        `HEAD:${branch}`
      ]
    );

    if (push.status === 0) {
      console.log(
        `[checkpoint] SUCCES: voortgang opgeslagen ${stamp}`
      );
    } else {
      console.log(
        "[checkpoint] Push mislukt."
      );
      console.log(
        "[checkpoint] Geen pull/rebase uitgevoerd om de draaiende sync te beschermen."
      );
      console.log(
        "[checkpoint] De synchronisatie kan veilig verdergaan; een volgend checkpoint probeert opnieuw."
      );
    }
  } catch (error) {
    console.error(
      `[checkpoint] Fout: ${error.message}`
    );
  } finally {
    busy = false;
  }
}

const child = spawn(
  process.execPath,
  ["sync.js"],
  {
    stdio: "inherit",
    env: process.env
  }
);

const timer = setInterval(
  () => checkpoint("periodieke autosave"),
  intervalMs
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!finished) {
      checkpoint(`voor ${signal}`);
    }

    child.kill(signal);
  });
}

child.on("exit", code => {
  finished = true;

  clearInterval(timer);

  checkpoint("einde sync");

  process.exitCode = code ?? 1;
});
