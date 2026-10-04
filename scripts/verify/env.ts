import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "../..");

/** The isolated desktop's user-data folder. Seeding wipes it, so run files live beside it. */
export const verifyDir = path.join(os.tmpdir(), "learnify-verify-desktop");
export const runDir = path.join(os.tmpdir(), "learnify-verify-run");

export const syncPort = 53318;
export const pairingCode = "VERFY234";
export const cdpPort = 9333;
/** Not 8081, so the verify Metro never fights the everyday `npm start`. */
export const metroPort = 8090;
export const emulatorDesktopUrl = `http://10.0.2.2:${syncPort}`;
export const appId = "com.learnifytube.mobile";

export const avds = { phone: "LearnifyPhone", tv: "LearnifyTV" } as const;
export type Surface = keyof typeof avds;
export const allSurfaces = Object.keys(avds) as Surface[];

const sdk =
  process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk");
const sdkTool = (relative: string, fallback: string) => {
  const full = path.join(sdk, relative);
  return fs.existsSync(full) ? full : fallback;
};
export const adbBin = sdkTool("platform-tools/adb", "adb");
export const emulatorBin = sdkTool("emulator/emulator", "emulator");

export const log = (message: string) => console.log(`[verify] ${message}`);
