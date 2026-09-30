import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DeviceEventEmitter,
  View,
  Text,
  StyleSheet,
  findNodeHandle,
} from "react-native";
import { useLocalSearchParams, router, type Href } from "expo-router";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLibraryStore } from "../../../stores/library";
import { usePlaybackStore } from "../../../stores/playback";
import { useTVHistoryStore } from "../../../stores/tvHistory";
import { useTVNoticeStore } from "../../../stores/tvNotice";
import {
  playbackSource,
  type PlaybackFailure,
} from "../../../services/playback-source";
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
import {
  describeVideoFailure,
  desktopGettingVideoTitle,
  desktopGoneNextVideo,
  desktopGoneNothingLeft,
  notOnThisTV,
  videoNotFound,
} from "../../../components/tv/tvMessages";
import {
  decideRemoteKey,
  type RemoteKeyEvent,
} from "../../../components/tv/remoteKeys";
import { colors, fontSize, fontWeight, radius, spacing } from "../../../theme";

const REMOTE_NAV_AUTO_HIDE_MS = 5000;

function describeFailure(failure: PlaybackFailure) {
  if (failure.kind === "videoNotFound") return videoNotFound;
  if (failure.kind === "notOnThisTV") return notOnThisTV;
  return describeVideoFailure(failure.error);
}

