import { useSyncExternalStore } from "react";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";
import { api } from "../api";
import { localFirstCoverUri } from "../held-audiobooks/localFirstCoverUri";
import { useConnectionStore } from "../../stores/connection";
import { heldAudiobooks } from "../held-audiobooks";
import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { useBookSpeedStore } from "../../stores/bookSpeed";
import {
  createBookPlayer,
  type Book,
  type BookAudioPlatform,
  type ListeningPoint,
  type NowPlaying,
} from "../../../shared/book-player/createBookPlayer";
import { createExpoAudioStatusReader } from "./expoAudioStatus";
import {
  keepListeningPositionOnPhone,
  keepTrackPositionsOnPhone,
} from "./keepListeningPosition";
import { useTrackPositionsStore } from "../../stores/trackPositions";
import { withKeptTrackPositions } from "../listening-position/trackPositions";
import { localFirstTrackUri } from "../../../shared/book-player/localFirstTrackUri";

// One expo-audio player for every book, made on first use so importing this
// module never touches the native module.
let audio: AudioPlayer | null = null;
const endedListeners = new Set<() => void>();
const readyListeners = new Set<() => void>();
const failedListeners = new Set<() => void>();
const playingListeners = new Set<(playing: boolean) => void>();
const progressListeners = new Set<() => void>();
const statusReader = createExpoAudioStatusReader();
let lockScreenActive = false;
// The time a seek is heading to, while expo-audio still reports the old time.
let seekingTo: number | null = null;

const emit = (listeners: Set<() => void>) => {
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

const seek = (player: AudioPlayer, target: number) => {
  seekingTo = target;
  void player.seekTo(target).finally(() => {
    if (seekingTo === target) seekingTo = null;
  });
};

const getAudio = () => {
  if (audio) return audio;
  // doNotMix takes audio focus, so a call or another app's audio pauses the
  // book (the native player pauses; statusReader tells the Book player).
  // shouldPlayInBackground keeps it playing with the screen off.
  void setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "doNotMix",
    shouldPlayInBackground: true,
  });
  audio = createAudioPlayer(null, { updateInterval: 1000 });
  audio.shouldCorrectPitch = true;
  audio.addListener("playbackStatusUpdate", (status) => {
    updateProgress();
    for (const event of statusReader.read(status)) {
      if (event === "ended") emit(endedListeners);
      else if (event === "ready") emit(readyListeners);
      else if (event === "failed") emit(failedListeners);
      else for (const listener of playingListeners) listener(event.playing);
    }
  });
  return audio;
};

// The lock screen and notification: book title, Track and cover, with
// play/pause and ±30s (the seek interval is patched to 30s in
// patches/expo-audio+*.patch; those buttons seek within the Track).
const showOnLockScreen = (player: AudioPlayer, nowPlaying: NowPlaying) => {
  const serverUrl = useConnectionStore.getState().serverUrl;
  const metadata = {
    title: nowPlaying.trackTitle,
    artist: nowPlaying.author ?? nowPlaying.bookTitle,
    albumTitle: nowPlaying.bookTitle,
    artworkUrl:
      localFirstCoverUri({
        heldCoverUri:
          heldAudiobooks.getHold(nowPlaying.bookId)?.coverUri ?? null,
        serverUrl,
        coverUrl: nowPlaying.coverUrl,
      }) ?? undefined,
  };
  if (lockScreenActive) {
    player.updateLockScreenMetadata(metadata);
    return;
  }
  player.setActiveForLockScreen(true, metadata, {
    showSeekBackward: true,
    showSeekForward: true,
  });
  lockScreenActive = true;
};

const expoAudioPlatform: BookAudioPlatform = {
  // The Track's file on the phone when held, else a Stream from the desktop.
  trackUri: localFirstTrackUri({
    held: (track) => heldAudiobooks.trackUri(track.id),
    stream: (track) => {
      const serverUrl = useConnectionStore.getState().serverUrl;
      return serverUrl
        ? api.getAudiobookTrackFileUrl(serverUrl, track.id)
        : null;
    },
  }),
  load: (uri, startAt, nowPlaying) => {
    const player = getAudio();
    statusReader.loading();
    player.replace({ uri });
    seekingTo = null;
    if (startAt > 0) seek(player, startAt);
    showOnLockScreen(player, nowPlaying);
  },
  play: () => {
    statusReader.commanded(true);
    getAudio().play();
  },
  pause: () => {
    statusReader.commanded(false);
    getAudio().pause();
  },
  stop: () => {
    const player = getAudio();
    statusReader.stopped();
    player.pause();
    player.replace(null);
    if (lockScreenActive) player.clearLockScreenControls();
    lockScreenActive = false;
  },
  // Until a seek lands, the Track is where it is about to be.
  currentTime: () => seekingTo ?? audio?.currentTime ?? 0,
  seekTo: (seconds) => seek(getAudio(), seconds),
  setRate: (rate) => getAudio().setPlaybackRate(rate),
  onEnded: (listener) => {
    endedListeners.add(listener);
    return () => endedListeners.delete(listener);
  },
  onReady: subscribe(readyListeners),
  onFailed: subscribe(failedListeners),
  onPlayingChange: subscribe(playingListeners),
};

