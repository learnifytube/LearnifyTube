import type { Series } from "../../../shared/mobile-sync-contract";
import type { MovieHold } from "../../services/held-movies/types";
import {
  heldSeries,
  seriesEpisodes,
} from "../../services/movie-watch/seriesWatch";

export type PhoneSeriesView =
  | { kind: "notFound" }
  | { kind: "needsDesktop" }
  | { kind: "ready"; series: Series };

/**
 * What the phone's Series screen shows: every Episode while connected; in
 * Offline mode only the Episodes this phone holds, else Needs the desktop.
 */
export function phoneSeriesView({
  series,
  connected,
  isHeld,
}: {
  series: Series | undefined;
  connected: boolean;
  /** Whether this phone holds the Episode's Offline copy. */
  isHeld: (episodeId: string) => boolean;
}): PhoneSeriesView {
  if (!series) return { kind: "notFound" };
  if (connected) return { kind: "ready", series };
  const held = heldSeries(series, isHeld);
  return held ? { kind: "ready", series: held } : { kind: "needsDesktop" };
}

/**
 * The Series' Download to this phone: the Episodes it pulls (every one that
 * isn't missing and isn't pulled yet, so the Mirror then never removes the ones
 * the desktop sent), and what the screen says of how many are on this phone.
 */
export function phoneSeriesDownload({
  series,
  holds,
  hasCopy,
}: {
  series: Series;
  holds: readonly Pick<MovieHold, "id" | "reasons">[];
  /** Whether this phone has the Episode's Offline copy. */
  hasCopy: (episodeId: string) => boolean;
}) {
  const episodes = seriesEpisodes(series).filter((episode) => !episode.missing);
  const pulled = new Set(
    holds
      .filter((hold) => hold.reasons.includes("pulled"))
      .map((hold) => hold.id),
  );
  const toPull = episodes.filter((episode) => !pulled.has(episode.id));
  const total = episodes.length;
  const onPhone = episodes.filter((episode) => hasCopy(episode.id)).length;
  const status =
    total === 0
      ? null
      : onPhone === total
        ? "On this phone"
        : toPull.length === 0
          ? `Downloading · ${onPhone} of ${total} on this phone`
          : onPhone > 0
            ? `${onPhone} of ${total} on this phone`
            : null;
  return { toPull, total, onPhone, status };
}
