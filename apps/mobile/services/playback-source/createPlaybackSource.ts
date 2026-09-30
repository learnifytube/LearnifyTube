import { useRef, useSyncExternalStore } from "react";
import type { DesktopFetch } from "../desktop-fetch/createDesktopFetch";
import type { ConnectionStatus } from "../desktop-connection/createDesktopConnection";

/** Why a Video can't play. The screen words it for the viewer. */
export type PlaybackFailure =
  | { kind: "videoNotFound" }
  | { kind: "notOnThisTV" }
  | { kind: "desktopFailed"; error: unknown };

/** What the player plays the Video from, or why it can't. */
export type PlaybackSourceKind =
  | { kind: "preparing"; progress: number | null }
  | {
      kind: "offline";
      uri: string;
      /** Where to pick up after the desktop dropped out mid-Stream. */
      resumeAt: number | null;
    }
  | { kind: "stream"; uri: string }
  | {
      kind: "failed";
      failure: PlaybackFailure;
      /** Whether the desktop is here to try again with. */
      canRetry: boolean;
    }
  | {
      kind: "desktopLost";
      /** The next Video in the queue the Device holds, or null to go back. */
      nextIndex: number | null;
    };

/** Whether the next Video in the queue is ready to play when this one ends. */
export type UpNext = "none" | "loading" | "ready" | "failed";

export type PlaybackSourceState = {
  source: PlaybackSourceKind;
  upNext: UpNext;
};

export type PlaybackSourcePlatform = {
  getDesktop: () => { status: ConnectionStatus; url: string | null };
  onDesktopChange: (listener: () => void) => () => void;
  offlineCopy: {
    getUri: (videoId: string) => string | null;
    subscribe: (listener: () => void) => () => void;
  };
  desktopFetch: DesktopFetch;
  streamUrl: (serverUrl: string, videoId: string) => string;
  log: (message: string, data?: Record<string, unknown>) => void;
};

export type PlaybackSourceRequest = {
  videoId: string;
  /** The play queue, when the Video is played from one. */
  queue: readonly { id: string }[];
  /** The Video's place in the queue, or -1. */
  index: number;
  /** The player's position, for resuming the Offline copy after the desktop drops out. */
  getPosition: () => number;
};

/**
 * What the player does when the desktop drops out while it depends on it: play the
 * Offline copy, else the next Video in the queue the Device holds, else go back.
 */
function planDesktopLoss({
  videoId,
  queue,
  index,
  hasOfflineCopy,
}: {
  videoId: string;
  queue: readonly { id: string }[];
  index: number;
  hasOfflineCopy: (videoId: string) => boolean;
}) {
  if (hasOfflineCopy(videoId)) return { kind: "offlineCopy" } as const;
  if (index >= 0) {
    for (let next = index + 1; next < queue.length; next += 1) {
      if (hasOfflineCopy(queue[next].id))
        return { kind: "next", index: next } as const;
    }
  }
  return { kind: "back" } as const;
}

