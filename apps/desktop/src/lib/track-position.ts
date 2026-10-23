import type { TrackPosition } from "../../../shared/mobile-sync-contract";

/** The Track position columns of a stored Track. */
type StoredTrack = {
  resumeSeconds: number | null;
  playedToEnd: boolean;
  resumeUpdatedAt: number | null;
};

/** A stored Track's Track position (ADR-0006); null before the Track was ever played. */
export const storedTrackPosition = (track: StoredTrack): TrackPosition | null =>
  track.resumeUpdatedAt === null
    ? null
    : {
        seconds: track.resumeSeconds ?? 0,
        playedToEnd: track.playedToEnd,
        updatedAt: track.resumeUpdatedAt,
      };
