import { create } from "zustand";

// A Video in the play queue. It carries no file location: the player asks the
// Offline copy module when each Video starts and streams when there is none.
export interface StreamingVideo {
  id: string;
  title: string;
  channelTitle: string;
  duration: number;
  thumbnailUrl?: string;
}

// The play queue's state. Start a queue through services/play-queue. It holds
// no desktop address: players resolve the source when each Video starts.
interface PlaybackStore {
  // Current playlist context
  playlistId: string | null;
  playlistTitle: string | null;
  playlistVideos: StreamingVideo[];
  currentIndex: number;

  // Actions
  startPlaylist: (
    playlistId: string,
    title: string,
    videos: StreamingVideo[],
    startIndex?: number
  ) => void;
  playNext: () => StreamingVideo | null;
  playPrevious: () => StreamingVideo | null;
  clearPlaylist: () => void;
  hasNext: () => boolean;
  hasPrevious: () => boolean;
  getCurrentVideo: () => StreamingVideo | null;
  setCurrentIndex: (index: number) => void;
}

export const usePlaybackStore = create<PlaybackStore>()((set, get) => ({
  playlistId: null,
  playlistTitle: null,
  playlistVideos: [],
  currentIndex: 0,

  startPlaylist: (playlistId, title, videos, startIndex = 0) => {
    set({
      playlistId,
      playlistTitle: title,
      playlistVideos: videos,
      currentIndex: startIndex,
    });
  },

  playNext: () => {
    const { playlistVideos, currentIndex } = get();
    if (currentIndex < playlistVideos.length - 1) {
      const nextIndex = currentIndex + 1;
      set({ currentIndex: nextIndex });
      return playlistVideos[nextIndex];
    }
    return null;
  },

  playPrevious: () => {
    const { playlistVideos, currentIndex } = get();
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      set({ currentIndex: prevIndex });
      return playlistVideos[prevIndex];
    }
    return null;
  },

  clearPlaylist: () => {
    set({
      playlistId: null,
      playlistTitle: null,
      playlistVideos: [],
      currentIndex: 0,
    });
  },

  hasNext: () => {
    const { playlistVideos, currentIndex } = get();
    return currentIndex < playlistVideos.length - 1;
  },

  hasPrevious: () => {
    const { currentIndex } = get();
    return currentIndex > 0;
  },

  getCurrentVideo: () => {
    const { playlistVideos, currentIndex } = get();
    return playlistVideos[currentIndex] ?? null;
  },

  setCurrentIndex: (index) => {
    const { playlistVideos } = get();
    if (index >= 0 && index < playlistVideos.length) {
      set({ currentIndex: index });
    }
  },

}));
