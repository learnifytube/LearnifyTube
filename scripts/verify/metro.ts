import path from "node:path";
import { emulatorDesktopUrl, log, metroPort, repoRoot } from "./env";
import { killAll, pidsWithEnv, startDetached, tryFetch, waitFor } from "./proc";

export const metroPids = () => pidsWithEnv("LEARNIFY_VERIFY_METRO", "1");

export const metroHealthy = async () => {
  const response = await tryFetch(`http://127.0.0.1:${metroPort}/status`);
  return (
    !!response?.ok &&
    (await response.text()).includes("packager-status:running")
  );
};

export const stopMetro = async () => {
  const pids = metroPids();
  if (pids.length === 0) return;
  log(`stopping Metro (${pids.length} processes)`);
  await killAll(pids);
};

export const upMetro = async () => {
  if (await metroHealthy()) {
    log("Metro healthy, reusing");
    return;
  }
  await stopMetro();
  log(`starting Metro on ${metroPort}`);
  // No surface is forced: each emulator gets phone or TV from Platform.isTV.
  const { EXPO_PUBLIC_APP_SURFACE: _, ...env } = process.env;
  startDetached(
    "metro",
    `npx expo start -c --port ${metroPort}`,
    path.join(repoRoot, "apps/mobile"),
    {
      ...env,
      EXPO_PUBLIC_VERIFY_DESKTOP_URL: emulatorDesktopUrl,
      LEARNIFY_VERIFY_METRO: "1",
    },
  );
  await waitFor("Metro", metroHealthy, 120_000);
  log("Metro up");
};
