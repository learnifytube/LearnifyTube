import { spawn } from "child_process";
import { app } from "electron";
import path from "path";
import { requireQueueManager } from "./queue-manager";
import { requireOptimizationQueueManager } from "@/services/optimization-queue/queue-manager";
import type { TargetResolution } from "@/services/optimization-queue/types";
import type { Database } from "@/api/db";
import type { WorkerState } from "./types";
import fs from "fs";
import { logger } from "@/helpers/logger";
import { ensureFfmpegStaticAvailable } from "@/utils/ffmpeg-static-helper";
import { ensureYtDlpBinaryReady } from "@/api/routers/binary";
import { userPreferences } from "@/api/db/schema";
import { eq } from "drizzle-orm";
import {
  type DownloadQuality,
  YT_DLP_COOKIE_BROWSERS,
  type YtDlpCookiesBrowser,
} from "@/lib/types/user-preferences";
import {
  type FallbackState,
  getPlayerClient,
  getFormatString as getFallbackFormatString,
  FORMAT_STRATEGIES,
} from "./fallback-strategy";

/**
 * Active download workers
 * Maps download ID to worker state
 */
const activeWorkers = new Map<string, WorkerState>();
const COOKIE_BROWSER_SET = new Set<string>(YT_DLP_COOKIE_BROWSERS);

/**
 * Determine error type based on captured stderr error message
 */
const determineErrorType = (stderrError: string | undefined): string => {
  if (!stderrError) return "process_error";
  const lowerError = stderrError.toLowerCase();

  if (lowerError.includes("http error 403")) return "http_403_forbidden";
  if (lowerError.includes("http error 429")) return "http_429_rate_limited";
  if (lowerError.includes("http error")) return "http_error";
  if (lowerError.includes("ffmpeg")) return "ffmpeg_missing";
  if (
    lowerError.includes("sign in") ||
    lowerError.includes("sign-in") ||
    lowerError.includes("age-restricted") ||
    lowerError.includes("age verification") ||
    lowerError.includes("authentication") ||
    lowerError.includes("not a bot") ||
    lowerError.includes("cookies-from-browser") ||
    lowerError.includes("use --cookies")
  ) {
    return "auth_required";
  }

  return "process_error";
};

/**
 * Extract codec information from yt-dlp format details
 */
const extractCodecInfo = (
  formatDetails: string
): { videoCodec: string | null; audioCodec: string | null } => {
  let videoCodec: string | null = null;
  let audioCodec: string | null = null;

  // Try to extract codec from format details
  // Common patterns: "avc1", "h264", "h265", "hevc", "vp8", "vp9", "av01"
  const codecPatterns = [
    /(avc1\.\d+[a-z0-9]+)/i, // avc1.42E01E (H.264)
    /(h\.?264)/i, // H.264
    /(h\.?265|hevc)/i, // H.265/HEVC
    /(vp8)/i, // VP8
    /(vp9)/i, // VP9
    /(av01)/i, // AV1
    /(avc)/i, // AVC (generic)
  ];

  for (const pattern of codecPatterns) {
    const match = formatDetails.match(pattern);
    if (match) {
      videoCodec = match[1];
      break;
    }
  }

  // Extract audio codec
  const audioCodecPatterns = [/(aac)/i, /(opus)/i, /(vorbis)/i, /(mp3)/i];

  for (const pattern of audioCodecPatterns) {
    const match = formatDetails.match(pattern);
    if (match) {
      audioCodec = match[1];
      break;
    }
  }

  return { videoCodec, audioCodec };
};

/**
 * Process and log format information from yt-dlp output
 */
