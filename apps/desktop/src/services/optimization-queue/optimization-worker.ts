import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "@/helpers/logger";
import { ensureFfmpegStaticAvailable } from "@/utils/ffmpeg-static-helper";
import { app } from "electron";
import type { OptimizationJob, TargetResolution } from "./types";
import { DEFAULT_OPTIMIZATION_CONFIG, RESOLUTION_SCALE } from "./config";

/**
 * Active optimization workers
 * Maps job ID to worker state
 */
interface WorkerState {
  jobId: string;
  process: ChildProcess;
  startTime: number;
  lastProgressUpdate: number;
  durationSeconds: number;
}

const activeWorkers = new Map<string, WorkerState>();

/**
 * Progress callback type
 */
type ProgressCallback = (jobId: string, progress: number) => void;

/**
 * Completion callback type
 */
type CompletionCallback = (
  jobId: string,
  success: boolean,
  finalPath?: string,
  finalSize?: number,
  errorMessage?: string
) => void;

/**
 * Get FFmpeg binary path
 */
export const getFfmpegPath = (): string | null => {
  const platform = process.platform;
  const isDev = !app.isPackaged;

  // 1. Check bundled version
  let bundledPath: string;
  if (isDev) {
    const rootDir = path.resolve(path.join(__dirname, "..", "..", "..", ".."));
    bundledPath = path.join(
      rootDir,
      "assets",
      "bin",
      platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    );
  } else {
    bundledPath = path.join(
      process.resourcesPath,
      "bin",
      platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    );
  }

  if (fs.existsSync(bundledPath)) {
    logger.debug("[optimization-worker] Using bundled ffmpeg", { path: bundledPath });
    return bundledPath;
  }

  // 2. Use ffmpeg-static
  const { path: staticPath } = ensureFfmpegStaticAvailable();
  if (staticPath && fs.existsSync(staticPath)) {
    logger.debug("[optimization-worker] Using ffmpeg-static", { path: staticPath });
    return staticPath;
  }

  // 3. Check downloaded version
  const binDir = path.join(app.getPath("userData"), "bin");
  const downloadedPath = path.join(binDir, platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

  if (fs.existsSync(downloadedPath)) {
    logger.debug("[optimization-worker] Using downloaded ffmpeg", { path: downloadedPath });
    return downloadedPath;
  }

  return null;
};

/**
 * Get FFprobe binary path (same location as FFmpeg)
 */
const getFfprobePath = (): string | null => {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) return null;

  const dir = path.dirname(ffmpegPath);
  const platform = process.platform;
  const ffprobePath = path.join(dir, platform === "win32" ? "ffprobe.exe" : "ffprobe");

  if (fs.existsSync(ffprobePath)) {
    return ffprobePath;
  }

  return null;
};

/**
 * Get video duration using FFprobe
 */
export const getVideoDuration = async (filePath: string): Promise<number> => {
  const ffprobePath = getFfprobePath();
  if (!ffprobePath) {
    logger.warn("[optimization-worker] ffprobe not found, cannot get duration");
    return 0;
  }

  return new Promise((resolve) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ];

    const proc = spawn(ffprobePath, args);
    let output = "";

    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        if (!isNaN(duration)) {
          resolve(duration);
          return;
        }
      }
      resolve(0);
    });

    proc.on("error", () => {
      resolve(0);
    });
  });
};

/**
 * Get video resolution using FFprobe
 */
export const getVideoResolution = async (
  filePath: string
): Promise<{ width: number; height: number } | null> => {
  const ffprobePath = getFfprobePath();
  if (!ffprobePath) {
    return null;
  }

  return new Promise((resolve) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      filePath,
    ];

    const proc = spawn(ffprobePath, args);
    let output = "";

    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const match = output.trim().match(/(\d+)x(\d+)/);
        if (match) {
          resolve({
            width: parseInt(match[1], 10),
            height: parseInt(match[2], 10),
          });
          return;
        }
      }
      resolve(null);
    });

    proc.on("error", () => {
      resolve(null);
    });
  });
};

/**
 * Build FFmpeg arguments for optimization
 */
