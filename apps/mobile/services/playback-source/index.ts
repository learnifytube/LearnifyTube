import { api } from "../api";
import { desktopConnection } from "../desktop-connection";
import { desktopFetch } from "../desktop-fetch";
import { logger } from "../logger";
import { movieOfflineCopy, offlineCopy } from "../offline-copy";
import { useConnectionStore } from "../../stores/connection";
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

// The phone players' desktop: the connection store's current one.
const phoneDesktop = {
  getDesktop: () => {
    const url = useConnectionStore.getState().serverUrl;
    return url
      ? { status: "connected" as const, url }
      : { status: "offline" as const, url: null };
  },
  onDesktopChange: (listener: () => void) =>
    useConnectionStore.subscribe((state, previous) => {
      if (state.serverUrl !== previous.serverUrl) listener();
    }),
};

// The phone player.
export const phonePlaybackSource = createPlaybackSource({
  ...phoneDesktop,
  offlineCopy,
  desktopFetch,
  streamUrl: api.getVideoFileUrl,
  log: (message, data) => logger.info(message, data),
});

// The phone's Movie player: the Offline copy when the Mirror or the user brought
// one, else a Stream; it never fetches or Downloads (ADR-0005).
export const phoneMoviePlaybackSource = createPlaybackSource({
  ...phoneDesktop,
  offlineCopy: movieOfflineCopy,
  desktopFetch: null,
  streamUrl: api.getMovieFileUrl,
  log: (message, data) => logger.info(message, data),
});

// The phone's Episode player, like Movies (Episodes share the Movies' Offline copies).
export const phoneEpisodePlaybackSource = createPlaybackSource({
  ...phoneDesktop,
  offlineCopy: movieOfflineCopy,
  desktopFetch: null,
  streamUrl: api.getEpisodeFileUrl,
  log: (message, data) => logger.info(message, data),
});

// The TV's Movie player: the Offline copy the Mirror brought, else a Stream from
// the Desktop connection; never fetches or Downloads (ADR-0005).
export const tvMoviePlaybackSource = createPlaybackSource({
  getDesktop: desktopConnection.getState,
  onDesktopChange: desktopConnection.subscribe,
  offlineCopy: movieOfflineCopy,
  desktopFetch: null,
  streamUrl: api.getMovieFileUrl,
  log: (message, data) => logger.info(message, data),
});

// The TV's Episode player, like the TV's Movies.
export const tvEpisodePlaybackSource = createPlaybackSource({
  getDesktop: desktopConnection.getState,
  onDesktopChange: desktopConnection.subscribe,
  offlineCopy: movieOfflineCopy,
  desktopFetch: null,
  streamUrl: api.getEpisodeFileUrl,
  log: (message, data) => logger.info(message, data),
});

export type {
  PlaybackFailure,
  PlaybackSourceKind,
  UpNext,
} from "./createPlaybackSource";
