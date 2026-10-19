import type { Audiobook } from "../../../shared/mobile-sync-contract";
import type { Hold } from "../../services/held-audiobooks/createHeldAudiobooks";

export type AudiobooksRowItem = {
  book: Audiobook;
  /** Every Track is on this phone: it plays with no desktop. */
  onThisPhone: boolean;
  /** Offline mode and not on this phone: shown dimmed, tapping does nothing. */
  needsDesktop: boolean;
};

/**
 * The cards of the Audiobooks Home row: the desktop's books (its latest
 * catalog, or the last one seen in Offline mode), then books held on this
 * phone the desktop no longer lists, which stay until removed here.
 */
export function audiobooksRowItems({
  connected,
  catalog,
  holds,
}: {
  connected: boolean;
  catalog: Audiobook[] | null;
  holds: ReadonlyMap<string, Hold>;
}): AudiobooksRowItem[] {
  const listed = catalog ?? [];
  const listedIds = new Set(listed.map((book) => book.id));
  const unlisted = [...holds.values()]
    .filter((hold) => !listedIds.has(hold.book.id))
    .map((hold) => hold.book);
  return [...listed, ...unlisted].map((book) => {
    const onThisPhone = holds.get(book.id)?.complete ?? false;
    return { book, onThisPhone, needsDesktop: !connected && !onThisPhone };
  });
}
