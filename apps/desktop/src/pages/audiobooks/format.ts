/** How far a Track has been listened to, from its Track position (ADR-0006). */
export const trackListenState = (track: {
  resumeSeconds: number | null;
  playedToEnd: boolean;
}): "not-started" | "in-progress" | "played-to-end" => {
  if (track.playedToEnd) return "played-to-end";
  return (track.resumeSeconds ?? 0) > 0 ? "in-progress" : "not-started";
};

// "5h 12m", "42m", "3:05" for short Tracks; "" when unknown.
export const formatListeningTime = (seconds: number | null | undefined): string => {
  if (!seconds) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes >= 10) return `${minutes}m`;
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
};
