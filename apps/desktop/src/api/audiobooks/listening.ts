import { and, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { audiobooks, audiobookTracks } from "@/api/db/schema";
import type { AudiobookListening } from "../../../../shared/mobile-sync-contract";
import { newestListening } from "../../../../shared/listening-position";

/**
 * Keeps a Device's Listening position when it is newer than the Audiobook's.
 * Positions in unknown Audiobooks, or in Tracks not of that Audiobook, are ignored.
 */
export const recordListening = async (db: Database, reported: AudiobookListening): Promise<void> => {
  const [[book], [track]] = await Promise.all([
    db
      .select({ updatedAt: audiobooks.listeningUpdatedAt })
      .from(audiobooks)
      .where(eq(audiobooks.id, reported.audiobookId))
      .limit(1),
    db
      .select({ id: audiobookTracks.id })
      .from(audiobookTracks)
      .where(
        and(
          eq(audiobookTracks.id, reported.trackId),
          eq(audiobookTracks.audiobookId, reported.audiobookId)
        )
      )
      .limit(1),
  ]);
  if (!book || !track) return;
  const existing = book.updatedAt === null ? null : { updatedAt: book.updatedAt };
  if (newestListening(existing, reported) !== reported) return;
  // updated_at is left alone: it versions the cover URL, not the Listening position.
  await db
    .update(audiobooks)
    .set({
      listeningTrackId: reported.trackId,
      listeningSeconds: Math.floor(reported.seconds),
      listeningUpdatedAt: reported.updatedAt,
      finished: reported.finished,
    })
    .where(eq(audiobooks.id, reported.audiobookId));
};
