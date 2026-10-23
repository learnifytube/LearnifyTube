import type { SeriesLastEpisode } from "../../../shared/mobile-sync-contract";
import {
  createSendToResumeDesktop,
  type ResumeDesktopPlatform,
} from "../desktop-protocol/sendToResumeDesktop";

export type SeriesLastEpisodesPlatform = ResumeDesktopPlatform & {
  now: () => number;
  /** Keeps it on this Device (newest wins); the Device report carries it. */
  keep: (entry: SeriesLastEpisode) => void;
  post: (serverUrl: string, entry: SeriesLastEpisode) => Promise<void>;
};

/**
 * Each Series remembers the Episode last played (ADR-0006). Starting an
 * Episode keeps it on this Device and, while connected to a desktop that
 * shares it, tells the desktop at once; otherwise the next Device report does.
 */
export function createSeriesLastEpisodes(platform: SeriesLastEpisodesPlatform) {
  const send = createSendToResumeDesktop(platform);

  const episodeStarted = (seriesId: string, episodeId: string) => {
    const entry = { seriesId, episodeId, updatedAt: platform.now() };
    platform.keep(entry);
    send((serverUrl) => platform.post(serverUrl, entry), "the last Episode");
  };

  return { episodeStarted };
}
