import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "@/helpers/logger";
import { getFfmpegPath } from "@/services/optimization-queue/optimization-worker";
import { isVideoPath } from "@/api/movies/import-plan";
import { isAudioPath, type FolderListing, type ListedFile } from "./import-plan";

// Reads the picked folder for the Import planners (Audiobooks and Movies). Only
// ever reads the user's files.

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

type Streams = Pick<ListedFile, "videoCodec" | "audioCodec" | "attachedPicStream">;

type Probe = Pick<ListedFile, "artist" | "durationSeconds" | "hasEmbeddedArt"> & Streams;

const STREAM_LINE = /^\s*Stream #\d+:(\d+)\S*: (Video|Audio): (\w+)(.*)$/gm;

// A video file's codecs and its embedded art ("attached pic") stream, if any.
const parseStreams = (output: string): Streams => {
  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  let attachedPicStream: number | null = null;
  for (const [, index, type, codec, rest] of output.matchAll(STREAM_LINE)) {
    if (type === "Video" && rest.includes("(attached pic)")) attachedPicStream ??= Number(index);
    else if (type === "Video") videoCodec ??= codec;
    else audioCodec ??= codec;
  }
  return { videoCodec, audioCodec, attachedPicStream };
};

// `ffmpeg -i` prints the container's tags, duration and streams to stderr.
const parseProbe = (output: string): Probe => {
  const artist = output.match(/^ {4}artist\s*: (.+)$/m)?.[1]?.trim() ?? null;
  const duration = output.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSeconds = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : null;
  return {
    artist,
    durationSeconds,
    hasEmbeddedArt: /Stream #\d+:\d+.*: Video:/.test(output),
    ...parseStreams(output),
  };
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
  if (!ffmpegPath) logger.warn("[import] ffmpeg not found; importing without tags");
  const files = await mapLimited(
    paths,
    PROBE_CONCURRENCY,
    async (relative): Promise<ListedFile> => {
      if (!ffmpegPath) return { path: relative };
      if (isAudioPath(relative)) {
        const { artist, durationSeconds, hasEmbeddedArt } = await probe(
          ffmpegPath,
          path.join(folderPath, relative)
        );
        return { path: relative, artist, durationSeconds, hasEmbeddedArt };
      }
      if (isVideoPath(relative)) {
        const { durationSeconds, videoCodec, audioCodec, attachedPicStream } = await probe(
          ffmpegPath,
          path.join(folderPath, relative)
        );
        return { path: relative, durationSeconds, videoCodec, audioCodec, attachedPicStream };
      }
      return { path: relative };
    }
  );
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
