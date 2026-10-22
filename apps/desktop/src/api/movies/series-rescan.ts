import path from "path";
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import type { FolderListing } from "@/api/audiobooks/import-plan";
import { episodes, seasons, series } from "@/api/db/schema";
import { planSeriesRescan, type CurrentSeason } from "./series-rescan-plan";

// Rescan of a Series (ADR-0005): applies the Rescan plan to its stored Seasons
// and Episodes. Only rows change; the user's files are only ever read.

export type SeriesRescanResult = {
  added: number;
  missing: number;
  // Whether Episodes were added, so the file allowlist must be refreshed.
  filesChanged: boolean;
  // Seasons that gained Episodes, new Seasons included; a Season sent to
  // Devices sends what it gained (#56 notifies Devices from these).
  seasonsWithNewEpisodes: string[];
};

const relativeTo = (folder: string, filePath: string): string =>
  path.relative(folder, filePath).split(path.sep).join("/");

/** Applies a fresh listing of the Series folder; an empty one marks everything missing. */
export const rescanSeries = async (
  db: Database,
  seriesId: string,
  listing: FolderListing,
  now: number = Date.now()
): Promise<SeriesRescanResult | null> => {
  const [row] = await db.select().from(series).where(eq(series.id, seriesId)).limit(1);
  if (!row) return null;
  const [seasonRows, episodeRows] = await Promise.all([
    db.select().from(seasons).where(eq(seasons.seriesId, seriesId)).orderBy(asc(seasons.position)),
    db
      .select()
      .from(episodes)
      .where(eq(episodes.seriesId, seriesId))
      .orderBy(asc(episodes.position)),
  ]);
  const current: CurrentSeason[] = seasonRows.map((season) => ({
    id: season.id,
    title: season.title,
    number: season.number,
    episodes: episodeRows
      .filter((episode) => episode.seasonId === season.id)
      .map((episode) => ({
        id: episode.id,
        path: relativeTo(row.sourceFolder, episode.filePath),
        number: episode.number,
        missing: episode.missing,
      })),
  }));
  const plan = planSeriesRescan(current, listing);

  const seasonsWithNewEpisodes: string[] = [];
  for (const [position, season] of plan.seasons.entries()) {
    let seasonId: string;
    if (season.kind === "existing") {
      seasonId = season.id;
      await db.update(seasons).set({ position }).where(eq(seasons.id, seasonId));
    } else {
      seasonId = randomUUID();
      await db
        .insert(seasons)
        .values({ id: seasonId, seriesId, title: season.title, number: season.number, position });
    }
    if (season.episodes.some((episode) => episode.kind === "new")) {
      seasonsWithNewEpisodes.push(seasonId);
    }
    for (const [episodePosition, episode] of season.episodes.entries()) {
      if (episode.kind === "existing") {
        await db
          .update(episodes)
          .set({ missing: episode.missing, position: episodePosition })
          .where(eq(episodes.id, episode.id));
        continue;
      }
      const proposed = episode.episode;
      await db.insert(episodes).values({
        id: randomUUID(),
        seriesId,
        seasonId,
        title: proposed.title,
        filePath: path.join(row.sourceFolder, proposed.path),
        number: proposed.number,
        position: episodePosition,
        durationSeconds:
          proposed.durationSeconds === null ? null : Math.round(proposed.durationSeconds),
        videoCodec: proposed.videoCodec,
        audioCodec: proposed.audioCodec,
        createdAt: now,
      });
    }
  }
  if (plan.added > 0) {
    await db.update(series).set({ updatedAt: now }).where(eq(series.id, seriesId));
  }
  return {
    added: plan.added,
    missing: plan.missing,
    filesChanged: plan.added > 0,
    seasonsWithNewEpisodes,
  };
};
