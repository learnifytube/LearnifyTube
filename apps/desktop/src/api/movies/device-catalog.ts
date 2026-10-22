import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { episodes, movies, seasons, series } from "@/api/db/schema";
import type { MovieCatalog, TitleWatch } from "../../../../shared/mobile-sync-contract";
import type { WatchProgress } from "./watch-progress";
import { captionsByOwner } from "./captions";

// What Devices see of the Movies section (ADR-0005): only titles Shown on Devices.

const titleWatch = (progress: WatchProgress): TitleWatch | null =>
  progress.watchUpdatedAt === null
    ? null
    : {
        positionSeconds: progress.positionSeconds ?? 0,
        watched: progress.watchedAt !== null,
        updatedAt: progress.watchUpdatedAt,
      };

/** GET /api/movies: every Movie and Series Shown on Devices, by title. */
export const loadMovieCatalog = async (
  db: Database,
  assetUrl: (pathname: string) => string
): Promise<MovieCatalog> => {
  const [movieRows, seriesRows, seasonRows, episodeRows, captionsOf] = await Promise.all([
    db.select().from(movies).where(eq(movies.shownOnDevices, true)).orderBy(asc(movies.title)),
    db.select().from(series).where(eq(series.shownOnDevices, true)).orderBy(asc(series.title)),
    db.select().from(seasons).orderBy(asc(seasons.position)),
    db.select().from(episodes).orderBy(asc(episodes.position)),
    captionsByOwner(db),
  ]);
  // Versioned, so a changed poster isn't shown from a Device's image cache.
  const posterUrl = (
    kind: "movie" | "series",
    row: (typeof movieRows)[number] | (typeof seriesRows)[number]
  ): string | null =>
    row.posterPath
      ? assetUrl(`/api/${kind}/${row.id}/poster?v=${row.updatedAt ?? row.createdAt}`)
      : null;

  return {
    movies: movieRows.map((movie) => ({
      id: movie.id,
      title: movie.title,
      posterUrl: posterUrl("movie", movie),
      durationSeconds: movie.durationSeconds,
      missing: movie.missing,
      captions: captionsOf.get(movie.id) ?? [],
      sentToDevices: movie.sentToDevices,
      watch: titleWatch(movie),
    })),
    series: seriesRows.map((show) => ({
      id: show.id,
      title: show.title,
      posterUrl: posterUrl("series", show),
      seasons: seasonRows
        .filter((season) => season.seriesId === show.id)
        .map((season) => ({
          id: season.id,
          title: season.title,
          number: season.number,
          sentToDevices: season.sentToDevices,
          episodes: episodeRows
            .filter((episode) => episode.seasonId === season.id)
            .map((episode) => ({
              id: episode.id,
              title: episode.title,
              number: episode.number,
              durationSeconds: episode.durationSeconds,
              missing: episode.missing,
              captions: captionsOf.get(episode.id) ?? [],
              watch: titleWatch(episode),
            })),
        })),
    })),
  };
};

export type MovieKind = "movie" | "episode";

/**
 * The recorded video file of a Movie or Episode Shown on Devices, found by id
 * (never by a path from the request), with the folder it was imported from.
 */
export const findMovieFileForDevices = async (
  db: Database,
  kind: MovieKind,
  id: string
): Promise<{ filePath: string; folder: string } | null> => {
  if (kind === "movie") {
    const [movie] = await db
      .select({ filePath: movies.filePath, folder: movies.sourceFolder })
      .from(movies)
      .where(and(eq(movies.id, id), eq(movies.shownOnDevices, true)))
      .limit(1);
    return movie ?? null;
  }
  const [episode] = await db
    .select({ filePath: episodes.filePath, folder: series.sourceFolder })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(and(eq(episodes.id, id), eq(series.shownOnDevices, true)))
    .limit(1);
  return episode ?? null;
};

/** The app-owned poster of a Movie or Series Shown on Devices. */
export const findPosterForDevices = async (
  db: Database,
  kind: "movie" | "series",
  id: string
): Promise<string | null> => {
  const table = kind === "movie" ? movies : series;
  const [row] = await db
    .select({ posterPath: table.posterPath })
    .from(table)
    .where(and(eq(table.id, id), eq(table.shownOnDevices, true)))
    .limit(1);
  return row?.posterPath ?? null;
};
