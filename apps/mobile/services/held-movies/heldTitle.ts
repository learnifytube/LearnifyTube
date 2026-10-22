import type {
  Episode,
  Movie,
  Series,
} from "../../../shared/mobile-sync-contract";
import type { HeldTitle } from "./types";

/** What a held Movie keeps of the desktop's catalog entry, to show it in Offline mode. */
export const heldTitleOfMovie = (movie: Movie): HeldTitle => ({
  kind: "movie",
  id: movie.id,
  title: movie.title,
  posterUrl: movie.posterUrl,
  durationSeconds: movie.durationSeconds,
});

/** A held Episode shows as "Series · Episode" with the Series poster. */
export const heldTitleOfEpisode = (
  series: Pick<Series, "title" | "posterUrl">,
  episode: Episode,
): HeldTitle => ({
  kind: "episode",
  id: episode.id,
  title: `${series.title} · ${episode.title}`,
  posterUrl: series.posterUrl,
  durationSeconds: episode.durationSeconds,
});
