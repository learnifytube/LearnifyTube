/**
 * One command for the isolated verify environment: desktop, Metro, and the
 * phone and TV emulators. See .cursor/skills/verify/SKILL.md.
 *
 *   npm run verify -- up [phone|tv] [--fresh] [--headless]
 *   npm run verify -- pair [phone|tv]
 *   npm run verify -- run <flow> [flow…]
 *   npm run verify -- shot desktop|phone|tv [desktop-shot.mjs flags]
 *   npm run verify -- logs desktop|metro|phone|tv
 *   npm run verify -- status
 *   npm run verify -- down [--emulators]
 *   npm run verify -- install phone|tv
 */
import fs from "node:fs";
import path from "node:path";
import {
  allSurfaces,
  avds,
  log,
  metroPort,
  runDir,
  syncPort,
  type Surface,
} from "./env";
import {
  desktopHealth,
  desktopPids,
  isSeeded,
  stopDesktop,
  upDesktop,
} from "./desktop";
import {
  emulatorSerials,
  installApp,
  isBooted,
  isInstalled,
  prepareApp,
  stopEmulator,
  upEmulator,
} from "./emulator";
import { runFlow } from "./maestro";
import { followLogs, runFlows, shot } from "./results";
import { metroHealthy, metroPids, stopMetro, upMetro } from "./metro";

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((arg) => arg.startsWith("--")));
const named = rest.filter((arg): arg is Surface => arg in avds);
const surfaces = named.length > 0 ? named : allSurfaces;

const up = async () => {
  const fresh = flags.has("--fresh");
  const [, , serials] = await Promise.all([
    upDesktop(fresh),
    upMetro(),
    Promise.all(surfaces.map((s) => upEmulator(s, flags.has("--headless")))),
  ]);
  for (const [i, surface] of surfaces.entries()) {
    await prepareApp(surface, serials[i], fresh);
  }
  log("ready");
};

const tail = (file: string, lines: number) =>
  fs.readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");

/** Pairs each device with the verify desktop; it ends on the device's Home. */
const pair = async () => {
  // One at a time: parallel Maestro runs fight over the driver port.
  for (const surface of surfaces) {
    const outDir = path.join(runDir, `pair-${surface}`);
    const { ok } = await runFlow(`${surface}-pair`, outDir);
    if (!ok) {
      console.error(tail(path.join(outDir, "maestro.log"), 15));
      throw new Error(`${surface} did not pair; Maestro output in ${outDir}`);
    }
    log(`${surface} paired`);
  }
};

const status = async () => {
  const [desktop, metro, serials] = await Promise.all([
    desktopHealth(),
    metroHealthy(),
    emulatorSerials(),
  ]);
  const mark = (ok: boolean) => (ok ? "up  " : "DOWN");
  const desktopOk = desktop.info && desktop.cdp && desktop.post;
  const desktopNote =
    desktop.info && !desktop.post ? " POST hangs (issue #29)" : "";
  const seeded = isSeeded() ? "seeded" : "not seeded";
  console.log(
    `desktop ${mark(desktopOk)} :${syncPort} ${desktopPids().length} procs, ${seeded}${desktopNote}`,
  );
  console.log(
    `metro   ${mark(metro)} :${metroPort} ${metroPids().length} procs`,
  );
  for (const surface of allSurfaces) {
    const serial = serials[surface];
    if (!serial) {
      console.log(`${surface.padEnd(7)} DOWN ${avds[surface]} not running`);
      continue;
    }
    const booted = await isBooted(serial);
    const app =
      booted && (await isInstalled(serial)) ? "app installed" : "app missing";
    console.log(`${surface.padEnd(7)} ${mark(booted)} ${serial} ${app}`);
  }
};

const down = async () => {
  await Promise.all([stopMetro(), stopDesktop()]);
  if (flags.has("--emulators")) await Promise.all(surfaces.map(stopEmulator));
  log("down");
};

const install = async () => {
  if (named.length !== 1) throw new Error("usage: install phone|tv");
  await installApp(named[0]);
};

const commands: Record<string, () => Promise<void>> = {
  up,
  pair,
  run: () => runFlows(rest.filter((arg) => !arg.startsWith("--"))),
  shot: () => shot(rest[0], rest.slice(1)),
  logs: () => followLogs(rest[0]),
  status,
  down,
  install,
};

const run = commands[command];
if (!run) {
  console.error(
    `usage: npm run verify -- ${Object.keys(commands).join("|")} [phone|tv] [flags]`,
  );
  process.exit(1);
}
run().catch((error: unknown) => {
  console.error(
    `[verify] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
