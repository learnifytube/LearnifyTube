import path from "path";
import { asc, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { audiobooks, audiobookTracks } from "@/api/db/schema";
import type { AudiobookCatalog, ListeningPosition } from "../../../../shared/mobile-sync-contract";

// A Track is named after its file, without the extension.
const trackTitle = (filePath: string): string => path.parse(filePath).name;

const listeningPosition = (book: typeof audiobooks.$inferSelect): ListeningPosition | null =>
  book.listeningTrackId !== null &&
  book.listeningSeconds !== null &&
  book.listeningUpdatedAt !== null
    ? {
        trackId: book.listeningTrackId,
        seconds: book.listeningSeconds,
        updatedAt: book.listeningUpdatedAt,
      }
    : null;

/**
 * Every imported Audiobook for Devices, its Tracks in Track order.
 * `assetUrl` makes a desktop path into a URL a Device can fetch.
 */
export const loadAudiobookCatalog = async (
  db: Database,
  assetUrl: (pathname: string) => string
): Promise<AudiobookCatalog> => {
  const [books, tracks] = await Promise.all([
    db.select().from(audiobooks).orderBy(asc(audiobooks.title)),
    db.select().from(audiobookTracks).orderBy(asc(audiobookTracks.position)),
  ]);
  return {
    audiobooks: books.map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      // Versioned, so a changed cover isn't shown from a Device's image cache.
      coverUrl: book.coverPath
        ? assetUrl(`/api/audiobook/${book.id}/cover?v=${book.updatedAt ?? book.createdAt}`)
        : null,
      tracks: tracks
        .filter((track) => track.audiobookId === book.id)
        .map((track) => ({
          id: track.id,
          title: trackTitle(track.filePath),
          durationSeconds: track.durationSeconds,
          missing: track.missing,
        })),
      listeningPosition: listeningPosition(book),
      finished: book.finished,
      sentToDevices: book.sentToDevices,
    })),
  };
};

export const findTrackFilePath = async (db: Database, trackId: string): Promise<string | null> => {
  const [track] = await db
    .select({ filePath: audiobookTracks.filePath })
    .from(audiobookTracks)
    .where(eq(audiobookTracks.id, trackId))
    .limit(1);
  return track?.filePath ?? null;
};

export const findAudiobookCoverPath = async (
  db: Database,
  audiobookId: string
): Promise<string | null> => {
  const [book] = await db
    .select({ coverPath: audiobooks.coverPath })
    .from(audiobooks)
    .where(eq(audiobooks.id, audiobookId))
    .limit(1);
  return book?.coverPath ?? null;
};
