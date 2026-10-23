import type {
  Audiobook,
  AudiobookTrackPosition,
  TrackPosition,
} from "../mobile-sync-contract";
import { newestWins } from "../newest-wins";
import { resumeAt } from "../resume-at";

export type Book = Pick<
  Audiobook,
  "id" | "title" | "author" | "coverUrl" | "tracks"
>;
export type BookTrack = Book["tracks"][number];

/** What the lock screen and notification show for the Track playing. */
export type NowPlaying = {
  bookId: string;
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
  /** Moves within the loaded Track. */
  seekTo: (seconds: number) => void;
  /** Sets the playback speed of the loaded Track, keeping pitch. */
  setRate: (rate: number) => void;
  /** Called when the loaded Track plays to its end. */
  onEnded: (listener: () => void) => () => void;
  /**
   * Called when the audio starts or stops playing by itself: audio focus lost
   * or regained (a call, another app), headphones unplugged, or the
   * lock-screen and notification controls.
   */
  onPlayingChange: (listener: (playing: boolean) => void) => () => void;
  /** Called when the loaded Track is ready to play. */
  onReady: (listener: () => void) => () => void;
  /** Called when the loaded Track can't be played (a file that 404s). */
  onFailed: (listener: () => void) => () => void;
};

/** A Track and a time inside it to start a book from. */
export type ListeningPoint = { trackId: string; seconds: number };

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
export function createBookPlayer(
  platform: BookAudioPlatform,
  options: BookPlayerOptions = {},
) {
  const speed = options.speed ?? createSpeedMemory();
  let state: BookPlayerState = { status: "idle" };
  const listeners = new Set<() => void>();
  const skipListeners = new Set<(tracks: BookTrack[]) => void>();
  const reportSkipped = (tracks: BookTrack[]) => {
    if (tracks.length === 0) return;
    for (const listener of skipListeners) listener(tracks);
  };
  // Each Track change takes a ticket; a slower, older one gives way.
  let ticket = 0;
  let pending: Promise<void> = Promise.resolve();
  // The Track a finished book ended on, kept for its Listening position.
  let lastTrack: BookTrack | null = null;
  // Where the Track change in flight is going, until it takes effect: the next
  // Previous or Next moves from there, not from the Track still playing.
  let heading: {
    book: Book;
    trackIndex: number;
    startAt: number;
    autoplay: boolean;
  } | null = null;

  const now = options.now ?? Date.now;
  // Track positions this player recorded, newer than the book it was handed
  // until the app passes a fresher one.
  const kept = new Map<string, TrackPosition>();
  const positionOf = (track: BookTrack) =>
    newestWins(track.trackPosition ?? null, kept.get(track.id) ?? null);
  const trackPositionListeners = new Set<
    (position: AudiobookTrackPosition) => void
  >();
  // The Track loaded in the audio output, until playback leaves it.
  let loaded: { book: Book; track: BookTrack } | null = null;
  // Records where the loaded Track was left (another Track, the book's end,
  // another book, close) as its Track position.
  const leave = (playedToEnd = false) => {
    if (!loaded) return;
    const position: AudiobookTrackPosition = {
      audiobookId: loaded.book.id,
      trackId: loaded.track.id,
      seconds: platform.currentTime(),
      playedToEnd,
      updatedAt: now(),
    };
    loaded = null;
    kept.set(position.trackId, position);
    for (const listener of trackPositionListeners) listener(position);
  };

  // Where a Track resumes: 0 once played to its end, else its Track position
  // (no 90% rule: a long chapter near its end still resumes).
  const startAtOf = (track: BookTrack) => {
    const position = positionOf(track);
    return resumeAt({
      positionSeconds: position?.seconds ?? null,
      durationSeconds: null,
      watched: position?.playedToEnd ?? false,
    });
  };

  const setState = (next: BookPlayerState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  // A Track that fails or never gets ready is skipped: on Android the audio
  // output reports no error for a file that 404s, it just never loads.
  const stallTimeoutMs = options.stallTimeoutMs ?? 20_000;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  // The Track change a failure skipped to; a failure there too stops the book.
  let skippedTo = -1;

  const stopWatching = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  };

  const watchLoading = (mine: number) => {
    stopWatching();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (mine === ticket) trackDidNotPlay();
    }, stallTimeoutMs);
  };

  const trackDidNotPlay = () => {
    stopWatching();
    if (state.status !== "playing" && state.status !== "paused") return;
    const { book, trackIndex } = state;
    loaded = null;
    if (ticket === skippedTo) {
      // Two Tracks in a row: the source is likely gone (no desktop), so stop
      // here rather than rushing through the rest of the book.
      ++ticket;
      heading = null;
      platform.stop();
      setState({ status: "unavailable", book, trackIndex });
      return;
    }
    void goTo(
      book,
      trackIndex + 1,
      0,
      state.status === "playing",
      book.tracks[trackIndex],
    );
    skippedTo = ticket;
  };

  // Plays the first Track from `fromIndex` on that isn't missing.
  const startTrack = async (
    book: Book,
    fromIndex: number,
    startAt: number,
    mine: number,
    // false keeps a paused book paused when a skip crosses into another Track.
    autoplay = true,
    // The Track left because it couldn't be played.
    failed?: BookTrack,
  ) => {
    const trackIndex = book.tracks.findIndex(
      (track, index) => index >= fromIndex && !track.missing,
    );
    const track = book.tracks[trackIndex];
    const passed = book.tracks.slice(
      fromIndex,
      trackIndex < 0 ? undefined : trackIndex,
    );
    const skipped = failed ? [failed, ...passed] : passed;
    if (!track) {
      heading = null;
      reportSkipped(skipped);
      lastTrack =
        "trackIndex" in state && state.book.id === book.id
          ? (book.tracks[state.trackIndex] ?? null)
          : null;
      platform.stop();
      setState({ status: "finished", book });
      return;
    }
    heading = { book, trackIndex, startAt, autoplay };
    const uri = await platform.trackUri(book, track);
    if (mine !== ticket) return;
    heading = null;
    reportSkipped(skipped);
    if (!uri) {
      platform.stop();
      setState({ status: "unavailable", book, trackIndex });
      return;
    }
    watchLoading(mine);
    loaded = { book, track };
    platform.load(uri, startAt, {
      bookId: book.id,
      bookTitle: book.title,
      trackTitle: track.title,
      author: book.author,
      coverUrl: book.coverUrl,
    });
    platform.setRate(clampSpeed(speed.get()));
    if (autoplay) platform.play();
    setState({ status: autoplay ? "playing" : "paused", book, trackIndex });
  };

  const goTo = (
    book: Book,
    fromIndex: number,
    startAt: number,
    autoplay = true,
    failed?: BookTrack,
  ) => {
    leave();
    pending = startTrack(book, fromIndex, startAt, ++ticket, autoplay, failed);
    return pending;
  };

  // Moves `seconds` from where the book is now, crossing Track boundaries
  // (back from 0:10 of a Track lands 20s before the end of the previous one).
  const skip = (seconds: number) => {
    if (state.status !== "playing" && state.status !== "paused") {
      return Promise.resolve();
    }
    const { book, trackIndex } = state;
    const autoplay = state.status === "playing";
    const target = platform.currentTime() + seconds;
    if (target < 0) {
      const previous = previousTrackIndex(book, trackIndex);
      if (previous < 0) {
        platform.seekTo(0);
        return Promise.resolve();
      }
      const length = book.tracks[previous]?.durationSeconds ?? null;
      const startAt = length === null ? 0 : Math.max(0, length + target);
      return goTo(book, previous, startAt, autoplay);
    }
    const length = book.tracks[trackIndex]?.durationSeconds ?? null;
    if (length !== null && target >= length) {
      return goTo(book, trackIndex + 1, target - length, autoplay);
    }
    platform.seekTo(target);
    return Promise.resolve();
  };

  // The Track Previous and Next move from: the one a Track change in flight is
  // going to, else the one playing.
  const currentPlace = () => {
    if (heading) return { ...heading, seconds: heading.startAt, loaded: false };
    if (state.status !== "playing" && state.status !== "paused") return null;
    return {
      book: state.book,
      trackIndex: state.trackIndex,
      seconds: platform.currentTime(),
      autoplay: state.status === "playing",
      loaded: true,
    };
  };

  const previousTrack = () => {
    const place = currentPlace();
    if (!place) return Promise.resolve();
    const { book, trackIndex, seconds, autoplay } = place;
    const previous = previousTrackIndex(book, trackIndex);
    if (previous < 0 || seconds > RESTART_TRACK_AFTER_SECONDS) {
      if (!place.loaded) return goTo(book, trackIndex, 0, autoplay);
      platform.seekTo(0);
      return Promise.resolve();
    }
    return goTo(book, previous, 0, autoplay);
  };

  // Past the last Track, the book is finished.
  const nextTrack = () => {
    const place = currentPlace();
    if (!place) return Promise.resolve();
    return goTo(place.book, place.trackIndex + 1, 0, place.autoplay);
  };

  platform.onEnded(() => {
    if (state.status !== "playing") return;
    leave(true);
    void goTo(state.book, state.trackIndex + 1, 0);
  });

  platform.onReady(() => {
    stopWatching();
    skippedTo = -1;
  });
  platform.onFailed(trackDidNotPlay);

  // The audio output already did it; the book follows.
  platform.onPlayingChange((playing) => {
    if (playing && state.status === "paused") {
      setState({ ...state, status: "playing" });
    } else if (!playing && state.status === "playing") {
      setState({ ...state, status: "paused" });
    }
  });

  return {
    /**
     * Starts a book from a Listening position, or at its first Track. A position
     * in a Track that went missing resumes at the next Track; one in a Track no
     * longer in the book starts over.
     */
    play: (book: Book, from?: ListeningPoint | null) => {
      const index = book.tracks.findIndex(
        (track) => track.id === from?.trackId,
      );
      if (!from || index < 0) return goTo(book, 0, 0);
      const track = book.tracks[index];
      if (track.missing) return goTo(book, index, 0);
      // The Track's own Track position, when it has one, is where it stopped.
      return goTo(book, index, positionOf(track) ? startAtOf(track) : from.seconds);
    },
    /**
     * Plays the Track at `trackIndex` from its Track position; from 0 once
     * played to its end.
     */
    jumpTo: (book: Book, trackIndex: number) => {
      // The Track playing is left first, so picking it again resumes there.
      leave();
      const track = book.tracks[trackIndex];
      return goTo(
        book,
        trackIndex,
        track && !track.missing ? startAtOf(track) : 0,
      );
    },
    /**
     * Clears every Track position of the book and plays it again from Track 1
     * at 0:00. The app records the Start over itself.
     */
    startOver: (book: Book) => {
      const at = now();
      // The place playing now is part of what Start over clears.
      if (loaded?.book.id === book.id) loaded = null;
      for (const track of book.tracks) {
        kept.set(track.id, { seconds: 0, playedToEnd: false, updatedAt: at });
      }
      return goTo(book, 0, 0);
    },
    /** Plays the finished book again from Track 1 at 0:00. */
    playAgain: () => {
      if (state.status !== "finished") return Promise.resolve();
      return goTo(state.book, 0, 0);
    },
    /** Tries the Track that couldn't be played again, from its start. */
    retry: () => {
      if (state.status !== "unavailable") return Promise.resolve();
      return goTo(state.book, state.trackIndex, 0);
    },
    /**
     * Stops the book and lets it go, back to holding none. A playing book is
     * paused first, so its Listening position is kept where the listener was.
     */
    close: () => {
      if (state.status === "playing") {
        platform.pause();
        setState({ ...state, status: "paused" });
      }
      leave();
      ++ticket;
      heading = null;
      lastTrack = null;
      stopWatching();
      platform.stop();
      setState({ status: "idle" });
    },
    /**
     * Where in the book the listener is now, to keep as its Listening position;
     * null when nothing plays or the Track can't play now.
     */
    listeningPosition: () => {
      if (state.status === "finished") {
        if (!lastTrack) return null;
        return {
          audiobookId: state.book.id,
          trackId: lastTrack.id,
          seconds: lastTrack.durationSeconds ?? platform.currentTime(),
          finished: true,
        };
      }
      if (state.status !== "playing" && state.status !== "paused") return null;
      return {
        audiobookId: state.book.id,
        trackId: state.book.tracks[state.trackIndex].id,
        seconds: platform.currentTime(),
        finished: false,
      };
    },
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
    /** Skips ±seconds, into the previous or next Track when it crosses one. */
    skip,
    /**
     * Restarts the Track playing when more than 3s into it, else plays the
     * Track before from its start; at the first Track, restarts it.
     */
    previousTrack,
    /** Plays the next Track from its start; at the last Track, finishes the book. */
    nextTrack,
    /** The playback speed, 0.75× to 2×, kept across Tracks and books. */
    getSpeed: () => clampSpeed(speed.get()),
    setSpeed: (rate: number) => {
      const next = clampSpeed(rate);
      speed.set(next);
      if (state.status === "playing" || state.status === "paused") {
        platform.setRate(next);
      }
      for (const listener of listeners) listener();
    },
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * Called with the Tracks playback passed over because they are missing or
     * their file couldn't be played, so the app can say which.
     */
    onTracksSkipped: (listener: (tracks: BookTrack[]) => void) => {
      skipListeners.add(listener);
      return () => {
        skipListeners.delete(listener);
      };
    },
    /**
     * Called with a Track's Track position each time playback leaves that
     * Track: another Track, the book's end (played to its end), another book,
     * or close.
     */
    onTrackPosition: (listener: (position: AudiobookTrackPosition) => void) => {
      trackPositionListeners.add(listener);
      return () => {
        trackPositionListeners.delete(listener);
      };
    },
    /** Resolves once the Track change in flight has happened. */
    settled: () => pending,
  };
}

