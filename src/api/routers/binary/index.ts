import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import { logger } from "@/helpers/logger";
import { ensureFfmpegStaticAvailable } from "@/utils/ffmpeg-static-helper";
import { app, net } from "electron";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync, execSync } from "child_process";
import {
  getDirectLatestDownloadUrl,
  getLatestReleaseApiUrl,
  getYtDlpAssetName,
} from "@/api/utils/ytdlp-utils/ytdlp-utils";
import { isYtDlpUpdateAvailable } from "@/api/utils/ytdlp-utils/version";
import {
  getFfmpegDownloadUrl,
  getFfmpegBinaryPathInArchive,
  requiresExtraction,
} from "@/api/utils/ffmpeg-utils/ffmpeg-utils";

// Zod schema for GitHub release API response (fault-tolerant)
const githubReleaseSchema = z
  .object({
    tag_name: z.string().optional().catch(undefined),
    assets: z
      .array(
        z.object({
          name: z.string().optional().catch(undefined),
          browser_download_url: z.string().optional().catch(undefined),
        })
      )
      .optional()
      .catch([]),
  })
  .passthrough();

const getBinDir = (): string => path.join(app.getPath("userData"), "bin");
const getVersionFilePath = (): string => path.join(getBinDir(), "yt-dlp-version.txt");
const getBinaryFilePath = (): string => path.join(getBinDir(), getYtDlpAssetName(process.platform));
const getUpdateCheckMetaPath = (): string => path.join(getBinDir(), "yt-dlp-update-check.json");

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// FFmpeg helper functions
const getFfmpegVersionFilePath = (): string => path.join(getBinDir(), "ffmpeg-version.txt");
const getFfmpegBinaryFilePath = (): string => {
  const platform = process.platform;
  if (platform === "win32") {
    return path.join(getBinDir(), "ffmpeg.exe");
  }
  return path.join(getBinDir(), "ffmpeg");
};

const ensureBinDir = (): void => {
  const dir = getBinDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const setExecutableIfNeeded = (filePath: string): void => {
  if (process.platform === "win32") return; // not needed
  try {
    fs.chmodSync(filePath, 0o755);
  } catch (e) {
    logger.error("[ytdlp] Failed to chmod binary", { error: String(e) });
  }
};

type DownloadResult = { ok: boolean; error?: string };

const pipeResponseToFile = (
  response: Electron.IncomingMessage,
  destinationPath: string,
  resolve: (result: DownloadResult) => void
): void => {
  const ws = fs.createWriteStream(destinationPath);
  let settled = false;
  const settle = (result: DownloadResult): void => {
    if (settled) return;
    settled = true;
    resolve(result);
  };

  ws.on("finish", () => settle({ ok: true }));
  ws.on("error", (error) => settle({ ok: false, error: String(error) }));
  response.on("data", (chunk) => ws.write(chunk));
  response.on("end", () => ws.end());
  response.on("error", (error) => {
    ws.destroy();
    settle({ ok: false, error: String(error) });
  });
};

const readVersionFromBinaryDetailed = (
  binPath: string,
  timeoutMs = 5000
): { version: string | null; timedOut: boolean; error?: string } => {
  try {
    if (!fs.existsSync(binPath)) {
      return { version: null, timedOut: false };
    }
    const out = execFileSync(binPath, ["--version"], {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
    }).trim();
    return { version: out || null, timedOut: false };
  } catch (e) {
    const error = String(e);
    const timedOut = /ETIMEDOUT/i.test(error);
    logger.warn("[ytdlp] Failed to read version from binary", { binPath, error, timedOut });
    return { version: null, timedOut, error };
  }
};

const readVersionFromBinary = (binPath: string): string | null =>
  readVersionFromBinaryDetailed(binPath).version;

const readInstalledVersion = (): string | null => {
  try {
    const versionFile = getVersionFilePath();
    if (fs.existsSync(versionFile)) {
      const stored = fs.readFileSync(versionFile, "utf8").trim();
      if (stored) return stored;
    }
    return null;
  } catch (e) {
    logger.error("[ytdlp] Failed to read version file", e);
    return null;
  }
};

const clearInstalledVersion = (): void => {
  try {
    const versionFile = getVersionFilePath();
    if (fs.existsSync(versionFile)) {
      fs.unlinkSync(versionFile);
    }
  } catch (e) {
    logger.warn("[ytdlp] Failed to clear version file", { error: String(e) });
  }
};

const writeInstalledVersion = (version: string): void => {
  try {
    fs.writeFileSync(getVersionFilePath(), version, "utf8");
  } catch (e) {
    logger.error("[ytdlp] Failed to write version file", e);
  }
};

const readLastUpdateCheckAt = (): number | null => {
  try {
    const filePath = getUpdateCheckMetaPath();
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "lastCheckedAt" in parsed &&
      typeof parsed.lastCheckedAt === "number" &&
      Number.isFinite(parsed.lastCheckedAt)
    ) {
      return parsed.lastCheckedAt;
    }
    return null;
  } catch (e) {
    logger.warn("[ytdlp] Failed to read update-check metadata", { error: String(e) });
    return null;
  }
};

