import { useCallback, useEffect, useRef, useState } from "react";
import { DeviceEventEmitter, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMovieCatalogStore } from "../../../stores/movieCatalog";
import { movieWatchKey, useMovieWatchStore } from "../../../stores/movieWatch";
import { useTVHistoryStore } from "../../../stores/tvHistory";
import { useTVNoticeStore } from "../../../stores/tvNotice";
import { tvMoviePlaybackSource } from "../../../services/playback-source";
import { resumeAt } from "../../../services/movie-watch/movieWatch";
import { useMovieProgressRecorder } from "../../../hooks/useMovieProgressRecorder";
import { goBackOrTVHome } from "../../../components/tv/tvBack";
import { TVFocusPressable } from "../../../components/tv/TVFocusPressable";
import {
  TVMessageButton,
  TVMessageCard,
} from "../../../components/tv/TVMessage";
import {
  desktopGoneMovie,
  describeMovieProblem,
  type MovieProblem,
} from "../../../components/tv/tvMessages";
import {
  decideRemoteKey,
  type RemoteKeyEvent,
} from "../../../components/tv/remoteKeys";
import {
  formatPlaybackTime,
  isSeekPending,
  planSeek,
  type PendingSeek,
} from "../../../components/playerSeek";
import {
  colors,
  fontWeight,
  Pause,
  Play,
  radius,
  spacing,
  tvFontSize,
  tvRestingBorder,
  tvScrim,
} from "../../../theme";

const OVERLAY_AUTO_HIDE_MS = 5000;

/** Where a press on the Movie starts: where any device left it, unless that was the end. */
function startPosition(movieId: string): number {
  const movie = useMovieCatalogStore
    .getState()
    .movies.find((item) => item.id === movieId);
  return resumeAt({
    watch: movie?.watch ?? null,
    kept: useMovieWatchStore.getState().progress[
      movieWatchKey("movie", movieId)
    ],
    durationSeconds: movie?.durationSeconds ?? null,
  });
}

/**
 * Plays a Movie on the TV: Streamed from the desktop, never Downloaded
 * (ADR-0005), and put in History. A file the TV's player refuses says so.
 */
