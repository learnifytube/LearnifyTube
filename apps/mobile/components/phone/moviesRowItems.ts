import type { Movie } from "../../../shared/mobile-sync-contract";

export type MoviesRowItem = {
  movie: Movie;
  /** Offline mode and not on this phone: shown dimmed, tapping does nothing. */
  needsDesktop: boolean;
};

/**
 * The cards of the Movies Home row: the desktop's Movies (its latest catalog,
 * or the last one seen in Offline mode) that it can play. No Movie is held on
 * the phone yet, so in Offline mode each one Needs the desktop.
 */
export function moviesRowItems({
  connected,
  movies,
}: {
  connected: boolean;
  movies: Movie[];
}): MoviesRowItem[] {
  return movies
    .filter((movie) => !movie.missing)
    .map((movie) => ({ movie, needsDesktop: !connected }));
}
