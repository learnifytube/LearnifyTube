import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/api/db";
import { episodes, movies, series } from "@/api/db/schema";
import type { MovieWatch, SeriesLastEpisode } from "../../../../shared/mobile-sync-contract";
import { newestWins } from "../../../../shared/newest-wins";
import { playedOnDevice } from "./watch-progress";
import { applyWrites, type Write } from "./batch-writes";

/** Takes the Movie and Episode progress of a Device report into the desktop's Watch state. */
export const recordDeviceMovieWatch = async (
  db: Database,
  entries: MovieWatch[],
  now: number
): Promise<void> => {
  const writes: Write[] = [];
  for (const kind of ["movie", "episode"] as const) {
    const table = kind === "movie" ? movies : episodes;
    const reported = entries.filter((entry) => entry.kind === kind);
    if (reported.length === 0) continue;
    const rows = await db
      .select()
      .from(table)
      .where(
        inArray(
          table.id,
          reported.map((entry) => entry.id)
        )
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const entry of reported) {
      // Only titles the desktop knows; a Device can hold titles from another desktop.
      const row = byId.get(entry.id);
      if (!row) continue;
      const progress = playedOnDevice(row, entry, row.durationSeconds, now);
      if (!progress) continue;
      writes.push(db.update(table).set(progress).where(eq(table.id, entry.id)));
      byId.set(entry.id, { ...row, ...progress });
    }
  }
  await applyWrites(db, writes);
};

/**
 * Takes each Series' last Episode from a Device report when it is newer than the
 * desktop's (ADR-0006), so a desktop mark made after it wins. Unknown Series, and
 * Episodes not of that Series, are ignored. True when any was kept.
 */
export const recordDeviceLastEpisodes = async (
  db: Database,
  entries: SeriesLastEpisode[]
): Promise<boolean> => {
  if (entries.length === 0) return false;
  const seriesIds = entries.map((entry) => entry.seriesId);
  const [seriesRows, episodeRows] = await Promise.all([
    db.select().from(series).where(inArray(series.id, seriesIds)),
    db
      .select({ id: episodes.id, seriesId: episodes.seriesId })
      .from(episodes)
      .where(inArray(episodes.seriesId, seriesIds)),
  ]);
  const byId = new Map(seriesRows.map((row) => [row.id, row]));
  const writes: Write[] = [];
  for (const entry of entries) {
    const row = byId.get(entry.seriesId);
    if (!row) continue;
    const ofSeries = episodeRows.some(
      (episode) => episode.id === entry.episodeId && episode.seriesId === row.id
    );
    if (entry.episodeId !== null && !ofSeries) continue;
    const existing =
      row.lastEpisodeUpdatedAt === null
        ? null
        : { episodeId: row.lastEpisodeId, updatedAt: row.lastEpisodeUpdatedAt };
    const reported = { episodeId: entry.episodeId, updatedAt: entry.updatedAt };
    if (newestWins(existing, reported) !== reported) continue;
    const kept = { lastEpisodeId: entry.episodeId, lastEpisodeUpdatedAt: entry.updatedAt };
    writes.push(db.update(series).set(kept).where(eq(series.id, row.id)));
    byId.set(row.id, { ...row, ...kept });
  }
  await applyWrites(db, writes);
  return writes.length > 0;
};
