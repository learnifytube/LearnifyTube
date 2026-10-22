import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StreamingVideo } from "./playback";
import {
  migrateTVHistory,
  recordPlayedQueue,
  recordPlayedTitle,
  recordQueueProgress,
  type TVHistoryEntry,
  type TVPlayedTitle,
} from "./tvHistoryEntries";

export type {
  TVHistoryEntry,
  TVRecentMovie,
  TVRecentPlaylist,
  TVRecentSeries,
} from "./tvHistoryEntries";

interface TVHistoryStore {
  /** Newest first: Video queues, Movies and Series played on this TV. */
  entries: TVHistoryEntry[];
  upsertRecentPlaylist: (params: {
    playlistId: string;
    title: string;
    videos: StreamingVideo[];
    startIndex: number;
  }) => void;
  updateRecentPlaylistProgress: (params: {
    playlistId: string;
    currentIndex: number;
    currentVideoId?: string | null;
  }) => void;
  /** A Movie, or an Episode of a Series, started playing. */
  recordTitle: (title: TVPlayedTitle) => void;
  clearRecentPlaylists: () => void;
}

export const useTVHistoryStore = create<TVHistoryStore>()(
  persist(
    (set, get) => ({
      entries: [],
      upsertRecentPlaylist: (queue) =>
        set({ entries: recordPlayedQueue(get().entries, queue, Date.now()) }),
      updateRecentPlaylistProgress: (progress) =>
        set({
          entries: recordQueueProgress(get().entries, progress, Date.now()),
        }),
      recordTitle: (title) =>
        set({ entries: recordPlayedTitle(get().entries, title, Date.now()) }),
      clearRecentPlaylists: () => set({ entries: [] }),
    }),
    {
      name: "learnify-tv-recent-playlists-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ entries: state.entries }),
      version: 3,
      migrate: migrateTVHistory,
    },
  ),
);
