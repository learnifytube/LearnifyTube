import type {
  Audiobook,
  AudiobookTrackPosition,
  TrackPosition,
} from "../../../shared/mobile-sync-contract";
import { newestWins } from "../../../shared/newest-wins";

/** Track positions kept on this phone, by Track id. */
export type KeptTrackPositions = Record<
  string,
  AudiobookTrackPosition | undefined
>;

const ownPosition = (kept: AudiobookTrackPosition | undefined) =>
  kept
    ? {
        seconds: kept.seconds,
        playedToEnd: kept.playedToEnd,
        updatedAt: kept.updatedAt,
      }
    : null;

/**
 * The book with each Track at the newest of the desktop's Track position and
 * the one kept on this phone (ADR-0006).
 */
export function withKeptTrackPositions<T extends Pick<Audiobook, "tracks">>(
  book: T,
  kept: KeptTrackPositions,
): T {
  return {
    ...book,
    tracks: book.tracks.map((track) => ({
      ...track,
      trackPosition: newestWins(
        track.trackPosition ?? null,
        ownPosition(kept[track.id]),
      ),
    })),
  };
}