const writeLastUpdateCheckAt = (timestamp: number): void => {
  try {
    fs.writeFileSync(
      getUpdateCheckMetaPath(),
      JSON.stringify({ lastCheckedAt: timestamp }, null, 2),
      "utf8"
    );
  } catch (e) {
    logger.warn("[ytdlp] Failed to persist update-check metadata", { error: String(e) });
  }
};

// FFmpeg version helpers
const readFfmpegInstalledVersion = (): string | null => {
  try {
    const p = getFfmpegVersionFilePath();
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf8").trim() || null;
    }
    return null;
  } catch (e) {
    logger.error("[ffmpeg] Failed to read version file", e);
    return null;
  }
};

const writeFfmpegInstalledVersion = (version: string): void => {
  try {
    fs.writeFileSync(getFfmpegVersionFilePath(), version, "utf8");
  } catch (e) {
    logger.error("[ffmpeg] Failed to write version file", e);
  }
};

// Extract archive (for Windows zip and Linux tar.xz)
const extractArchive = async (
  archivePath: string,
  extractTo: string,
  platform: NodeJS.Platform
): Promise<{ success: boolean; error?: string }> => {
  try {
    if (platform === "win32") {
      // For Windows, extract zip using PowerShell
      try {
        execSync(
          `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractTo}' -Force"`,
          { stdio: "ignore" }
        );
        return { success: true };
      } catch {
        // Fallback: try 7z if available
        try {
          execSync(`7z x "${archivePath}" -o"${extractTo}" -y`, { stdio: "ignore" });
          return { success: true };
        } catch {
          return {
            success: false,
            error: "No extraction tool available. Please install 7-Zip or use Windows 10+",
          };
        }
      }
    } else if (platform === "darwin") {
      // For macOS, extract zip using unzip (available by default)
      try {
        execSync(`unzip -q "${archivePath}" -d "${extractTo}"`, { stdio: "ignore" });
        return { success: true };
      } catch (e) {
        return {
          success: false,
          error: `Failed to extract zip: ${String(e)}`,
        };
      }
    } else if (platform === "linux") {
      // For Linux, extract tar.xz
      try {
        execSync(`tar -xf "${archivePath}" -C "${extractTo}"`, { stdio: "ignore" });
        return { success: true };
      } catch (e) {
        return {
          success: false,
          error: `Failed to extract tar.xz: ${String(e)}`,
        };
      }
    }
    return { success: false, error: "Unsupported platform for archive extraction" };
  } catch (e) {
    return { success: false, error: `Extraction error: ${String(e)}` };
  }
};

async function fetchLatestRelease(): Promise<{ version: string; assetUrl: string } | null> {
  try {
    const releaseRes = await fetch(getLatestReleaseApiUrl());
    if (!releaseRes.ok) {
      logger.error("[ytdlp] Failed to fetch latest release", { status: releaseRes.status });
      // Fallback to direct latest download URL without version
      return { version: "unknown", assetUrl: getDirectLatestDownloadUrl(process.platform) };
    }
    const json = githubReleaseSchema.parse(await releaseRes.json());
    const tag = (json.tag_name ?? "").replace(/^v/, "");
    const desiredAsset = getYtDlpAssetName(process.platform);
    const asset = json.assets?.find((a) => a.name === desiredAsset);
    const assetUrl = asset?.browser_download_url ?? getDirectLatestDownloadUrl(process.platform);
    return { version: tag || "unknown", assetUrl };
  } catch (e) {
    logger.error("[ytdlp] Exception fetching latest release", e);
    return { version: "unknown", assetUrl: getDirectLatestDownloadUrl(process.platform) };
  }
}

