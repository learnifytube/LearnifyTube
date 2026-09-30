import { getAppSurface } from "../../core/hooks/useAppSurface";
import { usePlaybackStore } from "../../stores/playback";
import { useTVHistoryStore } from "../../stores/tvHistory";
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
});
export type { PlayQueue } from "./createPlayQueue";
