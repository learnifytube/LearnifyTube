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
import { useDownloadStore } from "../../../stores/downloads";
import { usePlaybackStore } from "../../../stores/playback";
import { useTVHistoryStore } from "../../../stores/tvHistory";
import { api } from "../../../services/api";
import { offlineCopy } from "../../../services/offline-copy";
import { logger } from "../../../services/logger";
import { tvDebugInfo } from "../../../services/tvDebug";
import {
  TVFocusPressable,
  type TVFocusPressableHandle,
} from "../../../components/tv/TVFocusPressable";
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
    throw new Error(response.message || "Server refused download request");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    throwIfAborted(signal);

    const status = await api.getServerDownloadStatus(serverUrl, videoId);
    onStatus?.(status);

    if (status.status === "failed") {
      throw new Error(status.error || "Server download failed");
    }

    if (status.status === "completed") {
      const ready = await probeVideoFileAvailability(serverUrl, videoId, signal);
      if (ready) {
        return;
      }
    }

    await sleep(SERVER_DOWNLOAD_POLL_MS);
  }

  throw new Error("Server download timed out");
}

async function waitForLocalVideoReady(
  videoId: string,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onProgress?: (progress: number | null) => void;
  }
): Promise<string> {
  const signal = options?.signal;
  const timeoutMs = options?.timeoutMs ?? SERVER_DOWNLOAD_TIMEOUT_MS;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    throwIfAborted(signal);

    const offlineUri = offlineCopy.getUri(videoId);
    if (offlineUri) {
      options?.onProgress?.(100);
      return offlineUri;
    }

    const download = useDownloadStore.getState().getDownload(videoId);
    if (download?.status === "failed") {
      throw new Error(download.error || "Download to TV failed");
    }

    if (download?.status === "downloading" || download?.status === "completed") {
      options?.onProgress?.(download.progress ?? null);
    } else {
      options?.onProgress?.(null);
    }

    await sleep(1000);
  }

  throw new Error("Download to TV timed out");
}