export function createPlaybackSource(platform: PlaybackSourcePlatform) {
  const { offlineCopy, desktopFetch } = platform;

  const notFoundState: PlaybackSourceState = {
    source: {
      kind: "failed",
      failure: { kind: "videoNotFound" },
      canRetry: false,
    },
    upNext: "none",
  };
  const notFound = {
    getState: () => notFoundState,
    subscribe: (_listener: () => void) => () => {},
    retry: () => {},
  };

  const desktopUrl = () => {
    const desktop = platform.getDesktop();
    return desktop.status === "connected" ? desktop.url : null;
  };

  /**
   * A session for one Video. Reading its state starts nothing; the first
   * subscriber starts preparing and warming, and the last one stops them.
   */
  const open = ({
    videoId,
    queue,
    index,
    getPosition,
  }: PlaybackSourceRequest) => {
    if (!videoId) return notFound;
    const listeners = new Set<() => void>();
    let prepare: AbortController | null = null;
    let warm: AbortController | null = null;
    let warmedId: string | null = null;
    let stopListening: (() => void) | null = null;

    const initialSource = (): PlaybackSourceKind => {
      const uri = offlineCopy.getUri(videoId);
      if (uri) return { kind: "offline", uri, resumeAt: null };
      if (desktopUrl()) return { kind: "preparing", progress: null };
      return {
        kind: "failed",
        failure: { kind: "notOnThisTV" },
        canRetry: false,
      };
    };

    let state: PlaybackSourceState = {
      source: initialSource(),
      upNext: "none",
    };

    const set = (changes: Partial<PlaybackSourceState>) => {
      state = { ...state, ...changes };
      for (const listener of listeners) listener();
    };
    const setSource = (source: PlaybackSourceKind) => set({ source });
    const setUpNext = (upNext: UpNext) => {
      if (state.upNext !== upNext) set({ upNext });
    };

    const stopPreparing = () => {
      prepare?.abort();
      prepare = null;
    };

    const stopWarming = () => {
      warm?.abort();
      warm = null;
    };

    const startPreparing = (serverUrl: string) => {
      const controller = new AbortController();
      prepare = controller;
      if (state.source.kind !== "preparing") {
        setSource({ kind: "preparing", progress: null });
      }
      platform.log("[PlaybackSource] Streaming from the desktop", {
        videoId,
        serverUrl,
      });
      desktopFetch
        .waitUntilFetched(serverUrl, videoId, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) {
              setSource({ kind: "preparing", progress });
            }
          },
        })
        .then(() => {
          if (controller.signal.aborted) return;
          prepare = null;
          setSource({
            kind: "stream",
            uri: platform.streamUrl(serverUrl, videoId),
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          prepare = null;
          platform.log("[PlaybackSource] Preparing the Stream failed", {
            videoId,
            serverUrl,
            error: error instanceof Error ? error.message : String(error),
          });
          setSource({
            kind: "failed",
            failure: { kind: "desktopFailed", error },
            canRetry: desktopUrl() !== null,
          });
        });
    };

    // Picks the source afresh: the Offline copy, else a Stream, else nothing.
    const resolve = () => {
      const uri = offlineCopy.getUri(videoId);
      if (uri) {
        stopPreparing();
        setSource({ kind: "offline", uri, resumeAt: null });
        return;
      }
      const serverUrl = desktopUrl();
      if (serverUrl) {
        if (!prepare) startPreparing(serverUrl);
        return;
      }
      stopPreparing();
      setSource({
        kind: "failed",
        failure: { kind: "notOnThisTV" },
        canRetry: false,
      });
    };

    const warmNext = () => {
      const next = index >= 0 ? queue[index + 1] : undefined;
      if (!next) {
        stopWarming();
        setUpNext("none");
        return;
      }
      if (offlineCopy.getUri(next.id)) {
        stopWarming();
        setUpNext("ready");
        return;
      }
      const serverUrl = desktopUrl();
      if (!serverUrl) {
        stopWarming();
        setUpNext("none");
        return;
      }
      if (warmedId === next.id) {
        setUpNext("ready");
        return;
      }
      if (warm || state.upNext === "failed") return;
      const controller = new AbortController();
      warm = controller;
      setUpNext("loading");
      desktopFetch
        .waitUntilFetched(serverUrl, next.id, { signal: controller.signal })
        .then(() => {
          if (controller.signal.aborted) return;
          warm = null;
          warmedId = next.id;
          setUpNext("ready");
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          warm = null;
          platform.log("[PlaybackSource] Warming the next Video failed", {
            videoId: next.id,
            error: error instanceof Error ? error.message : String(error),
          });
          setUpNext("failed");
        });
    };

    const dependsOnDesktop = () =>
      state.source.kind === "stream" || state.source.kind === "preparing";

    const onDesktopLoss = () => {
      const plan = planDesktopLoss({
        videoId,
        queue,
        index,
        hasOfflineCopy: (id) => offlineCopy.getUri(id) !== null,
      });
      platform.log("[PlaybackSource] Desktop dropped out mid-video", {
        videoId,
        plan: plan.kind,
      });
      const wasStreaming = state.source.kind === "stream";
      stopPreparing();
      const uri = offlineCopy.getUri(videoId);
      if (plan.kind === "offlineCopy" && uri) {
        setSource({
          kind: "offline",
          uri,
          resumeAt: wasStreaming ? getPosition() : null,
        });
        return;
      }
      setSource({
        kind: "desktopLost",
        nextIndex: plan.kind === "next" ? plan.index : null,
      });
    };

    const onDesktopChange = () => {
      const { source } = state;
      const connected = desktopUrl() !== null;
      if (connected) {
        if (source.kind === "failed" && source.failure.kind === "notOnThisTV") {
          resolve();
        }
      } else if (dependsOnDesktop()) {
        onDesktopLoss();
      }
      if (
        state.source.kind === "failed" &&
        state.source.failure.kind === "desktopFailed" &&
        state.source.canRetry !== connected
      ) {
        setSource({ ...state.source, canRetry: connected });
      }
      warmNext();
    };

    const onOfflineCopyChange = () => {
      const { source } = state;
      const uri = offlineCopy.getUri(videoId);
      // A Stream that has started keeps playing from the desktop.
      if (source.kind === "offline" ? uri !== source.uri : uri !== null) {
        if (source.kind !== "stream" && source.kind !== "desktopLost") {
          resolve();
        }
      }
      warmNext();
    };

    const start = () => {
      const unsubscribeDesktop = platform.onDesktopChange(onDesktopChange);
      const unsubscribeOfflineCopy = offlineCopy.subscribe(onOfflineCopyChange);
      stopListening = () => {
        unsubscribeDesktop();
        unsubscribeOfflineCopy();
      };
      const { source } = state;
      if (
        source.kind === "preparing" ||
        (source.kind === "failed" && source.failure.kind === "notOnThisTV")
      ) {
        resolve();
      }
      warmNext();
    };

    const stop = () => {
      stopListening?.();
      stopListening = null;
      stopPreparing();
      stopWarming();
    };

    return {
      getState: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        if (listeners.size === 1) start();
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) stop();
        };
      },
      /** Prepares a failed Video again. */
      retry: () => {
        if (state.source.kind !== "failed") return;
        stopPreparing();
        resolve();
      },
    };
  };

  /**
   * The source of the Video the player is on, following the Offline copy and the
   * Desktop connection: the Offline copy, else a Stream once the desktop has
   * fetched the Video, else a failure. Also warms the next Video in the queue.
   */
  const useSource = (request: PlaybackSourceRequest) => {
    const ref = useRef<{
      videoId: string;
      queue: PlaybackSourceRequest["queue"];
      index: number;
      session: PlaybackSourceSession;
    } | null>(null);
    let entry = ref.current;
    if (
      !entry ||
      entry.videoId !== request.videoId ||
      entry.queue !== request.queue ||
      entry.index !== request.index
    ) {
      // Opening only reads; nothing runs until useSyncExternalStore subscribes.
      entry = {
        videoId: request.videoId,
        queue: request.queue,
        index: request.index,
        session: open(request),
      };
      ref.current = entry;
    }
    const { session } = entry;
    const state = useSyncExternalStore(session.subscribe, session.getState);
    return { ...state, retry: session.retry };
  };

  return { open, useSource };
}

export type PlaybackSourceSession = ReturnType<
  ReturnType<typeof createPlaybackSource>["open"]
>;