export default function TVMoviePlayerScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const movie = useMovieCatalogStore((state) =>
    state.movies.find((item) => item.id === id),
  );
  const showNotice = useTVNoticeStore((state) => state.show);

  const playerRef = useRef<VideoPlayer | null>(null);
  const { source, retry } = tvMoviePlaybackSource.useSource({
    videoId: id,
    queue: [],
    index: -1,
    getPosition: () => playerRef.current?.currentTime ?? 0,
  });
  const uri =
    source.kind === "offline" || source.kind === "stream" ? source.uri : null;

  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 1;
    const start =
      source.kind === "offline" && source.resumeAt !== null
        ? source.resumeAt
        : startPosition(id);
    if (start > 0) instance.currentTime = start;
    instance.play();
  });
  playerRef.current = player;
  useMovieProgressRecorder(player, "movie", id);

  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
    error: undefined,
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });

  const movieTitle = movie?.title;
  useEffect(() => {
    if (!movieTitle) return;
    useTVHistoryStore
      .getState()
      .recordTitle({ kind: "movie", movieId: id, title: movieTitle });
  }, [id, movieTitle]);

  // The desktop went away mid-Stream and the TV doesn't hold this Movie.
  const desktopLost = source.kind === "desktopLost";
  useEffect(() => {
    if (!desktopLost) return;
    showNotice(desktopGoneMovie);
    goBackOrTVHome();
  }, [desktopLost, showNotice]);

  useEffect(() => {
    if (status === "error") {
      console.warn("[TVMoviePlayer] The player refused the file:", error);
    }
  }, [status, error]);

  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayShownAt, setOverlayShownAt] = useState(0);
  const [preferPlayFocus, setPreferPlayFocus] = useState(true);
  const progressFocusedRef = useRef(false);
  const suppressNextPressRef = useRef(false);
  const pendingSeekRef = useRef<PendingSeek | null>(null);
  const [playback, setPlayback] = useState({ position: 0, duration: 0 });

  const showOverlay = useCallback((preferFocus = false) => {
    setOverlayVisible(true);
    if (preferFocus) setPreferPlayFocus(true);
    setOverlayShownAt(Date.now());
  }, []);

  useEffect(() => {
    if (!overlayVisible || !isPlaying) return;
    const timeout = setTimeout(
      () => setOverlayVisible(false),
      OVERLAY_AUTO_HIDE_MS,
    );
    return () => clearTimeout(timeout);
  }, [overlayVisible, isPlaying, overlayShownAt]);

  useEffect(() => {
    pendingSeekRef.current = null;
    const timeSub = player.addListener("timeUpdate", (event) => {
      // Until the player catches up, keep showing where the seek is heading.
      if (isSeekPending(pendingSeekRef.current, Date.now())) return;
      setPlayback({ position: event.currentTime, duration: player.duration });
    });
    const loadSub = player.addListener("sourceLoad", (event) =>
      setPlayback((prev) => ({ ...prev, duration: event.duration })),
    );
    return () => {
      timeSub.remove();
      loadSub.remove();
    };
  }, [player]);

  useEffect(() => {
    const seek = (direction: 1 | -1): void => {
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
    const subscription = DeviceEventEmitter.addListener(
      "onHWKeyEvent",
      (event: RemoteKeyEvent) => {
        const command = decideRemoteKey(event, {
          overlayVisible,
          progressFocused: progressFocusedRef.current,
        });
        if (command.kind === "ignore") return;
        suppressNextPressRef.current =
          command.kind === "wake" && command.suppressPress;
        if (command.kind === "wake") showOverlay(true);
        else if (command.kind === "hide") setOverlayVisible(false);
        else {
          if (command.kind === "seek") seek(command.direction);
          showOverlay();
        }
      },
    );
    return () => subscription.remove();
  }, [overlayVisible, player, showOverlay]);

  const togglePlayPause = (): void => {
    if (!overlayVisible || suppressNextPressRef.current) {
      suppressNextPressRef.current = false;
      showOverlay(true);
      return;
    }
    if (player.playing) player.pause();
    else player.play();
    showOverlay();
  };

  const problem: MovieProblem | null =
    source.kind === "failed"
      ? source.failure
      : uri && status === "error"
        ? { kind: "playerRejected" }
        : null;

  if (!uri || problem) {
    const message = problem
      ? describeMovieProblem(problem)
      : { title: movie?.title ?? "Starting", text: "Please wait" };
    const canRetry =
      !!problem &&
      source.kind === "failed" &&
      source.canRetry &&
      describeMovieProblem(problem).canRetry;
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
              onPress={goBackOrTVHome}
              hasTVPreferredFocus={!canRetry}
            />
          </TVMessageCard>
        </View>
      </SafeAreaView>
    );
  }

  const duration =
    playback.duration > 0 ? playback.duration : (movie?.durationSeconds ?? 0);
  const position =
    duration > 0 ? Math.min(playback.position, duration) : playback.position;
  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <View style={styles.fullscreen}>
      <VideoView
        key={`${id}:${uri}`}
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        focusable={false}
        importantForAccessibility="no-hide-descendants"
        surfaceType="surfaceView"
      />

      <SafeAreaView
        style={[styles.overlay, !overlayVisible && styles.overlayHidden]}
        edges={["bottom", "left", "right"]}
        pointerEvents={overlayVisible ? "auto" : "none"}
      >
        <Text style={styles.title} numberOfLines={1}>
          {movie?.title ?? "Now Playing"}
        </Text>
        {source.kind === "stream" ? (
          <Text style={styles.meta}>Streaming</Text>
        ) : null}

        <TVFocusPressable
          style={styles.progressRow}
          focusedStyle={styles.progressRowFocused}
          accessibilityLabel={`${formatPlaybackTime(position)} of ${formatPlaybackTime(duration)}`}
          onPress={togglePlayPause}
          onFocus={() => {
            progressFocusedRef.current = true;
            showOverlay();
          }}
          onBlur={() => {
            progressFocusedRef.current = false;
          }}
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

        <View style={styles.controls}>
          <TVFocusPressable
            style={styles.playPause}
            accessibilityLabel={isPlaying ? "Pause" : "Play"}
            onPress={togglePlayPause}
            onFocus={() => {
              setPreferPlayFocus(false);
              showOverlay();
            }}
            hasTVPreferredFocus={preferPlayFocus}
          >
            {isPlaying ? (
              <Pause size={34} color={colors.primaryForeground} />
            ) : (
              <Play size={34} color={colors.primaryForeground} />
            )}
          </TVFocusPressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  fullscreen: { flex: 1, backgroundColor: "#000" },
  video: { flex: 1, backgroundColor: "#000" },
  // Anchored to the bottom so the picture stays clear above it.
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    backgroundColor: tvScrim,
    gap: spacing.xs,
  },
  overlayHidden: { opacity: 0 },
  title: {
    color: colors.foreground,
    fontSize: tvFontSize.title,
    fontWeight: fontWeight.bold,
  },
  meta: { color: colors.mutedForeground, fontSize: tvFontSize.body },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    ...tvRestingBorder,
  },
  progressRowFocused: {
    borderColor: colors.foreground,
    backgroundColor: colors.overlayLight,
  },
  progressTime: {
    color: colors.foreground,
    fontSize: tvFontSize.body,
    fontWeight: fontWeight.semibold,
    fontVariant: ["tabular-nums"],
    minWidth: 72,
    textAlign: "center",
  },
  progressTrack: {
    flex: 1,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.primary },
  controls: { flexDirection: "row", justifyContent: "center" },
  playPause: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    ...tvRestingBorder,
    alignItems: "center",
    justifyContent: "center",
  },
});