const buildFfmpegArgs = (
  inputPath: string,
  outputPath: string,
  targetResolution: TargetResolution,
  _durationSeconds: number
): string[] => {
  const config = DEFAULT_OPTIMIZATION_CONFIG;
  const args: string[] = [];

  // Input
  args.push("-i", inputPath);

  // Video codec: H.264
  args.push("-c:v", "libx264");

  // Preset for encoding speed vs compression
  args.push("-preset", config.preset);

  // CRF for quality (lower = better quality, higher = smaller file)
  args.push("-crf", config.crf.toString());

  // Resolution scaling (if not original)
  const scale = RESOLUTION_SCALE[targetResolution];
  if (scale) {
    // Use scale filter with proper aspect ratio handling
    args.push("-vf", `scale=${scale}`);
  }

  // Audio codec: AAC
  args.push("-c:a", "aac");
  args.push("-b:a", config.audioBitrate);

  // MP4-specific optimizations
  args.push("-movflags", "+faststart"); // Move moov atom for faster streaming

  // Overwrite output without asking
  args.push("-y");

  // Progress output
  args.push("-progress", "pipe:1");

  // Output path
  args.push(outputPath);

  return args;
};

/**
 * Parse FFmpeg progress output
 */
const parseProgress = (output: string, durationSeconds: number): number | null => {
  // FFmpeg progress format: out_time_ms=12345678
  const timeMatch = output.match(/out_time_ms=(\d+)/);
  if (timeMatch && durationSeconds > 0) {
    const outTimeMs = parseInt(timeMatch[1], 10);
    const outTimeSeconds = outTimeMs / 1000000;
    const progress = Math.min((outTimeSeconds / durationSeconds) * 100, 99);
    return Math.round(progress);
  }

  // Alternative: out_time=00:01:23.456789
  const timeStrMatch = output.match(/out_time=(\d+):(\d+):(\d+)/);
  if (timeStrMatch && durationSeconds > 0) {
    const hours = parseInt(timeStrMatch[1], 10);
    const minutes = parseInt(timeStrMatch[2], 10);
    const seconds = parseInt(timeStrMatch[3], 10);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    const progress = Math.min((totalSeconds / durationSeconds) * 100, 99);
    return Math.round(progress);
  }

  return null;
};

/**
 * Spawn optimization worker for a job
 */
export const spawnOptimization = async (
  job: OptimizationJob,
  onProgress: ProgressCallback,
  onComplete: CompletionCallback
): Promise<void> => {
  const { id: jobId, sourceFilePath, targetFilePath, targetResolution, durationSeconds } = job;

  try {
    // Check if already processing
    if (activeWorkers.has(jobId)) {
      logger.warn("[optimization-worker] Job already active", { jobId });
      return;
    }

    // Get FFmpeg path
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) {
      onComplete(jobId, false, undefined, undefined, "FFmpeg not found");
      return;
    }

    // Verify source file exists
    if (!fs.existsSync(sourceFilePath)) {
      onComplete(jobId, false, undefined, undefined, "Source file not found");
      return;
    }

    // Get video duration if not provided
    let duration = durationSeconds || 0;
    if (duration === 0) {
      duration = await getVideoDuration(sourceFilePath);
    }

    // Build FFmpeg arguments
    const args = buildFfmpegArgs(sourceFilePath, targetFilePath, targetResolution, duration);

    logger.info("[optimization-worker] Starting optimization", {
      jobId,
      sourceFilePath,
      targetFilePath,
      targetResolution,
      duration,
      command: `${ffmpegPath} ${args.join(" ")}`,
    });

    // Spawn FFmpeg process
    const proc = spawn(ffmpegPath, args);

    // Store worker state
    const worker: WorkerState = {
      jobId,
      process: proc,
      startTime: Date.now(),
      lastProgressUpdate: Date.now(),
      durationSeconds: duration,
    };
    activeWorkers.set(jobId, worker);

    // Handle stdout (progress output)
    proc.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      const progress = parseProgress(output, duration);

      if (progress !== null) {
        const now = Date.now();
        // Throttle progress updates to every 500ms
        if (now - worker.lastProgressUpdate >= 500) {
          worker.lastProgressUpdate = now;
          onProgress(jobId, progress);
        }
      }
    });

    // Handle stderr (FFmpeg logs)
    proc.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();

      // Check for errors
      if (output.toLowerCase().includes("error")) {
        logger.warn("[optimization-worker] FFmpeg stderr", { jobId, output: output.trim() });
      }

      // Also try to parse progress from stderr (some FFmpeg versions output here)
      const progress = parseProgress(output, duration);
      if (progress !== null) {
        const now = Date.now();
        if (now - worker.lastProgressUpdate >= 500) {
          worker.lastProgressUpdate = now;
          onProgress(jobId, progress);
        }
      }
    });

    // Handle process completion
    proc.on("close", async (code: number | null) => {
      activeWorkers.delete(jobId);

      if (code === 0) {
        // Verify output file exists and has content
        if (fs.existsSync(targetFilePath)) {
          const stats = fs.statSync(targetFilePath);
          if (stats.size > 0) {
            logger.info("[optimization-worker] Optimization completed", {
              jobId,
              outputPath: targetFilePath,
              outputSize: stats.size,
            });
            onComplete(jobId, true, targetFilePath, stats.size);
          } else {
            logger.error("[optimization-worker] Output file is empty", { jobId });
            onComplete(jobId, false, undefined, undefined, "Output file is empty");
          }
        } else {
          logger.error("[optimization-worker] Output file not found", { jobId });
          onComplete(jobId, false, undefined, undefined, "Output file not created");
        }
      } else {
        logger.error("[optimization-worker] FFmpeg exited with error", { jobId, code });
        onComplete(jobId, false, undefined, undefined, `FFmpeg exited with code ${code}`);
      }
    });

    // Handle process errors
    proc.on("error", (error: Error) => {
      activeWorkers.delete(jobId);
      logger.error("[optimization-worker] FFmpeg process error", { jobId, error: error.message });
      onComplete(jobId, false, undefined, undefined, error.message);
    });
  } catch (error) {
    activeWorkers.delete(jobId);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("[optimization-worker] Failed to spawn optimization", {
      jobId,
      error: errorMessage,
    });
    onComplete(jobId, false, undefined, undefined, errorMessage);
  }
};

