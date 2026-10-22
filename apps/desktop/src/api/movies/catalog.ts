import path from "path";
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { episodes, movies, type Movie } from "@/api/db/schema";
import type { WatchState } from "@/lib/watch-state";
import type { ProposedMovie } from "./import-plan";
import { markedWatched, playedTo, watchStateOf } from "./watch-progress";

// The desktop's Movies (ADR-0005). Files are referenced in place: nothing here
// copies, moves or deletes the user's video files.

export type ImportedMovie = Omit<ProposedMovie, "poster" | "codecWarnings"> & {
  // The app-owned poster copy, already saved, or null for the placeholder.
  posterPath: string | null;
};

const roundSeconds = (seconds: number | null): number | null =>
  seconds === null ? null : Math.round(seconds);

/** Saves the Movies an Import confirmed; `folderPath` is the picked folder. */
export const saveImportedMovies = async (
  db: Database,
  folderPath: string,
  imported: ImportedMovie[],
  now: number = Date.now()
): Promise<string[]> => {
  const rows = imported.map((movie) => ({
    id: randomUUID(),
    title: movie.title.trim(),
    sourceFolder: folderPath,
    filePath: path.join(folderPath, movie.path),
    posterPath: movie.posterPath,
    durationSeconds: roundSeconds(movie.durationSeconds),
    videoCodec: movie.videoCodec,
    audioCodec: movie.audioCodec,
    createdAt: now,
    updatedAt: now,
  }));
  if (rows.length > 0) await db.insert(movies).values(rows);
  return rows.map((row) => row.id);
};

export type MovieListItem = {
  id: string;
  title: string;
  posterPath: string | null;
  durationSeconds: number | null;
  missing: boolean;
  positionSeconds: number | null;
  shownOnDevices: boolean;
  watchState: WatchState;
};

export const listMovies = async (db: Database): Promise<MovieListItem[]> => {
  const rows = await db.select().from(movies).orderBy(asc(movies.title));
  return rows.map((movie) => ({
    id: movie.id,
    title: movie.title,
    posterPath: movie.posterPath,
    durationSeconds: movie.durationSeconds,
    missing: movie.missing,
    positionSeconds: movie.positionSeconds,
    shownOnDevices: movie.shownOnDevices,
    watchState: watchStateOf(movie),
  }));
};

export const findMovie = async (db: Database, id: string): Promise<Movie | null> => {
  const [movie] = await db.select().from(movies).where(eq(movies.id, id)).limit(1);
  return movie ?? null;
};

export const renameMovie = async (
  db: Database,
  id: string,
  title: string,
  now: number = Date.now()
): Promise<void> => {
  const trimmed = title.trim();
  if (!trimmed) return;
  await db.update(movies).set({ title: trimmed, updatedAt: now }).where(eq(movies.id, id));
};

export type MoviePlayback = {
  movieId: string;
  positionSeconds: number;
  // The length the player found, used while the scan's probe didn't know it.
  durationSeconds?: number | null;
};

/** The desktop player's progress: resumes there, and is watched at about 90%. */
export const recordMoviePlayback = async (
  db: Database,
  playback: MoviePlayback,
  now: number = Date.now()
): Promise<void> => {
  const movie = await findMovie(db, playback.movieId);
  if (!movie) return;
  const durationSeconds = movie.durationSeconds ?? roundSeconds(playback.durationSeconds ?? null);
  await db
    .update(movies)
    .set({ durationSeconds, ...playedTo(movie, playback.positionSeconds, durationSeconds, now) })
    .where(eq(movies.id, movie.id));
};

export const setMovieWatched = async (
  db: Database,
  id: string,
  watched: boolean,
  now: number = Date.now()
): Promise<void> => {
  const movie = await findMovie(db, id);
  if (!movie) return;
  await db
    .update(movies)
    .set(markedWatched(movie, watched, now))
    .where(eq(movies.id, id));
};

/** Removes the Movie from the app only; resolves its poster copy for cleanup. */
export const forgetMovie = async (
  db: Database,
  id: string
): Promise<{ posterPath: string | null } | null> => {
  const movie = await findMovie(db, id);
  if (!movie) return null;
  await db.delete(movies).where(eq(movies.id, id));
  return { posterPath: movie.posterPath };
};

/**
 * Checks every Movie's file: one that is gone is missing and keeps its Watch
 * state; one that is back plays again. Resolves how many changed.
 */
export const markMissingMovies = async (
  db: Database,
  exists: (filePath: string) => Promise<boolean>
): Promise<number> => {
  const rows = await db.select().from(movies);
  let changed = 0;
  for (const movie of rows) {
    const missing = !(await exists(movie.filePath));
    if (missing === movie.missing) continue;
    await db.update(movies).set({ missing }).where(eq(movies.id, movie.id));
    changed += 1;
  }
  return changed;
};

/** The video file of every Movie and Episode, as recorded. */
export const listMovieFilePaths = async (db: Database): Promise<string[]> => {
  const [movieFiles, episodeFiles] = await Promise.all([
    db.select({ filePath: movies.filePath }).from(movies),
    db.select({ filePath: episodes.filePath }).from(episodes),
  ]);
  return [...movieFiles, ...episodeFiles].map((row) => row.filePath);
};
