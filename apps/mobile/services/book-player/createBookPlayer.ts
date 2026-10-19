import type { Audiobook } from "../../../shared/mobile-sync-contract";

export type Book = Pick<
  Audiobook,
  "id" | "title" | "author" | "coverUrl" | "tracks"
>;
export type BookTrack = Book["tracks"][number];

/** What the lock screen and notification show for the Track playing. */
export type NowPlaying = {
  bookTitle: string;
  trackTitle: string;
  author: string | null;
  coverUrl: string | null;
};

/** The audio output a book plays through, and where each Track plays from. */
export type BookAudioPlatform = {
  /** Where to play a Track from now, or null when it can't be played. */
  trackUri: (book: Book, track: BookTrack) => Promise<string | null>;
  /** Replaces whatever is loaded with this Track, at `startAt` seconds. */
  load: (uri: string, startAt: number, nowPlaying: NowPlaying) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  currentTime: () => number;
  /** Called when the loaded Track plays to its end. */
  onEnded: (listener: () => void) => () => void;
};

export type BookPlayerState =
  | { status: "idle" }
  | {
      /** `unavailable`: this Track has no source now (no held file, no desktop). */
      status: "playing" | "paused" | "unavailable";
      book: Book;
      trackIndex: number;
    }
  | { status: "finished"; book: Book };

/**
 * Plays an Audiobook from start to end: Track after Track in Track order,
 * skipping missing Tracks, until the last one ends. The platform decides where
 * each Track plays from and owns the audio output.
 */
export function createBookPlayer(platform: BookAudioPlatform) {
  let state: BookPlayerState = { status: "idle" };
  const listeners = new Set<() => void>();
  // Each Track change takes a ticket; a slower, older one gives way.
  let ticket = 0;
  let pending: Promise<void> = Promise.resolve();

  const setState = (next: BookPlayerState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  // Plays the first Track from `fromIndex` on that isn't missing.
  const startTrack = async (
    book: Book,
    fromIndex: number,
    startAt: number,
    mine: number,
  ) => {
    const trackIndex = book.tracks.findIndex(
      (track, index) => index >= fromIndex && !track.missing,
    );
    const track = book.tracks[trackIndex];
    if (!track) {
      platform.stop();
      setState({ status: "finished", book });
      return;
    }
    const uri = await platform.trackUri(book, track);
    if (mine !== ticket) return;
    if (!uri) {
      platform.stop();
      setState({ status: "unavailable", book, trackIndex });
      return;
    }
    platform.load(uri, startAt, {
      bookTitle: book.title,
      trackTitle: track.title,
      author: book.author,
      coverUrl: book.coverUrl,
    });
    platform.play();
    setState({ status: "playing", book, trackIndex });
  };

  const goTo = (book: Book, fromIndex: number, startAt: number) => {
    pending = startTrack(book, fromIndex, startAt, ++ticket);
    return pending;
  };

  platform.onEnded(() => {
    if (state.status !== "playing") return;
    void goTo(state.book, state.trackIndex + 1, 0);
  });

  return {
    /** Starts a book at its first Track. */
    play: (book: Book) => goTo(book, 0, 0),
    pause: () => {
      if (state.status !== "playing") return;
      platform.pause();
      setState({ ...state, status: "paused" });
    },
    resume: () => {
      if (state.status !== "paused") return;
      platform.play();
      setState({ ...state, status: "playing" });
    },
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Resolves once the Track change in flight has happened. */
    settled: () => pending,
  };
}

export type BookPlayer = ReturnType<typeof createBookPlayer>;
