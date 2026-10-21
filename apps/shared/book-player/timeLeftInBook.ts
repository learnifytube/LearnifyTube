import type { BookTrack } from "./createBookPlayer";

/**
 * How long the rest of a book takes to hear at this speed, in seconds: the
 * rest of the Track playing and every later Track that isn't missing. Null
 * when one of them has no known length.
 */
export const timeLeftInBook = ({
  tracks,
  trackIndex,
  elapsed,
  trackLength = 0,
  speed,
}: {
  tracks: BookTrack[];
  trackIndex: number;
  elapsed: number;
  /** The playing Track's length from its file, or 0 while unknown. */
  trackLength?: number;
  speed: number;
}) => {
  const playing =
    trackLength > 0 ? trackLength : tracks[trackIndex]?.durationSeconds;
  if (playing == null) return null;
  let left = Math.max(0, playing - elapsed);
  for (const track of tracks.slice(trackIndex + 1)) {
    if (track.missing) continue;
    if (track.durationSeconds === null) return null;
    left += track.durationSeconds;
  }
  return left / speed;
};

/** "2h 08m" or "45m", rounded up so a few seconds left still reads "1m". */
export const formatTimeLeft = (seconds: number) => {
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
};