export type BookPlayer = ReturnType<typeof createBookPlayer>;

// Previous Track restarts the Track playing once this far into it.
const RESTART_TRACK_AFTER_SECONDS = 3;
const MIN_BOOK_SPEED = 0.75;
const MAX_BOOK_SPEED = 2;

/** The speeds a listener can pick, on the phone and the desktop alike. */
export const BOOK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Where the chosen speed is remembered; the app persists it. */
export type BookSpeedMemory = {
  get: () => number;
  set: (rate: number) => void;
};

type BookPlayerOptions = {
  speed?: BookSpeedMemory;
  /** How long a Track may take to get ready before it is skipped. */
  stallTimeoutMs?: number;
  /** The clock Track positions are stamped with. */
  now?: () => number;
};

function createSpeedMemory(): BookSpeedMemory {
  let rate = 1;
  return {
    get: () => rate,
    set: (next) => {
      rate = next;
    },
  };
}

function clampSpeed(rate: number) {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(MAX_BOOK_SPEED, Math.max(MIN_BOOK_SPEED, rate));
}

// The last Track before `index` that isn't missing, or -1.
function previousTrackIndex(book: Book, index: number) {
  for (let i = index - 1; i >= 0; i--) {
    if (!book.tracks[i]?.missing) return i;
  }
  return -1;
}