const processFormatInfo = (
  formatMatch: RegExpMatchArray,
  downloadId: string,
  videoId: string | null
): void => {
  const formatDescription = formatMatch[2];
  const formatDetails = formatMatch[3] || "";

  // Extract resolution/height from format description (e.g., "1080p", "720p", "4K")
  const resolutionMatch = formatDescription.match(/(\d+)p|(\d+)x(\d+)|(\d+)K/i);
  let resolution: string | null = null;
  if (resolutionMatch) {
    if (resolutionMatch[1]) {
      resolution = `${resolutionMatch[1]}p`;
    } else if (resolutionMatch[2] && resolutionMatch[3]) {
      resolution = `${resolutionMatch[2]}x${resolutionMatch[3]}`;
    } else if (resolutionMatch[4]) {
      resolution = `${resolutionMatch[4]}K`;
    }
  }

  // Detect if MP4 was selected (should be rare with WebM-first strategy)
  const isMp4 =
    formatDescription.toLowerCase().includes("mp4") || formatDetails.toLowerCase().includes("mp4");
  const isWebm =
    formatDescription.toLowerCase().includes("webm") ||
    formatDetails.toLowerCase().includes("webm");

  // Extract codec information from format details
  const { videoCodec, audioCodec } = extractCodecInfo(formatDetails);

  // Check if H.265/HEVC was detected (problematic for Chromium)
  const isH265 =
    videoCodec &&
    (videoCodec.toLowerCase().includes("h265") || videoCodec.toLowerCase().includes("hevc"));
  const isH264 =
    videoCodec &&
    (videoCodec.toLowerCase().includes("h264") ||
      videoCodec.toLowerCase().includes("avc1") ||
      videoCodec.toLowerCase().includes("avc"));

  logger.info("[download-worker] yt-dlp format info with codec detection", {
    downloadId,
    videoId,
    formatId: formatMatch[1],
    formatDescription,
    formatDetails,
    resolution,
    videoCodec: videoCodec || "unknown",
    audioCodec: audioCodec || "unknown",
    format: isWebm ? "WebM" : isMp4 ? "MP4" : "Unknown",
    codecCompatibility: isH265
      ? "⚠️ H.265/HEVC - NOT supported in Chromium"
      : isH264
        ? "✅ H.264/AVC1 - supported in Chromium"
        : isWebm
          ? "✅ WebM - fully supported in Chromium"
          : "❓ Unknown codec compatibility",
    note:
      isMp4 && isH265
        ? "⚠️ MP4 with H.265/HEVC selected - will NOT play in Chromium!"
        : isMp4
          ? "⚠️ MP4 selected - WebM may not be available for this video"
          : resolution
            ? `Selected resolution: ${resolution}`
            : undefined,
  });

  if (isMp4 && isH265) {
    logger.error("[download-worker] H.265/HEVC codec detected in MP4 - playback will fail", {
      downloadId,
      videoId,
      formatId: formatMatch[1],
      formatDescription,
      videoCodec,
      note: "H.265/HEVC is NOT supported in Chromium. This file will not play. WebM should be preferred.",
    });
  } else if (isMp4) {
    logger.warn("[download-worker] MP4 format selected instead of WebM", {
      downloadId,
      videoId,
      formatId: formatMatch[1],
      formatDescription,
      videoCodec: videoCodec || "unknown",
      note: "MP4 selected. If playback fails, check if codec is H.264/AVC1 (supported) or H.265/HEVC (not supported).",
    });
  }
};

/**
 * Get download quality preference from database
 */
const getDownloadQuality = async (db: Database): Promise<DownloadQuality> => {
  try {
    const rows = await db
      .select({ customizationSettings: userPreferences.customizationSettings })
      .from(userPreferences)
      .where(eq(userPreferences.id, "default"))
      .limit(1);

    if (rows.length > 0 && rows[0].customizationSettings) {
      const settings: unknown = JSON.parse(rows[0].customizationSettings);
      if (
        typeof settings === "object" &&
        settings !== null &&
        "download" in settings &&
        typeof settings.download === "object" &&
        settings.download !== null &&
        "downloadQuality" in settings.download
      ) {
        const quality = settings.download.downloadQuality;
        if (quality === "360p" || quality === "480p" || quality === "720p" || quality === "1080p") {
          return quality;
        }
      }
    }
  } catch (error) {
    logger.warn("[download-worker] Failed to read download quality preference", { error });
  }
  return "480p"; // Default for learning apps
};

const isYtDlpCookiesBrowser = (value: unknown): value is YtDlpCookiesBrowser => {
  return typeof value === "string" && COOKIE_BROWSER_SET.has(value);
};

const getCookiesFromBrowserPreference = async (db: Database): Promise<YtDlpCookiesBrowser> => {
  try {
    const rows = await db
      .select({ customizationSettings: userPreferences.customizationSettings })
      .from(userPreferences)
      .where(eq(userPreferences.id, "default"))
      .limit(1);

    if (rows.length > 0 && rows[0].customizationSettings) {
      const settings: unknown = JSON.parse(rows[0].customizationSettings);
      if (
        typeof settings === "object" &&
        settings !== null &&
        "download" in settings &&
        typeof settings.download === "object" &&
        settings.download !== null &&
        "cookiesFromBrowser" in settings.download
      ) {
        const browser = settings.download.cookiesFromBrowser;
        if (isYtDlpCookiesBrowser(browser)) {
          return browser;
        }
      }
    }
  } catch (error) {
    logger.warn("[download-worker] Failed to read cookie browser preference", { error });
  }
  return "none";
};

