export type WatchState = "unwatched" | "in-progress" | "watched";

// A Video counts as watched once about 90% of it has played.
export { isPlayedEnough } from "../../../shared/resume-at";

export const getWatchState = (stats: {
  watchedAt: number | null;
  lastPositionSeconds: number | null;
}): WatchState => {
  if (stats.watchedAt) return "watched";
  if ((stats.lastPositionSeconds ?? 0) > 0) return "in-progress";
  return "unwatched";
};
