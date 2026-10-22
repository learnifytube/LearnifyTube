import type { Series } from "../../../shared/mobile-sync-contract";
import { seriesEpisodes } from "../../services/movie-watch/seriesWatch";

export type SeriesRowItem = {
  series: Series;
  /** Offline mode and not on this phone: shown dimmed, tapping does nothing. */
  needsDesktop: boolean;
};

/**
 * The cards of the Series Home row: the desktop's Series (its latest catalog,
 * or the last one seen in Offline mode) with an Episode that can play. No
 * Episode is held on the phone yet, so in Offline mode each one Needs the desktop.
 */
export function seriesRowItems({
  connected,
  series,
}: {
  connected: boolean;
  series: Series[];
}): SeriesRowItem[] {
  return series
    .filter((item) => seriesEpisodes(item).some((episode) => !episode.missing))
    .map((item) => ({ series: item, needsDesktop: !connected }));
}