export default function TVPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const libraryVideo = useLibraryStore((state) =>
    state.videos.find((item) => item.id === id),
  );
  const showNotice = useTVNoticeStore((state) => state.show);

  const playlistId = usePlaybackStore((state) => state.playlistId);
  const playlistVideos = usePlaybackStore((state) => state.playlistVideos);
  const currentIndex = usePlaybackStore((state) => state.currentIndex);
  const setCurrentIndex = usePlaybackStore((state) => state.setCurrentIndex);
  const updateRecentPlaylistProgress = useTVHistoryStore(
    (state) => state.updateRecentPlaylistProgress,
  );

  const [isVideoViewReady, setIsVideoViewReady] = useState(false);
  const [isRemoteNavVisible, setIsRemoteNavVisible] = useState(true);
  const [shouldPreferRemoteNavFocus, setShouldPreferRemoteNavFocus] =
    useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playback, setPlayback] = useState({ position: 0, duration: 0 });
  const pendingSeekRef = useRef<PendingSeek | null>(null);
  const isProgressFocusedRef = useRef(false);
  // Set when a key press woke the overlay, so that press's click doesn't also act.
  const suppressNextPressRef = useRef(false);
  const navigationLockVideoIdRef = useRef<string | null>(null);
  const remoteNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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

  const showRemoteNav = useCallback(
    (preferRemoteNavFocus = false) => {
      setIsRemoteNavVisible(true);
      if (preferRemoteNavFocus) {
        setShouldPreferRemoteNavFocus(true);
      }
      scheduleRemoteNavAutoHide();
    },
    [scheduleRemoteNavAutoHide],
  );

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

  const playlistVideo =
    playlistIndex >= 0 ? playlistVideos[playlistIndex] : undefined;
  const video = playlistVideo ?? libraryVideo;

  // The player, once it exists, for resuming the Offline copy where a Stream left off.
  const playerRef = useRef<VideoPlayer | null>(null);
  const {
    source: playbackState,
    upNext,
    retry,
  } = playbackSource.useSource({
    videoId: id ?? "",
    queue: playlistVideos,
    index: playlistIndex,
    getPosition: () => playerRef.current?.currentTime ?? 0,
  });

  const source =
    playbackState.kind === "offline" || playbackState.kind === "stream"
      ? playbackState.uri
      : "";
  const resumeAt =
    playbackState.kind === "offline" ? playbackState.resumeAt : null;

  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 1;
    if (resumeAt !== null) instance.currentTime = resumeAt;
    instance.play();
  });
  playerRef.current = player;
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
  }, [playlistId, playlistIndex, playlistVideos, updateRecentPlaylistProgress]);

  const hasPlaylistContext = playlistIndex >= 0;
  const hasPrevious = hasPlaylistContext && playlistIndex > 0;
  const hasNext =
    hasPlaylistContext && playlistIndex < playlistVideos.length - 1;
  const nextVideo = hasNext ? playlistVideos[playlistIndex + 1] : null;
  const playbackModeLabel =
    playbackState.kind === "stream" ? "Streaming" : "Offline";
  const duration =
    playback.duration > 0 ? playback.duration : (video?.duration ?? 0);
  const position =
    duration > 0 ? Math.min(playback.position, duration) : playback.position;
  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;

  useEffect(() => {
    setNavNodeHandles({
      back: backNavRef.current
        ? (findNodeHandle(backNavRef.current) ?? undefined)
        : undefined,
      prev: prevNavRef.current
        ? (findNodeHandle(prevNavRef.current) ?? undefined)
        : undefined,
      playPause: playPauseNavRef.current
        ? (findNodeHandle(playPauseNavRef.current) ?? undefined)
        : undefined,
      next: nextNavRef.current
        ? (findNodeHandle(nextNavRef.current) ?? undefined)
        : undefined,
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
      (event: RemoteKeyEvent) => {
        const command = decideRemoteKey(event, {
          overlayVisible: isRemoteNavVisible,
          progressFocused: isProgressFocusedRef.current,
        });
        if (command.kind === "ignore") return;

        suppressNextPressRef.current =
          command.kind === "wake" && command.suppressPress;
        if (command.kind === "wake") {
          showRemoteNav(true);
        } else if (command.kind === "hide") {
          clearRemoteNavTimeout();
          setIsRemoteNavVisible(false);
        } else {
          if (command.kind === "seek") seek(command.direction);
          showRemoteNav(false);
        }
      },
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
    [id, playlistVideos, setCurrentIndex],
  );

  const lostNextIndex =
    playbackState.kind === "desktopLost" ? playbackState.nextIndex : undefined;

  // The desktop dropped out and the TV doesn't hold this Video: carry on from the TV.
  useEffect(() => {
    if (
      lostNextIndex === undefined ||
      !id ||
      navigationLockVideoIdRef.current === id
    ) {
      return;
    }
    if (lostNextIndex !== null) {
      showNotice(desktopGoneNextVideo);
      goToIndex(lostNextIndex);
      return;
    }
    navigationLockVideoIdRef.current = id;
    showNotice(desktopGoneNothingLeft);
    router.back();
  }, [goToIndex, id, lostNextIndex, showNotice]);

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

  if (!id || !source) {
    const failure =
      playbackState.kind === "failed"
        ? describeFailure(playbackState.failure)
        : null;
    const canRetry =
      !!failure?.canRetry &&
      playbackState.kind === "failed" &&
      playbackState.canRetry;
    const progress =
      playbackState.kind === "preparing" ? playbackState.progress : null;
    const message = failure ?? {
      title: desktopGettingVideoTitle,
      text:
        progress !== null
          ? `${Math.max(0, Math.round(progress))}% done`
          : "Please wait",
    };

    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.centered}>
          <TVMessageCard message={message}>
            {canRetry ? (
              <TVMessageButton
                label="Retry"
                onPress={retry}
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
              {nextVideo && upNext === "loading"
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
              nextFocusRight={
                hasPrevious ? navNodeHandles.prev : navNodeHandles.playPause
              }
            >
              <Text style={styles.navFabText}>Back</Text>
            </TVFocusPressable>

            <TVFocusPressable
              ref={prevNavRef}
              style={[
                styles.navFabButton,
                !hasPrevious && styles.navButtonDisabled,
              ]}
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
              nextFocusLeft={
                hasPrevious ? navNodeHandles.prev : navNodeHandles.back
              }
              nextFocusRight={hasNext ? navNodeHandles.next : undefined}
            >
              <Text style={styles.navFabText}>
                {isPlaying ? "Pause" : "Play"}
              </Text>
            </TVFocusPressable>

            <TVFocusPressable
              ref={nextNavRef}
              style={[
                styles.navFabButton,
                !hasNext && styles.navButtonDisabled,
              ]}
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
