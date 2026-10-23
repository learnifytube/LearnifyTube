import {
  RESUME_SYNC_PROTOCOL_VERSION,
  type SeriesLastEpisode,
} from "../../../shared/mobile-sync-contract";
import { supportsProtocol } from "../desktop-protocol/supportsProtocol";

export type SeriesLastEpisodesPlatform = {
  now: () => number;
  /** Keeps it on this Device (newest wins); the Device report carries it. */
  keep: (entry: SeriesLastEpisode) => void;
  getServerUrl: () => string | null;
  /** The connected desktop's sync protocol version, null until learnt. */
  knownDesktopVersion: (serverUrl: string) => number | null;
  post: (serverUrl: string, entry: SeriesLastEpisode) => Promise<void>;
};

/**
 * Each Series remembers the Episode last played (ADR-0006). Starting an
 * Episode keeps it on this Device and, while connected to a desktop that
 * shares it, tells the desktop at once; otherwise the next Device report does.
 */
export function createSeriesLastEpisodes(platform: SeriesLastEpisodesPlatform) {
  const episodeStarted = (seriesId: string, episodeId: string) => {
    const entry = { seriesId, episodeId, updatedAt: platform.now() };
    platform.keep(entry);
    const serverUrl = platform.getServerUrl();
    if (!serverUrl) return;
    const version = platform.knownDesktopVersion(serverUrl);
    if (!supportsProtocol(version, RESUME_SYNC_PROTOCOL_VERSION)) return;
    platform.post(serverUrl, entry).catch((error) => {
      console.warn(
        "[SeriesLastEpisode] Sending the last Episode failed",
        error,
      );
    });
  };

  return { episodeStarted };
}
