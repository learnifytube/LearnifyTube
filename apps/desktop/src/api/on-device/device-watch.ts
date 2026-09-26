import { isPlayedEnough } from "@/lib/watch-state";

export type DeviceWatchReport = {
  videoId: string;
  lastPositionSeconds: number;
  lastWatchedAt: number;
};

// What a Device's watch progress changes on the desktop, or null when the desktop has
// changed the Video since (including a manual mark), so the older Device progress loses.
export const mergeDeviceWatch = (
  existing: { updatedAt: number | null; watchedAt: number | null } | null,
  report: DeviceWatchReport,
  durationSeconds: number | null
): { lastPositionSeconds: number; lastWatchedAt: number; watchedAt: number | null } | null => {
  if (existing && report.lastWatchedAt <= (existing.updatedAt ?? 0)) return null;
  const playedEnough = isPlayedEnough(report.lastPositionSeconds, durationSeconds);
  return {
    lastPositionSeconds: Math.floor(report.lastPositionSeconds),
    lastWatchedAt: report.lastWatchedAt,
    watchedAt: existing?.watchedAt ?? (playedEnough ? report.lastWatchedAt : null),
  };
};