const installYtDlpFromRelease = async (
  latest: { version: string; assetUrl: string },
  binPath: string
): Promise<DownloadLatestResult> => {
  const tmpPath = path.join(os.tmpdir(), `yt-dlp-${Date.now()}`);

  logger.info("[ytdlp] Download starting", { url: latest.assetUrl });

  const result = await new Promise<DownloadResult>((resolve) => {
    let request: ReturnType<typeof net.request> | undefined;
    try {
      request = net.request({ method: "GET", url: latest.assetUrl });
    } catch (err) {
      logger.error("[ytdlp] net.request failed", err);
      return resolve({ ok: false, error: String(err) });
    }

    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const locationHeader = response.headers["location"] || response.headers["Location"];
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
        if (location) {
          logger.info("[ytdlp] Redirecting", { to: location });
          response.on("data", () => {});
          response.on("end", () => {
            // Follow one redirect by reissuing request
            const follow = net.request({ method: "GET", url: location });
            follow.on("response", (res2) => {
              if ((res2.statusCode ?? 0) >= 400) {
                logger.error("[ytdlp] Download failed after redirect", {
                  status: res2.statusCode,
                });
                res2.on("data", () => {});
                res2.on("end", () => resolve({ ok: false, error: `HTTP ${res2.statusCode}` }));
                return;
              }
              pipeResponseToFile(res2, tmpPath, resolve);
            });
            follow.on("error", (e) => resolve({ ok: false, error: String(e) }));
            follow.end();
          });
          return;
        }
      }

      if (status >= 400) {
        logger.error("[ytdlp] Download failed", { status });
        response.on("data", () => {});
        response.on("end", () => resolve({ ok: false, error: `HTTP ${status}` }));
        return;
      }

      pipeResponseToFile(response, tmpPath, resolve);
    });

    request.on("error", (e) => resolve({ ok: false, error: String(e) }));
    request.end();
  });

  if (!result.ok) {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    logger.error("[ytdlp] Download failed", { error: result.error });
    return { success: false as const, message: result.error ?? "Download failed" };
  }

  try {
    // Move tmp to bin path
    fs.copyFileSync(tmpPath, binPath);
    fs.unlinkSync(tmpPath);
    setExecutableIfNeeded(binPath);

    const versionProbe = readVersionFromBinaryDetailed(binPath, 20000);
    let detectedVersion = versionProbe.version;
    if (!detectedVersion && versionProbe.timedOut) {
      logger.warn("[ytdlp] Version probe timed out after install; accepting downloaded binary", {
        binPath,
        fallbackVersion: latest.version,
      });
      detectedVersion = latest.version || "unknown";
    }

    if (!detectedVersion) {
      if (fs.existsSync(binPath)) {
        fs.unlinkSync(binPath);
      }
      clearInstalledVersion();
      return {
        success: false as const,
        message: "Downloaded yt-dlp binary failed validation (not executable)",
      };
    }

    writeInstalledVersion(detectedVersion);
    writeLastUpdateCheckAt(Date.now());
    logger.info("[ytdlp] Installed", { binPath, version: detectedVersion });
    return {
      success: true as const,
      path: binPath,
      version: detectedVersion,
      alreadyInstalled: false as const,
    };
  } catch (e) {
    logger.error("[ytdlp] Failed to finalize installation", e);
    return { success: false as const, message: `Install error: ${String(e)}` };
  }
};

type EnsureYtDlpOptions = {
  forceCheckForUpdate?: boolean;
  forceInstall?: boolean;
};

type EnsureYtDlpResult = {
  installed: boolean;
  path: string | null;
  version: string | null;
  updated: boolean;
  updateCheckSkipped: boolean;
  message?: string;
};

let ensureYtDlpInFlight: Promise<EnsureYtDlpResult> | null = null;

