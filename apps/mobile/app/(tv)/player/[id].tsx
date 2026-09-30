import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DeviceEventEmitter,
  View,
  Text,
  StyleSheet,
  findNodeHandle,
} from "react-native";
import { useLocalSearchParams, router, type Href } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLibraryStore } from "../../../stores/library";
import { useConnectionStore } from "../../../stores/connection";
import { usePlaybackStore } from "../../../stores/playback";
import { useTVHistoryStore } from "../../../stores/tvHistory";
import { useTVNoticeStore } from "../../../stores/tvNotice";
import { api } from "../../../services/api";
import { desktopConnection } from "../../../services/desktop-connection";
import { offlineCopy } from "../../../services/offline-copy";
import { logger } from "../../../services/logger";
import { tvDebugInfo } from "../../../services/tvDebug";
import { useWatchProgressRecorder } from "../../../hooks/useWatchProgressRecorder";
import {
  TVFocusPressable,
  type TVFocusPressableHandle,
} from "../../../components/tv/TVFocusPressable";
import {
  formatPlaybackTime,
  isSeekPending,
  planSeek,
  type PendingSeek,
} from "../../../components/tv/playerSeek";
import {
  TVMessageButton,
  TVMessageCard,
} from "../../../components/tv/TVMessage";
import { planDesktopLoss } from "../../../components/tv/desktopLoss";
import {
  DesktopFetchFailedError,
  DesktopStillFetchingError,
  describeVideoFailure,
  desktopGettingVideoTitle,
  desktopGoneNextVideo,
  desktopGoneNothingLeft,
  notOnThisTV,
  videoNotFound,
  type TVMessageContent,
} from "../../../components/tv/tvMessages";
import { colors, fontSize, fontWeight, radius, spacing } from "../../../theme";
import type { ServerDownloadStatus } from "../../../types";

type PrefetchState = "idle" | "loading" | "ready" | "failed";
type SourcePrepareState = "idle" | "preparing" | "ready" | "failed";

const SERVER_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const SERVER_DOWNLOAD_POLL_MS = 2000;
const REMOTE_NAV_TIMEOUT_MS = 4500;
const REMOTE_NAV_AUTO_HIDE_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const MEDIA_KEYS = new Set(["playPause", "rewind", "fastForward"]);

type Direction = "up" | "down" | "left" | "right";

// Android's KeyEvent.ACTION_UP.
const KEY_UP = 1;

function getDirection(eventType: string) {
  const normalized = eventType.toLowerCase();
  for (const direction of ["up", "down", "left", "right"] as const) {
    if (
      normalized === direction ||
      normalized === `arrow${direction}` ||
      normalized.includes(`dpad_${direction}`)
    ) {
      return direction;
    }
  }
  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    throw abortError;
  }
}

