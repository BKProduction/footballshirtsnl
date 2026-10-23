import { spawn, spawnSync } from "node:child_process";

const intervalMinutes = Math.max(
  1,
  Number(process.env.CHECKPOINT_MINUTES || 5)
);

const intervalMs =
  intervalMinutes * 60 * 1000;

let busy = false;
let finished = false;

function run(
  command,
  args,
  options = {}
) {
  return spawnSync(
    command,
    args,
    {
      stdio: "inherit",
      ...options
    }
  );
}

function checkpoint(
  label = "automatic checkpoint"
) {
  if (busy) {
    return;
  }

  busy = true;

  try {
    run(
      "git",
      [
        "add",
        "assets/products",
        "data/catalog.json",
        "data/catalog.json.tmp"
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
        `[checkpoint] Geen nieuwe bestanden om op te slaan (${label}).`
      );

      return;
    }

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

    const stamp =
      new Date().toISOString();

    const commit = run(
      "git",
      [
        "commit",
        "-m",
        `Catalog checkpoint ${stamp}`
      ]
    );

    if (commit.status !== 0) {
      return;
    }

    const push = run(
      "git",
      [
        "push",
        "origin",
        `HEAD:${process.env.GITHUB_REF_NAME || "main"}`
      ]
    );

    if (push.status === 0) {
      console.log(
        `[checkpoint] Tussentijds opgeslagen: ${stamp}`
      );
    }
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
  () => checkpoint("interval"),
  intervalMs
);

for (
  const signal of [
    "SIGINT",
    "SIGTERM"
  ]
) {
  process.on(
    signal,
    () => {
      if (!finished) {
        checkpoint(
          `voor ${signal}`
        );
      }

      child.kill(signal);
    }
  );
}

child.on(
  "exit",
  code => {
    finished = true;

    clearInterval(timer);

    checkpoint(
      "einde sync"
    );

    process.exitCode =
      code ?? 1;
  }
);
