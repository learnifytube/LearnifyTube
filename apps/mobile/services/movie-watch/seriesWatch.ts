import type {
  Episode,
  Movie,
  MovieWatch,
  Series,
} from "../../../shared/mobile-sync-contract";
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

/**
 * Where a Series picks up (the shared next-up rule, by the newer of the
 * desktop's and this phone's Watch progress of each Episode), and when any of
 * its Episodes was last watched (null before any was). Null once no unwatched
 * Episode is left.
 */
export function seriesNextUp(
  series: Series,
  keptEpisode: (episodeId: string) => MovieWatch | undefined,
): { episode: Episode; lastWatchedAt: number | null } | null {
  const episodes = episodesWithWatchState(series, keptEpisode);
  const next = nextUpEpisode(episodes);
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
