import type { BookAudioPlatform, NowPlaying } from "./createBookPlayer";

type Loaded = { uri: string; startAt: number; nowPlaying: NowPlaying };

/** An in-memory audio output for tests of the Book player. */
export function createFakeBookAudioPlatform({
  // Tracks with no source right now (not held, and no desktop to Stream from).
  unavailableTrackIds = [] as string[],
  // Tracks whose source resolves only when releaseSlowTracks() is called.
  slowTrackIds = [] as string[],
} = {}) {
  const slow: (() => void)[] = [];
  const loads: Loaded[] = [];
  const endedListeners = new Set<() => void>();
  const state = { playing: false, time: 0, stopped: false };

  const platform: BookAudioPlatform = {
    trackUri: async (_book, track) => {
      if (slowTrackIds.includes(track.id))
        await new Promise<void>((resolve) => slow.push(resolve));
      return unavailableTrackIds.includes(track.id)
        ? null
        : `stream://${track.id}`;
    },
    load: (uri, startAt, nowPlaying) => {
      loads.push({ uri, startAt, nowPlaying });
      state.time = startAt;
      state.stopped = false;
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
    onEnded: (listener) => {
      endedListeners.add(listener);
      return () => endedListeners.delete(listener);
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
  };
}
