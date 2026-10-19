import type { BookAudioPlatform, NowPlaying } from "./createBookPlayer";
import { localFirstTrackUri } from "./localFirstTrackUri";

type Loaded = { uri: string; startAt: number; nowPlaying: NowPlaying };

/** An in-memory audio output for tests of the Book player. */
export function createFakeBookAudioPlatform({
  // Tracks with no source right now (not held, and no desktop to Stream from).
  unavailableTrackIds = [] as string[],
  // Tracks whose source resolves only when releaseSlowTracks() is called.
  slowTrackIds = [] as string[],
  // Tracks that load but never get ready until finishLoading() is called.
  stallingTrackIds = [] as string[],
  // Tracks held on the phone (read each time a Track starts).
  heldTrackIds = [] as string[],
  // False for Offline mode: nothing Streams.
  desktop = true,
} = {}) {
  const readyListeners = new Set<() => void>();
  const failedListeners = new Set<() => void>();
  const emit = (set: Set<() => void>) => {
    for (const listener of set) listener();
  };
  const slow: (() => void)[] = [];
  const loads: Loaded[] = [];
  const endedListeners = new Set<() => void>();
  const playingListeners = new Set<(playing: boolean) => void>();
  const setPlayingFromSystem = (playing: boolean) => {
    state.playing = playing;
    for (const listener of playingListeners) listener(playing);
  };
  const state = { playing: false, time: 0, stopped: false, rate: 1 };
  const localFirst = localFirstTrackUri({
    held: async (track) =>
      heldTrackIds.includes(track.id) ? `file://held/${track.id}` : null,
    stream: (track) =>
      desktop && !unavailableTrackIds.includes(track.id)
        ? `stream://${track.id}`
        : null,
  });

  const platform: BookAudioPlatform = {
    trackUri: async (book, track) => {
      if (slowTrackIds.includes(track.id))
        await new Promise<void>((resolve) => slow.push(resolve));
      return localFirst(book, track);
    },
    load: (uri, startAt, nowPlaying) => {
      loads.push({ uri, startAt, nowPlaying });
      state.time = startAt;
      state.stopped = false;
      if (!stallingTrackIds.some((id) => uri === `stream://${id}`)) {
        emit(readyListeners);
      }
    },
    play: () => {
      state.playing = true;
    },
    pause: () => {
      state.playing = false;
    },
    stop: () => {
      state.playing = false;
      state.stopped = true;
    },
    currentTime: () => state.time,
    seekTo: (seconds) => {
      state.time = seconds;
    },
    setRate: (rate) => {
      state.rate = rate;
    },
    onEnded: (listener) => {
      endedListeners.add(listener);
      return () => endedListeners.delete(listener);
    },
    onPlayingChange: (listener) => {
      playingListeners.add(listener);
      return () => playingListeners.delete(listener);
    },
    onReady: (listener) => {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    onFailed: (listener) => {
      failedListeners.add(listener);
      return () => failedListeners.delete(listener);
    },
  };

  return {
    platform,
    /** What is loaded now, or null before anything was. */
    current: () => (state.stopped ? null : (loads.at(-1) ?? null)),
    /** Every Track uri loaded so far, in order. */
    loadedUris: () => loads.map((load) => load.uri),
    isPlaying: () => state.playing,
    /** Plays the loaded Track to its end. */
    finishTrack: () => {
      state.playing = false;
      for (const listener of endedListeners) listener();
    },
    releaseSlowTracks: () => {
      for (const resolve of slow.splice(0)) resolve();
    },
    setTime: (seconds: number) => {
      state.time = seconds;
    },
    /** Where in the loaded Track playback is, in seconds. */
    time: () => state.time,
    /** The playback speed set on the audio output. */
    rate: () => state.rate,
    /** The system pauses the audio: focus lost, headphones unplugged, lock screen. */
    pauseFromSystem: () => setPlayingFromSystem(false),
    /** The system resumes the audio: focus regained, lock-screen play. */
    resumeFromSystem: () => setPlayingFromSystem(true),
    /** A stalling Track gets ready after all. */
    finishLoading: () => emit(readyListeners),
    /** The loaded Track can't be played (its file 404s). */
    failTrack: () => {
      state.playing = false;
      emit(failedListeners);
    },
  };
}