/**
 * Kill an optimization worker
 */
export const killOptimization = (jobId: string): boolean => {
  const worker = activeWorkers.get(jobId);
  if (worker?.process) {
    worker.process.kill("SIGTERM");
    activeWorkers.delete(jobId);
    logger.info("[optimization-worker] Killed optimization job", { jobId });
    return true;
  }
  return false;
};

/**
 * Check if FFmpeg is available
 */
export const isFfmpegAvailable = (): boolean => {
  return getFfmpegPath() !== null;
};

/**
 * Audio format options
 */
export type AudioFormat = "mp3" | "m4a" | "opus";

/**
 * Audio quality presets
 */
export type AudioQuality = "high" | "medium" | "low";

const AUDIO_BITRATE: Record<AudioQuality, string> = {
  high: "192k",
  medium: "128k",
  low: "96k",
};

/**
 * Build FFmpeg arguments for audio extraction
 */
const buildAudioExtractionArgs = (
  inputPath: string,
  outputPath: string,
  format: AudioFormat,
  quality: AudioQuality
): string[] => {
  const args: string[] = [];
  const bitrate = AUDIO_BITRATE[quality];

  // Input
  args.push("-i", inputPath);

  // No video
  args.push("-vn");

  // Audio codec based on format
  switch (format) {
    case "mp3":
      args.push("-c:a", "libmp3lame");
      args.push("-b:a", bitrate);
      break;
    case "m4a":
      args.push("-c:a", "aac");
      args.push("-b:a", bitrate);
      break;
    case "opus":
      args.push("-c:a", "libopus");
      args.push("-b:a", bitrate);
      break;
  }

  // Overwrite output without asking
  args.push("-y");

  // Progress output
  args.push("-progress", "pipe:1");

  // Output path
  args.push(outputPath);

  return args;
};

/**
 * Audio conversion job type
 */
export interface AudioConversionJob {
  id: string;
  videoId: string;
  title: string;
  sourceFilePath: string;
  targetFilePath: string;
  format: AudioFormat;
  quality: AudioQuality;
  status: "queued" | "converting" | "completed" | "failed" | "cancelled";
  progress: number;
  originalSize: number;
  finalSize: number | null;
  errorMessage: string | null;
  addedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  durationSeconds: number;
  deleteOriginal: boolean;
}

/**
 * Active audio conversion workers
 */
const activeAudioWorkers = new Map<string, WorkerState>();

/**
 * Spawn audio conversion worker for a job
 */
