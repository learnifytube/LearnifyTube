import { useEffect } from "react";
import { seriesLastEpisodes } from "../services/series-last-episode";

/**
 * Records the Episode as its Series' last Episode once it starts playing
 * (ADR-0006): kept on this Device, and sent to the desktop while connected.
 */
export function useLastEpisodeWhenStarted(
  seriesId: string | null,
  episodeId: string,
  started: boolean,
): void {
  useEffect(() => {
    if (!seriesId || !episodeId || !started) return;
    seriesLastEpisodes.episodeStarted(seriesId, episodeId);
  }, [seriesId, episodeId, started]);
}
