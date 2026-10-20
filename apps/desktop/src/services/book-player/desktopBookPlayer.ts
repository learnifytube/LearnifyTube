import { toLocalFileUrl } from "@/helpers/localFile";
import {
  createBookPlayer,
  type Book,
  type BookPlayer,
  type ListeningPoint,
} from "../../../../shared/book-player/createBookPlayer";
import {
  keepListeningPosition,
  type ListeningSave,
} from "../../../../shared/book-player/keepListeningPosition";
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
  }[];
};

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
  /** Plays a book from its Listening position; from the start once finished. */
  play: (book: DesktopAudiobook) => Promise<void>;
  /** Plays a book from the start of the Track at `trackIndex`. */
  jumpTo: (book: DesktopAudiobook, trackIndex: number) => Promise<void>;
  /** Plays a book again from Track 1 at 0:00. */
  startOver: (book: DesktopAudiobook) => Promise<void>;
};

// A Track is named after its file, without the extension (as Devices see it).
const trackTitle = (filePath: string): string =>
  (filePath.split(/[\\/]/).pop() ?? filePath).replace(/\.[^.]+$/, "");

// Where Play resumes: the Listening position, or the start once finished.
const resumeFrom = (book: DesktopAudiobook): ListeningPoint | null =>
  book.finished || book.listeningTrackId === null
    ? null
    : { trackId: book.listeningTrackId, seconds: book.listeningSeconds ?? 0 };

/**
 * The shared Book player on the desktop: Tracks play straight from the
 * Audiobook's folder over `local-file://` through one `<audio>` element, and
 * every save of the Listening position goes to `saveListening`. A Video
 * starting anywhere on `page` pauses the book; the bar can resume it.
 */
export function createDesktopBookPlayer({
  audio,
  page,
  saveListening,
}: {
  audio: AudioOutput;
  page: MediaPage;
  saveListening: (save: ListeningSave) => void;
}): DesktopBookPlayer {
  // Each Track's file, by Track id, for the books played so far.
  const trackFiles = new Map<string, string>();
  const platform = createAudioElementPlatform(audio, async (_book, track) => {
    const filePath = trackFiles.get(track.id);
    return filePath ? toLocalFileUrl(filePath) : null;
  });
  const player = createBookPlayer(platform);
  keepListeningPosition(player, saveListening);
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
      })),
    };
  };

  return {
    ...player,
    play: (book) => player.play(toBook(book), resumeFrom(book)),
    jumpTo: (book, trackIndex) => player.jumpTo(toBook(book), trackIndex),
    startOver: (book) => player.startOver(toBook(book)),
  };
}
