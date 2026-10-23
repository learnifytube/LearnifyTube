import { and, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { audiobookTracks } from "@/api/db/schema";
import { applyWrites, type Write } from "@/api/movies/batch-writes";
import type { AudiobookTrackPosition } from "../../../../shared/mobile-sync-contract";
import { newestWins } from "../../../../shared/newest-wins";

/**
 * The write that keeps a Track position when it is newer than the Track's own
 * (ADR-0006); none when it loses, or names a Track not of that Audiobook. (A
 * list, since an async function can't hand back a query unawaited: it would run.)
 */
export const trackPositionWrites = async (
  db: Database,
  reported: AudiobookTrackPosition
): Promise<Write[]> => {
  const [track] = await db
    .select({ updatedAt: audiobookTracks.resumeUpdatedAt })
    .from(audiobookTracks)
    .where(
      and(
        eq(audiobookTracks.id, reported.trackId),
        eq(audiobookTracks.audiobookId, reported.audiobookId)
      )
    )
    .limit(1);
  if (!track) return [];
  const existing = track.updatedAt === null ? null : { updatedAt: track.updatedAt };
  if (newestWins(existing, reported) !== reported) return [];
  return [
    db
      .update(audiobookTracks)
      .set({
        resumeSeconds: Math.floor(reported.seconds),
        playedToEnd: reported.playedToEnd,
        resumeUpdatedAt: reported.updatedAt,
      })
      .where(eq(audiobookTracks.id, reported.trackId)),
  ];
};

/**
 * Keeps a Track position when it is newer than the Track's own (ADR-0006).
 * Positions in unknown Audiobooks, or in Tracks not of that Audiobook, are ignored.
 * Resolves true when the reported position was kept.
 */
export const recordTrackPosition = async (
  db: Database,
  reported: AudiobookTrackPosition
): Promise<boolean> => {
  const writes = await trackPositionWrites(db, reported);
  await applyWrites(db, writes);
  return writes.length > 0;
};
