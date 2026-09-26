export type WatchState = "unwatched" | "in-progress" | "watched";

const WATCHED_FRACTION = 0.9;

// A Video counts as watched once about 90% of it has played.
export const isPlayedEnough = (positionSeconds: number, durationSeconds: number | null): boolean =>
  !!durationSeconds && durationSeconds > 0 && positionSeconds >= durationSeconds * WATCHED_FRACTION;

export const getWatchState = (stats: {
  watchedAt: number | null;
  lastPositionSeconds: number | null;
}): WatchState => {
  if (stats.watchedAt) return "watched";
  if ((stats.lastPositionSeconds ?? 0) > 0) return "in-progress";
  return "unwatched";
};
