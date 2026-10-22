import type {
  MovieWatch,
  TitleWatch,
} from "../../../shared/mobile-sync-contract";
import {
  isPlayedEnough,
  resumeAt as resumePosition,
} from "../../../shared/resume-at";

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

/** A desktop mark made after this Device last played. */
const markedOnDesktop = (
  watch: TitleWatch | null,
  current: { updatedAt: number } | null,
) => !!watch?.watched && watch.updatedAt === current?.updatedAt;

/**
 * Where a tap on a Movie or Episode starts playing, by the shared "resume at"
 * rule: where it was left, unless it was watched (played to about 90%, or
 * marked on the desktop after this Device last played).
 */
export function resumeAt({
  watch,
  kept,
  durationSeconds,
}: {
  watch: TitleWatch | null;
  kept: MovieWatch | undefined;
  durationSeconds: number | null;
}) {
  const current = currentMovieWatch(watch, kept);
  return resumePosition({
    positionSeconds: current?.positionSeconds ?? null,
    durationSeconds,
    watched: markedOnDesktop(watch, current),
  });
}

export type TitleWatchState = "unwatched" | "in-progress" | "watched";

/**
 * Whether a Movie or Episode is unwatched, in progress or watched, by the
 * newer of the desktop's Watch state and this Device's progress, and when that
 * last changed. A desktop mark made after this Device last played wins.
 */
export function watchStateOf({
  watch,
  kept,
  durationSeconds,
}: {
  watch: TitleWatch | null;
  kept: MovieWatch | undefined;
  durationSeconds: number | null;
}): { state: TitleWatchState; updatedAt: number | null } {
  const current = currentMovieWatch(watch, kept);
  if (!current) return { state: "unwatched", updatedAt: null };
  const { positionSeconds, updatedAt } = current;
  if (
    markedOnDesktop(watch, current) ||
    isPlayedEnough(positionSeconds, durationSeconds)
  ) {
    return { state: "watched", updatedAt };
  }
  return {
    state: positionSeconds > 0 ? "in-progress" : "unwatched",
    updatedAt,
  };
}
