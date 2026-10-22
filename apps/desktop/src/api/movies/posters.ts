import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getFfmpegPath } from "@/services/optimization-queue/optimization-worker";
import type { PosterSource } from "./import-plan";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const runFfmpeg = (args: string[]): Promise<boolean> =>
  new Promise((resolve) => {
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) {
      resolve(false);
      return;
    }
    execFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], (error) =>
      resolve(!error)
    );
  });

// A frame a little way in, past any black opening.
const frameTime = (durationSeconds: number | null): number =>
  durationSeconds && durationSeconds > 0 ? Math.min(durationSeconds * 0.1, 300) : 10;

// Writes the poster from the video (embedded art or a frame) to `outputPath` as a JPEG.
const grabPoster = (
  folderPath: string,
  source: Exclude<PosterSource, { kind: "file" }>,
  durationSeconds: number | null,
  outputPath: string
): Promise<boolean> => {
  const video = path.join(folderPath, source.videoPath);
  if (source.kind === "embedded") {
    return runFfmpeg(["-i", video, "-map", `0:${source.stream}`, "-frames:v", "1", outputPath]);
  }
  return runFfmpeg([
    "-ss",
    String(frameTime(durationSeconds)),
    "-i",
    video,
    "-frames:v",
    "1",
    "-vf",
    "scale=640:-2",
    outputPath,
  ]);
};

// Writes the poster to `<postersDir>/<movieId>.<ext>`; null when there is none.
export const savePoster = async (
  folderPath: string,
  source: PosterSource,
  durationSeconds: number | null,
  postersDir: string,
  movieId: string
): Promise<string | null> => {
  await fs.promises.mkdir(postersDir, { recursive: true });
  if (source.kind === "file") {
    const image = path.join(folderPath, source.path);
    const target = path.join(postersDir, `${movieId}${path.extname(image).toLowerCase()}`);
    await fs.promises.copyFile(image, target);
    return target;
  }
  const target = path.join(postersDir, `${movieId}.jpg`);
  const ok = await grabPoster(folderPath, source, durationSeconds, target);
  return ok ? target : null;
};

// A data URL for showing the poster in the Import preview, before anything is saved.
export const previewPoster = async (
  folderPath: string,
  source: PosterSource,
  durationSeconds: number | null
): Promise<string | null> => {
  try {
    if (source.kind === "file") {
      const image = path.join(folderPath, source.path);
      const mime = MIME_BY_EXTENSION[path.extname(image).toLowerCase()] ?? "image/jpeg";
      const bytes = await fs.promises.readFile(image);
      return `data:${mime};base64,${bytes.toString("base64")}`;
    }
    const tmp = path.join(os.tmpdir(), `learnifytube-poster-${randomUUID()}.jpg`);
    const ok = await grabPoster(folderPath, source, durationSeconds, tmp);
    if (!ok) return null;
    const bytes = await fs.promises.readFile(tmp);
    await fs.promises.rm(tmp, { force: true });
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    // A poster that can't be read falls back to the placeholder.
    return null;
  }
};
