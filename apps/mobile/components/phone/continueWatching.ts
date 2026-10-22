import type {
  Episode,
  Movie,
  MovieWatch,
  Series,
} from "../../../shared/mobile-sync-contract";
import { watchStateOf } from "../../services/movie-watch/movieWatch";
import { seriesNextUp } from "../../services/movie-watch/seriesWatch";
import type { StreamingVideo } from "../../stores/playback";

export type ContinueWatchingItem =
  | {
      kind: "video";
      video: StreamingVideo;
      /** Its place in the row's Videos, which play as one Play queue. */
      videoIndex: number;
      lastWatchedAt: number | null;
    }
  | {
      kind: "movie";
      movie: Movie;
      lastWatchedAt: number | null;
      /** Offline mode and not on this phone: shown dimmed, tapping does nothing. */
      needsDesktop: boolean;
    }
  | {
      kind: "episode";
      series: Series;
      /** The Series' next-up Episode. */
      episode: Episode;
      lastWatchedAt: number | null;
      needsDesktop: boolean;
    };

export type ContinueWatchingInput = {
  connected: boolean;
  /** The Continue watching Videos this phone can play now, newest first. */
  videos: { video: StreamingVideo; lastWatchedAt: number | null }[];
  /** The desktop's Movies and Series (in Offline mode the last catalog seen). */
  movies: Movie[];
  series: Series[];
  /** This phone's own progress in a Movie or Episode. */
  kept: (kind: MovieWatch["kind"], id: string) => MovieWatch | undefined;
  /** Whether this phone holds the Movie's or Episode's Offline copy. */
  onThisPhone?: (id: string) => boolean;
};

/**
 * The phone's Continue watching row: Videos, Movies in progress and each
 * started Series' next Episode, newest first. A Movie leaves once watched
 * anywhere (a desktop mark wins); a Series once no unwatched Episode remains.
 * In Offline mode a Movie or Episode without an Offline copy here Needs the desktop.
 */
export function mergeContinueWatching(
  input: ContinueWatchingInput,
): ContinueWatchingItem[] {
  const onThisPhone = input.onThisPhone ?? (() => false);
  const needsDesktop = (id: string) => !input.connected && !onThisPhone(id);
  const videos = input.videos.map(
    ({ video, lastWatchedAt }, videoIndex): ContinueWatchingItem => ({
      kind: "video",
      video,
      videoIndex,
      lastWatchedAt,
    }),
  );
  const movies = input.movies.flatMap((movie): ContinueWatchingItem[] => {
    if (movie.missing) return [];
    const { state, updatedAt } = watchStateOf({
      watch: movie.watch,
      kept: input.kept("movie", movie.id),
      durationSeconds: movie.durationSeconds,
    });
    if (state !== "in-progress") return [];
    return [
      {
        kind: "movie",
        movie,
        lastWatchedAt: updatedAt,
        needsDesktop: needsDesktop(movie.id),
      },
    ];
  });
  const episodes = input.series.flatMap((series): ContinueWatchingItem[] => {
    const next = seriesNextUp(series, (id) => input.kept("episode", id));
    // Not started yet, or nothing left to watch.
    if (!next || next.lastWatchedAt === null) return [];
    return [
      {
        kind: "episode",
        series,
        episode: next.episode,
        lastWatchedAt: next.lastWatchedAt,
        needsDesktop: needsDesktop(next.episode.id),
      },
    ];
  });
  return [...videos, ...movies, ...episodes].sort(
    (a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0),
  );
}
