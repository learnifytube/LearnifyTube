import type { Movie } from "../../../shared/mobile-sync-contract";
import type { HeldTitle } from "./types";

/** What a held Movie keeps of the desktop's catalog entry, to show it in Offline mode. */
export const heldTitleOfMovie = (movie: Movie): HeldTitle => ({
  kind: "movie",
  id: movie.id,
  title: movie.title,
  posterUrl: movie.posterUrl,
  durationSeconds: movie.durationSeconds,
});