export const ensureYtDlpBinaryReady = async (
  options: EnsureYtDlpOptions = {}
): Promise<EnsureYtDlpResult> => {
  if (ensureYtDlpInFlight) {
    return ensureYtDlpInFlight;
  }

  ensureYtDlpInFlight = (async (): Promise<EnsureYtDlpResult> => {
    ensureBinDir();
    const binPath = getBinaryFilePath();
    const hasBinary = fs.existsSync(binPath);
    const storedVersion = readInstalledVersion();
    const shouldProbeExistingBinary = hasBinary && !storedVersion;
    const existingVersionProbe = shouldProbeExistingBinary
      ? readVersionFromBinaryDetailed(binPath)
      : { version: storedVersion, timedOut: false };
    const detectedExistingVersion = existingVersionProbe.version ?? storedVersion;

    if (hasBinary && !detectedExistingVersion && !existingVersionProbe.timedOut) {
      logger.warn("[ytdlp] Existing binary is unusable; reinstalling", { binPath });
    }

    if (
      !hasBinary ||
      (!detectedExistingVersion && !existingVersionProbe.timedOut) ||
      options.forceInstall
    ) {
      const latest = await fetchLatestRelease();
      if (!latest) {
        return {
          installed: false,
          path: null,
          version: null,
          updated: false,
          updateCheckSkipped: false,
          message: "Failed to resolve latest yt-dlp",
        };
      }

      const install = await installYtDlpFromRelease(latest, binPath);
      if (!install.success) {
        return {
          installed: false,
          path: null,
          version: null,
          updated: false,
          updateCheckSkipped: false,
          message: install.message,
        };
      }

      return {
        installed: true,
        path: install.path,
        version: install.version,
        updated: !install.alreadyInstalled,
        updateCheckSkipped: false,
      };
    }

    const installedVersion = detectedExistingVersion ?? storedVersion;
    if (detectedExistingVersion && detectedExistingVersion !== storedVersion) {
      writeInstalledVersion(detectedExistingVersion);
    }

    const lastCheckedAt = readLastUpdateCheckAt();
    const now = Date.now();
    const updateCheckDue =
      options.forceCheckForUpdate ||
      lastCheckedAt === null ||
      now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;

    if (!updateCheckDue) {
      return {
        installed: true,
        path: binPath,
        version: installedVersion,
        updated: false,
        updateCheckSkipped: true,
      };
    }

    const latest = await fetchLatestRelease();
    writeLastUpdateCheckAt(now);
    if (!latest || !installedVersion) {
      return {
        installed: true,
        path: binPath,
        version: installedVersion,
        updated: false,
        updateCheckSkipped: false,
      };
    }

    const updateAvailable = isYtDlpUpdateAvailable(installedVersion, latest.version);
    if (!updateAvailable) {
      return {
        installed: true,
        path: binPath,
        version: installedVersion,
        updated: false,
        updateCheckSkipped: false,
      };
    }

    const install = await installYtDlpFromRelease(latest, binPath);
    if (!install.success) {
      logger.warn("[ytdlp] Update attempt failed; continuing with existing binary", {
        error: install.message,
      });
      return {
        installed: true,
        path: binPath,
        version: installedVersion,
        updated: false,
        updateCheckSkipped: false,
        message: install.message,
      };
    }

    return {
      installed: true,
      path: install.path,
      version: install.version,
      updated: true,
      updateCheckSkipped: false,
    };
  })();

  try {
    return await ensureYtDlpInFlight;
  } finally {
    ensureYtDlpInFlight = null;
  }
};

// Return types for binary router endpoints
type GetInstallInfoResult = {
  installed: boolean;
  version: string | null;
  path: string | null;
};

type ResolveLatestResult = {
  version: string;
  assetUrl: string;
} | null;

type DownloadLatestSuccess = {
  success: true;
  path: string;
  version: string;
  alreadyInstalled: boolean;
};

type DownloadLatestFailure = {
  success: false;
  message: string;
};

type DownloadLatestResult = DownloadLatestSuccess | DownloadLatestFailure;

