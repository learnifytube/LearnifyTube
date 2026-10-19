import { useSyncExternalStore } from "react";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";
import { api } from "../api";
import { useConnectionStore } from "../../stores/connection";
import { createBookPlayer, type BookAudioPlatform } from "./createBookPlayer";

// One expo-audio player for every book, made on first use so importing this
// module never touches the native module.
let audio: AudioPlayer | null = null;
const endedListeners = new Set<() => void>();

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
  // Streams every Track from the desktop for now.
  trackUri: async (_book, track) => {
    const serverUrl = useConnectionStore.getState().serverUrl;
    return serverUrl ? api.getAudiobookTrackFileUrl(serverUrl, track.id) : null;
  },
  load: (uri, startAt) => {
    const player = getAudio();
    player.replace({ uri });
    if (startAt > 0) void player.seekTo(startAt);
  },
  play: () => getAudio().play(),
  pause: () => getAudio().pause(),
  stop: () => {
    const player = getAudio();
    player.pause();
    player.replace(null);
  },
  currentTime: () => audio?.currentTime ?? 0,
  onEnded: (listener) => {
    endedListeners.add(listener);
    return () => endedListeners.delete(listener);
  },
};

export const bookPlayer = createBookPlayer(expoAudioPlatform);

export function useBookPlayerState() {
  return useSyncExternalStore(bookPlayer.subscribe, bookPlayer.getState);
}

export type {
  Book,
  BookPlayer,
  BookPlayerState,
} from "./createBookPlayer";
