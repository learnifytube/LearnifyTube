import type {
  Audiobook,
  AudiobookListening,
} from "../../../shared/mobile-sync-contract";
import { newestListening } from "../../../shared/listening-position";

/** Listening positions kept on this phone, by Audiobook id. */
export type KeptListening = Record<string, AudiobookListening | undefined>;

// The newest of the desktop's Listening position and the one kept on this phone.
export function currentListening(
  book: Audiobook,
  kept: AudiobookListening | null | undefined,
) {
  const fromDesktop = book.listeningPosition
    ? {
        ...book.listeningPosition,
        audiobookId: book.id,
        finished: book.finished,
      }
    : null;
  return newestListening(fromDesktop, kept ?? null);
}

/** Where tapping a book plays it from: its Listening position, or null for the start (also once finished). */
export function resumePoint(
  book: Audiobook,
  kept: AudiobookListening | null | undefined,
) {
  const listening = currentListening(book, kept);
  if (!listening || listening.finished) return null;
  return { trackId: listening.trackId, seconds: listening.seconds };
}

/** Continue listening: books started but not finished on any device, newest first. */
export function continueListening(books: Audiobook[], kept: KeptListening) {
  return books
    .flatMap((book) => {
      const listening = currentListening(book, kept[book.id]);
      return listening && !listening.finished
        ? [{ book, updatedAt: listening.updatedAt }]
        : [];
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ book }) => book);
}