// Each Track at the newest of the desktop's and this phone's Track position.
const withKeptPositions = (book: Audiobook) =>
  withKeptTrackPositions(book, useTrackPositionsStore.getState().positions);

const player = createBookPlayer(expoAudioPlatform, {
  // Persisted, and read at every Track, so it applies once storage has loaded.
  speed: {
    get: () => useBookSpeedStore.getState().speed,
    set: (speed) => useBookSpeedStore.getState().setSpeed(speed),
  },
});

// Playing a book (from anywhere in it) also fetches the whole book onto the
// phone (it's pulled), while the Track playing Streams uninterrupted.
/** How far into its Track the book is, in seconds. */
export type TrackProgress = { elapsed: number; duration: number };

const NO_PROGRESS: TrackProgress = { elapsed: 0, duration: 0 };
let progress = NO_PROGRESS;

// The Track's length: its file's once known, else the length its scan found.
const trackLength = (track: Book["tracks"][number] | undefined) =>
  audio && Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : (track?.durationSeconds ?? 0);

function updateProgress() {
  const state = player.getState();
  const next =
    state.status === "playing" || state.status === "paused"
      ? {
          elapsed: expoAudioPlatform.currentTime(),
          duration: trackLength(state.book.tracks[state.trackIndex]),
        }
      : NO_PROGRESS;
  if (next.elapsed === progress.elapsed && next.duration === progress.duration)
    return;
  progress = next;
  emit(progressListeners);
}
player.subscribe(updateProgress);

export const bookPlayer = {
  ...player,
  getProgress: () => progress,
  subscribeProgress: subscribe(progressListeners),
  /** Moves within the Track playing, kept inside its length. */
  seekTo: (seconds: number) => {
    const state = player.getState();
    if (state.status !== "playing" && state.status !== "paused") return;
    const length = trackLength(state.book.tracks[state.trackIndex]);
    expoAudioPlatform.seekTo(
      Math.max(0, length > 0 ? Math.min(seconds, length) : seconds),
    );
    updateProgress();
  },
  play: (book: Audiobook, from?: ListeningPoint | null) => {
    heldAudiobooks.pull(book);
    return player.play(withKeptPositions(book), from);
  },
  /** Plays a Track from its Track position; from 0 once played to its end. */
  jumpTo: (book: Audiobook, trackIndex: number) => {
    heldAudiobooks.pull(book);
    return player.jumpTo(withKeptPositions(book), trackIndex);
  },
  /** Clears every Track position of the book and plays it from Track 1 at 0:00. */
  startOver: (book: Audiobook) => {
    heldAudiobooks.pull(book);
    const at = Date.now();
    keepTrackPositionsOnPhone(
      book.tracks.map((track) => ({
        audiobookId: book.id,
        trackId: track.id,
        seconds: 0,
        playedToEnd: false,
        updatedAt: at,
      })),
    );
    return player.startOver(book);
  },
  /** Plays a Track of the book in the player from its Track position (already pulled). */
  playTrack: (trackIndex: number) => {
    const state = player.getState();
    if (state.status === "idle") return Promise.resolve();
    return player.jumpTo(state.book, trackIndex);
  },
};
keepListeningPositionOnPhone(player);
player.onTrackPosition((position) => keepTrackPositionsOnPhone([position]));

/** The book speed, for screens. */
export function useBookSpeed() {
  return useBookSpeedStore((s) => s.speed);
}

export function useBookPlayerState() {
  return useSyncExternalStore(bookPlayer.subscribe, bookPlayer.getState);
}

/** How far into its Track the book is. */
export function useTrackProgress() {
  return useSyncExternalStore(
    bookPlayer.subscribeProgress,
    bookPlayer.getProgress,
  );
}

export type {
  Book,
  BookPlayer,
  BookPlayerState,
  ListeningPoint,
} from "../../../shared/book-player/createBookPlayer";
