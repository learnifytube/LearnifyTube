import { and, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { audiobooks, audiobookTracks } from "@/api/db/schema";
import type { AudiobookListening } from "../../../../shared/mobile-sync-contract";
import { newestListening } from "../../../../shared/listening-position";

/**
 * Keeps a Device's Listening position when it is newer than the Audiobook's.
 * Positions in unknown Audiobooks, or in Tracks not of that Audiobook, are ignored.
 * Resolves true when the reported position was kept.
 */
export const recordListening = async (
  db: Database,
  reported: AudiobookListening
): Promise<boolean> => {
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
  if (!book || !track) return false;
  const existing = book.updatedAt === null ? null : { updatedAt: book.updatedAt };
  if (newestListening(existing, reported) !== reported) return false;
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
  return true;
};

export type DesktopListening = { listening: AudiobookListening; announce: boolean };

/**
 * The desktop Book player's own Listening position. A kept position from a
 * meaningful moment (pause, Track change, finish) is announced so open phones
 * refresh; periodic saves while playing are kept quietly.
 */
export const recordDesktopListening = async (
  db: Database,
  { listening, announce }: DesktopListening,
  announceAudiobooksChanged: () => void
): Promise<void> => {
  const kept = await recordListening(db, listening);
  if (kept && announce) announceAudiobooksChanged();
};
