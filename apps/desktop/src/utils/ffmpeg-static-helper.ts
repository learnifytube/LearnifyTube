import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { app } from "electron";
import { logger } from "@/helpers/logger";

const getTargetBinaryName = (): string => (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

const getUserDataBinaryPath = (): string => {
  const binDir = path.join(app.getPath("userData"), "bin");
  fs.mkdirSync(binDir, { recursive: true });
  return path.join(binDir, getTargetBinaryName());
};

const resolveAsarAwarePath = (maybeAsarPath: string): string | null => {
  if (fs.existsSync(maybeAsarPath)) {
    return maybeAsarPath;
  }

  if (maybeAsarPath.includes("app.asar")) {
    const unpackedPath = maybeAsarPath.replace("app.asar", "app.asar.unpacked");
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
  }

  return null;
};

const getFfmpegStaticSource = (): string | null => {
  try {
    logger.debug("[ffmpeg-static] Attempting to resolve module", {
      cwd: process.cwd(),
      baseDir: __dirname,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const ffmpegStatic: string | undefined = require("ffmpeg-static");
    if (!ffmpegStatic || typeof ffmpegStatic !== "string") {
      logger.warn("[ffmpeg-static] Module resolved but path is invalid", { ffmpegStatic });
      return null;
    }
    const resolved = resolveAsarAwarePath(ffmpegStatic);
    if (!resolved) {
      logger.warn("[ffmpeg-static] Source binary not found", { ffmpegStatic });
    } else {
      logger.debug("[ffmpeg-static] Resolved source binary path", { resolved });
    }
    return resolved;
  } catch (error) {
    logger.debug("[ffmpeg-static] require failed", { error });
    return null;
  }
};

const copyIfNeeded = (sourcePath: string, targetPath: string): void => {
  let needsCopy = true;
  try {
    if (fs.existsSync(targetPath)) {
      const sourceStats = fs.statSync(sourcePath);
      const targetStats = fs.statSync(targetPath);
      needsCopy =
        sourceStats.size !== targetStats.size || sourceStats.mtimeMs > targetStats.mtimeMs;
      logger.debug("[ffmpeg-static] Existing binary found", {
        targetPath,
        needsCopy,
        sourceSize: sourceStats.size,
        targetSize: targetStats.size,
      });
    }
  } catch (error) {
    logger.debug("[ffmpeg-static] Error comparing binary stats", { error });
    needsCopy = true;
  }

  if (!needsCopy) {
    logger.debug("[ffmpeg-static] Reusing existing binary", { targetPath });
    return;
  }

  logger.debug("[ffmpeg-static] Copying binary", { sourcePath, targetPath });
  fs.copyFileSync(sourcePath, targetPath);
  if (process.platform !== "win32") {
    fs.chmodSync(targetPath, 0o755);
  }
  logger.info("[ffmpeg-static] Copied binary to userData/bin", { targetPath });
};

const safeGetVersion = (binaryPath: string): string | null => {
  try {
    const output = execFileSync(binaryPath, ["-version"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    const match = output.match(/ffmpeg version ([^\s]+)/);
    return match ? match[1] : "unknown";
  } catch (error) {
    logger.debug("[ffmpeg-static] Unable to determine ffmpeg version", { error });
    return null;
  }
};

export const ensureFfmpegStaticAvailable = (): { path: string | null; version: string | null } => {
  logger.debug("[ffmpeg-static] ensureFfmpegStaticAvailable invoked");
  const sourcePath = getFfmpegStaticSource();
  if (!sourcePath) {
    logger.warn("[ffmpeg-static] Unable to resolve ffmpeg-static source path");
    return { path: null, version: null };
  }

  const targetPath = getUserDataBinaryPath();
  logger.debug("[ffmpeg-static] Ensuring target binary", { targetPath, sourcePath });
  copyIfNeeded(sourcePath, targetPath);
  const version = safeGetVersion(targetPath);
  logger.debug("[ffmpeg-static] Binary ready", { targetPath, version });
  return { path: targetPath, version };
};
