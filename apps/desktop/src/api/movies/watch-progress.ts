import { getWatchState, isPlayedEnough, type WatchState } from "@/lib/watch-state";

// Watch progress of a Movie or Episode, with the Video rules. Pure, so Movies and
// Episodes (and Device reports) share one rule.

export type WatchProgress = {
  positionSeconds: number | null;
  watchedAt: number | null;
  watchUpdatedAt: number | null;
};

// Playback stopped at `positionSeconds`; once about 90% has played it stays watched.
export const playedTo = (
  existing: Pick<WatchProgress, "watchedAt">,
  positionSeconds: number,
  durationSeconds: number | null,
  now: number
): WatchProgress => ({
  positionSeconds: Math.max(0, Math.floor(positionSeconds)),
  watchedAt: existing.watchedAt ?? (isPlayedEnough(positionSeconds, durationSeconds) ? now : null),
  watchUpdatedAt: now,
});

// Marked watched, or back to unwatched (which also forgets where playback stopped).
export const markedWatched = (
  existing: Pick<WatchProgress, "positionSeconds">,
  watched: boolean,
  now: number
): WatchProgress =>
  watched
    ? { positionSeconds: existing.positionSeconds, watchedAt: now, watchUpdatedAt: now }
    : { positionSeconds: 0, watchedAt: null, watchUpdatedAt: now };

export const watchStateOf = (
  progress: Pick<WatchProgress, "positionSeconds" | "watchedAt">
): WatchState =>
  getWatchState({ watchedAt: progress.watchedAt, lastPositionSeconds: progress.positionSeconds });
