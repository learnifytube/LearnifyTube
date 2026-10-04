import fs from "node:fs";
import path from "node:path";
import {
  cdpPort,
  log,
  pairingCode,
  repoRoot,
  syncPort,
  verifyDir,
} from "./env";
import {
  killAll,
  pidsWithEnv,
  sh,
  startDetached,
  tryFetch,
  waitFor,
} from "./proc";

const sync = `http://127.0.0.1:${syncPort}`;
const auth = { Authorization: `Bearer ${pairingCode}` };

/** Every process of the isolated desktop carries its user-data folder in its environment. */
export const desktopPids = () =>
  pidsWithEnv("LEARNIFYTUBE_USER_DATA_DIR", verifyDir);

export const isSeeded = () =>
  fs.existsSync(path.join(verifyDir, ".verify-desktop"));

export const desktopHealth = async () => {
  const [info, cdp, post] = await Promise.all([
    tryFetch(`${sync}/api/info`, { headers: auth }),
    tryFetch(`http://127.0.0.1:${cdpPort}/json/version`),
    // Answers 400 without queueing anything; hangs when issue #29 strikes.
    tryFetch(`${sync}/api/download/request`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: "{}",
    }),
  ]);
  return { info: !!info?.ok, cdp: !!cdp?.ok, post: !!post };
};

// Written by the desktop when a POST body is all in but the request never ends.
const stuckPostMark = "Stuck POST body (issue #29)";

/** When the verify desktop logged a stuck POST (issue #29), oldest first. */
export const stuckPostTimes = () =>
  ["main.old.log", "main.log"]
    .map((name) => path.join(verifyDir, "logs", name))
    .filter((file) => fs.existsSync(file))
    .flatMap((file) =>
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.includes(stuckPostMark))
        .map((line) => line.slice(1, 20)),
    );

export const stuckPostNote = () => {
  const times = stuckPostTimes();
  if (times.length === 0) return null;
  return `desktop logged ${times.length} stuck POST(s), latest ${times.at(-1)} — issue #29; details in \`npm run verify -- logs desktop\``;
};

const portOwner = async () => {
  const pid = await sh("lsof", [
    "-nP",
    `-iTCP:${syncPort}`,
    "-sTCP:LISTEN",
    "-t",
  ]).catch(() => "");
  return pid ? Number(pid.split("\n")[0]) : null;
};

export const stopDesktop = async () => {
  const pids = desktopPids();
  if (pids.length === 0) return;
  log(`stopping desktop (${pids.length} processes)`);
  await killAll(pids);
};

const seed = async () => {
  log("seeding desktop");
  await sh(
    "npm",
    ["run", "verify:seed", "--prefix", "apps/desktop", "--", verifyDir],
    repoRoot,
  );
};

export const upDesktop = async (fresh: boolean) => {
  if (fresh || !isSeeded()) {
    await stopDesktop();
    await seed();
  }

  const stuck = stuckPostNote();
  if (stuck) log(`WARNING: ${stuck}`);

  const health = await desktopHealth();
  if (health.info && health.cdp && health.post) {
    log("desktop healthy, reusing");
    return;
  }
  if (health.info && !health.post) {
    log("WARNING: desktop answers GET but POST hangs — restarting it.");
    log("WARNING: this is a real desktop bug, see issue #29.");
  }
  await stopDesktop();

  const owner = await portOwner();
  if (owner !== null) {
    throw new Error(
      `port ${syncPort} is held by PID ${owner}, which is not the verify desktop; stop it first`,
    );
  }

  log("starting desktop");
  const env = { ...process.env, LEARNIFYTUBE_USER_DATA_DIR: verifyDir };
  startDetached(
    "desktop",
    `npx electron-forge start -- --remote-debugging-port=${cdpPort}`,
    path.join(repoRoot, "apps/desktop"),
    env,
  );
  await waitFor(
    "desktop",
    async () => {
      const { info, cdp } = await desktopHealth();
      return info && cdp;
    },
    240_000,
  );
  log("desktop up");
};
