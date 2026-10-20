import { useSyncExternalStore } from "react";
import type { Audiobook } from "../../../shared/mobile-sync-contract";

/**
 * Why the phone holds a book: the user `pulled` it by playing it, or the
 * Audiobook Mirror brought it because the desktop sent it (`mirrored`).
 */
export type HoldReason = "pulled" | "mirrored";

/** A book held (or being fetched) on this phone, as saved between app runs. */
export type HeldBookRecord = {
  book: Audiobook;
  reasons: HoldReason[];
  /** The file on the phone of each Track fetched so far, by Track id. */
  trackUris: Record<string, string>;
  /** The book's cover on the phone, and the desktop cover URL it came from. */
  cover?: { uri: string; from: string };
  heldAt: number;
};

export type Hold = {
  book: Audiobook;
  reasons: HoldReason[];
  /** Tracks on the phone, and Tracks there are to fetch (missing ones don't count). */
  heldTracks: number;
  totalTracks: number;
  /** Every Track that isn't missing is on the phone: the book plays offline. */
  complete: boolean;
  /** The book's cover on the phone (a file:// URI), or null when none is stored. */
  coverUri: string | null;
};

export type HeldAudiobooksPlatform = {
  getServerUrl: () => string | null;
  /** Called when the desktop connection or the app's foreground state changes. */
  onConditionsChange: (listener: () => void) => () => void;
  /**
   * Fetches a Track's file from the desktop into the Storage location; returns
   * its URI. A fetch cut short (aborted, or the desktop dropped) leaves what it
   * got on the phone, and the next fetch of that Track carries on from there.
   */
  fetchTrack: (
    serverUrl: string,
    bookId: string,
    trackId: string,
    signal: AbortSignal,
  ) => Promise<string>;
  exists: (uri: string) => Promise<boolean>;
  /**
   * Fetches the book's cover from the desktop into the app's own storage (a
   * file:// URI, which the lock screen can load too); returns its URI.
   */
  fetchCover: (
    serverUrl: string,
    bookId: string,
    coverUrl: string,
    signal: AbortSignal,
  ) => Promise<string>;
  /** Deletes what a cut-short fetch of the Track left on the phone. */
  discardPartial: (trackId: string) => Promise<void>;
  remove: (uri: string) => Promise<void>;
  loadRecords: () => Promise<HeldBookRecord[]>;
  saveRecords: (records: HeldBookRecord[]) => void;
};

// What to fetch next for a held book: a Track, or its cover (trackId null).
type FetchJob =
  | { bookId: string; trackId: string }
  | { bookId: string; trackId: null; coverUrl: string };

const toHold = (record: HeldBookRecord): Hold => {
  const tracks = record.book.tracks.filter((track) => !track.missing);
  const heldTracks = tracks.filter(
    (track) => record.trackUris[track.id],
  ).length;
  return {
    book: record.book,
    reasons: record.reasons,
    heldTracks,
    totalTracks: tracks.length,
    complete: heldTracks === tracks.length,
    coverUri: record.cover?.uri ?? null,
  };
};

/**
 * Audiobooks held on this phone, whole. Holding a book fetches every Track
 * that isn't on the phone yet, one at a time, whenever the desktop is
 * connected, in the background too (for as long as the app runs); a Track
 * cut short carries on from where it stopped on the next connection. Files
 * go to the Storage location; the book's cover is stored with them, so it
 * shows with no desktop.
 */
