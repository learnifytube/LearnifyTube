import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { runDir } from "./env";

const execFileAsync = promisify(execFile);

export const sh = async (command: string, args: string[], cwd?: string) => {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
  });
  return stdout.trim();
};

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = async (
  what: string,
  check: () => Promise<boolean>,
  timeoutMs: number,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await sleep(1000);
  }
  throw new Error(`${what} not ready after ${Math.round(timeoutMs / 1000)}s`);
};

export const logPath = (name: string) => path.join(runDir, `${name}.log`);

/**
 * Starts a long-running command that outlives this CLI. Its stdin is a fifo it
 * holds open itself, so tools that quit on stdin EOF (Electron Forge) keep running.
 */
export const startDetached = (
  name: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
) => {
  fs.mkdirSync(runDir, { recursive: true });
  const fifo = path.join(runDir, `${name}.stdin`);
  if (!fs.existsSync(fifo)) execFileSync("mkfifo", [fifo]);
  const out = fs.openSync(logPath(name), "w");
  const child = spawn("sh", ["-c", `exec ${command} 0<>"${fifo}"`], {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  fs.closeSync(out);
};

/**
 * PIDs of this user's processes whose environment has `name=value`. Every
 * process the tool starts carries such a marker, and so do their children.
 */
export const pidsWithEnv = (name: string, value: string) => {
  const marker = ` ${name}=${value}`;
  const listing = execFileSync("ps", ["eww", "-ax", "-o", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listing
    .split("\n")
    .map((line) => line.trim().match(/^(\d+) (.*)$/))
    .filter((match) => {
      if (!match) return false;
      const rest = match[2];
      const at = rest.indexOf(marker);
      return at !== -1 && [" ", undefined].includes(rest[at + marker.length]);
    })
    .map((match) => Number(match![1]))
    .filter((pid) => pid !== process.pid);
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const killAll = async (pids: number[]) => {
  const signal = (sig: NodeJS.Signals) =>
    pids.forEach((pid) => {
      try {
        process.kill(pid, sig);
      } catch {
        // Already gone.
      }
    });
  signal("SIGTERM");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && pids.some(alive)) await sleep(250);
  signal("SIGKILL");
};

/** The response, or null when nothing answered in time. */
export const tryFetch = async (
  url: string,
  init?: RequestInit,
  timeoutMs = 4000,
) => {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
};
