import type { WatchState } from "@/lib/watch-state";

export type UpNextVideo = {
  videoId: string;
  keptAt: number;
  lastWatchedAt: number | null;
  watchState: WatchState;
};

// Home's Library sections: Continue watching (most recently played first) and
// Unwatched (newest kept first). Watched Videos are in neither.
export const selectUpNext = <T extends UpNextVideo>(
  videos: T[]
): { continueWatching: T[]; unwatched: T[] } => ({
  continueWatching: videos
    .filter((v) => v.watchState === "in-progress")
    .sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0) || b.keptAt - a.keptAt),
  unwatched: videos.filter((v) => v.watchState === "unwatched").sort((a, b) => b.keptAt - a.keptAt),
});
