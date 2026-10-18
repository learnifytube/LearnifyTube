/**
 * Formats a timestamp in seconds to mm:ss (or h:mm:ss if >= 1 hour).
 */
export function formatPlayerTime(seconds: number): string {
  const total =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
}

/**
 * Calculates seek target in seconds from a touch coordinate along the scrubber track.
 */
export function calculateScrubTime(
  touchX: number,
  trackWidth: number,
  duration: number,
): number {
  if (trackWidth <= 0 || duration <= 0 || !Number.isFinite(duration)) {
    return 0;
  }
  const ratio = Math.max(0, Math.min(1, touchX / trackWidth));
  return ratio * duration;
}

/**
 * Calculates current progress percentage [0..100] given current position and total duration.
 */
export function calculateProgressPercent(
  currentTime: number,
  duration: number,
): number {
  if (duration <= 0 || !Number.isFinite(duration)) {
    return 0;
  }
  const ratio = currentTime / duration;
  return Math.max(0, Math.min(100, ratio * 100));
}
