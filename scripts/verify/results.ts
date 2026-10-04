import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { adbBin, appId, log, repoRoot, type Surface } from "./env";
import { emulatorSerials } from "./emulator";
import { runFlow } from "./maestro";
import { logPath, sh } from "./proc";

export const outRoot = "/tmp/learnify-verify-out";

/** Local time as YYYYMMDD-HHMMSS. */
const stamp = () => {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
};

const pngsUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pngsUnder(full);
    return entry.name.endsWith(".png") ? [full] : [];
  });

/** The step Maestro failed on, and why. */
const failure = (maestroLog: string) =>
  fs
    .readFileSync(maestroLog, "utf8")
    .split("\n")
    .filter((line) => /FAILED|Error|not visible|not found/.test(line))
    .slice(0, 6)
    .join("\n");

/**
 * Runs each flow into its own folder under /tmp/learnify-verify-out, with
 * `latest` pointing at the newest, and the desktop log written meanwhile.
 */
export const runFlows = async (flows: string[]) => {
  if (flows.length === 0) throw new Error("usage: run <flow> [flow…]");
  const failed: string[] = [];
  for (const flow of flows) {
    const outDir = path.join(outRoot, `${stamp()}-${flow}`);
    const desktopLog = logPath("desktop");
    const from = fs.existsSync(desktopLog) ? fs.statSync(desktopLog).size : 0;

    const { ok } = await runFlow(flow, outDir);

    if (fs.existsSync(desktopLog)) {
      const all = fs.readFileSync(desktopLog);
      fs.writeFileSync(path.join(outDir, "desktop.log"), all.subarray(from));
    }
    const latest = path.join(outRoot, "latest");
    fs.rmSync(latest, { force: true });
    fs.symlinkSync(outDir, latest);

    for (const png of pngsUnder(outDir)) console.log(`  ${png}`);
    if (ok) {
      log(`${flow} passed`);
    } else {
      console.error(failure(path.join(outDir, "maestro.log")));
      log(`${flow} FAILED, see ${outDir}`);
      failed.push(flow);
    }
  }
  if (failed.length > 0) throw new Error(`failed: ${failed.join(", ")}`);
};

const serialFor = async (surface: Surface) => {
  const serial = (await emulatorSerials())[surface];
  if (!serial) throw new Error(`${surface} emulator is not running`);
  return serial;
};

/** One screenshot of the desktop window or an emulator screen. */
export const shot = async (target: string, extra: string[]) => {
  const file = path.join(outRoot, "shots", `${stamp()}-${target}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (target === "desktop") {
    const script = path.join(
      repoRoot,
      ".cursor/skills/verify/scripts/desktop-shot.mjs",
    );
    execFileSync("node", [script, "--out", file, ...extra], {
      stdio: "inherit",
    });
    return;
  }
  if (target !== "phone" && target !== "tv") {
    throw new Error("usage: shot desktop|phone|tv");
  }
  const png = execFileSync(adbBin, [
    "-s",
    await serialFor(target),
    "exec-out",
    "screencap",
    "-p",
  ]);
  fs.writeFileSync(file, png);
  console.log(file);
};

/** Follows a piece's log until interrupted. */
export const followLogs = async (target: string) => {
  if (target === "desktop" || target === "metro") {
    spawn("tail", ["-n", "50", "-f", logPath(target)], { stdio: "inherit" });
    return;
  }
  if (target !== "phone" && target !== "tv") {
    throw new Error("usage: logs desktop|metro|phone|tv");
  }
  const serial = await serialFor(target);
  const pid = await sh(adbBin, ["-s", serial, "shell", "pidof", appId]).catch(
    () => "",
  );
  if (!pid) throw new Error(`${appId} is not running on ${serial}`);
  spawn(adbBin, ["-s", serial, "logcat", `--pid=${pid}`], {
    stdio: "inherit",
  });
};