export const binaryRouter = t.router({
  getInstallInfo: publicProcedure.query(async (): Promise<GetInstallInfoResult> => {
    try {
      const binPath = getBinaryFilePath();
      const installed = fs.existsSync(binPath);
      const version = installed ? readInstalledVersion() : null;
      return { installed, version, path: installed ? binPath : null };
    } catch (e) {
      logger.error("[ytdlp] getInstallInfo failed", e);
      return { installed: false, version: null, path: null };
    }
  }),

  resolveLatest: publicProcedure.query(async (): Promise<ResolveLatestResult> => {
    const info = await fetchLatestRelease();
    return info;
  }),

  /**
   * Check if yt-dlp update is available by comparing installed vs latest version
   */
  checkForUpdate: publicProcedure.query(
    async (): Promise<{
      updateAvailable: boolean;
      installedVersion: string | null;
      latestVersion: string | null;
    }> => {
      try {
        const binPath = getBinaryFilePath();
        const storedVersion = readInstalledVersion();
        const installedVersion = fs.existsSync(binPath)
          ? (storedVersion ?? readVersionFromBinary(binPath))
          : null;
        const latest = await fetchLatestRelease();

        if (!installedVersion || !latest) {
          return {
            updateAvailable: !installedVersion && !!latest,
            installedVersion,
            latestVersion: latest?.version ?? null,
          };
        }

        const updateAvailable = isYtDlpUpdateAvailable(installedVersion, latest.version);

        logger.info("[ytdlp] Update check result", {
          installedVersion,
          latestVersion: latest.version,
          updateAvailable,
        });

        return {
          updateAvailable,
          installedVersion,
          latestVersion: latest.version,
        };
      } catch (e) {
        logger.error("[ytdlp] checkForUpdate failed", e);
        return {
          updateAvailable: false,
          installedVersion: readInstalledVersion(),
          latestVersion: null,
        };
      }
    }
  ),

  downloadLatest: publicProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .mutation(async ({ input }): Promise<DownloadLatestResult> => {
      ensureBinDir();
      const binPath = getBinaryFilePath();
      const hadBinaryBefore = fs.existsSync(binPath);
      const ready = await ensureYtDlpBinaryReady({
        forceCheckForUpdate: input?.force === true,
      });

      if (!ready.installed || !ready.path) {
        return {
          success: false as const,
          message: ready.message ?? "Failed to install yt-dlp",
        };
      }

      logger.info("[ytdlp] ensureYtDlpBinaryReady result", {
        hadBinaryBefore,
        version: ready.version,
        updated: ready.updated,
        updateCheckSkipped: ready.updateCheckSkipped,
      });

      return {
        success: true as const,
        path: ready.path,
        version: ready.version ?? "unknown",
        alreadyInstalled: hadBinaryBefore && !ready.updated,
      };
    }),

  // FFmpeg procedures
  getFfmpegInstallInfo: publicProcedure.query(async (): Promise<GetInstallInfoResult> => {
    try {
      // 1. Check for downloaded FFmpeg in userData/bin
      const binPath = getFfmpegBinaryFilePath();
      if (fs.existsSync(binPath)) {
        const version = readFfmpegInstalledVersion();
        return { installed: true, version, path: binPath };
      }

      // 2. Ensure ffmpeg-static npm package is extracted to userData/bin
      const { path: staticPath, version: staticVersion } = ensureFfmpegStaticAvailable();
      logger.debug("[ffmpeg] ensureFfmpegStaticAvailable result", { staticPath, staticVersion });
      if (staticPath && fs.existsSync(staticPath)) {
        return { installed: true, version: staticVersion ?? null, path: staticPath };
      } else {
        logger.warn("[ffmpeg] ensureFfmpegStaticAvailable returned no path");
      }

      return { installed: false, version: null, path: null };
    } catch (e) {
      logger.error("[ffmpeg] getInstallInfo failed", e);
      return { installed: false, version: null, path: null };
    }
  }),

  downloadFfmpeg: publicProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .mutation(async ({ input }): Promise<DownloadLatestResult> => {
      ensureBinDir();
      const binPath = getFfmpegBinaryFilePath();
      if (fs.existsSync(binPath) && !input?.force) {
        const version = readFfmpegInstalledVersion();
        logger.info("[ffmpeg] Binary already installed", { binPath, version });
        return {
          success: true as const,
          path: binPath,
          version: version ?? "unknown",
          alreadyInstalled: true as const,
        };
      }

      const platform = process.platform;
      const downloadUrl = getFfmpegDownloadUrl(platform);
      const needsExtraction = requiresExtraction(platform);
      // Determine file extension based on platform
      let fileExt = "";
      if (needsExtraction) {
        if (platform === "win32" || platform === "darwin") {
          fileExt = ".zip";
        } else if (platform === "linux") {
          fileExt = ".tar.xz";
        }
      }
      const tmpPath = path.join(os.tmpdir(), `ffmpeg-${Date.now()}${fileExt}`);

      logger.info("[ffmpeg] Download starting", { url: downloadUrl, platform, needsExtraction });

      // Download the file
      const result = await new Promise<DownloadResult>((resolve) => {
        const request = net.request(downloadUrl);
        request.on("response", (response) => {
          if (response.statusCode !== 200) {
            resolve({ ok: false, error: `HTTP ${response.statusCode}` });
            return;
          }

          pipeResponseToFile(response, tmpPath, resolve);
        });

        request.on("error", (e) => resolve({ ok: false, error: String(e) }));
        request.end();
      });

      if (!result.ok) {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
        logger.error("[ffmpeg] Download failed", { error: result.error });
        return { success: false as const, message: result.error ?? "Download failed" };
      }

      try {
        if (needsExtraction) {
          // Extract archive
          const extractDir = path.join(os.tmpdir(), `ffmpeg-extract-${Date.now()}`);
          fs.mkdirSync(extractDir, { recursive: true });

          const extractResult = await extractArchive(tmpPath, extractDir, platform);
          if (!extractResult.success) {
            fs.unlinkSync(tmpPath);
            return { success: false as const, message: extractResult.error ?? "Extraction failed" };
          }

          // Find the ffmpeg binary in the extracted directory
          const binaryPathInArchive = getFfmpegBinaryPathInArchive(platform);
          const extractedBinaryPath = path.join(extractDir, binaryPathInArchive);

          if (!fs.existsSync(extractedBinaryPath)) {
            // Try to find it by searching
            const findBinary = (dir: string): string | null => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  const found = findBinary(fullPath);
                  if (found) return found;
                } else if (entry.name === "ffmpeg" || entry.name === "ffmpeg.exe") {
                  return fullPath;
                }
              }
              return null;
            };

            const foundPath = findBinary(extractDir);
            if (!foundPath) {
              fs.unlinkSync(tmpPath);
              return {
                success: false as const,
                message: "Could not find ffmpeg binary in archive",
              };
            }
            fs.copyFileSync(foundPath, binPath);
          } else {
            fs.copyFileSync(extractedBinaryPath, binPath);
          }

          // Cleanup
          fs.unlinkSync(tmpPath);
          fs.rmSync(extractDir, { recursive: true, force: true });
        } else {
          // No extraction needed (shouldn't happen with current implementation)
          fs.copyFileSync(tmpPath, binPath);
          fs.unlinkSync(tmpPath);
        }

        setExecutableIfNeeded(binPath);

        // Get version by running ffmpeg -version
        try {
          const versionOutput = execSync(`"${binPath}" -version`, {
            encoding: "utf8",
            timeout: 5000,
          });
          const versionMatch = versionOutput.match(/ffmpeg version (.+?)(?:\s|$)/);
          const version = versionMatch ? versionMatch[1] : "unknown";
          writeFfmpegInstalledVersion(version);
          logger.info("[ffmpeg] Installed", { binPath, version });
          return {
            success: true as const,
            path: binPath,
            version,
            alreadyInstalled: false as const,
          };
        } catch {
          // If version check fails, still mark as installed
          writeFfmpegInstalledVersion("unknown");
          logger.info("[ffmpeg] Installed (version check failed)", { binPath });
          return {
            success: true as const,
            path: binPath,
            version: "unknown",
            alreadyInstalled: false as const,
          };
        }
      } catch (e) {
        logger.error("[ffmpeg] Failed to finalize installation", e);
        return { success: false as const, message: `Install error: ${String(e)}` };
      }
    }),
});

export type BinaryRouter = typeof binaryRouter;

// Export utilities for use by other routers
export { getBinaryFilePath, getFfmpegBinaryFilePath };
