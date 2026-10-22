/**
 * Where a Video, Movie or Episode starts playing, for the desktop and Devices
 * alike (ADR-0006). Pure.
 */

/** About 90% played is the end, so credits don't hold a resume point. */
const WATCHED_FRACTION = 0.9;

/** Whether about 90% of a file has played; never when its length is unknown. */
export const isPlayedEnough = (
  positionSeconds: number,
  durationSeconds: number | null,
) =>
  !!durationSeconds &&
  durationSeconds > 0 &&
  positionSeconds >= durationSeconds * WATCHED_FRACTION;

/**
 * A watched file (about 90% played, or marked watched) starts from the
 * beginning; one in progress resumes where it stopped; one never played starts
 * from the beginning.
 */
export const resumeAt = ({
  positionSeconds,
  durationSeconds,
  watched = false,
}: {
  positionSeconds: number | null;
  durationSeconds: number | null;
  watched?: boolean;
}) => {
  const position = Math.max(0, positionSeconds ?? 0);
  if (watched || isPlayedEnough(position, durationSeconds)) return 0;
  return position;
};
