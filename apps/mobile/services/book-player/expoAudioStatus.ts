import type { AudioStatus } from "expo-audio";

export type ExpoAudioEvent =
  "ended" | "ready" | "failed" | { playing: boolean };

// Statuses emitted just before the app's own play/pause can arrive after it.
const COMMAND_SETTLE_MS = 1000;

/**
 * Reads expo-audio's playbackStatusUpdate events for the Book player. On
 * Android the player emits no error for a Track that can't load (a 404): it
 * goes buffering → idle, so a drop to idle while a Track is active is a failure.
 */
export function createExpoAudioStatusReader(now: () => number = Date.now) {
  // Between a replace() and the new Track's first "ready".
  let loading = false;
  // A buffering status was seen since the replace, so a "ready" is the new Track's.
  let sawBuffering = false;
  // A Track is loaded and hasn't been stopped.
  let active = false;
  let lastPlaying = false;
  let commandedAt = -Infinity;

  return {
    /** The app replaced the Track. */
    loading: () => {
      loading = true;
      sawBuffering = false;
      active = true;
    },
    /** The app stopped and unloaded the player. */
    stopped: () => {
      loading = false;
      active = false;
      lastPlaying = false;
    },
    /** The app itself played or paused. */
    commanded: (playing: boolean) => {
      lastPlaying = playing;
      commandedAt = now();
    },
    read: (
      status: Pick<AudioStatus, "playbackState" | "playing" | "didJustFinish">,
    ) => {
      if (status.didJustFinish) {
        lastPlaying = false;
        return ["ended"] as ExpoAudioEvent[];
      }
      const events: ExpoAudioEvent[] = [];
      const state = status.playbackState;
      if (state === "buffering" || state === "loading") sawBuffering = true;
      if (loading && sawBuffering && state === "ready") {
        loading = false;
        events.push("ready");
      } else if (active && sawBuffering && state === "idle") {
        loading = false;
        active = false;
        events.push("failed");
      }
      if (
        state === "ready" &&
        status.playing !== lastPlaying &&
        now() - commandedAt >= COMMAND_SETTLE_MS
      ) {
        lastPlaying = status.playing;
        events.push({ playing: status.playing });
      }
      return events;
    },
  };
}