/**
 * Map download quality preference to optimization target resolution
 */
const getOptimizationTargetResolution = (quality: DownloadQuality): TargetResolution => {
  const resolutionMap: Record<DownloadQuality, TargetResolution> = {
    "360p": "480p", // Keep original if already small
    "480p": "480p",
    "720p": "720p",
    "1080p": "720p", // Downscale 1080p to 720p for optimization
  };
  return resolutionMap[quality];
};

/**
 * Auto-optimization threshold in bytes (100 MB)
 */
const AUTO_OPTIMIZATION_THRESHOLD = 100 * 1024 * 1024;

/**
 * Get ffmpeg binary path (bundled, from ffmpeg-static, or downloaded)
 * Priority: 1. Bundled with app, 2. ffmpeg-static npm package, 3. Downloaded to userData/bin
 */
const getFfmpegPath = (): string | null => {
  const platform = process.platform;
  const isDev = !app.isPackaged;

  // 1. Check bundled version (from resources/bin when packaged, or assets/bin in dev)
  let bundledPath: string;
  if (isDev) {
    // Development: check assets/bin from project root
    // __dirname is .vite/build/services/download-queue, so go up to project root
    const rootDir = path.resolve(path.join(__dirname, "..", "..", "..", ".."));
    bundledPath = path.join(
      rootDir,
      "assets",
      "bin",
      platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    );
  } else {
    // Production: check resources/bin (from extraResource: "./assets/bin" -> "bin" in resourcesPath)
    bundledPath = path.join(
      process.resourcesPath,
      "bin",
      platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    );
  }

  if (fs.existsSync(bundledPath)) {
    logger.debug("[download-worker] Using bundled ffmpeg", { path: bundledPath });
    return bundledPath;
  }

  // 2. Ensure ffmpeg-static npm package is extracted to userData/bin
  const { path: staticPath, version: staticVersion } = ensureFfmpegStaticAvailable();
  logger.debug("[download-worker] ensureFfmpegStaticAvailable result", {
    staticPath,
    staticVersion,
  });
  if (staticPath && fs.existsSync(staticPath)) {
    logger.debug("[download-worker] Using ffmpeg-static copy", {
      path: staticPath,
      version: staticVersion,
    });
    return staticPath;
  } else {
    logger.warn("[download-worker] ffmpeg-static copy not available");
  }

  // 3. Check downloaded version (from userData/bin)
  const binDir = path.join(app.getPath("userData"), "bin");
  const downloadedPath = path.join(binDir, platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

  if (fs.existsSync(downloadedPath)) {
    logger.debug("[download-worker] Using downloaded ffmpeg", { path: downloadedPath });
    return downloadedPath;
  }

  return null;
};

/**
 * Spawn a download worker for a queued item
 */
export const spawnDownload = async (
  db: Database,
  downloadId: string,
  videoId: string | null,
  url: string,
  format: string | null,
  outputPath: string,
  fallbackState?: FallbackState
): Promise<void> => {
  try {
    // Check if already downloading
    if (activeWorkers.has(downloadId)) {
      logger.warn(`Download already active`, { downloadId });
      return;
    }

    // Status will be updated by queue manager before calling this function

    // Ensure yt-dlp exists and is periodically refreshed before each download
    const ytDlpReady = await ensureYtDlpBinaryReady();
    if (!ytDlpReady.installed || !ytDlpReady.path) {
      throw new Error(ytDlpReady.message ?? "yt-dlp binary is not available");
    }
    const ytDlpPath = ytDlpReady.path;

    logger.info("[download-worker] yt-dlp readiness check", {
      downloadId,
      videoId,
      path: ytDlpPath,
      version: ytDlpReady.version,
      updated: ytDlpReady.updated,
      updateCheckSkipped: ytDlpReady.updateCheckSkipped,
      warning: ytDlpReady.message,
    });

    // Get ffmpeg path if available
    const ffmpegPath = getFfmpegPath();

    // Determine player client from fallback state (defaults to 'android' at index 0)
    const playerClientIndex = fallbackState?.playerClientIndex ?? 0;
    const fallbackAttempt = fallbackState?.fallbackAttempts ?? 0;
    const configuredCookiesFromBrowser = await getCookiesFromBrowserPreference(db);
    const useCookies = configuredCookiesFromBrowser !== "none" && fallbackAttempt === 0;
    const cookiesFromBrowser = useCookies ? configuredCookiesFromBrowser : "none";
    const playerClient = getPlayerClient(playerClientIndex);

    if (configuredCookiesFromBrowser !== "none" && !useCookies) {
      logger.info("[download-worker] Disabling browser cookies for fallback attempt", {
        downloadId,
        videoId,
        configuredCookiesFromBrowser,
        fallbackAttempt,
        reason:
          "Previous attempt failed; retrying without cookies to recover missing format errors",
      });
    }

    // Build yt-dlp command arguments
    const args = [
      url,
      "--newline", // Output progress on new lines
      "--no-playlist", // Don't download playlists
      "-o",
      outputPath,
      // Ensure proper merging when separate video+audio streams are downloaded
      // Note: Since we now prefer single-file formats, merging should be rare
      "--no-mtime", // Don't set file modification time (avoids merge issues)
      // Use dynamic player client based on fallback state
      // Default is 'android' to avoid SABR streaming issues
      // See: https://github.com/yt-dlp/yt-dlp/issues/12482
      "--extractor-args",
      `youtube:player_client=${playerClient}`,
    ];

    if (cookiesFromBrowser !== "none") {
      args.push("--cookies-from-browser", cookiesFromBrowser);
      logger.info("[download-worker] Using browser cookies for YouTube authentication", {
        downloadId,
        videoId,
        cookiesFromBrowser,
      });
    }

    // Add ffmpeg location if available (enables merging of separate streams)
    if (ffmpegPath) {
      args.push("--ffmpeg-location", ffmpegPath);
      logger.info("[download-worker] Using bundled ffmpeg for merging", {
        downloadId,
        videoId,
        ffmpegPath,
      });
    } else {
      logger.warn("[download-worker] ffmpeg not found - merging will fail if needed", {
        downloadId,
        videoId,
        note: "ffmpeg will be auto-downloaded on next app start",
      });
    }

    // Determine format strategy from fallback state
    const formatStrategyIndex = fallbackState?.formatStrategyIndex ?? 0;
    const formatStrategy = FORMAT_STRATEGIES[formatStrategyIndex];

    // Add format if specified, otherwise use quality preference from settings with fallback strategy
    let selectedFormat: string;
    if (format) {
      selectedFormat = format;
      args.push("-f", format);
      logger.info("[download-worker] Using user-specified format", {
        downloadId,
        videoId,
        format: selectedFormat,
      });
    } else {
      // Get download quality from user preferences (defaults to 480p for learning apps)
      const quality = await getDownloadQuality(db);
      selectedFormat = getFallbackFormatString(formatStrategy, quality);
      args.push("-f", selectedFormat);
      logger.info(
        "[download-worker] Using quality preference from settings with fallback strategy",
        {
          downloadId,
          videoId,
          quality,
          formatStrategy,
          playerClient,
          cookiesFromBrowser,
          preferredFormat: selectedFormat,
          fallbackAttempt: fallbackState?.fallbackAttempts ?? 0,
          note: `${formatStrategy} strategy at ${quality} with ${playerClient} client`,
        }
      );
    }

    // Log full command for debugging
    logger.info("[download-worker] Starting yt-dlp download", {
      downloadId,
      videoId,
      url,
      ytDlpPath,
      outputPath,
      format: selectedFormat,
      playerClient,
      configuredCookiesFromBrowser,
      cookiesFromBrowser,
      useCookies,
      formatStrategy,
      fallbackAttempt,
      maxFallbackAttempts: fallbackState?.maxFallbackAttempts ?? 10,
      fullCommand: `${ytDlpPath} ${args.join(" ")}`,
    });

    // Spawn yt-dlp process
    const process = spawn(ytDlpPath, args);

    // Store worker state
    const worker: WorkerState = {
      downloadId,
      process,
      startTime: Date.now(),
      lastProgressUpdate: Date.now(),
      lastKnownFilePath: undefined,
      outputDir: path.dirname(outputPath),
      videoId,
      lastStderrError: undefined,
      stderrBuffer: [],
    };
    activeWorkers.set(downloadId, worker);

    // Store format in closure for completion logging
    const formatUsed = selectedFormat;

    // Handle stdout - parse progress and file path
    process.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();

      // Log format selection messages
      if (output.includes("[info]") || output.includes("format")) {
        logger.debug("[download-worker] yt-dlp info output", { downloadId, videoId, output });
      }

      // Check for format selection - multiple patterns
      // Pattern 1: [info] 123: format description (details)
      const formatMatch = output.match(/\[info\]\s+(\d+):\s+(.+?)(?:\s+\((.+?)\))?/);
      if (formatMatch) {
        processFormatInfo(formatMatch, downloadId, videoId);
      }

      // Pattern 2: [info] Available formats for...
      if (output.includes("Available formats")) {
        logger.debug("[download-worker] yt-dlp listing available formats", {
          downloadId,
          videoId,
          output: output.trim(),
        });
      }

      // Pattern 3: [info] Selecting format... or [download] Downloading format...
      if (
        output.includes("Selecting format") ||
        output.includes("format selected") ||
        output.includes("Downloading format")
      ) {
        logger.info("[download-worker] yt-dlp format selection/start", {
          downloadId,
          videoId,
          output: output.trim(),
        });

        // Try to extract the actual format ID being downloaded
        const downloadingFormatMatch = output.match(/Downloading format\s+(\d+)/i);
        if (downloadingFormatMatch) {
          logger.info("[download-worker] yt-dlp downloading specific format ID", {
            downloadId,
            videoId,
            formatId: downloadingFormatMatch[1],
            output: output.trim(),
          });
        }
      }

      // Pattern 4: [info] Downloading X format(s): 123+456-789 (video+audio merge)
      const downloadingFormatsMatch = output.match(
        /\[info\].*Downloading\s+(\d+)\s+format\(s\):\s+(.+)/
      );
      if (downloadingFormatsMatch) {
        const formatCount = downloadingFormatsMatch[1];
        const formatIds = downloadingFormatsMatch[2].trim();
        const isMerging = formatIds.includes("+") || formatIds.includes("-");
        logger.info("[download-worker] yt-dlp downloading formats", {
          downloadId,
          videoId,
          formatCount: parseInt(formatCount, 10),
          formatIds,
          isMerging,
          note: isMerging
            ? "Downloading separate video+audio streams (will be merged)"
            : "Downloading single format file",
        });
      }

      // Check for audio-only warnings
      if (
        output.toLowerCase().includes("audio only") ||
        output.toLowerCase().includes("audio-only")
      ) {
        logger.warn("[download-worker] Audio-only format detected", {
          downloadId,
          videoId,
          output: output.trim(),
        });
      }

      // Check for video+audio merging
      if (output.includes("[Merger]") || output.includes("Merging formats")) {
        logger.info("[download-worker] yt-dlp merging video+audio", {
          downloadId,
          videoId,
          output: output.trim(),
        });
      }

      // Check for merge completion
      if (
        output.includes("has already been downloaded") ||
        output.includes("Deleting original file")
      ) {
        logger.debug("[download-worker] yt-dlp post-merge cleanup", {
          downloadId,
          videoId,
          output: output.trim(),
        });
      }

      // Check for merge errors or warnings
      if (
        output.toLowerCase().includes("error merging") ||
        output.toLowerCase().includes("merge failed") ||
        output.toLowerCase().includes("could not merge")
      ) {
        logger.error("[download-worker] yt-dlp merge error detected", {
          downloadId,
          videoId,
          output: output.trim(),
        });
      }

      parseProgressAndMetadata(db, downloadId, output);
    });

    // Handle stderr - log errors and warnings
    process.stderr?.on("data", (data: Buffer) => {
      const errorOutput = data.toString();
      const trimmedOutput = errorOutput.trim();

      // Store stderr in buffer for debugging
      const currentWorker = activeWorkers.get(downloadId);
      if (currentWorker?.stderrBuffer) {
        currentWorker.stderrBuffer.push(trimmedOutput);
        // Keep last 20 lines
        if (currentWorker.stderrBuffer.length > 20) {
          currentWorker.stderrBuffer.shift();
        }
      }

      // Log all stderr output for debugging format issues
      logger.info("[download-worker] yt-dlp stderr output", {
        downloadId,
        videoId,
        output: trimmedOutput,
      });

      // Capture HTTP errors (403, 429, etc.) for better error reporting
      const httpErrorMatch = errorOutput.match(/HTTP Error (\d+):\s*(.+)/i);
      if (httpErrorMatch) {
        const httpCode = httpErrorMatch[1];
        const httpMessage = httpErrorMatch[2].trim();

        if (currentWorker) {
          currentWorker.lastStderrError = `HTTP Error ${httpCode}: ${httpMessage}`;
        }

        logger.error("[download-worker] HTTP error from YouTube", {
          downloadId,
          videoId,
          httpStatusCode: httpCode,
          httpMessage,
          fullError: trimmedOutput,
          possibleCauses:
            httpCode === "403"
              ? [
                  "Video may be geo-restricted or region-locked",
                  "Video may require age verification/sign-in",
                  "YouTube may be rate-limiting requests",
                  "Selected format may no longer be available",
                  "Video URL/token may have expired (try re-adding the video)",
                  "YouTube may have changed their API (try updating yt-dlp)",
                ]
              : httpCode === "429"
                ? [
                    "Too many requests - YouTube rate limiting",
                    "Wait a few minutes before retrying",
                  ]
                : httpCode === "404"
                  ? ["Video not found or has been deleted", "Video ID may be incorrect"]
                  : ["Unknown HTTP error - check YouTube status"],
          recommendations:
            httpCode === "403"
              ? [
                  "Try updating yt-dlp to latest version",
                  "Try a different quality/format setting",
                  "Try using a VPN if geo-restricted",
                  "Wait and retry - may be temporary",
                ]
              : ["Wait and retry the download"],
        });
      }

      // Capture generic ERROR lines
      if (errorOutput.includes("ERROR:") && currentWorker && !currentWorker.lastStderrError) {
        const errorMatch = errorOutput.match(/ERROR:\s*(.+)/);
        if (errorMatch) {
          currentWorker.lastStderrError = errorMatch[1].trim();
        }
      }

      // CRITICAL: Check for missing ffmpeg (prevents merging, results in incomplete downloads)
      if (
        errorOutput.toLowerCase().includes("ffmpeg is not installed") ||
        errorOutput.toLowerCase().includes("ffmpeg not found") ||
        (errorOutput.toLowerCase().includes("merging") &&
          errorOutput.toLowerCase().includes("ffmpeg") &&
          errorOutput.toLowerCase().includes("not"))
      ) {
        if (currentWorker) {
          currentWorker.lastStderrError = "ffmpeg not installed - cannot merge video+audio streams";
        }
        logger.error("[download-worker] CRITICAL: ffmpeg is not installed - merging will fail", {
          downloadId,
          videoId,
          message: trimmedOutput,
          impact:
            "Download will only save one file (usually audio-only). Video file will be lost. Install ffmpeg or use single-file formats only.",
          recommendation:
            "Install ffmpeg or adjust format preference to avoid formats requiring merging (bestvideo+bestaudio)",
        });
      }

      // Check for format-related errors
      if (
        errorOutput.toLowerCase().includes("format") ||
        errorOutput.toLowerCase().includes("codec") ||
        errorOutput.toLowerCase().includes("not available")
      ) {
        logger.warn("[download-worker] Format-related message in stderr", {
          downloadId,
          videoId,
          message: trimmedOutput,
        });
      }

      // Check for sign-in required
      if (
        errorOutput.toLowerCase().includes("sign in") ||
        errorOutput.toLowerCase().includes("not a bot") ||
        errorOutput.toLowerCase().includes("login") ||
        errorOutput.toLowerCase().includes("age-restricted") ||
        errorOutput.toLowerCase().includes("cookies-from-browser")
      ) {
        const authMessage =
          cookiesFromBrowser === "none"
            ? "YouTube requires sign-in verification. In Settings > System > YouTube Authentication, select a browser cookie source, then retry."
            : `YouTube requires sign-in verification. Make sure you are logged into YouTube in ${cookiesFromBrowser}, then retry.`;

        if (currentWorker) {
          currentWorker.lastStderrError = authMessage;
        }
        logger.error("[download-worker] Video requires authentication", {
          downloadId,
          videoId,
          message: trimmedOutput,
          cookiesFromBrowser,
          recommendation: authMessage,
        });
      }
    });

    // Handle process completion
    process.on("close", async (code: number | null) => {
      activeWorkers.delete(downloadId);

      if (code === 0) {
        // Success
        const queueManager = requireQueueManager();
        // Determine final path: prefer parsed, else search by [videoId]
        const w = worker;
        let finalPath: string | null = w.lastKnownFilePath ?? null;
        if (!finalPath && w.videoId && w.outputDir && fs.existsSync(w.outputDir)) {
          try {
            const files = fs.readdirSync(w.outputDir);
            const matches = files.filter((f) => f.includes(`[${w.videoId}]`));

            // Check for multiple files (indicates failed merge)
            if (matches.length > 1) {
              logger.warn(
                "[download-worker] Multiple files found for video - merge may have failed",
                {
                  downloadId,
                  videoId,
                  fileCount: matches.length,
                  files: matches,
                  note: "yt-dlp may have downloaded separate video/audio files without merging",
                }
              );
            }

            // Prefer files without format codes (merged files) over format-specific files
            const mergedFile = matches.find((f) => !f.match(/\.f\d+\./));
            const match = mergedFile || matches[0];
            if (match) finalPath = path.join(w.outputDir, match);
          } catch {
            // Ignore file system errors when searching for video file
          }
        }
        const completedPath = finalPath || outputPath;
        await queueManager.markCompleted(downloadId, completedPath);

        // Log file details for debugging format issues
        let fileExtension: string | null = null;
        let fileSize: number | null = null;
        let fileExists = false;

        if (completedPath && fs.existsSync(completedPath)) {
          fileExists = true;
          fileExtension = path.extname(completedPath).toLowerCase();
          try {
            const stats = fs.statSync(completedPath);
            fileSize = stats.size;
          } catch {
            // Ignore stat errors
          }
        }

        // Detect if file has format code (indicates unmerged file from separate streams)
        const hasFormatCode = completedPath && /\.f\d+\./.test(completedPath);

        // Determine codec compatibility warning
        let codecWarning: string | undefined;
        if (fileExtension === ".mp4") {
          codecWarning =
            "⚠️ MP4 file - verify codec is H.264/AVC1 (supported) not H.265/HEVC (not supported). Check logs for codec detection.";
        } else if (hasFormatCode) {
          codecWarning =
            "⚠️ File has format code (.fXXX.) - this is likely an unmerged file from separate video+audio streams. Check if ffmpeg is installed and merging succeeded.";
        } else if (fileExtension === ".webm" && fileSize && fileSize < 10 * 1024 * 1024) {
          codecWarning = "Small WebM file - may be audio-only";
        }

        logger.info("[download-worker] Download completed successfully", {
          downloadId,
          videoId,
          finalPath: completedPath,
          fileExtension,
          fileSize: fileSize ? `${(fileSize / 1024 / 1024).toFixed(2)} MB` : null,
          fileExists,
          formatUsed,
          codecCompatibility:
            fileExtension === ".webm"
              ? "✅ WebM - fully supported in Chromium"
              : fileExtension === ".mp4"
                ? "⚠️ MP4 - check codec (H.264=supported, H.265=not supported)"
                : "❓ Unknown format",
          note: codecWarning,
        });

        // If format code detected, this is a critical issue - merge failed
        if (hasFormatCode) {
          logger.error("[download-worker] CRITICAL: Unmerged file detected - merge failed", {
            downloadId,
            videoId,
            finalPath: completedPath,
            fileSize: fileSize ? `${(fileSize / 1024 / 1024).toFixed(2)} MB` : null,
            note: "File has format code (.fXXX.) indicating it's an unmerged stream. Only one file (video OR audio) was saved. The other stream was lost. This usually means ffmpeg is not installed. Check stderr logs for 'ffmpeg is not installed' warning.",
            impact:
              "Download is incomplete - only one stream was saved. Video playback will fail if only audio was saved, or audio will be missing if only video was saved.",
          });
        }

        // If MP4, log a reminder to check codec
        if (fileExtension === ".mp4") {
          logger.info("[download-worker] MP4 file downloaded - codec check reminder", {
            downloadId,
            videoId,
            finalPath: completedPath,
            note: "If playback fails, check format selection logs above for actual codec (H.264/AVC1 vs H.265/HEVC). H.265 will not play in Chromium.",
          });
        }

        // Auto-optimization for large files (>100MB)
        if (
          fileSize &&
          fileSize > AUTO_OPTIMIZATION_THRESHOLD &&
          videoId &&
          !hasFormatCode // Skip if unmerged file (optimization won't help)
        ) {
          try {
            const downloadQuality = await getDownloadQuality(db);
            const targetResolution = getOptimizationTargetResolution(downloadQuality);

            logger.info("[download-worker] Large file detected, queueing auto-optimization", {
              downloadId,
              videoId,
              fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
              thresholdMB: (AUTO_OPTIMIZATION_THRESHOLD / 1024 / 1024).toFixed(0),
              targetResolution,
            });

            const optimizationManager = requireOptimizationQueueManager();
            await optimizationManager.addToQueue(db, [videoId], targetResolution);
          } catch (optError) {
            // Don't fail the download if optimization queueing fails
            logger.warn("[download-worker] Failed to queue auto-optimization", {
              downloadId,
              videoId,
              error: optError instanceof Error ? optError.message : "Unknown error",
            });
          }
        }
      } else {
        // Failed - get captured error or use generic message
        const failedWorker = activeWorkers.get(downloadId) || worker;
        const errorMessage = failedWorker.lastStderrError || `yt-dlp exited with code ${code}`;
        const errorType = determineErrorType(failedWorker.lastStderrError);
        const errorDetails = failedWorker.stderrBuffer?.slice(-5) || [];

        const queueManager = requireQueueManager();
        await queueManager.markFailed(downloadId, errorMessage, errorType, errorDetails);

        logger.error("[download-worker] Download failed", {
          downloadId,
          videoId,
          exitCode: code,
          errorMessage,
          errorType,
          stderrHistory: errorDetails,
          note: "Check stderrHistory for recent yt-dlp output leading to failure",
        });
      }
    });

    // Handle process errors
    process.on("error", async (error: Error) => {
      activeWorkers.delete(downloadId);
      const queueManager = requireQueueManager();
      await queueManager.markFailed(downloadId, error.message, "spawn_error");
      logger.error("[download-worker] Download process error", error, { downloadId });
    });
  } catch (error) {
    activeWorkers.delete(downloadId);
    const queueManager = requireQueueManager();
    await queueManager.markFailed(
      downloadId,
      error instanceof Error ? error.message : "Unknown error",
      "spawn_error"
    );
    logger.error("[download-worker] Failed to spawn download", error, { downloadId });
  }
};

