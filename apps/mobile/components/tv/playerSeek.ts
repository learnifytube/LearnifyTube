export const SEEK_STEP_SECONDS = 10;

// Presses closer together than this add up, since the player's time lags a seek.
const PENDING_SEEK_MS = 1500;

export type PendingSeek = { target: number; at: number };

/** Whether the player may not have caught up with the last seek yet. */
export function isSeekPending(
  pending: PendingSeek | null,
  now: number,
): pending is PendingSeek {
  return pending !== null && now - pending.at < PENDING_SEEK_MS;
}

/** Where a 10-second seek lands, counting presses the player hasn't caught up with. */
export function planSeek({
  currentTime,
  duration,
  pending,
  now,
  direction,
}: {
  currentTime: number;
  duration: number;
  pending: PendingSeek | null;
  now: number;
  direction: 1 | -1;
}) {
  const from = isSeekPending(pending, now) ? pending.target : currentTime;
  const target = Math.max(0, from + direction * SEEK_STEP_SECONDS);
  const seek: PendingSeek = {
    target: duration > 0 ? Math.min(target, duration) : target,
    at: now,
  };
  return seek;
}

export function formatPlaybackTime(seconds: number) {
  const total =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
}
