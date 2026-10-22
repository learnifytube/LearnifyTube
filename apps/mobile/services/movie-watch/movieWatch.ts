import type {
  MovieWatch,
  TitleWatch,
} from "../../../shared/mobile-sync-contract";

/** The Video rule: about 90% played is the end, so credits don't hold a resume point. */
const WATCHED_FRACTION = 0.9;

/**
 * Where a Movie or Episode is now: the newer of the desktop's Watch state and
 * this Device's own progress. A desktop change made after this Device last
 * played wins, as it does on the desktop.
 */
export function currentMovieWatch(
  watch: TitleWatch | null,
  kept: MovieWatch | undefined,
) {
  if (kept && kept.lastWatchedAt > (watch?.updatedAt ?? 0)) {
    return {
      positionSeconds: kept.lastPositionSeconds,
      updatedAt: kept.lastWatchedAt,
    };
  }
  return watch
    ? { positionSeconds: watch.positionSeconds, updatedAt: watch.updatedAt }
    : null;
}

/** Where a tap on a Movie or Episode starts playing: where it was left, unless that was the end. */
export function resumeAt({
  watch,
  kept,
  durationSeconds,
}: {
  watch: TitleWatch | null;
  kept: MovieWatch | undefined;
  durationSeconds: number | null;
}) {
  const position = currentMovieWatch(watch, kept)?.positionSeconds ?? 0;
  if (durationSeconds && position >= durationSeconds * WATCHED_FRACTION) {
    return 0;
  }
  return position;
}
