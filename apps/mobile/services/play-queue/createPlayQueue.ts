import type { StreamingVideo } from "../../stores/playback";

export type PlayQueueStart = {
  id: string;
  title: string;
  videos: StreamingVideo[];
  startIndex: number;
};

export type PlayQueuePlatform = {
  setQueue: (queue: PlayQueueStart) => void;
  // TV history; null on the phone, which keeps none.
  recordHistory: ((queue: PlayQueueStart) => void) | null;
};

export function createPlayQueue(platform: PlayQueuePlatform) {
  return {
    // Starts playing `videos` from `startIndex` and returns the Video to open,
    // or null when there is nothing to play. The queue carries no desktop
    // address: players resolve the source when each Video starts.
    start: ({
      id,
      title,
      videos,
      startIndex = 0,
    }: Omit<PlayQueueStart, "startIndex"> & { startIndex?: number }) => {
      if (videos.length === 0) return null;
      const index = Math.min(Math.max(startIndex, 0), videos.length - 1);
      const queue = { id, title, videos, startIndex: index };
      platform.setQueue(queue);
      platform.recordHistory?.(queue);
      return videos[index];
    },
  };
}

export type PlayQueue = ReturnType<typeof createPlayQueue>;