export default function TVPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const libraryVideo = useLibraryStore((state) => state.videos.find((item) => item.id === id));
  const serverUrl = useConnectionStore((state) => state.serverUrl);

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
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [prepareProgress, setPrepareProgress] = useState<number | null>(null);
  const [prepareRetryVersion, setPrepareRetryVersion] = useState(0);
  const [isVideoViewReady, setIsVideoViewReady] = useState(false);
  const [isRemoteNavVisible, setIsRemoteNavVisible] = useState(true);
  const [shouldPreferRemoteNavFocus, setShouldPreferRemoteNavFocus] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const navigationLockVideoIdRef = useRef<string | null>(null);
  const prefetchedNextVideoIdRef = useRef<string | null>(null);
  const remoteNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backNavRef = useRef<TVFocusPressableHandle | null>(null);
  const prevNavRef = useRef<TVFocusPressableHandle | null>(null);
  const playPauseNavRef = useRef<TVFocusPressableHandle | null>(null);
  const nextNavRef = useRef<TVFocusPressableHandle | null>(null);
  const [navNodeHandles, setNavNodeHandles] = useState<{
    back?: number;
    prev?: number;
    playPause?: number;
    next?: number;
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

  const playlistIndex = useMemo(() => {
    if (!id) return -1;
    return playlistVideos.findIndex((item) => item.id === id);
  }, [id, playlistVideos]);

  const playlistVideo = playlistIndex >= 0 ? playlistVideos[playlistIndex] : undefined;
  const video = playlistVideo ?? libraryVideo;

  const effectiveServerUrl = streamServerUrl ?? serverUrl;

  const offlineUri = offlineCopy.useUri(id ?? "");

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
      setPrepareError("Video ID is missing");
      setPrepareProgress(null);
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
      setPrepareError("Video is not available offline");
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
        if (!video) {
          throw new Error("Video metadata is unavailable");
        }

        tvDebugInfo("[TV Playback Debug] Falling back to desktop playback", {
          videoId: id,
          serverUrl: effectiveServerUrl,
          reason: "download-to-tv-required",
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

        const existingDownload = useDownloadStore.getState().getDownload(id);
        if (!offlineCopy.getUri(id)) {
          tvDebugInfo("[TV Playback Debug] Queueing TV download", {
            videoId: id,
            title: video.title,
            existingDownloadStatus: existingDownload?.status ?? null,
          });
          useDownloadStore.getState().queueDownload(id, {
            title: video.title,
            channelTitle: video.channelTitle,
            duration: video.duration,
            thumbnailUrl: video.thumbnailUrl ?? undefined,
          });
        }

        await waitForLocalVideoReady(id, {
          signal: abortController.signal,
          onProgress: (progress) => {
            if (cancelled) return;
            setPrepareProgress(progress);
          },
        });

        if (!cancelled) {
          tvDebugInfo("[TV Playback Debug] TV download ready", {
            videoId: id,
            offlineUri: offlineCopy.getUri(id),
          });
          setPrepareState("ready");
          setPrepareError(null);
          setPrepareProgress(100);
        }
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
        setPrepareError(getErrorMessage(error));
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
    video,
  ]);

  const source = useMemo(() => {
    if (!id) return "";
    if (offlineUri) return offlineUri;
    return "";
  }, [effectiveServerUrl, id, offlineUri, prepareState]);

  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    instance.play();
  });

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
  const playbackModeLabel = offlineUri ? "Offline" : "Streaming";

  useEffect(() => {
    setNavNodeHandles({
      back: backNavRef.current ? findNodeHandle(backNavRef.current) ?? undefined : undefined,
      prev: prevNavRef.current ? findNodeHandle(prevNavRef.current) ?? undefined : undefined,
      playPause: playPauseNavRef.current ? findNodeHandle(playPauseNavRef.current) ?? undefined : undefined,
      next: nextNavRef.current ? findNodeHandle(nextNavRef.current) ?? undefined : undefined,
    });
  }, [hasNext, hasPrevious, playlistIndex]);

  useEffect(() => {
    const sub = player.addListener("playingChange", (event) => {
      setIsPlaying(event.isPlaying);
    });
    return () => sub.remove();
  }, [player]);

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
        const normalizedEventType = eventType.toLowerCase();
        const isDirectionalKey =
          normalizedEventType === "up" ||
          normalizedEventType === "down" ||
          normalizedEventType === "left" ||
          normalizedEventType === "right" ||
          normalizedEventType === "arrowup" ||
          normalizedEventType === "arrowdown" ||
          normalizedEventType === "arrowleft" ||
          normalizedEventType === "arrowright" ||
          normalizedEventType === "keycode_dpad_up" ||
          normalizedEventType === "keycode_dpad_down" ||
          normalizedEventType === "keycode_dpad_left" ||
          normalizedEventType === "keycode_dpad_right" ||
          normalizedEventType.includes("dpad_up") ||
          normalizedEventType.includes("dpad_down") ||
          normalizedEventType.includes("dpad_left") ||
          normalizedEventType.includes("dpad_right");
        // Some TV remotes only emit ACTION_UP for D-pad events.
        // Let directional keys wake the overlay on either action.
        if (
          typeof event.eventKeyAction === "number" &&
          event.eventKeyAction !== 0 &&
          !isDirectionalKey
        ) {
          return;
        }

        if (isDirectionalKey) {
          if (!isRemoteNavVisible) {
            showRemoteNav(true);
            return;
          }
          // Explicit hide toggle when pressing DOWN while header is visible.
          if (
            normalizedEventType === "down" ||
            normalizedEventType === "arrowdown" ||
            normalizedEventType === "keycode_dpad_down" ||
            normalizedEventType.includes("dpad_down")
          ) {
            clearRemoteNavTimeout();
            setIsRemoteNavVisible(false);
            return;
          }
          showRemoteNav(false);
          return;
        }

        if (eventType === "KEYCODE_MEDIA_PLAY_PAUSE") {
          if (player.playing) {
            player.pause();
          } else {
            player.play();
          }
          showRemoteNav(false);
          return;
        }

        if (eventType === "KEYCODE_MEDIA_PLAY") {
          player.play();
          showRemoteNav(false);
          return;
        }

        if (eventType === "KEYCODE_MEDIA_PAUSE") {
          player.pause();
          showRemoteNav(false);
          return;
        }

        showRemoteNav(!isRemoteNavVisible);
      }
    );

    return () => {
      subscription.remove();
    };
  }, [clearRemoteNavTimeout, isRemoteNavVisible, player, showRemoteNav]);

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
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <TVFocusPressable onPress={() => router.back()} style={styles.backButton} hasTVPreferredFocus>
          <Text style={styles.backButtonText}>Back</Text>
        </TVFocusPressable>
        <View style={styles.centered}>
          {prepareState === "preparing" ? (
            <>
              <Text style={styles.errorText}>Preparing video for offline playback...</Text>
              <Text style={styles.channel}>
                {prepareProgress !== null
                  ? `Download progress ${Math.max(0, Math.round(prepareProgress))}%`
                  : "Please wait"}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.errorText}>
                {prepareError ?? "Video source is not available"}
              </Text>
              {id && effectiveServerUrl ? (
                <TVFocusPressable
                  style={styles.retryPrepareButton}
                  onPress={() => setPrepareRetryVersion((prev) => prev + 1)}
                >
                  <Text style={styles.retryPrepareButtonText}>Retry Download</Text>
                </TVFocusPressable>
              ) : null}
            </>
          )}
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
                ? `Loading next: ${nextVideo.title}`
                : nextVideo
                  ? `Up next: ${nextVideo.title}`
                  : playbackModeLabel}
            </Text>
          </View>

          <View style={styles.navFabRow}>
            <TVFocusPressable
              ref={backNavRef}
              style={styles.navFabButton}
              onPress={() => {
                if (!isRemoteNavVisible) {
                  showRemoteNav(true);
                  return;
                }
                showRemoteNav(false);
                router.back();
              }}
              onFocus={handleRemoteNavFocus}
              onBlur={handleRemoteNavBlur}
              nextFocusRight={hasPrevious ? navNodeHandles.prev : navNodeHandles.playPause}
            >
              <Text style={styles.navFabText}>Back</Text>
            </TVFocusPressable>

            <TVFocusPressable
              ref={prevNavRef}
              style={[styles.navFabButton, !hasPrevious && styles.navButtonDisabled]}
              onPress={() => {
                if (!isRemoteNavVisible) {
                  showRemoteNav(true);
                  return;
                }
                showRemoteNav(false);
                goToIndex(playlistIndex - 1);
              }}
              onFocus={handleRemoteNavFocus}
              onBlur={handleRemoteNavBlur}
              disabled={!hasPrevious}
              nextFocusLeft={navNodeHandles.back}
              nextFocusRight={navNodeHandles.playPause}
            >
              <Text style={styles.navFabText}>Prev</Text>
            </TVFocusPressable>

            <TVFocusPressable
              ref={playPauseNavRef}
              style={styles.navFabButton}
              onPress={() => {
                if (!isRemoteNavVisible) {
                  showRemoteNav(true);
                  return;
                }
                togglePlayPause();
              }}
              onFocus={handleRemoteNavFocus}
              onBlur={handleRemoteNavBlur}
              hasTVPreferredFocus={shouldPreferRemoteNavFocus}
              nextFocusLeft={hasPrevious ? navNodeHandles.prev : navNodeHandles.back}
              nextFocusRight={hasNext ? navNodeHandles.next : undefined}
            >
              <Text style={styles.navFabText}>{isPlaying ? "Pause" : "Play"}</Text>
            </TVFocusPressable>

            <TVFocusPressable
              ref={nextNavRef}
              style={[styles.navFabButton, !hasNext && styles.navButtonDisabled]}
              onPress={() => {
                if (!isRemoteNavVisible) {
                  showRemoteNav(true);
                  return;
                }
                showRemoteNav(false);
                goToIndex(playlistIndex + 1);
              }}
              onFocus={handleRemoteNavFocus}
              onBlur={handleRemoteNavBlur}
              disabled={!hasNext}
              nextFocusLeft={navNodeHandles.playPause}
            >
              <Text style={styles.navFabText}>Next</Text>
            </TVFocusPressable>
          </View>
        </View>
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
  backButton: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff6b6b",
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  backButtonText: {
    color: "#fffef2",
    fontSize: 20,
    fontWeight: "900",
  },
  navButton: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff8a00",
    paddingHorizontal: 18,
    paddingVertical: 10,
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
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    color: "#fecaca",
    fontSize: 22,
    fontWeight: "700",
  },
  channel: {
    color: "#e5f2ff",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 8,
  },
  retryPrepareButton: {
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#2d7ff9",
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryPrepareButtonText: {
    color: "#fffef2",
    fontSize: 20,
    fontWeight: "900",
  },
});
