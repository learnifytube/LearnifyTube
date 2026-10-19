import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "@/helpers/logger";
import { getFfmpegPath } from "@/services/optimization-queue/optimization-worker";
import { isAudioPath, type FolderListing, type ListedFile } from "./import-plan";

// Reads the picked folder for the import planner. Only ever reads the user's files.

const PROBE_CONCURRENCY = 6;

const walk = async (root: string, relative = ""): Promise<string[]> => {
  const entries = await fs.promises.readdir(path.join(root, relative), { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return walk(root, child);
        return entry.isFile() ? [child] : [];
      })
  );
  return nested.flat();
};

type Probe = Pick<ListedFile, "artist" | "durationSeconds" | "hasEmbeddedArt">;

// `ffmpeg -i` prints the container's tags, duration and streams to stderr.
const parseProbe = (output: string): Probe => {
  const artist = output.match(/^ {4}artist\s*: (.+)$/m)?.[1]?.trim() ?? null;
  const duration = output.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSeconds = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : null;
  return { artist, durationSeconds, hasEmbeddedArt: /Stream #\d+:\d+.*: Video:/.test(output) };
};

const probe = (ffmpegPath: string, filePath: string): Promise<Probe> =>
  new Promise((resolve) => {
    execFile(ffmpegPath, ["-hide_banner", "-i", filePath], (_error, _stdout, stderr) => {
      resolve(parseProbe(String(stderr)));
    });
  });

const mapLimited = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

export const scanFolder = async (folderPath: string): Promise<FolderListing> => {
  const paths = await walk(folderPath);
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) logger.warn("[audiobooks] ffmpeg not found; importing without tags");
  const files = await mapLimited(paths, PROBE_CONCURRENCY, async (relative) => {
    if (!ffmpegPath || !isAudioPath(relative)) return { path: relative };
    return { path: relative, ...(await probe(ffmpegPath, path.join(folderPath, relative))) };
  });
  return { name: path.basename(folderPath), files };
};

// Writes the first Track's embedded art to `outputPath` as a JPEG.
export const extractEmbeddedArt = (trackPath: string, outputPath: string): Promise<boolean> =>
  new Promise((resolve) => {
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) {
      resolve(false);
      return;
    }
    execFile(
      ffmpegPath,
      ["-hide_banner", "-y", "-i", trackPath, "-an", "-frames:v", "1", outputPath],
      (error) => resolve(!error)
    );
  });