export function createHeldAudiobooks(platform: HeldAudiobooksPlatform) {
  const records = new Map<string, HeldBookRecord>();
  const listeners = new Set<() => void>();
  let holds: ReadonlyMap<string, Hold> = new Map();
  let loaded = false;
  let ready: Promise<void> = Promise.resolve();
  let running: {
    bookId: string;
    /** The Track on its way, or null for the cover. */
    trackId: string | null;
    controller: AbortController;
    work: Promise<void>;
  } | null = null;
  // Tracks that failed since the last change of conditions; retried after it.
  const failed = new Set<string>();

  const changed = () => {
    if (loaded) platform.saveRecords([...records.values()]);
    holds = new Map(
      [...records].map(([bookId, record]) => [bookId, toHold(record)]),
    );
    for (const listener of listeners) listener();
  };

  const canRun = () => loaded && platform.getServerUrl() !== null;

  const coverKey = (bookId: string) => `cover:${bookId}`;

  // Each book's cover first (it is small and shows in every row), then its Tracks.
  const nextToFetch = (): FetchJob | null => {
    const ordered = [...records.values()].sort((a, b) => a.heldAt - b.heldAt);
    for (const { book, cover, trackUris } of ordered) {
      if (
        book.coverUrl &&
        cover?.from !== book.coverUrl &&
        !failed.has(coverKey(book.id))
      ) {
        return { bookId: book.id, trackId: null, coverUrl: book.coverUrl };
      }
      const track = book.tracks.find(
        (t) => !t.missing && !trackUris[t.id] && !failed.has(t.id),
      );
      if (track) return { bookId: book.id, trackId: track.id };
    }
    return null;
  };

  const storeTrack = async (bookId: string, trackId: string, uri: string) => {
    const record = records.get(bookId);
    // Removed from this phone while its Track was on the way.
    if (!record) {
      await platform.remove(uri).catch(() => {});
      return;
    }
    records.set(bookId, {
      ...record,
      trackUris: { ...record.trackUris, [trackId]: uri },
    });
    changed();
  };

  const storeCover = async (bookId: string, coverUrl: string, uri: string) => {
    const record = records.get(bookId);
    // Removed, or the desktop changed the cover while this one was on the way.
    if (record?.book.coverUrl !== coverUrl) {
      await platform.remove(uri).catch(() => {});
      return;
    }
    const previous = record.cover?.uri;
    records.set(bookId, { ...record, cover: { uri, from: coverUrl } });
    changed();
    if (previous && previous !== uri) {
      await platform.remove(previous).catch(() => {});
    }
  };

  function pump() {
    if (running || !canRun()) return;
    const serverUrl = platform.getServerUrl();
    const next = nextToFetch();
    if (!serverUrl || !next) return;
    const { bookId, trackId } = next;
    const controller = new AbortController();
    const fetching =
      next.trackId === null
        ? platform
            .fetchCover(serverUrl, bookId, next.coverUrl, controller.signal)
            .then((uri) => storeCover(bookId, next.coverUrl, uri))
        : platform
            .fetchTrack(serverUrl, bookId, next.trackId, controller.signal)
            .then((uri) => storeTrack(bookId, next.trackId, uri));
    const work = fetching
      .catch((error) => {
        if (controller.signal.aborted) return;
        failed.add(trackId ?? coverKey(bookId));
        console.warn("[HeldAudiobooks] Fetching for a held book failed", error);
      })
      .finally(() => {
        running = null;
        pump();
      });
    running = { bookId, trackId, controller, work };
  }

  // A newer snapshot of a held book; a cover the desktop dropped goes too.
  const withBook = (record: HeldBookRecord, book: Audiobook) => {
    if (!record.cover || book.coverUrl) return { ...record, book };
    void platform.remove(record.cover.uri).catch(() => {});
    return { ...record, book, cover: undefined };
  };

  // Changes wait for the saved holds, so they never shadow one.
  const afterLoad = (change: () => void) => {
    void ready.then(change);
  };

  const holdNow = (book: Audiobook, reason: HoldReason) => {
    const existing = records.get(book.id);
    const record = existing
      ? withBook(existing, book)
      : { book, reasons: [], trackUris: {}, heldAt: Date.now() };
    records.set(book.id, {
      ...record,
      reasons: record.reasons.includes(reason)
        ? record.reasons
        : [...record.reasons, reason],
    });
    changed();
    pump();
  };

  const hold = (book: Audiobook, reason: HoldReason) =>
    afterLoad(() => holdNow(book, reason));

  const pull = (book: Audiobook) =>
    afterLoad(() => {
      const mirrored = records.get(book.id)?.reasons.includes("mirrored");
      holdNow(book, mirrored ? "mirrored" : "pulled");
    });

  // Deletes the book's files on this phone (never anything on the desktop).
  const remove = async (bookId: string) => {
    await ready;
    const record = records.get(bookId);
    if (!record) return;
    records.delete(bookId);
    const cutShort = running?.bookId === bookId ? running : null;
    cutShort?.controller.abort();
    changed();
    const uris = [...Object.values(record.trackUris)];
    if (record.cover) uris.push(record.cover.uri);
    for (const uri of uris) {
      await platform.remove(uri).catch(() => {});
    }
    if (cutShort) {
      await cutShort.work;
      if (cutShort.trackId) {
        await platform.discardPartial(cutShort.trackId).catch(() => {});
      }
    }
  };

  const release = async (bookId: string, reason: HoldReason) => {
    await ready;
    const record = records.get(bookId);
    if (!record?.reasons.includes(reason)) return;
    const reasons = record.reasons.filter((r) => r !== reason);
    if (reasons.length === 0) return remove(bookId);
    records.set(bookId, { ...record, reasons });
    changed();
  };

  // Newer snapshots of held books from the desktop's catalog (e.g. after a
  // Rescan added Tracks); books the phone doesn't hold are ignored.
  const refresh = (books: Audiobook[]) =>
    afterLoad(() => {
      let any = false;
      for (const book of books) {
        const record = records.get(book.id);
        if (!record) continue;
        records.set(book.id, withBook(record, book));
        any = true;
      }
      if (!any) return;
      changed();
      pump();
    });

  const start = () => {
    const unsubscribe = platform.onConditionsChange(() => {
      if (!canRun()) running?.controller.abort();
      else failed.clear();
      pump();
    });
    ready = platform
      .loadRecords()
      .then((stored) => {
        for (const record of stored) {
          if (!records.has(record.book.id)) records.set(record.book.id, record);
        }
      })
      .catch((error) => {
        console.warn("[HeldAudiobooks] Loading held books failed", error);
      })
      .finally(() => {
        loaded = true;
        changed();
        pump();
      });
    return unsubscribe;
  };

  const trackUri = async (trackId: string) => {
    await ready;
    for (const record of records.values()) {
      const uri = record.trackUris[trackId];
      if (uri) return (await platform.exists(uri)) ? uri : null;
    }
    return null;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    /** Loads the held books and fetches whatever is missing whenever it can. */
    start,
    /**
     * The user played the book: hold it whole until they remove it. A book
     * already held for the Mirror stays the Mirror's, as with Videos.
     */
    pull,
    /** Holds the book whole for this reason; the book snapshot replaces the saved one. */
    hold,
    /** Drops one reason to hold the book; deletes it from the phone when none is left. */
    release,
    /** Remove from this phone: deletes the book's files here, whatever the reason it was held. */
    remove,
    /** Updates held books from the desktop's latest catalog, fetching Tracks they gained. */
    refresh,
    /** The book's hold on this phone, or null when it holds none of it. */
    getHold: (bookId: string) => holds.get(bookId) ?? null,
    /** Every hold by book id as it stands now. */
    getHolds: () => holds,
    /** Every hold by book id, once the saved holds have loaded. */
    allHolds: async () => {
      await ready;
      return holds;
    },
    /** The Track's file on this phone when it is there and reachable, else null. */
    trackUri,
    subscribe,
    /** Every hold by book id, re-rendering as they change. */
    useHolds: () => useSyncExternalStore(subscribe, () => holds),
    /** Resolves once nothing is being fetched (tests, and waiting in screens). */
    idle: async () => {
      await ready;
      while (running) await running.work;
    },
  };
}

export type HeldAudiobooks = ReturnType<typeof createHeldAudiobooks>;
