import type { TrackPosition } from "./mobile-sync-contract";

export type TrackListenState = "not-started" | "in-progress" | "played-to-end";

/**
 * How far a Track has been listened to, from its Track position (ADR-0006),
 * for the desktop and phone Track lists alike. Pure.
 */
export const trackListenState = (
  position: TrackPosition | null | undefined,
): TrackListenState => {
  if (position?.playedToEnd) return "played-to-end";
  return (position?.seconds ?? 0) > 0 ? "in-progress" : "not-started";
};
