import path from "path";
import { randomUUID } from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/api/db";
import type { MovieKind } from "../../../../shared/mobile-sync-contract";
import { captions, episodes, movies, series, type Caption } from "@/api/db/schema";
import { applyWrites, type Write } from "./batch-writes";
import { pairCaptions, type ProposedCaption } from "./caption-pairing";

// Sidecar Captions of Movies and Episodes (ADR-0005). The subtitle files are
// only ever read where they are.

export type CaptionOwner = { kind: MovieKind; id: string };

export type StoredCaption = {
  id: string;
  language: string | null;
  label: string;
  filePath: string;
};

const ownerColumn = (
  kind: CaptionOwner["kind"]
): typeof captions.movieId | typeof captions.episodeId =>
  kind === "movie" ? captions.movieId : captions.episodeId;

/**
 * The writes that make the owner's Captions the paired ones, in their order: a
 * file still paired keeps its Caption id, new files are added and gone ones
 * removed. `existing` is the owner's stored Captions; `folder` is the imported
 * folder the paired paths are relative to. No writes means nothing changes.
 */
export const captionWrites = (
  db: Database,
  owner: CaptionOwner,
  folder: string,
  paired: ProposedCaption[],
  existing: Caption[] = []
): Write[] => {
  const writes: Write[] = [];
  const byPath = new Map(existing.map((row) => [row.filePath, row]));
  const kept = new Set<string>();
  for (const [position, caption] of paired.entries()) {
    const filePath = path.join(folder, caption.path);
    const row = byPath.get(filePath);
    const fields = { language: caption.language, label: caption.label, position };
    if (row) {
      kept.add(row.id);
      if (
        row.language === fields.language &&
        row.label === fields.label &&
        row.position === position
      ) {
        continue;
      }
      writes.push(db.update(captions).set(fields).where(eq(captions.id, row.id)));
      continue;
    }
    writes.push(
      db.insert(captions).values({
        id: randomUUID(),
        movieId: owner.kind === "movie" ? owner.id : null,
        episodeId: owner.kind === "episode" ? owner.id : null,
        filePath,
        ...fields,
      })
    );
  }
  const gone = existing.filter((row) => !kept.has(row.id)).map((row) => row.id);
  if (gone.length > 0) writes.push(db.delete(captions).where(inArray(captions.id, gone)));
  return writes;
};

/**
 * Pairs a Movie's sidecars again from the names of the files now in its
 * video's folder, so subtitles added later are found. Resolves whether its
 * Captions changed.
 */
export const pairMovieCaptionsAgain = async (
  db: Database,
  movieId: string,
  namesBesideVideo: string[]
): Promise<boolean> => {
  const [movie] = await db
    .select({ filePath: movies.filePath })
    .from(movies)
    .where(eq(movies.id, movieId))
    .limit(1);
  if (!movie) return false;
  const owner: CaptionOwner = { kind: "movie", id: movieId };
  const existing = await db.select().from(captions).where(eq(captions.movieId, movieId));
  const paired = pairCaptions(path.basename(movie.filePath), namesBesideVideo);
  const writes = captionWrites(db, owner, path.dirname(movie.filePath), paired, existing);
  await applyWrites(db, writes);
  return writes.length > 0;
};

/** A Movie's or Episode's Captions, in picker order. */
export const listCaptions = async (db: Database, owner: CaptionOwner): Promise<StoredCaption[]> =>
  db
    .select({
      id: captions.id,
      language: captions.language,
      label: captions.label,
      filePath: captions.filePath,
    })
    .from(captions)
    .where(eq(ownerColumn(owner.kind), owner.id))
    .orderBy(asc(captions.position));

/** Every Caption, by the Movie or Episode it belongs to, for the Device catalog. */
export const captionsByOwner = async (
  db: Database
): Promise<Map<string, { id: string; language: string | null; label: string }[]>> => {
  const rows = await db.select().from(captions).orderBy(asc(captions.position));
  const byOwner = new Map<string, { id: string; language: string | null; label: string }[]>();
  for (const row of rows) {
    const owner = row.movieId ?? row.episodeId;
    if (!owner) continue;
    const list = byOwner.get(owner) ?? [];
    list.push({ id: row.id, language: row.language, label: row.label });
    byOwner.set(owner, list);
  }
  return byOwner;
};

type CaptionFile = { filePath: string; folder: string };

const findCaption = async (
  db: Database,
  id: string,
  onlyShown: boolean
): Promise<CaptionFile | null> => {
  const [ofMovie] = await db
    .select({ filePath: captions.filePath, folder: movies.sourceFolder })
    .from(captions)
    .innerJoin(movies, eq(movies.id, captions.movieId))
    .where(and(eq(captions.id, id), onlyShown ? eq(movies.shownOnDevices, true) : undefined))
    .limit(1);
  if (ofMovie) return ofMovie;
  const [ofEpisode] = await db
    .select({ filePath: captions.filePath, folder: series.sourceFolder })
    .from(captions)
    .innerJoin(episodes, eq(episodes.id, captions.episodeId))
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(and(eq(captions.id, id), onlyShown ? eq(series.shownOnDevices, true) : undefined))
    .limit(1);
  return ofEpisode ?? null;
};

/**
 * The recorded subtitle file of a Caption whose title is Shown on Devices,
 * found by id (never by a path from the request), with the folder the title
 * was imported from.
 */
export const findCaptionForDevices = (db: Database, id: string): Promise<CaptionFile | null> =>
  findCaption(db, id, true);

/** A Caption's recorded file and its title's imported folder, for the desktop player. */
export const findCaptionFile = (db: Database, id: string): Promise<CaptionFile | null> =>
  findCaption(db, id, false);
