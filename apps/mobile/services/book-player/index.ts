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
  type BookAudioPlatform,
  type ListeningPoint,
  type NowPlaying,
} from "../../../shared/book-player/createBookPlayer";
import { createExpoAudioStatusReader } from "./expoAudioStatus";
import { keepListeningPositionOnPhone } from "./keepListeningPosition";
import { localFirstTrackUri } from "../../../shared/book-player/localFirstTrackUri";

// One expo-audio player for every book, made on first use so importing this
// module never touches the native module.
let audio: AudioPlayer | null = null;
const endedListeners = new Set<() => void>();
const readyListeners = new Set<() => void>();
const failedListeners = new Set<() => void>();
const playingListeners = new Set<(playing: boolean) => void>();
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

const player = createBookPlayer(expoAudioPlatform, {
  // Persisted, and read at every Track, so it applies once storage has loaded.
  speed: {
    get: () => useBookSpeedStore.getState().speed,
    set: (speed) => useBookSpeedStore.getState().setSpeed(speed),
  },
});

// Playing a book (from anywhere in it) also fetches the whole book onto the
// phone (it's pulled), while the Track playing Streams uninterrupted.
export const bookPlayer = {
  ...player,
  play: (book: Audiobook, from?: ListeningPoint | null) => {
    heldAudiobooks.pull(book);
    return player.play(book, from);
  },
  jumpTo: (book: Audiobook, trackIndex: number) => {
    heldAudiobooks.pull(book);
    return player.jumpTo(book, trackIndex);
  },
  startOver: (book: Audiobook) => {
    heldAudiobooks.pull(book);
    return player.startOver(book);
  },
  /** Plays a Track of the book in the player from its start (already pulled). */
  playTrack: (trackIndex: number) => {
    const state = player.getState();
    if (state.status === "idle") return Promise.resolve();
    return player.jumpTo(state.book, trackIndex);
  },
};
keepListeningPositionOnPhone(player);

/** The book speed, for screens. */
export function useBookSpeed() {
  return useBookSpeedStore((s) => s.speed);
}

export function useBookPlayerState() {
  return useSyncExternalStore(bookPlayer.subscribe, bookPlayer.getState);
}

export type {
  Book,
  BookPlayer,
  BookPlayerState,
  ListeningPoint,
} from "../../../shared/book-player/createBookPlayer";
