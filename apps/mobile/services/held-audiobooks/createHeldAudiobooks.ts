import { useSyncExternalStore } from "react";
import type { Book } from "../book-player/createBookPlayer";

/**
 * Why the phone holds a book: the user `pulled` it by playing it, or the
 * Audiobook Mirror brought it because the desktop sent it (`mirrored`).
 */
export type HoldReason = "pulled" | "mirrored";

/** A book held (or being fetched) on this phone, as saved between app runs. */
export type HeldBookRecord = {
  book: Book;
  reasons: HoldReason[];
  /** The file on the phone of each Track fetched so far, by Track id. */
  trackUris: Record<string, string>;
  heldAt: number;
};

export type Hold = {
  book: Book;
  reasons: HoldReason[];
  /** Tracks on the phone, and Tracks there are to fetch (missing ones don't count). */
  heldTracks: number;
  totalTracks: number;
  /** Every Track that isn't missing is on the phone: the book plays offline. */
  complete: boolean;
};

export type HeldAudiobooksPlatform = {
  getServerUrl: () => string | null;
  isForeground: () => boolean;
  /** Called when the desktop connection or the app's foreground state changes. */
  onConditionsChange: (listener: () => void) => () => void;
  /** Fetches a Track's file from the desktop into the Storage location; returns its URI. */
  fetchTrack: (
    serverUrl: string,
    bookId: string,
    trackId: string,
    signal: AbortSignal,
  ) => Promise<string>;
  exists: (uri: string) => Promise<boolean>;
  remove: (uri: string) => Promise<void>;
  loadRecords: () => Promise<HeldBookRecord[]>;
  saveRecords: (records: HeldBookRecord[]) => void;
};

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
  };
};

/**
 * Audiobooks held on this phone, whole. Holding a book fetches every Track
 * that isn't on the phone yet, one at a time, whenever the desktop is
 * connected and the app is in the foreground; a fetch cut short resumes on
 * the next connection. Files go to the Storage location.
 */
export function createHeldAudiobooks(platform: HeldAudiobooksPlatform) {
  const records = new Map<string, HeldBookRecord>();
  const listeners = new Set<() => void>();
  let holds: ReadonlyMap<string, Hold> = new Map();
  let loaded = false;
  let ready: Promise<void> = Promise.resolve();
  let running: {
    bookId: string;
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

  const canRun = () =>
    loaded && platform.getServerUrl() !== null && platform.isForeground();

  const nextToFetch = () => {
    const ordered = [...records.values()].sort((a, b) => a.heldAt - b.heldAt);
    for (const record of ordered) {
      const track = record.book.tracks.find(
        (t) => !t.missing && !record.trackUris[t.id] && !failed.has(t.id),
      );
      if (track) return { bookId: record.book.id, trackId: track.id };
    }
    return null;
  };

  function pump() {
    if (running || !canRun()) return;
    const serverUrl = platform.getServerUrl();
    const next = nextToFetch();
    if (!serverUrl || !next) return;
    const { bookId, trackId } = next;
    const controller = new AbortController();
    const work = platform
      .fetchTrack(serverUrl, bookId, trackId, controller.signal)
      .then(async (uri) => {
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
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        failed.add(trackId);
        console.warn("[HeldAudiobooks] Fetching a Track failed", error);
      })
      .finally(() => {
        running = null;
        pump();
      });
    running = { bookId, controller, work };
  }

  // Changes wait for the saved holds, so they never shadow one.
  const afterLoad = (change: () => void) => {
    void ready.then(change);
  };

  const holdNow = (book: Book, reason: HoldReason) => {
    const existing = records.get(book.id);
    records.set(book.id, {
      book,
      reasons: existing?.reasons.includes(reason)
        ? existing.reasons
        : [...(existing?.reasons ?? []), reason],
      trackUris: existing?.trackUris ?? {},
      heldAt: existing?.heldAt ?? Date.now(),
    });
    changed();
    pump();
  };

  const hold = (book: Book, reason: HoldReason) =>
    afterLoad(() => holdNow(book, reason));

  const pull = (book: Book) =>
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
    if (running?.bookId === bookId) running.controller.abort();
    changed();
    for (const uri of Object.values(record.trackUris)) {
      await platform.remove(uri).catch(() => {});
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
  const refresh = (books: Book[]) =>
    afterLoad(() => {
      let any = false;
      for (const book of books) {
        const record = records.get(book.id);
        if (!record) continue;
        records.set(book.id, { ...record, book });
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
