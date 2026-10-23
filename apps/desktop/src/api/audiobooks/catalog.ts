import path from "path";
import { asc, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { audiobooks, audiobookTracks } from "@/api/db/schema";
import { storedTrackPosition } from "@/lib/track-position";
import type { AudiobookCatalog, ListeningPosition } from "../../../../shared/mobile-sync-contract";

type TrackRow = typeof audiobookTracks.$inferSelect;

// A Track is named after its file, without the extension.
const trackTitle = (filePath: string): string => path.parse(filePath).name;

// The Track last played, at that Track's own Track position when that is the
// newer record. The book-level seconds stay filled in for Devices older than resume.
const listeningPosition = (
  book: typeof audiobooks.$inferSelect,
  tracks: TrackRow[]
): ListeningPosition | null => {
  if (
    book.listeningTrackId === null ||
    book.listeningSeconds === null ||
    book.listeningUpdatedAt === null
  ) {
    return null;
  }
  const listeningTrack = tracks.find((track) => track.id === book.listeningTrackId);
  const own = listeningTrack ? storedTrackPosition(listeningTrack) : null;
  return own && own.updatedAt > book.listeningUpdatedAt
    ? { trackId: book.listeningTrackId, seconds: own.seconds, updatedAt: own.updatedAt }
    : {
        trackId: book.listeningTrackId,
        seconds: book.listeningSeconds,
        updatedAt: book.listeningUpdatedAt,
      };
};

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
    audiobooks: books.map((book) => {
      const bookTracks = tracks.filter((track) => track.audiobookId === book.id);
      return {
        id: book.id,
        title: book.title,
        author: book.author,
        // Versioned, so a changed cover isn't shown from a Device's image cache.
        coverUrl: book.coverPath
          ? assetUrl(`/api/audiobook/${book.id}/cover?v=${book.updatedAt ?? book.createdAt}`)
          : null,
        tracks: bookTracks.map((track) => ({
          id: track.id,
          title: trackTitle(track.filePath),
          durationSeconds: track.durationSeconds,
          missing: track.missing,
          trackPosition: storedTrackPosition(track),
        })),
        listeningPosition: listeningPosition(book, bookTracks),
        finished: book.finished,
        sentToDevices: book.sentToDevices,
      };
    }),
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

/** The file of every Track of an imported Audiobook, as recorded. */
export const listTrackFilePaths = async (db: Database): Promise<string[]> => {
  const tracks = await db.select({ filePath: audiobookTracks.filePath }).from(audiobookTracks);
  return tracks.map((track) => track.filePath);
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
