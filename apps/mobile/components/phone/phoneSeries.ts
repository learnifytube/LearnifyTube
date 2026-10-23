import type { Series } from "../../../shared/mobile-sync-contract";
import { heldSeries } from "../../services/movie-watch/seriesWatch";

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
