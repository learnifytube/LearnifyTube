import { toLocalFileUrl } from "@/helpers/localFile";
import {
  createBookPlayer,
  type Book,
  type BookPlayer,
  type BookSpeedMemory,
  type ListeningPoint,
} from "../../../../shared/book-player/createBookPlayer";
import {
  keepListeningPosition,
  type ListeningSave,
} from "../../../../shared/book-player/keepListeningPosition";
import type {
  AudiobookTrackPosition,
  TrackPosition,
} from "../../../../shared/mobile-sync-contract";
import { createAudioElementPlatform, type AudioOutput } from "./audioElementPlatform";

/** An Audiobook as the desktop keeps it: its Tracks are files in the user's folder. */
export type DesktopAudiobook = {
  id: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  listeningTrackId: string | null;
  listeningSeconds: number | null;
  finished: boolean;
  tracks: {
    id: string;
    filePath: string;
    durationSeconds: number | null;
    missing: boolean;
    // Its Track position (ADR-0006); null times before it was ever played.
    resumeSeconds: number | null;
    playedToEnd: boolean;
    resumeUpdatedAt: number | null;
  }[];
};

type DesktopTrack = DesktopAudiobook["tracks"][number];

/** The window's document: every media element's `play` reaches it while capturing. */
export type MediaPage = {
  addEventListener: (
    type: "play",
    listener: (event: { target: unknown }) => void,
    capture: true
  ) => void;
};

// Media events don't bubble, so a Video's play is caught on its way down.
const isVideo = (target: unknown): boolean =>
  typeof target === "object" &&
  target !== null &&
  (target as { nodeName?: unknown }).nodeName === "VIDEO";

/** The shared Book player, started with the desktop's Audiobooks. */
export type DesktopBookPlayer = Omit<BookPlayer, "play" | "jumpTo" | "startOver"> & {
  /**
   * Plays a book from its Listening position: the Track last played, at that
   * Track's own Track position; from the start once finished.
   */
  play: (book: DesktopAudiobook) => Promise<void>;
  /** Plays the Track at `trackIndex` from its Track position; from 0 once played to its end. */
  jumpTo: (book: DesktopAudiobook, trackIndex: number) => Promise<void>;
  /** Clears every Track position and plays the book again from Track 1 at 0:00. */
  startOver: (book: DesktopAudiobook) => Promise<void>;
  /** How far into the Track the book is; zeros while no Track plays. */
  getProgress: () => TrackProgress;
  /** Called as the Track plays on, seeks, or changes. */
  subscribeProgress: (listener: () => void) => () => void;
  /** Moves to `seconds` into the Track playing. */
  seekTo: (seconds: number) => void;
};

/** Where the book is within its Track, in seconds. */
export type TrackProgress = { elapsed: number; duration: number };

const NO_PROGRESS: TrackProgress = { elapsed: 0, duration: 0 };

// A Track is named after its file, without the extension (as Devices see it).
const trackTitle = (filePath: string): string =>
  (filePath.split(/[\\/]/).pop() ?? filePath).replace(/\.[^.]+$/, "");

const storedPosition = (track: DesktopTrack): TrackPosition | null =>
  track.resumeUpdatedAt === null
    ? null
    : {
        seconds: track.resumeSeconds ?? 0,
        playedToEnd: track.playedToEnd,
        updatedAt: track.resumeUpdatedAt,
      };

/**
 * The shared Book player on the desktop: Tracks play straight from the
 * Audiobook's folder over `local-file://` through one `<audio>` element, and
 * every save of the Listening position goes to `saveListening`. Each Track's
 * place is saved to `saveTrackPosition` as playback leaves it, and Start over
 * to `saveStartOver`. A Video starting anywhere on `page` pauses the book; the
 * bar can resume it.
 */
export function createDesktopBookPlayer({
  audio,
  page,
  saveListening,
  saveTrackPosition,
  saveStartOver,
  speed,
}: {
  audio: AudioOutput;
  page: MediaPage;
  saveListening: (save: ListeningSave) => void;
  saveTrackPosition: (position: AudiobookTrackPosition) => void;
  /** Start over clears every Track position of the book, as of `at`. */
  saveStartOver: (audiobookId: string, at: number) => void;
  /** Where the desktop's own speed is remembered (the phone keeps its own). */
  speed?: BookSpeedMemory;
}): DesktopBookPlayer {
  // Where Play resumes: the Track last played (the shared player starts it at
  // its own Track position), or the start once finished.
  const resumeFrom = (book: DesktopAudiobook): ListeningPoint | null =>
    book.finished || book.listeningTrackId === null
      ? null
      : { trackId: book.listeningTrackId, seconds: book.listeningSeconds ?? 0 };
  // Each Track's file, by Track id, for the books played so far.
  const trackFiles = new Map<string, string>();
  const platform = createAudioElementPlatform(audio, async (_book, track) => {
    const filePath = trackFiles.get(track.id);
    return filePath ? toLocalFileUrl(filePath) : null;
  });
  const player = createBookPlayer(platform, { speed });
  keepListeningPosition(player, saveListening);
  // Each Track's place is saved as playback leaves it.
  player.onTrackPosition(saveTrackPosition);
  page.addEventListener(
    "play",
    (event) => {
      if (isVideo(event.target)) player.pause();
    },
    true
  );

  const toBook = (book: DesktopAudiobook): Book => {
    for (const track of book.tracks) trackFiles.set(track.id, track.filePath);
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      coverUrl: book.coverPath ? toLocalFileUrl(book.coverPath) : null,
      tracks: book.tracks.map((track) => ({
        id: track.id,
        title: trackTitle(track.filePath),
        durationSeconds: track.durationSeconds,
        missing: track.missing,
        trackPosition: storedPosition(track),
      })),
    };
  };

  // The Track's length: its file's once known, else the length its scan found.
  const trackLength = (track: Book["tracks"][number] | undefined): number =>
    Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : (track?.durationSeconds ?? 0);

  let progress = NO_PROGRESS;
  const progressListeners = new Set<() => void>();
  const updateProgress = (): void => {
    const state = player.getState();
    const next =
      state.status === "playing" || state.status === "paused"
        ? {
            elapsed: platform.currentTime(),
            duration: trackLength(state.book.tracks[state.trackIndex]),
          }
        : NO_PROGRESS;
    if (next.elapsed === progress.elapsed && next.duration === progress.duration) return;
    progress = next;
    for (const listener of progressListeners) listener();
  };
  for (const type of ["timeupdate", "durationchange", "emptied"]) {
    audio.addEventListener(type, updateProgress);
  }
  player.subscribe(updateProgress);

  return {
    ...player,
    getProgress: () => progress,
    subscribeProgress: (listener) => {
      progressListeners.add(listener);
      return () => {
        progressListeners.delete(listener);
      };
    },
    seekTo: (seconds) => {
      const state = player.getState();
      if (state.status !== "playing" && state.status !== "paused") return;
      const length = trackLength(state.book.tracks[state.trackIndex]);
      platform.seekTo(Math.max(0, length > 0 ? Math.min(seconds, length) : seconds));
      updateProgress();
    },
    play: (book) => player.play(toBook(book), resumeFrom(book)),
    jumpTo: (book, trackIndex) => player.jumpTo(toBook(book), trackIndex),
    startOver: (book) => {
      saveStartOver(book.id, Date.now());
      return player.startOver(toBook(book));
    },
  };
}
