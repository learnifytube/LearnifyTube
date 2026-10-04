import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  adbBin,
  appId,
  avds,
  emulatorBin,
  log,
  metroPort,
  repoRoot,
  type Surface,
} from "./env";
import { sh, startDetached, waitFor } from "./proc";

const adb = (serial: string, ...args: string[]) =>
  sh(adbBin, ["-s", serial, ...args]);

/** Serial of the running emulator for each surface, found by asking each emulator its AVD name. */
export const emulatorSerials = async () => {
  const serials = (await sh(adbBin, ["devices"]))
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(
      ([serial, state]) => serial.startsWith("emulator-") && state === "device",
    )
    .map(([serial]) => serial);
  const found: Partial<Record<Surface, string>> = {};
  for (const serial of serials) {
    const name = (await adb(serial, "emu", "avd", "name").catch(() => ""))
      .split("\n")[0]
      .trim();
    const surface = (Object.keys(avds) as Surface[]).find(
      (s) => avds[s] === name,
    );
    if (surface) found[surface] = serial;
  }
  return found;
};

export const isBooted = async (serial: string) =>
  (await adb(serial, "shell", "getprop", "sys.boot_completed").catch(
    () => "",
  )) === "1";

export const isInstalled = async (serial: string) =>
  (await adb(serial, "shell", "pm", "path", appId).catch(() => "")).startsWith(
    "package:",
  );

export const upEmulator = async (surface: Surface, headless: boolean) => {
  let serial = (await emulatorSerials())[surface];
  if (!serial) {
    log(`booting ${avds[surface]}${headless ? " (headless)" : ""}`);
    const flags = headless ? " -no-window -no-audio" : "";
    startDetached(
      `emulator-${surface}`,
      `"${emulatorBin}" -avd ${avds[surface]}${flags}`,
      repoRoot,
      {
        ...process.env,
        LEARNIFY_VERIFY_EMULATOR: surface,
      },
    );
    await waitFor(
      avds[surface],
      async () => {
        serial = (await emulatorSerials())[surface];
        return !!serial && (await isBooted(serial));
      },
      300_000,
    );
  } else {
    await waitFor(avds[surface], () => isBooted(serial!), 300_000);
  }
  log(`${surface} emulator ${serial} booted`);
  return serial!;
};

export const installHint = (surface: Surface) =>
  `npm run verify -- install ${surface}`;

/**
 * Debug builds bake in 10.0.2.2:8081, which `adb reverse` cannot redirect, so
 * set React Native's dev-server setting (Dev Menu → Change bundle location).
 */
const pointAtMetro = async (serial: string) => {
  const prefs = `shared_prefs/${appId}_preferences.xml`;
  const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes" ?><map><string name="debug_http_host">10.0.2.2:${metroPort}</string></map>`;
  await adb(
    serial,
    "shell",
    `run-as ${appId} sh -c 'mkdir -p shared_prefs && echo "${xml.replaceAll('"', '\\"')}" > ${prefs}'`,
  );
};

/** `pm clear` resets runtime permissions; a prompt would cover the app and block flows. */
const grantRuntimePermissions = async (serial: string) => {
  const dump = await adb(serial, "shell", "dumpsys", "package", appId);
  const permissions = new Set(
    [...dump.matchAll(/(android\.permission\.[A-Z_]+): granted=false/g)].map(
      (match) => match[1],
    ),
  );
  for (const permission of permissions) {
    await adb(serial, "shell", "pm", "grant", appId, permission).catch(
      () => {},
    );
  }
};

/** Points the app at the verify Metro and launches it fresh. */
export const prepareApp = async (
  surface: Surface,
  serial: string,
  fresh: boolean,
) => {
  if (!(await isInstalled(serial))) {
    throw new Error(
      `${appId} is not installed on ${serial}; run: ${installHint(surface)}`,
    );
  }
  await adb(serial, "shell", "am", "force-stop", appId);
  if (fresh) {
    log(`${surface}: clearing app data`);
    await adb(serial, "shell", "pm", "clear", appId);
    await grantRuntimePermissions(serial);
  }
  await pointAtMetro(serial);
  // `monkey` lands on the TV's FallbackHome; start the activity by name.
  await adb(
    serial,
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    `${appId}/.MainActivity`,
  );
  log(`${surface}: app launched`);
};

/** Builds and installs the debug app; the only command that builds. */
export const installApp = async (surface: Surface) => {
  const serial = await upEmulator(surface, false);
  log(`building and installing on ${serial} (slow)`);
  execFileSync(
    "npx",
    ["expo", "run:android", "--device", avds[surface], "--no-bundler"],
    {
      cwd: path.join(repoRoot, "apps/mobile"),
      stdio: "inherit",
    },
  );
};

export const stopEmulator = async (surface: Surface) => {
  const serial = (await emulatorSerials())[surface];
  if (!serial) return;
  log(`shutting down ${avds[surface]} (${serial})`);
  await adb(serial, "emu", "kill");
};
