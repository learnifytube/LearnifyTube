import path from "path";
import { randomUUID } from "crypto";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type { Database } from "@/api/db";
import { captions, episodes, seasons, series, type Episode } from "@/api/db/schema";
import type { WatchState } from "@/lib/watch-state";
import { nextUpEpisode } from "../../../../shared/series/nextUp";
import type { ProposedEpisode, ProposedSeason } from "./series-plan";
import { markedWatched, playedTo, watchStateOf } from "./watch-progress";
import { applyWrites } from "./batch-writes";
import { captionWrites } from "./captions";

// The desktop's Series, Seasons and Episodes (ADR-0005). Files are referenced in
// place: nothing here copies, moves or deletes the user's video files.

export type ImportedSeries = {
  title: string;
  // The app-owned poster copy, already saved, or null for the placeholder.
  posterPath: string | null;
  // In the order the preview confirmed.
  seasons: (Pick<ProposedSeason, "title" | "number"> & {
    episodes: (Omit<ProposedEpisode, "codecWarnings" | "captions"> & {
      // Paired sidecar subtitles; none when left out.
      captions?: ProposedEpisode["captions"];
    })[];
  })[];
};

const roundSeconds = (seconds: number | null): number | null =>
  seconds === null ? null : Math.round(seconds);

/** Saves the Series an Import confirmed; `folderPath` is the picked folder. */
export const saveImportedSeries = async (
  db: Database,
  folderPath: string,
  imported: ImportedSeries,
  now: number = Date.now()
): Promise<string> => {
  const seriesId = randomUUID();
  const seasonRows = imported.seasons.map((season, position) => ({
    id: randomUUID(),
    seriesId,
    title: season.title.trim(),
    number: season.number,
    position,
  }));
  const episodeRows = imported.seasons.flatMap((season, seasonIndex) =>
    season.episodes.map((episode, position) => ({
      id: randomUUID(),
      seriesId,
      seasonId: seasonRows[seasonIndex].id,
      title: episode.title.trim(),
      filePath: path.join(folderPath, episode.path),
      number: episode.number,
      position,
      durationSeconds: roundSeconds(episode.durationSeconds),
      videoCodec: episode.videoCodec,
      audioCodec: episode.audioCodec,
      createdAt: now,
    }))
  );
  const importedEpisodes = imported.seasons.flatMap((season) => season.episodes);
  await applyWrites(db, [
    db.insert(series).values({
      id: seriesId,
      title: imported.title.trim(),
      sourceFolder: folderPath,
      posterPath: imported.posterPath,
      createdAt: now,
      updatedAt: now,
    }),
    ...(seasonRows.length > 0 ? [db.insert(seasons).values(seasonRows)] : []),
    ...(episodeRows.length > 0 ? [db.insert(episodes).values(episodeRows)] : []),
    ...importedEpisodes.flatMap((episode, index) =>
      captionWrites(
        db,
        { kind: "episode", id: episodeRows[index].id },
        folderPath,
        episode.captions ?? []
      )
    ),
  ]);
  return seriesId;
};

// Watched once every Episode that can play is; in progress once any has been played.
const watchStateOfAll = (states: { missing: boolean; watchState: WatchState }[]): WatchState => {
  const playable = states.filter((state) => !state.missing);
  if (playable.length > 0 && playable.every((state) => state.watchState === "watched")) {
    return "watched";
  }
  return states.some((state) => state.watchState !== "unwatched") ? "in-progress" : "unwatched";
};

export type SeriesEpisode = Pick<
  Episode,
  | "id"
  | "title"
  | "filePath"
  | "number"
  | "durationSeconds"
  | "missing"
  | "positionSeconds"
  | "watchUpdatedAt"
> & { watchState: WatchState };

export type SeriesSeason = {
  id: string;
  title: string;
  number: number | null;
  // The Season is what the desktop sends to Devices.
  sentToDevices: boolean;
  watchState: WatchState;
  episodes: SeriesEpisode[];
};

export type SeriesDetail = {
  id: string;
  title: string;
  posterPath: string | null;
  sourceFolder: string;
  shownOnDevices: boolean;
  watchState: WatchState;
  seasons: SeriesSeason[];
  // The Episode playing the Series starts: the last one played unless watched,
  // else the next unwatched after it, else the first unwatched (ADR-0006).
  nextUpEpisodeId: string | null;
};

const toSeriesEpisode = (episode: Episode): SeriesEpisode => ({
  id: episode.id,
  title: episode.title,
  filePath: episode.filePath,
  number: episode.number,
  durationSeconds: episode.durationSeconds,
  missing: episode.missing,
  positionSeconds: episode.positionSeconds,
  watchUpdatedAt: episode.watchUpdatedAt,
  watchState: watchStateOf(episode),
});

export const getSeries = async (db: Database, id: string): Promise<SeriesDetail | null> => {
  const [row] = await db.select().from(series).where(eq(series.id, id)).limit(1);
  if (!row) return null;
  const [seasonRows, episodeRows] = await Promise.all([
    db.select().from(seasons).where(eq(seasons.seriesId, id)).orderBy(asc(seasons.position)),
    db.select().from(episodes).where(eq(episodes.seriesId, id)).orderBy(asc(episodes.position)),
  ]);
  const seasonList = seasonRows.map((season) => {
    const seasonEpisodes = episodeRows
      .filter((episode) => episode.seasonId === season.id)
      .map(toSeriesEpisode);
    return {
      id: season.id,
      title: season.title,
      number: season.number,
      sentToDevices: season.sentToDevices,
      watchState: watchStateOfAll(seasonEpisodes),
      episodes: seasonEpisodes,
    };
  });
  const inOrder = seasonList.flatMap((season) => season.episodes);
  return {
    id: row.id,
    title: row.title,
    posterPath: row.posterPath,
    sourceFolder: row.sourceFolder,
    shownOnDevices: row.shownOnDevices,
    watchState: watchStateOfAll(inOrder),
    seasons: seasonList,
    nextUpEpisodeId: nextUpEpisode(inOrder, row.lastEpisodeId)?.id ?? null,
  };
};

