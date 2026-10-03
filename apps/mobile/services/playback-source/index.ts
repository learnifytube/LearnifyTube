import { api } from "../api";
import { desktopConnection } from "../desktop-connection";
import { desktopFetch } from "../desktop-fetch";
import { logger } from "../logger";
import { offlineCopy } from "../offline-copy";
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

// The phone player; the address is the connection store's current desktop.
export const phonePlaybackSource = createPlaybackSource({
  getDesktop: () => {
    const url = useConnectionStore.getState().serverUrl;
    return url
      ? { status: "connected" as const, url }
      : { status: "offline" as const, url: null };
  },
  onDesktopChange: (listener) =>
    useConnectionStore.subscribe((state, previous) => {
      if (state.serverUrl !== previous.serverUrl) listener();
    }),
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
