import path from "path";
import { readdir } from "fs/promises";
import type { Database } from "@/api/db";
import type { Movie } from "@/api/db/schema";
import {
  findCaptionFile,
  listCaptions,
  pairMovieCaptionsAgain,
  type CaptionOwner,
} from "@/api/movies/captions";
import { readCaptionAsWebVtt } from "@/api/movies/caption-file";
import { resolveCaptionFile } from "@/main/security/path-confinement";
import { logger } from "@/helpers/logger";
import { notifyDevicesOfMovies } from "./notify-devices";

export type CaptionTrack = { id: string; language: string | null; label: string; vtt: string };

/**
 * Subtitles added beside a Movie's file after Import become Captions when its
 * page opens. A folder that can't be read (an unplugged drive) changes nothing.
 */
export const checkMovieCaptions = async (db: Database, movie: Movie): Promise<void> => {
  const names = await readdir(path.dirname(movie.filePath)).catch(() => null);
  if (!names) return;
  if (await pairMovieCaptionsAgain(db, movie.id, names)) await notifyDevicesOfMovies();
};

/**
 * Each Caption read as WebVTT, through the same confinement as Devices get:
 * by id, inside the title's imported folder, and only subtitle files.
 */
export const loadCaptionTracks = async (
  db: Database,
  owner: CaptionOwner
): Promise<CaptionTrack[]> => {
  const tracks: CaptionTrack[] = [];
  for (const caption of await listCaptions(db, owner)) {
    const file = await resolveCaptionFile(caption.id, (id) => findCaptionFile(db, id));
    if (!file.ok) continue;
    try {
      const vtt = await readCaptionAsWebVtt(file.realPath);
      tracks.push({ id: caption.id, language: caption.language, label: caption.label, vtt });
    } catch (error) {
      logger.warn("[movies] Couldn't read a Caption", { id: caption.id, error });
    }
  }
  return tracks;
};