async function probeVideoFileAvailability(
  serverUrl: string,
  videoId: string,
  signal?: AbortSignal
): Promise<boolean> {
  const fileUrl = api.getVideoFileUrl(serverUrl, videoId);

  try {
    const head = await fetch(fileUrl, {
      method: "HEAD",
      signal,
    });
    if (head.ok) {
      return true;
    }
  } catch {
    // Continue to range probe
  }

  try {
    const probe = await fetch(fileUrl, {
      signal,
      headers: {
        Range: "bytes=0-2048",
      },
    });

    if (!probe.ok) {
      return false;
    }

    await probe.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

async function ensureServerVideoReady(
  serverUrl: string,
  videoId: string,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onStatus?: (status: ServerDownloadStatus) => void;
  }
): Promise<void> {
  const signal = options?.signal;
  const timeoutMs = options?.timeoutMs ?? SERVER_DOWNLOAD_TIMEOUT_MS;
  const onStatus = options?.onStatus;

  throwIfAborted(signal);

  const alreadyReady = await probeVideoFileAvailability(serverUrl, videoId, signal);
  if (alreadyReady) {
    onStatus?.({
      videoId,
      status: "completed",
      progress: 100,
      error: null,
    });
    return;
  }

  const response = await api.requestServerDownload(serverUrl, { videoId });
  if (!response.success && !response.status) {
    throw new DesktopFetchFailedError(response.message || null);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    throwIfAborted(signal);

    const status = await api.getServerDownloadStatus(serverUrl, videoId);
    onStatus?.(status);

    if (status.status === "failed") {
      throw new DesktopFetchFailedError(status.error);
    }

    if (status.status === "completed") {
      const ready = await probeVideoFileAvailability(serverUrl, videoId, signal);
      if (ready) {
        return;
      }
    }

    await sleep(SERVER_DOWNLOAD_POLL_MS);
  }

  throw new DesktopStillFetchingError();
}

export default function TVPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const libraryVideo = useLibraryStore((state) => state.videos.find((item) => item.id === id));
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const connectionStatus = desktopConnection.useConnection().status;
  const showNotice = useTVNoticeStore((state) => state.show);

  const playlistId = usePlaybackStore((state) => state.playlistId);
  const playlistVideos = usePlaybackStore((state) => state.playlistVideos);
  const currentIndex = usePlaybackStore((state) => state.currentIndex);
  const setCurrentIndex = usePlaybackStore((state) => state.setCurrentIndex);
  const streamServerUrl = usePlaybackStore((state) => state.streamServerUrl);
  const updateRecentPlaylistProgress = useTVHistoryStore(
    (state) => state.updateRecentPlaylistProgress
  );

  const [prefetchState, setPrefetchState] = useState<PrefetchState>("idle");
  const [prepareState, setPrepareState] = useState<SourcePrepareState>("idle");
  const [prepareError, setPrepareError] = useState<TVMessageContent | null>(
    null
  );
  const [prepareProgress, setPrepareProgress] = useState<number | null>(null);
  const [prepareRetryVersion, setPrepareRetryVersion] = useState(0);
  const [isVideoViewReady, setIsVideoViewReady] = useState(false);
  const [isRemoteNavVisible, setIsRemoteNavVisible] = useState(true);
  const [shouldPreferRemoteNavFocus, setShouldPreferRemoteNavFocus] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [stream, setStream] = useState<{
    videoId: string;
    url: string;
  } | null>(null);
  const [playback, setPlayback] = useState({ position: 0, duration: 0 });
  const pendingSeekRef = useRef<PendingSeek | null>(null);
  // Where the Offline copy picks up after the desktop drops out mid-stream.
  const resumeAtRef = useRef<{ videoId: string; position: number } | null>(
    null,
  );
  // Only a desktop that was here can drop out; a player opened in Offline mode fails as usual.
  const hadDesktopRef = useRef(false);
  const isProgressFocusedRef = useRef(false);
  // Set when a key press woke the overlay, so that press's click doesn't also act.
  const suppressNextPressRef = useRef(false);
  const navigationLockVideoIdRef = useRef<string | null>(null);
  const prefetchedNextVideoIdRef = useRef<string | null>(null);
  const remoteNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backNavRef = useRef<TVFocusPressableHandle | null>(null);
  const prevNavRef = useRef<TVFocusPressableHandle | null>(null);
  const playPauseNavRef = useRef<TVFocusPressableHandle | null>(null);
  const nextNavRef = useRef<TVFocusPressableHandle | null>(null);
  const progressNavRef = useRef<TVFocusPressableHandle | null>(null);
  const [navNodeHandles, setNavNodeHandles] = useState<{
    back?: number;
    prev?: number;
    playPause?: number;
    next?: number;
    progress?: number;
  }>({});

  const clearRemoteNavTimeout = useCallback(() => {
    if (remoteNavTimeoutRef.current) {
      clearTimeout(remoteNavTimeoutRef.current);
      remoteNavTimeoutRef.current = null;
    }
  }, []);

  const scheduleRemoteNavAutoHide = useCallback(() => {
    clearRemoteNavTimeout();
    remoteNavTimeoutRef.current = setTimeout(() => {
      setIsRemoteNavVisible(false);
    }, REMOTE_NAV_AUTO_HIDE_MS);
  }, [clearRemoteNavTimeout]);

  const showRemoteNav = useCallback((preferRemoteNavFocus = false) => {
    setIsRemoteNavVisible(true);
    if (preferRemoteNavFocus) {
      setShouldPreferRemoteNavFocus(true);
    }
    scheduleRemoteNavAutoHide();
  }, [scheduleRemoteNavAutoHide]);

  const handleRemoteNavFocus = useCallback(() => {
    setShouldPreferRemoteNavFocus(false);
    scheduleRemoteNavAutoHide();
  }, [scheduleRemoteNavAutoHide]);

  const handleRemoteNavBlur = useCallback(() => {
    scheduleRemoteNavAutoHide();
  }, [scheduleRemoteNavAutoHide]);

  // Runs an overlay button's action, unless the press only woke the overlay.
  const pressRemoteNav = (action: () => void) => {
    if (!isRemoteNavVisible || suppressNextPressRef.current) {
      suppressNextPressRef.current = false;
      showRemoteNav(true);
      return;
    }
    action();
  };

  const playlistIndex = useMemo(() => {
    if (!id) return -1;
    return playlistVideos.findIndex((item) => item.id === id);
  }, [id, playlistVideos]);

  const playlistVideo = playlistIndex >= 0 ? playlistVideos[playlistIndex] : undefined;
  const video = playlistVideo ?? libraryVideo;

  const effectiveServerUrl = streamServerUrl ?? serverUrl;

  const offlineUri = offlineCopy.useUri(id ?? "");
  // Once a Video starts streaming it keeps its source, even if its Offline copy lands meanwhile.
  const streamUrl = stream && stream.videoId === id ? stream.url : null;

  useEffect(() => {
    if (!id) {
      return;
    }

    tvDebugInfo("[TV Playback Debug] Source resolution", {
      videoId: id,
      hasOfflineUri: !!offlineUri,
      offlineUri,
      hasEffectiveServerUrl: !!effectiveServerUrl,
      effectiveServerUrl,
      sourceKind: offlineUri
        ? "local-file"
        : effectiveServerUrl
          ? "desktop-playback"
          : "unavailable",
    });
  }, [effectiveServerUrl, id, offlineUri]);

  useEffect(() => {
    if (!id) {
      setPrepareState("failed");
      setPrepareError(videoNotFound);
      setPrepareProgress(null);
      return;
    }

    if (streamUrl) {
      return;
    }

    if (offlineUri) {
      tvDebugInfo("[TV Playback Debug] Using local file", {
        videoId: id,
        offlineUri,
      });
      setPrepareState("ready");
      setPrepareError(null);
      setPrepareProgress(100);
      return;
    }

    if (!effectiveServerUrl) {
      logger.warn("[TV Playback Debug] Offline playback unavailable", {
        videoId: id,
        reason: "no-local-file-and-no-server",
      });
      setPrepareState("failed");
      setPrepareError(notOnThisTV);
      setPrepareProgress(null);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();

    setPrepareState("preparing");
    setPrepareError(null);
    setPrepareProgress(null);

    const prepare = async () => {
      try {
        tvDebugInfo("[TV Playback Debug] Streaming from the desktop", {
          videoId: id,
          serverUrl: effectiveServerUrl,
        });
        await ensureServerVideoReady(effectiveServerUrl, id, {
          signal: abortController.signal,
          onStatus: (status) => {
            if (cancelled) return;
            setPrepareProgress(status.progress ?? null);
          },
        });

        if (cancelled || abortController.signal.aborted) {
          return;
        }

        setStream({
          videoId: id,
          url: api.getVideoFileUrl(effectiveServerUrl, id),
        });
        setPrepareState("ready");
        setPrepareError(null);
        setPrepareProgress(100);
      } catch (error) {
        if (cancelled || abortController.signal.aborted) {
          return;
        }

        logger.warn("[TV Playback Debug] Desktop playback preparation failed", {
          videoId: id,
          serverUrl: effectiveServerUrl,
          error: getErrorMessage(error),
        });
        setPrepareState("failed");
        setPrepareError(describeVideoFailure(error));
        setPrepareProgress(null);
      }
    };

    void prepare();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    effectiveServerUrl,
    id,
    offlineUri,
    prepareRetryVersion,
    streamUrl,
  ]);

  const source = id ? (streamUrl ?? offlineUri ?? "") : "";

  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 1;
    const resumeAt = resumeAtRef.current;
    if (resumeAt && resumeAt.videoId === id) {
      instance.currentTime = resumeAt.position;
      resumeAtRef.current = null;
    }
    instance.play();
  });
  useWatchProgressRecorder(player, video);

  useEffect(() => {
    setIsVideoViewReady(false);

    if (!source) {
      return;
    }

    const timeout = setTimeout(() => {
      setIsVideoViewReady(true);
    }, 0);

    return () => {
      clearTimeout(timeout);
    };
  }, [source]);

  useEffect(() => {
    if (playlistIndex >= 0 && playlistIndex !== currentIndex) {
      setCurrentIndex(playlistIndex);
    }
  }, [playlistIndex, currentIndex, setCurrentIndex]);

  useEffect(() => {
    if (!playlistId || playlistIndex < 0) return;
    updateRecentPlaylistProgress({
      playlistId,
      currentIndex: playlistIndex,
      currentVideoId: playlistVideos[playlistIndex]?.id ?? null,
    });
  }, [
    playlistId,
    playlistIndex,
    playlistVideos,
    updateRecentPlaylistProgress,
  ]);

  const hasPlaylistContext = playlistIndex >= 0;
  const hasPrevious = hasPlaylistContext && playlistIndex > 0;
  const hasNext = hasPlaylistContext && playlistIndex < playlistVideos.length - 1;
  const nextVideo = hasNext ? playlistVideos[playlistIndex + 1] : null;
  const nextOfflineUri = offlineCopy.useUri(nextVideo?.id ?? "");
  const playbackModeLabel = streamUrl ? "Streaming" : "Offline";
  const duration =
    playback.duration > 0 ? playback.duration : (video?.duration ?? 0);
  const position =
    duration > 0 ? Math.min(playback.position, duration) : playback.position;
  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;

  useEffect(() => {
    setNavNodeHandles({
      back: backNavRef.current ? findNodeHandle(backNavRef.current) ?? undefined : undefined,
      prev: prevNavRef.current ? findNodeHandle(prevNavRef.current) ?? undefined : undefined,
      playPause: playPauseNavRef.current ? findNodeHandle(playPauseNavRef.current) ?? undefined : undefined,
      next: nextNavRef.current ? findNodeHandle(nextNavRef.current) ?? undefined : undefined,
      progress: progressNavRef.current
        ? (findNodeHandle(progressNavRef.current) ?? undefined)
        : undefined,
    });
  }, [hasNext, hasPrevious, playlistIndex, source]);

  useEffect(() => {
    const sub = player.addListener("playingChange", (event) => {
      setIsPlaying(event.isPlaying);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    pendingSeekRef.current = null;
    setPlayback({ position: player.currentTime, duration: player.duration });
    const timeSub = player.addListener("timeUpdate", (event) => {
      // Until the player catches up, keep showing where the seek is heading.
      if (isSeekPending(pendingSeekRef.current, Date.now())) return;
      setPlayback({ position: event.currentTime, duration: player.duration });
    });
    const loadSub = player.addListener("sourceLoad", (event) => {
      setPlayback((prev) => ({ ...prev, duration: event.duration }));
    });
    return () => {
      timeSub.remove();
      loadSub.remove();
    };
  }, [player]);

  const seek = (direction: 1 | -1) => {
    const next = planSeek({
      currentTime: player.currentTime,
      duration: player.duration,
      pending: pendingSeekRef.current,
      now: Date.now(),
      direction,
    });
    pendingSeekRef.current = next;
    player.currentTime = next.target;
    setPlayback((prev) => ({ ...prev, position: next.target }));
  };

  const togglePlayPause = useCallback(() => {
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
    showRemoteNav();
  }, [player, showRemoteNav]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "onHWKeyEvent",
      (event: { eventType?: string; eventKeyAction?: number }) => {
        const eventType = event?.eventType;
        if (!eventType || eventType === "focus" || eventType === "blur") {
          return;
        }
        const direction = getDirection(eventType);
        const isKeyDown = event.eventKeyAction !== KEY_UP;
        const isMediaKey = MEDIA_KEYS.has(eventType);

        // While the overlay is hidden, a d-pad press only shows it: it doesn't pause, skip or
        // seek. Some TV remotes only emit ACTION_UP for the d-pad, so either action wakes it.
        if (!isRemoteNavVisible && !isMediaKey) {
          // Only Select clicks the focused button.
          suppressNextPressRef.current = eventType === "select";
          showRemoteNav(true);
          return;
        }

        if (!isKeyDown) {
          return;
        }
        suppressNextPressRef.current = false;

        if (direction) {
          if (isProgressFocusedRef.current) {
            if (direction === "left" || direction === "right") {
              seek(direction === "right" ? 1 : -1);
              showRemoteNav(false);
              return;
            }
            // Down from the progress row, the bottom of the overlay, hides it.
            if (direction === "down") {
              clearRemoteNavTimeout();
              setIsRemoteNavVisible(false);
              return;
            }
          }
          showRemoteNav(false);
          return;
        }

        // Play/pause also reaches expo-video's media session, which toggles playback itself;
        // toggling here too would undo it.
        if (eventType === "playPause") {
          showRemoteNav(false);
          return;
        }

        if (eventType === "rewind" || eventType === "fastForward") {
          seek(eventType === "fastForward" ? 1 : -1);
          showRemoteNav(false);
          return;
        }

        showRemoteNav(false);
      }
    );

    return () => {
      subscription.remove();
    };
  }, [clearRemoteNavTimeout, isRemoteNavVisible, player, seek, showRemoteNav]);

  useEffect(() => {
    showRemoteNav(true);
    return () => {
      clearRemoteNavTimeout();
    };
  }, [clearRemoteNavTimeout, showRemoteNav]);

  const goToIndex = useCallback(
    (targetIndex: number) => {
      const target = playlistVideos[targetIndex];
      if (!target) return;
      navigationLockVideoIdRef.current = id ?? null;
      setCurrentIndex(targetIndex);
      router.replace(`/(tv)/player/${target.id}` as Href);
    },
    [id, playlistVideos, setCurrentIndex]
  );

  const dependsOnDesktop = !!streamUrl || prepareState === "preparing";

  // The desktop dropped out while this Video depends on it: carry on from the TV.
  useEffect(() => {
    if (connectionStatus === "connected") {
      hadDesktopRef.current = true;
      return;
    }
    if (
      !id ||
      !dependsOnDesktop ||
      !hadDesktopRef.current ||
      navigationLockVideoIdRef.current === id
    ) {
      return;
    }
    const plan = planDesktopLoss({
      videoId: id,
      queue: playlistVideos,
      index: playlistIndex,
      hasOfflineCopy: (videoId) => !!offlineCopy.getUri(videoId),
    });
    logger.info("[TV Player] Desktop dropped out mid-video", {
      videoId: id,
      plan: plan.kind,
    });
    if (plan.kind === "offlineCopy") {
      resumeAtRef.current = { videoId: id, position: player.currentTime };
      setStream(null);
      return;
    }
    if (plan.kind === "next") {
      showNotice(desktopGoneNextVideo);
      goToIndex(plan.index);
      return;
    }
    navigationLockVideoIdRef.current = id;
    showNotice(desktopGoneNothingLeft);
    router.back();
  }, [
    connectionStatus,
    dependsOnDesktop,
    goToIndex,
    id,
    player,
    playlistIndex,
    playlistVideos,
    showNotice,
  ]);

  useEffect(() => {
    if (!player) return;

    const endSubscription = player.addListener("playToEnd", () => {
      if (id && navigationLockVideoIdRef.current === id) {
        return;
      }
      if (hasNext) {
        goToIndex(playlistIndex + 1);
      }
    });

    return () => {
      endSubscription.remove();
    };
  }, [player, hasNext, goToIndex, playlistIndex]);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    const warmNextVideo = async () => {
      if (!nextVideo) {
        prefetchedNextVideoIdRef.current = null;
        setPrefetchState("idle");
        return;
      }

      if (nextOfflineUri) {
        prefetchedNextVideoIdRef.current = nextVideo.id;
        setPrefetchState("ready");
        return;
      }

      if (!effectiveServerUrl) {
        setPrefetchState("idle");
        return;
      }

      if (prefetchedNextVideoIdRef.current === nextVideo.id) {
        setPrefetchState("ready");
        return;
      }

      setPrefetchState("loading");

      try {
        await ensureServerVideoReady(effectiveServerUrl, nextVideo.id, {
          signal: abortController.signal,
        });

        if (!cancelled) {
          prefetchedNextVideoIdRef.current = nextVideo.id;
          setPrefetchState("ready");
        }
      } catch (error) {
        if (!cancelled && !abortController.signal.aborted) {
          console.log("[TV Player] Next video prefetch failed:", error);
          prefetchedNextVideoIdRef.current = null;
          setPrefetchState("failed");
        }
      }
    };

    void warmNextVideo();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [effectiveServerUrl, nextOfflineUri, nextVideo?.id]);

  if (!id || !source) {
    const failure =
      prepareState === "failed" ? (prepareError ?? notOnThisTV) : null;
    const canRetry = !!failure?.canRetry && !!id && !!effectiveServerUrl;
    const message = failure ?? {
      title: desktopGettingVideoTitle,
      text:
        prepareProgress !== null
          ? `${Math.max(0, Math.round(prepareProgress))}% done`
          : "Please wait",
    };

    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.centered}>
          <TVMessageCard message={message}>
            {canRetry ? (
              <TVMessageButton
                label="Retry"
                onPress={() => setPrepareRetryVersion((prev) => prev + 1)}
                hasTVPreferredFocus
              />
            ) : null}
            <TVMessageButton
              label="Back"
              onPress={() => router.back()}
              hasTVPreferredFocus={!canRetry}
            />
          </TVMessageCard>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.fullscreenContainer}>
      <View style={styles.videoFrame}>
        {isVideoViewReady ? (
          <VideoView
            key={`${id}:${source}`}
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls={false}
            focusable={false}
            importantForAccessibility="no-hide-descendants"
            surfaceType="surfaceView"
          />
        ) : (
          <View style={[styles.video, styles.videoPlaceholder]} />
        )}
      </View>

      <SafeAreaView
        style={[
          styles.chromeSafeArea,
          !isRemoteNavVisible && styles.overlayHidden,
        ]}
        edges={["top", "left", "right"]}
        pointerEvents={isRemoteNavVisible ? "auto" : "none"}
      >
        <View style={styles.overlayTopRow}>
          <View style={styles.titleChip}>
            <Text style={styles.titleChipText} numberOfLines={1}>
              {video?.title ?? "Now Playing"}
            </Text>
            <Text style={styles.titleChipMeta} numberOfLines={1}>
              {nextVideo && prefetchState === "loading"
                ? `${playbackModeLabel} · Loading next: ${nextVideo.title}`
                : nextVideo
                  ? `${playbackModeLabel} · Up next: ${nextVideo.title}`
                  : playbackModeLabel}
            </Text>
          </View>

          <View style={styles.navFabRow}>
            <TVFocusPressable
              ref={backNavRef}
              style={styles.navFabButton}
              onPress={() =>
                pressRemoteNav(() => {
                  showRemoteNav(false);
                  router.back();
                })
              }
              onFocus={handleRemoteNavFocus}
              onBlur={handleRemoteNavBlur}
              nextFocusDown={navNodeHandles.progress}
              nextFocusRight={hasPrevious ? navNodeHandles.prev : navNodeHandles.playPause}
            >
              <Text style={styles.navFabText}>Back</Text>
            </TVFocusPressable>

            <TVFocusPressable
              ref={prevNavRef}
              style={[styles.navFabButton, !hasPrevious && styles.navButtonDisabled]}
              onPress={() =>
                pressRemoteNav(() => {
                  showRemoteNav(false);
                  goToIndex(playlistIndex - 1);
                })
              }
              onFocus={handleRemoteNavFocus}
              onBlur={handleRemoteNavBlur}
              nextFocusDown={navNodeHandles.progress}
              disabled={!hasPrevious}
              nextFocusLeft={navNodeHandles.back}
              nextFocusRight={navNodeHandles.playPause}
            >
              <Text style={styles.navFabText}>Prev</Text>
            </TVFocusPressable>

            <TVFocusPressable
              ref={playPauseNavRef}
              style={styles.navFabButton}
              onPress={() => pressRemoteNav(togglePlayPause)}
              onFocus={handleRemoteNavFocus}
              onBlur={handleRemoteNavBlur}
              nextFocusDown={navNodeHandles.progress}
              hasTVPreferredFocus={shouldPreferRemoteNavFocus}
              nextFocusLeft={hasPrevious ? navNodeHandles.prev : navNodeHandles.back}
              nextFocusRight={hasNext ? navNodeHandles.next : undefined}
            >
              <Text style={styles.navFabText}>{isPlaying ? "Pause" : "Play"}</Text>
            </TVFocusPressable>

            <TVFocusPressable
              ref={nextNavRef}
              style={[styles.navFabButton, !hasNext && styles.navButtonDisabled]}
              onPress={() =>
                pressRemoteNav(() => {
                  showRemoteNav(false);
                  goToIndex(playlistIndex + 1);
                })
              }
              onFocus={handleRemoteNavFocus}
              onBlur={handleRemoteNavBlur}
              nextFocusDown={navNodeHandles.progress}
              disabled={!hasNext}
              nextFocusLeft={navNodeHandles.playPause}
            >
              <Text style={styles.navFabText}>Next</Text>
            </TVFocusPressable>
          </View>
        </View>

        <TVFocusPressable
          ref={progressNavRef}
          style={styles.progressRow}
          focusedStyle={styles.progressRowFocused}
          accessibilityLabel={`${formatPlaybackTime(position)} of ${formatPlaybackTime(duration)}`}
          onPress={() => pressRemoteNav(togglePlayPause)}
          onFocus={() => {
            isProgressFocusedRef.current = true;
            handleRemoteNavFocus();
          }}
          onBlur={() => {
            isProgressFocusedRef.current = false;
            handleRemoteNavBlur();
          }}
          nextFocusUp={navNodeHandles.playPause}
          nextFocusLeft={navNodeHandles.progress}
          nextFocusRight={navNodeHandles.progress}
        >
          <Text style={styles.progressTime}>
            {formatPlaybackTime(position)}
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[styles.progressFill, { width: `${progressPercent}%` }]}
            />
          </View>
          <Text style={styles.progressTime}>
            {formatPlaybackTime(duration)}
          </Text>
        </TVFocusPressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#132447",
    paddingHorizontal: 32,
    paddingBottom: 20,
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: "#000",
    position: "relative",
  },
  videoFrame: {
    flex: 1,
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  video: {
    flex: 1,
    backgroundColor: "#000",
  },
  videoPlaceholder: {
    backgroundColor: "#000",
  },
  chromeSafeArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 18,
    backgroundColor: "rgba(0, 0, 0, 0.82)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.12)",
  },
  overlayHidden: {
    opacity: 0,
  },
  overlayTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  titleChip: {
    flex: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.28)",
  },
  titleChipText: {
    color: "#fffef2",
    fontSize: 18,
    fontWeight: "800",
  },
  titleChipMeta: {
    marginTop: 4,
    color: "#dbeafe",
    fontSize: 14,
    fontWeight: "700",
  },
  navFabRow: {
    flexDirection: "row",
    gap: 12,
  },
  navFabButton: {
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff8a00",
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 102,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  navFabText: {
    color: "#fffef2",
    fontSize: 18,
    fontWeight: "900",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: "transparent",
  },
  progressRowFocused: {
    borderColor: colors.warning,
    backgroundColor: colors.overlayLight,
  },
  progressTime: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    fontVariant: ["tabular-nums"],
    minWidth: 72,
    textAlign: "center",
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
