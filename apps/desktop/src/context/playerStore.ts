import { useSyncExternalStore } from "react";

// Playback metadata type (mirrors previous atom usage but simplified)
export interface PlaybackData {
  filePath?: string | null;
  title?: string;
  description?: string | null;
  videoId?: string;
  status?: string | null;
  progress?: number | null;
  lastPositionSeconds?: number;
  /** Where the player starts: the shared "resume at" rule over the Watch progress. */
  resumeAtSeconds?: number;
  thumbnailPath?: string | null;
  thumbnailUrl?: string | null;
  availableLanguages?: Array<{
    lang: string;
    hasManual: boolean;
    hasAuto: boolean;
    manualFormats?: string[];
    autoFormats?: string[];
  }>;
  [key: string]: unknown;
}

export interface PlayerState {
  videoId: string | null;
  playlistId: string | null;
  playlistIndex: number | null;
  currentTime: number;
  filePath: string | null;
  playback: PlaybackData | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  isPlaying: boolean;
}

// Internal mutable state (not reactive by itself)
let state: PlayerState = {
  videoId: null,
  playlistId: null,
  playlistIndex: null,
  currentTime: 0,
  filePath: null,
  playback: null,
  thumbnailUrl: null,
  thumbnailPath: null,
  isPlaying: false,
};

// Event listeners
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

// Public API
export const getState = (): PlayerState => state;

export function setPlayerState(patch: Partial<PlayerState>): void {
  const prevVideoId = state.videoId;
  state = { ...state, ...patch };
  // If switching videos, reset transient fields unless explicitly provided
  if (patch.videoId && patch.videoId !== prevVideoId) {
    state.currentTime = patch.currentTime ?? 0;
    // Do not carry previous playback object if new one not supplied yet
    if (!patch.playback) state.playback = null;
  }
  emit();
}

export function updateCurrentTime(time: number): void {
  if (state.currentTime === time) return;
  state.currentTime = time;
  emit();
}

export function setPlaybackData(playback: PlaybackData | null): void {
  state.playback = playback;
  state.filePath = playback?.filePath ?? null;
  state.thumbnailPath = playback?.thumbnailPath ?? null;
  state.thumbnailUrl = playback?.thumbnailUrl ?? null;
  emit();
}

export function setIsPlaying(isPlaying: boolean): void {
  if (state.isPlaying === isPlaying) return;
  state.isPlaying = isPlaying;
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Generic hook returning entire state (components can memo/select locally)
export function usePlayerStore(): PlayerState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// Selector hook for performance (optional usage)
// Removed unused selector for now to keep API minimal

// Convenience helper to initialize a new video playback context
export function beginVideoPlayback(args: {
  videoId: string;
  playlistId?: string | null;
  playlistIndex?: number | null;
  startTime?: number;
}): void {
  setPlayerState({
    videoId: args.videoId,
    playlistId: args.playlistId ?? null,
    playlistIndex: args.playlistIndex ?? null,
    currentTime: args.startTime ?? 0,
  });
}

// Reset everything (e.g., when leaving player entirely)
export function resetPlayerState(): void {
  setPlayerState({
    videoId: null,
    playlistId: null,
    playlistIndex: null,
    currentTime: 0,
    filePath: null,
    playback: null,
    thumbnailUrl: null,
    thumbnailPath: null,
    isPlaying: false,
  });
}