/**
 * Parse progress and metadata from yt-dlp output
 */
const parseProgressAndMetadata = (db: Database, downloadId: string, output: string): void => {
  // Parse comprehensive download progress information
  // Example formats:
  // "[download]  45.3% of 10.5MiB at 1.2MiB/s ETA 00:15"
  // "[download]  45.3% of ~10.5MiB at 1.2MiB/s ETA 00:15"
  // "[download] 100% of 10.5MiB in 00:08"

  const progressLineMatch = output.match(
    /\[download\]\s+(\d+(?:\.\d+)?)%(?:\s+of\s+~?([\d.]+(?:K|M|G)?i?B))?(?:\s+at\s+([\d.]+(?:K|M|G)?i?B\/s))?(?:\s+ETA\s+([\d:]+))?/i
  );

  if (progressLineMatch) {
    const progress = parseFloat(progressLineMatch[1]);
    const totalSize = progressLineMatch[2] || null;
    const speed = progressLineMatch[3] || null;
    const eta = progressLineMatch[4] || null;

    // Calculate downloaded size if we have total size and progress
    let downloadedSize: string | null = null;
    if (totalSize && progress > 0) {
      const totalBytes = parseSize(totalSize);
      if (totalBytes > 0) {
        const downloadedBytes = (totalBytes * progress) / 100;
        downloadedSize = formatSize(downloadedBytes);
      }
    }

    // Update progress in database (throttled)
    const worker = activeWorkers.get(downloadId);
    if (worker) {
      const now = Date.now();
      // Update at most every 500ms
      if (now - worker.lastProgressUpdate >= 500) {
        worker.lastProgressUpdate = now;
        const queueManager = requireQueueManager();
        queueManager
          .updateProgress(downloadId, Math.round(progress), {
            downloadSpeed: speed,
            downloadedSize,
            totalSize,
            eta,
          })
          .catch((err: Error) =>
            logger.error("[download-worker] Failed to update progress", err, { downloadId })
          );
      }
    }
  }

  // Look for destination/merged file path
  // Example: [download] Destination: /path/to/file.mp4
  const destMatch = output.match(/\[download\]\s+Destination:\s+(.+)/);
  // Example: [Merger] Merging formats into "/path/to/file.mp4"
  const mergeMatch = output.match(/\[Merger\]\s+Merging formats into\s+"(.+?)"/);

  const foundPath = destMatch?.[1] || mergeMatch?.[1];
  if (foundPath) {
    const worker = activeWorkers.get(downloadId);
    if (worker) {
      // Normalize quotes and whitespace
      const cleaned = foundPath.replace(/^"|"$/g, "").trim();
      worker.lastKnownFilePath = cleaned;
    }
  }
};

/**
 * Parse size string to bytes (e.g., "10.5MiB" -> bytes)
 */
const parseSize = (sizeStr: string): number => {
  const match = sizeStr.match(/([\d.]+)\s*(K|M|G)?(i)?B/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2]?.toUpperCase() || "";
  const isBinary = match[3] === "i"; // MiB vs MB

  const multiplier = isBinary ? 1024 : 1000;

  switch (unit) {
    case "K":
      return value * multiplier;
    case "M":
      return value * Math.pow(multiplier, 2);
    case "G":
      return value * Math.pow(multiplier, 3);
    default:
      return value;
  }
};

/**
 * Format bytes to human-readable size
 */
const formatSize = (bytes: number): string => {
  const units = ["B", "KiB", "MiB", "GiB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)}${units[unitIndex]}`;
};

/**
 * Kill a download worker
 */
export const killDownload = (downloadId: string): boolean => {
  const worker = activeWorkers.get(downloadId);
  if (worker?.process) {
    worker.process.kill("SIGTERM");
    activeWorkers.delete(downloadId);
    return true;
  }
  return false;
};
