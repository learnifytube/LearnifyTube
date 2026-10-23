import type {
  Episode,
  LastEpisode,
  Movie,
  MovieWatch,
  Series,
} from "../../../shared/mobile-sync-contract";
import { newestWins } from "../../../shared/newest-wins";
import { episodeAfter, nextUpEpisode } from "../../../shared/series/nextUp";
import { watchStateOf } from "./movieWatch";

/** Every Episode of a Series in Series order: Season by Season, then Episode order. */
export function seriesEpisodes(series: Series) {
  return series.seasons.flatMap((season) => season.episodes);
}

function episodesWithWatchState(
  series: Series,
  keptEpisode: (episodeId: string) => MovieWatch | undefined,
) {
  return seriesEpisodes(series).map((episode) => {
    const { state, updatedAt } = watchStateOf({
      watch: episode.watch,
      kept: keptEpisode(episode.id),
      durationSeconds: episode.durationSeconds,
    });
    return {
      id: episode.id,
      missing: episode.missing,
      watchState: state,
      watchUpdatedAt: updatedAt,
      episode,
    };
  });
}

type EpisodeWithWatchState = ReturnType<typeof episodesWithWatchState>[number];

/**
 * The Episode a Series picks up from: the newer of the desktop's last Episode
 * and this Device's (ADR-0006). A desktop older than resume serves none, so
 * today's rule stands in: the Episode in progress that changed last.
 */
function lastEpisodeId(
  series: Series,
  episodes: EpisodeWithWatchState[],
  keptLastEpisode: LastEpisode | undefined,
) {
  if (series.lastEpisode === undefined) {
    return (
      episodes
        .filter((e) => !e.episode.missing && e.watchState === "in-progress")
        .reduce<EpisodeWithWatchState | null>(
          (latest, e) =>
            !latest || (e.watchUpdatedAt ?? 0) > (latest.watchUpdatedAt ?? 0)
              ? e
              : latest,
          null,
        )?.id ?? null
    );
  }
  return (
    newestWins(series.lastEpisode, keptLastEpisode ?? null)?.episodeId ?? null
  );
}

/**
 * Where a Series picks up (the shared next-up rule, by the newer of the
 * desktop's and this Device's Watch progress of each Episode and last
 * Episode), and when any of its Episodes was last watched (null before any
 * was). Null once no unwatched Episode is left.
 */
export function seriesNextUp(
  series: Series,
  keptEpisode: (episodeId: string) => MovieWatch | undefined,
  keptLastEpisode?: LastEpisode,
): { episode: Episode; lastWatchedAt: number | null } | null {
  const episodes = episodesWithWatchState(series, keptEpisode);
  const next = nextUpEpisode(
    episodes,
    lastEpisodeId(series, episodes, keptLastEpisode),
  );
  if (!next) return null;
  const lastWatchedAt = episodes.reduce<number | null>(
    (latest, { watchUpdatedAt }) =>
      watchUpdatedAt !== null && watchUpdatedAt > (latest ?? 0)
        ? watchUpdatedAt
        : latest,
    null,
  );
  return { episode: next.episode, lastWatchedAt };
}

/**
 * The Movie or Episode a player was opened on, from the last catalog the
 * desktop served. An Episode is named "Series · Episode" and shows the Series'
 * poster; `series` is null for a Movie.
 */
export function findTitle(
  catalog: { movies: Movie[]; series: Series[] },
  kind: MovieWatch["kind"],
  id: string,
) {
  if (kind === "movie") {
    const movie = catalog.movies.find((item) => item.id === id);
    return movie ? { ...movie, series: null } : null;
  }
  for (const series of catalog.series) {
    const episode = seriesEpisodes(series).find((item) => item.id === id);
    if (episode) {
      return {
        ...episode,
        title: `${series.title} · ${episode.title}`,
        posterUrl: series.posterUrl,
        series,
      };
    }
  }
  return null;
}

/** The Episode that autoplays after `episodeId` ends, skipping missing ones. */
export function seriesEpisodeAfter(series: Series, episodeId: string) {
  // Autoplay goes in order whatever was watched, so the Watch state is moot.
  const episodes = seriesEpisodes(series).map((episode) => ({
    id: episode.id,
    missing: episode.missing,
    watchState: "unwatched" as const,
    episode,
  }));
  return episodeAfter(episodes, episodeId)?.episode ?? null;
}
