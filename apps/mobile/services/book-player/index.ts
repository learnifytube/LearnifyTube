import { useSyncExternalStore } from "react";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";
import { api } from "../api";
import { useConnectionStore } from "../../stores/connection";
import { heldAudiobooks } from "../held-audiobooks";
import type { Audiobook } from "../../../shared/mobile-sync-contract";
import {
  createBookPlayer,
  type BookAudioPlatform,
  type ListeningPoint,
} from "./createBookPlayer";
import { keepListeningPosition } from "./keepListeningPosition";
import { localFirstTrackUri } from "./localFirstTrackUri";

// One expo-audio player for every book, made on first use so importing this
// module never touches the native module.
let audio: AudioPlayer | null = null;
const endedListeners = new Set<() => void>();
// The time a just-loaded Track is seeking to, while expo-audio still reports 0.
let seekingTo: number | null = null;

const getAudio = () => {
  if (audio) return audio;
  // doNotMix takes audio focus, so other apps' audio pauses while a book plays.
  void setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "doNotMix",
  });
  audio = createAudioPlayer(null, { updateInterval: 1000 });
  audio.addListener("playbackStatusUpdate", (status) => {
    if (status.didJustFinish) {
      for (const listener of endedListeners) listener();
    }
  });
  return audio;
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
  load: (uri, startAt) => {
    const player = getAudio();
    player.replace({ uri });
    seekingTo = startAt > 0 ? startAt : null;
    if (seekingTo !== null) {
      const target = seekingTo;
      void player.seekTo(target).finally(() => {
        if (seekingTo === target) seekingTo = null;
      });
    }
  },
  play: () => getAudio().play(),
  pause: () => getAudio().pause(),
  stop: () => {
    const player = getAudio();
    player.pause();
    player.replace(null);
  },
  // Until a resume's seek lands, the Track is where it is about to be.
  currentTime: () => seekingTo ?? audio?.currentTime ?? 0,
  onEnded: (listener) => {
    endedListeners.add(listener);
    return () => endedListeners.delete(listener);
  },
};

const player = createBookPlayer(expoAudioPlatform);

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
};
keepListeningPosition(player);

export function useBookPlayerState() {
  return useSyncExternalStore(bookPlayer.subscribe, bookPlayer.getState);
}

export type {
  Book,
  BookPlayer,
  BookPlayerState,
  ListeningPoint,
} from "./createBookPlayer";
