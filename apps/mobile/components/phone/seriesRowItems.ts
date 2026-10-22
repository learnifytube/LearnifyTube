import type { Series } from "../../../shared/mobile-sync-contract";
import { seriesEpisodes } from "../../services/movie-watch/seriesWatch";

export type SeriesRowItem = {
  series: Series;
  /** Offline mode and not on this phone: shown dimmed, tapping does nothing. */
  needsDesktop: boolean;
};

/**
 * The cards of the Series Home row: the desktop's Series (its latest catalog,
 * or the last one seen in Offline mode) with an Episode that can play. In
 * Offline mode a Series with no Episode on this phone Needs the desktop.
 */
export function seriesRowItems({
  connected,
  series,
  onThisPhone = () => false,
}: {
  connected: boolean;
  series: Series[];
  /** Whether this phone holds the Episode's Offline copy. */
  onThisPhone?: (episodeId: string) => boolean;
}): SeriesRowItem[] {
  return series
    .filter((item) => seriesEpisodes(item).some((episode) => !episode.missing))
    .map((item) => ({
      series: item,
      needsDesktop:
        !connected &&
        !seriesEpisodes(item).some((episode) => onThisPhone(episode.id)),
    }));
}
