import { getAppSurface } from "../../core/hooks/useAppSurface";
import { isVideoWatched } from "../../db/repositories/watchHistory";
import {
  currentVideoOf,
  useCurrentVideosStore,
} from "../../stores/currentVideos";
import { usePlaybackStore } from "../../stores/playback";
import { useTVHistoryStore } from "../../stores/tvHistory";
import { api } from "../api";
import { sendToResumeDesktop } from "../desktop-protocol";
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
    // a connected desktop that knows Current Videos (the shared protocol gate).
    keep: (currentVideo) => {
      useCurrentVideosStore.getState().keep(currentVideo);
      sendToResumeDesktop(
        (serverUrl) => api.reportCurrentVideo(serverUrl, currentVideo),
        "the Current Video",
      );
    },
  },
  isWatched: (video) => isVideoWatched(video.id, video.duration),
  now: () => Date.now(),
});
export { playableVideos } from "./createPlayQueue";
export type { ListVideo, PlayQueue } from "./createPlayQueue";
