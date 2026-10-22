import type { Movie } from "../../../shared/mobile-sync-contract";

export type MoviesRowItem = {
  movie: Movie;
  /** Offline mode and not on this phone: shown dimmed, tapping does nothing. */
  needsDesktop: boolean;
};

/**
 * The cards of the Movies Home row: the desktop's Movies (its latest catalog,
 * or the last one seen in Offline mode) that can play: the desktop has the
 * file, or this phone holds an Offline copy. In Offline mode a Movie without
 * one Needs the desktop.
 */
export function moviesRowItems({
  connected,
  movies,
  onThisPhone = () => false,
}: {
  connected: boolean;
  movies: Movie[];
  /** Whether this phone holds the Movie's Offline copy. */
  onThisPhone?: (id: string) => boolean;
}): MoviesRowItem[] {
  return movies
    .filter((movie) => !movie.missing || onThisPhone(movie.id))
    .map((movie) => ({
      movie,
      needsDesktop: !connected && !onThisPhone(movie.id),
    }));
}
