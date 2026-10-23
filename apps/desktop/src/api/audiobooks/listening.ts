import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { audiobooks, audiobookTracks } from "@/api/db/schema";
import type { AudiobookListening } from "../../../../shared/mobile-sync-contract";
import { newestListening, trackPositionOfListening } from "../../../../shared/listening-position";
import { applyWrites, type Write } from "@/api/movies/batch-writes";
import { trackPositionWrites } from "./track-positions";

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
  // Its Track's own Track position, so older Devices that only send the
  // Listening position still move it (ADR-0006).
  const ofTrack = trackPositionOfListening(reported);
  const trackWrites = ofTrack ? await trackPositionWrites(db, ofTrack) : [];
  const existing = book.updatedAt === null ? null : { updatedAt: book.updatedAt };
  const kept = newestListening(existing, reported) === reported;
  await applyWrites(db, [...trackWrites, ...(kept ? [listeningWrite(db, reported)] : [])]);
  return kept;
};

// updated_at is left alone: it versions the cover URL, not the Listening position.
const listeningWrite = (db: Database, listening: AudiobookListening): Write =>
  db
    .update(audiobooks)
    .set({
      listeningTrackId: listening.trackId,
      listeningSeconds: Math.floor(listening.seconds),
      listeningUpdatedAt: listening.updatedAt,
      finished: listening.finished,
    })
    .where(eq(audiobooks.id, listening.audiobookId));

/**
 * Start over: every Track back to 0 and not played to its end, and the
 * Listening position at the first Track, all at `now`, so Device positions
 * from before it lose. All or nothing.
 */
export const startBookOver = async (
  db: Database,
  audiobookId: string,
  now: number
): Promise<void> => {
  const tracks = await db
    .select({ id: audiobookTracks.id })
    .from(audiobookTracks)
    .where(eq(audiobookTracks.audiobookId, audiobookId))
    .orderBy(asc(audiobookTracks.position));
  const [first] = tracks;
  if (!first) return;
  const trackWrites = await Promise.all(
    tracks.map((track) =>
      trackPositionWrites(db, {
        audiobookId,
        trackId: track.id,
        seconds: 0,
        playedToEnd: false,
        updatedAt: now,
      })
    )
  );
  const [book] = await db
    .select({ updatedAt: audiobooks.listeningUpdatedAt })
    .from(audiobooks)
    .where(eq(audiobooks.id, audiobookId))
    .limit(1);
  const listening = { audiobookId, trackId: first.id, seconds: 0, finished: false, updatedAt: now };
  if (!book) return;
  const existing = book.updatedAt === null ? null : { updatedAt: book.updatedAt };
  const kept = newestListening(existing, listening) === listening;
  await applyWrites(db, [...trackWrites.flat(), ...(kept ? [listeningWrite(db, listening)] : [])]);
};

export type DesktopListening = { listening: AudiobookListening; announce: boolean };

/**
 * The desktop Book player's own Listening position. A kept position from a
 * meaningful moment (pause, Track change, finish) of a book sent to Devices is
 * announced so open phones refresh; periodic saves while playing, and books
 * Devices don't have, are kept quietly.
 */
export const recordDesktopListening = async (
  db: Database,
  { listening, announce }: DesktopListening,
  announceAudiobooksChanged: () => void
): Promise<void> => {
  const kept = await recordListening(db, listening);
  if (!kept || !announce) return;
  await announceIfSent(db, listening.audiobookId, announceAudiobooksChanged);
};

/** Announces a change to an Audiobook when it is sent to Devices; books they don't have stay quiet. */
export const announceIfSent = async (
  db: Database,
  audiobookId: string,
  announceAudiobooksChanged: () => void
): Promise<void> => {
  const [book] = await db
    .select({ sentToDevices: audiobooks.sentToDevices })
    .from(audiobooks)
    .where(eq(audiobooks.id, audiobookId))
    .limit(1);
  if (book?.sentToDevices) announceAudiobooksChanged();
};
