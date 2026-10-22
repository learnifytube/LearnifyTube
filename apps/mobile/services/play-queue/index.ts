import { RESUME_SYNC_PROTOCOL_VERSION } from "../../../shared/mobile-sync-contract";
import { getAppSurface } from "../../core/hooks/useAppSurface";
import { isVideoWatched } from "../../db/repositories/watchHistory";
import { useConnectionStore } from "../../stores/connection";
import {
  currentVideoOf,
  useCurrentVideosStore,
} from "../../stores/currentVideos";
import { usePlaybackStore } from "../../stores/playback";
import { useTVHistoryStore } from "../../stores/tvHistory";
import { api } from "../api";
import { desktopSpeaks } from "../desktop-protocol";
import { createPlayQueue } from "./createPlayQueue";

export const playQueue = createPlayQueue({
  setQueue: ({ id, title, videos, startIndex }) =>
    usePlaybackStore.getState().startPlaylist(id, title, videos, startIndex),
  recordHistory:
    getAppSurface() === "tv"
      ? ({ id, title, videos, startIndex }) =>
          useTVHistoryStore
            .getState()
            .upsertRecentPlaylist({ playlistId: id, title, videos, startIndex })
      : null,
  currentVideos: {
    get: (collection) =>
      currentVideoOf(
        useCurrentVideosStore.getState().currentVideos,
        collection,
      ),
    // Kept on the Device (the next Device report carries it), and sent live to
    // a connected desktop that knows Current Videos.
    keep: (currentVideo) => {
      useCurrentVideosStore.getState().keep(currentVideo);
      const serverUrl = useConnectionStore.getState().serverUrl;
      if (!serverUrl) return;
      desktopSpeaks(serverUrl, RESUME_SYNC_PROTOCOL_VERSION)
        .then((speaks) =>
          speaks ? api.reportCurrentVideo(serverUrl, currentVideo) : undefined,
        )
        .catch((error) => {
          console.warn("[PlayQueue] Reporting the Current Video failed", error);
        });
    },
  },
  isWatched: (video) => isVideoWatched(video.id, video.duration),
  now: () => Date.now(),
});
export type { PlayQueue } from "./createPlayQueue";
