import { api } from "../api";
import { desktopConnection } from "../desktop-connection";
import { desktopFetch } from "../desktop-fetch";
import { logger } from "../logger";
import { offlineCopy } from "../offline-copy";
import { createPlaybackSource } from "./createPlaybackSource";

// The TV's player; the address comes from the Desktop connection, never the play queue.
export const playbackSource = createPlaybackSource({
  getDesktop: desktopConnection.getState,
  onDesktopChange: desktopConnection.subscribe,
  offlineCopy,
  desktopFetch,
  streamUrl: api.getVideoFileUrl,
  log: (message, data) => logger.info(message, data),
});
export type {
  PlaybackFailure,
  PlaybackSourceKind,
  UpNext,
} from "./createPlaybackSource";
