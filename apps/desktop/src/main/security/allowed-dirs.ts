import * as path from "path";

import { app } from "electron";
import { eq } from "drizzle-orm";

import defaultDb from "../../api/db";
import { userPreferences } from "../../api/db/schema";
import { logger } from "../../helpers/logger";

/**
 * Base directories from which the app is allowed to serve files to the renderer
 * (via the `local-file://` protocol and the local media HTTP server).
 *
 * The custom download directory is stored in the database, and the DB driver is
 * async, so the allowlist is cached in memory and refreshed explicitly at
 * startup and whenever the download path changes. The hot path
 * (`getAllowedBaseDirs`) stays synchronous.
 */

const getDefaultDownloadDir = (): string => path.join(app.getPath("downloads"), "LearnifyTube");

// Thumbnails and transcripts are streamed from here.
const getCacheDir = (): string => path.join(app.getPath("userData"), "cache");

const getStaticBaseDirs = (): string[] => [getDefaultDownloadDir(), getCacheDir()];

let cachedAllowedDirs: string[] | null = null;

/**
 * Returns the current allowlist. Falls back to the static directories if a
 * refresh has not run yet, so default-configuration users are always covered.
 */
export const getAllowedBaseDirs = (): string[] => cachedAllowedDirs ?? getStaticBaseDirs();

/**
 * Re-read the custom download path from the database and rebuild the allowlist.
 * Safe to call repeatedly; tolerant of DB errors (keeps the static dirs).
 */
export const refreshAllowedBaseDirs = async (): Promise<string[]> => {
  const dirs = new Set(getStaticBaseDirs());

  try {
    const rows = await defaultDb
      .select({ downloadPath: userPreferences.downloadPath })
      .from(userPreferences)
      .where(eq(userPreferences.id, "default"))
      .limit(1);

    const customPath = rows.length > 0 ? rows[0].downloadPath : null;
    if (customPath) {
      dirs.add(customPath);
    }
  } catch (error) {
    logger.warn("[allowed-dirs] Failed to read custom download path; using defaults", {
      error: String(error),
    });
  }

  cachedAllowedDirs = Array.from(dirs);
  logger.debug("[allowed-dirs] Allowlist refreshed", { dirs: cachedAllowedDirs });
  return cachedAllowedDirs;
};