export type SeriesListItem = {
  id: string;
  title: string;
  posterPath: string | null;
  seasonCount: number;
  episodeCount: number;
  shownOnDevices: boolean;
  watchState: WatchState;
};

export const listSeries = async (db: Database): Promise<SeriesListItem[]> => {
  const [seriesRows, seasonRows, episodeRows] = await Promise.all([
    db.select().from(series).orderBy(asc(series.title)),
    db.select({ seriesId: seasons.seriesId }).from(seasons),
    db.select().from(episodes),
  ]);
  return seriesRows.map((row) => {
    const own = episodeRows
      .filter((episode) => episode.seriesId === row.id)
      .map((episode) => ({ missing: episode.missing, watchState: watchStateOf(episode) }));
    return {
      id: row.id,
      title: row.title,
      posterPath: row.posterPath,
      seasonCount: seasonRows.filter((season) => season.seriesId === row.id).length,
      episodeCount: own.length,
      shownOnDevices: row.shownOnDevices,
      watchState: watchStateOfAll(own),
    };
  });
};

export const findEpisode = async (db: Database, id: string): Promise<Episode | null> => {
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
  return episode ?? null;
};

export const renameSeries = async (
  db: Database,
  id: string,
  title: string,
  now: number = Date.now()
): Promise<void> => {
  const trimmed = title.trim();
  if (!trimmed) return;
  await db.update(series).set({ title: trimmed, updatedAt: now }).where(eq(series.id, id));
};

export type EpisodePlayback = {
  episodeId: string;
  positionSeconds: number;
  // The length the player found, used while the scan's probe didn't know it.
  durationSeconds?: number | null;
};

/** The desktop player's progress: resumes there, and is watched at about 90%. */
export const recordEpisodePlayback = async (
  db: Database,
  playback: EpisodePlayback,
  now: number = Date.now()
): Promise<void> => {
  const episode = await findEpisode(db, playback.episodeId);
  if (!episode) return;
  const durationSeconds = episode.durationSeconds ?? roundSeconds(playback.durationSeconds ?? null);
  await db
    .update(episodes)
    .set({ durationSeconds, ...playedTo(episode, playback.positionSeconds, durationSeconds, now) })
    .where(eq(episodes.id, episode.id));
};

/** The desktop player started an Episode: it becomes its Series' last Episode. */
export const recordEpisodeStarted = async (
  db: Database,
  episodeId: string,
  now: number = Date.now()
): Promise<void> => {
  const episode = await findEpisode(db, episodeId);
  if (!episode) return;
  await db
    .update(series)
    .set({ lastEpisodeId: episode.id, lastEpisodeUpdatedAt: now })
    .where(eq(series.id, episode.seriesId));
};

export type EpisodesTarget = { episodeId: string } | { seasonId: string } | { seriesId: string };

const whereTarget = (target: EpisodesTarget): SQL =>
  "episodeId" in target
    ? eq(episodes.id, target.episodeId)
    : "seasonId" in target
      ? eq(episodes.seasonId, target.seasonId)
      : eq(episodes.seriesId, target.seriesId);

/** Marks one Episode, every Episode of a Season, or of the whole Series. */
export const setEpisodesWatched = async (
  db: Database,
  target: EpisodesTarget,
  watched: boolean,
  now: number = Date.now()
): Promise<void> => {
  const rows = await db.select().from(episodes).where(whereTarget(target));
  // Marking a Series, or the Season holding its last Episode, unwatched forgets
  // that Episode, stamped so older Device reports lose to it.
  const forget =
    !watched && !("episodeId" in target)
      ? [
          db
            .update(series)
            .set({ lastEpisodeId: null, lastEpisodeUpdatedAt: now })
            .where(
              and(
                inArray(series.id, [...new Set(rows.map((episode) => episode.seriesId))]),
                inArray(
                  series.lastEpisodeId,
                  rows.map((episode) => episode.id)
                )
              )
            ),
        ]
      : [];
  await applyWrites(db, [
    ...rows.map((episode) =>
      db
        .update(episodes)
        .set(markedWatched(episode, watched, now))
        .where(eq(episodes.id, episode.id))
    ),
    ...forget,
  ]);
};

/** Removes the Series from the app only; resolves its poster copy for cleanup. */
export const forgetSeries = async (
  db: Database,
  id: string
): Promise<{ posterPath: string | null } | null> => {
  const [row] = await db.select().from(series).where(eq(series.id, id)).limit(1);
  if (!row) return null;
  // Children first, whether or not the connection enforces cascades.
  const ofSeries = db.select({ id: episodes.id }).from(episodes).where(eq(episodes.seriesId, id));
  await applyWrites(db, [
    db.delete(captions).where(inArray(captions.episodeId, ofSeries)),
    db.delete(episodes).where(eq(episodes.seriesId, id)),
    db.delete(seasons).where(eq(seasons.seriesId, id)),
    db.delete(series).where(eq(series.id, id)),
  ]);
  return { posterPath: row.posterPath };
};
