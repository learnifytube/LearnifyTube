import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StreamingVideo } from "./playback";

const MAX_RECENT_PLAYLISTS = 20;

export interface TVRecentPlaylist {
  playlistId: string;
  title: string;
  videos: StreamingVideo[];
  lastIndex: number;
  lastVideoId: string | null;
  serverUrl: string | null;
  updatedAt: number;
}

interface TVHistoryStore {
  recentPlaylists: TVRecentPlaylist[];
  upsertRecentPlaylist: (params: {
    playlistId: string;
    title: string;
    videos: StreamingVideo[];
    startIndex: number;
    serverUrl?: string | null;
  }) => void;
  updateRecentPlaylistProgress: (params: {
    playlistId: string;
    currentIndex: number;
    currentVideoId?: string | null;
  }) => void;
  clearRecentPlaylists: () => void;
}

// Keep only the queue fields, so a location from an older version (or an
// object carrying extra fields) is never persisted.
function toHistoryVideo({
  id,
  title,
  channelTitle,
  duration,
  thumbnailUrl,
}: StreamingVideo) {
  return { id, title, channelTitle, duration, thumbnailUrl };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

export const useTVHistoryStore = create<TVHistoryStore>()(
  persist(
    (set, get) => ({
      recentPlaylists: [],

      upsertRecentPlaylist: ({
        playlistId,
        title,
        videos,
        startIndex,
        serverUrl,
      }) => {
        if (!playlistId || videos.length === 0) return;

        const safeIndex = clampIndex(startIndex, videos.length);
        const nextEntry: TVRecentPlaylist = {
          playlistId,
          title,
          videos: videos.map(toHistoryVideo),
          lastIndex: safeIndex,
          lastVideoId: videos[safeIndex]?.id ?? null,
          serverUrl: serverUrl ?? null,
          updatedAt: Date.now(),
        };

        const existing = get().recentPlaylists.filter(
          (item) => item.playlistId !== playlistId
        );

        set({
          recentPlaylists: [nextEntry, ...existing].slice(0, MAX_RECENT_PLAYLISTS),
        });
      },

      updateRecentPlaylistProgress: ({
        playlistId,
        currentIndex,
        currentVideoId,
      }) => {
        if (!playlistId) return;

        const next = get().recentPlaylists.map((item) => {
          if (item.playlistId !== playlistId) return item;

          const safeIndex = clampIndex(currentIndex, item.videos.length);
          return {
            ...item,
            lastIndex: safeIndex,
            lastVideoId: currentVideoId ?? item.videos[safeIndex]?.id ?? null,
            updatedAt: Date.now(),
          };
        });

        next.sort((a, b) => b.updatedAt - a.updatedAt);
        set({ recentPlaylists: next.slice(0, MAX_RECENT_PLAYLISTS) });
      },

      clearRecentPlaylists: () => {
        set({ recentPlaylists: [] });
      },
    }),
    {
      name: "learnify-tv-recent-playlists-v1",
      storage: createJSONStorage(() => AsyncStorage),
      // v0 persisted each Video's file location; drop it.
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Pick<TVHistoryStore, "recentPlaylists">;
        return {
          recentPlaylists: (state?.recentPlaylists ?? []).map((item) => ({
            ...item,
            videos: (item.videos ?? []).map(toHistoryVideo),
          })),
        };
      },
    }
  )
);