export const spawnAudioConversion = async (
  job: AudioConversionJob,
  onProgress: ProgressCallback,
  onComplete: CompletionCallback
): Promise<void> => {
  const { id: jobId, sourceFilePath, targetFilePath, format, quality, durationSeconds } = job;

  try {
    // Check if already processing
    if (activeAudioWorkers.has(jobId)) {
      logger.warn("[audio-worker] Job already active", { jobId });
      return;
    }

    // Get FFmpeg path
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) {
      onComplete(jobId, false, undefined, undefined, "FFmpeg not found");
      return;
    }

    // Verify source file exists
    if (!fs.existsSync(sourceFilePath)) {
      onComplete(jobId, false, undefined, undefined, "Source file not found");
      return;
    }

    // Get video duration if not provided
    let duration = durationSeconds || 0;
    if (duration === 0) {
      duration = await getVideoDuration(sourceFilePath);
    }

    // Build FFmpeg arguments
    const args = buildAudioExtractionArgs(sourceFilePath, targetFilePath, format, quality);

    logger.info("[audio-worker] Starting audio conversion", {
      jobId,
      sourceFilePath,
      targetFilePath,
      format,
      quality,
      duration,
      command: `${ffmpegPath} ${args.join(" ")}`,
    });

    // Spawn FFmpeg process
    const proc = spawn(ffmpegPath, args);

    // Store worker state
    const worker: WorkerState = {
      jobId,
      process: proc,
      startTime: Date.now(),
      lastProgressUpdate: Date.now(),
      durationSeconds: duration,
    };
    activeAudioWorkers.set(jobId, worker);

    // Handle stdout (progress output)
    proc.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      const progress = parseProgress(output, duration);

      if (progress !== null) {
        const now = Date.now();
        if (now - worker.lastProgressUpdate >= 500) {
          worker.lastProgressUpdate = now;
          onProgress(jobId, progress);
        }
      }
    });

    // Handle stderr (FFmpeg logs)
    proc.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();

      if (output.toLowerCase().includes("error")) {
        logger.warn("[audio-worker] FFmpeg stderr", { jobId, output: output.trim() });
      }

      const progress = parseProgress(output, duration);
      if (progress !== null) {
        const now = Date.now();
        if (now - worker.lastProgressUpdate >= 500) {
          worker.lastProgressUpdate = now;
          onProgress(jobId, progress);
        }
      }
    });

    // Handle process completion
    proc.on("close", async (code: number | null) => {
      activeAudioWorkers.delete(jobId);

      if (code === 0) {
        if (fs.existsSync(targetFilePath)) {
          const stats = fs.statSync(targetFilePath);
          if (stats.size > 0) {
            logger.info("[audio-worker] Audio conversion completed", {
              jobId,
              outputPath: targetFilePath,
              outputSize: stats.size,
            });
            onComplete(jobId, true, targetFilePath, stats.size);
          } else {
            logger.error("[audio-worker] Output file is empty", { jobId });
            onComplete(jobId, false, undefined, undefined, "Output file is empty");
          }
        } else {
          logger.error("[audio-worker] Output file not found", { jobId });
          onComplete(jobId, false, undefined, undefined, "Output file not created");
        }
      } else {
        logger.error("[audio-worker] FFmpeg exited with error", { jobId, code });
        onComplete(jobId, false, undefined, undefined, `FFmpeg exited with code ${code}`);
      }
    });

    // Handle process errors
    proc.on("error", (error: Error) => {
      activeAudioWorkers.delete(jobId);
      logger.error("[audio-worker] FFmpeg process error", { jobId, error: error.message });
      onComplete(jobId, false, undefined, undefined, error.message);
    });
  } catch (error) {
    activeAudioWorkers.delete(jobId);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("[audio-worker] Failed to spawn audio conversion", {
      jobId,
      error: errorMessage,
    });
    onComplete(jobId, false, undefined, undefined, errorMessage);
  }
};

/**
 * Kill an audio conversion worker
 */
export const killAudioConversion = (jobId: string): boolean => {
  const worker = activeAudioWorkers.get(jobId);
  if (worker?.process) {
    worker.process.kill("SIGTERM");
    activeAudioWorkers.delete(jobId);
    logger.info("[audio-worker] Killed audio conversion job", { jobId });
    return true;
  }
  return false;
};
