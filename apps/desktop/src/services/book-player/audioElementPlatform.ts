import type { BookAudioPlatform } from "../../../../shared/book-player/createBookPlayer";

/** The parts of an `<audio>` element the Book player drives. */
export type AudioOutput = {
  src: string;
  currentTime: number;
  /** Seconds; NaN until the loaded file says how long it is. */
  readonly duration: number;
  playbackRate: number;
  defaultPlaybackRate: number;
  preservesPitch: boolean;
  readonly paused: boolean;
  readonly ended: boolean;
  play: () => Promise<void>;
  pause: () => void;
  load: () => void;
  removeAttribute: (name: string) => void;
  addEventListener: (type: string, listener: () => void) => void;
};

/**
 * The desktop's audio output for the Book player: one `<audio>` element that
 * lives as long as the window, so a book keeps playing across pages and while
 * the window is hidden to the tray.
 */
export function createAudioElementPlatform(
  audio: AudioOutput,
  trackUri: BookAudioPlatform["trackUri"]
): BookAudioPlatform {
  const endedListeners = new Set<() => void>();
  const readyListeners = new Set<() => void>();
  const failedListeners = new Set<() => void>();
  const playingListeners = new Set<(playing: boolean) => void>();
  const emit = (listeners: Set<() => void>): void => {
    for (const listener of listeners) listener();
  };
  const subscribe =
    <T>(listeners: Set<T>) =>
    (listener: T) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };

  // Where the loaded Track starts, until the element knows its length and can seek.
  let startAt: number | null = null;
  // Whether the Book player asked to play; the element's own events tell it otherwise.
  let wantsToPlay = false;
  const playingChanged = (playing: boolean): void => {
    wantsToPlay = playing;
    for (const listener of playingListeners) listener(playing);
  };

  audio.addEventListener("loadedmetadata", () => {
    if (startAt === null) return;
    audio.currentTime = startAt;
    startAt = null;
  });
  audio.addEventListener("canplay", () => emit(readyListeners));
  audio.addEventListener("ended", () => emit(endedListeners));
  audio.addEventListener("error", () => emit(failedListeners));
  // Media keys and the OS media controls play and pause the element itself.
  // Events arrive after the fact, so one the element has since undone is stale;
  // and the pause Chromium sends as a Track ends is the end, not a pause.
  audio.addEventListener("play", () => {
    if (!wantsToPlay && !audio.paused) playingChanged(true);
  });
  audio.addEventListener("pause", () => {
    if (wantsToPlay && audio.paused && !audio.ended) playingChanged(false);
  });

  return {
    trackUri,
    load: (uri, at) => {
      startAt = at > 0 ? at : null;
      audio.src = uri;
    },
    play: () => {
      wantsToPlay = true;
      // Rejected when another Track replaces this one before it starts.
      audio.play().catch(() => undefined);
    },
    pause: () => {
      wantsToPlay = false;
      audio.pause();
    },
    stop: () => {
      wantsToPlay = false;
      startAt = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
    currentTime: () => startAt ?? audio.currentTime,
    seekTo: (seconds) => {
      if (startAt !== null) startAt = seconds;
      else audio.currentTime = seconds;
    },
    setRate: (rate) => {
      // A new Track resets the rate to the default one.
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
      audio.preservesPitch = true;
    },
    onEnded: subscribe(endedListeners),
    onReady: subscribe(readyListeners),
    onFailed: subscribe(failedListeners),
    onPlayingChange: subscribe(playingListeners),
  };
}
