import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConnectionStore } from "../../stores/connection";
import { useMovieCatalogStore } from "../../stores/movieCatalog";
import { movieWatchKey, useMovieWatchStore } from "../../stores/movieWatch";
import {
  phoneMoviePlaybackSource,
  type PlaybackFailure,
} from "../../services/playback-source";
import { bookPlayer } from "../../services/book-player";
import { useMovieProgressRecorder } from "../../hooks/useMovieProgressRecorder";
import { resumeAt } from "../../services/movie-watch/movieWatch";
import { resolveRemoteAssetUrl } from "../../services/remoteAssetUrl";
import { PlayerProgressBar } from "../../components/phone/PlayerProgressBar";
import {
  holdPlayerOrientation,
  setFullScreenBars,
  toggleFullScreen,
} from "../../components/phone/playerOrientation";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "../../theme/icons";

const CONTROLS_HIDE_MS = 3000;
const SEEK_SECONDS = 10;

function failureText(failure: PlaybackFailure) {
  if (failure.kind === "notOnThisTV") {
    return "This movie needs the desktop.";
  }
  return "Couldn't play this movie. Try again when the desktop is around.";
}

/** Plays a Movie: Streamed from the desktop, never Downloaded (ADR-0005). */
export default function MoviePlayerScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const movie = useMovieCatalogStore((state) =>
    state.movies.find((item) => item.id === id),
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(movie?.durationSeconds ?? 0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [interactions, setInteractions] = useState(0);
  const positionRef = useRef(0);

  useEffect(() => holdPlayerOrientation(), []);
  // A Movie and a book never play at once.
  useEffect(() => bookPlayer.pause(), []);
  useEffect(() => {
    setFullScreenBars(isLandscape);
  }, [isLandscape]);

  const playback = phoneMoviePlaybackSource.useSource({
    videoId: id,
    queue: [],
    index: -1,
    getPosition: () => positionRef.current,
  });
  const sourceUri =
    playback.source.kind === "offline" || playback.source.kind === "stream"
      ? playback.source.uri
      : null;

  // Fixed when the source starts, like the Video player: a new object restarts it.
  const [playerSource, setPlayerSource] = useState<{
    uri: string;
    metadata: { title?: string; artwork?: string };
  } | null>(null);
  if ((playerSource?.uri ?? null) !== sourceUri) {
    setPlayerSource(
      sourceUri
        ? {
            uri: sourceUri,
            metadata: {
              title: movie?.title,
              artwork:
                resolveRemoteAssetUrl(serverUrl, movie?.posterUrl) ?? undefined,
            },
          }
        : null,
    );
  }

  const player = useVideoPlayer(playerSource, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.25;
    instance.staysActiveInBackground = true;
    instance.showNowPlayingNotification = true;
    instance.play();
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });

  // Where any device left off, read as each source starts.
  const watch = movie?.watch ?? null;
  const knownDuration = movie?.durationSeconds ?? null;
  useEffect(() => {
    if (!sourceUri) return;
    const start = resumeAt({
      watch,
      kept: useMovieWatchStore.getState().progress[movieWatchKey("movie", id)],
      durationSeconds: knownDuration,
    });
    if (start <= 0) return;
    const timeout = setTimeout(() => {
      player.currentTime = start;
    }, 250);
    return () => clearTimeout(timeout);
    // Only when a source starts: a later catalog refresh mustn't seek.
  }, [player, sourceUri, id]);

  useMovieProgressRecorder(player, "movie", id);

  useEffect(() => {
    const timeSubscription = player.addListener("timeUpdate", (event) => {
      positionRef.current = event.currentTime;
      setCurrentTime(event.currentTime);
      if (player.duration > 0) setDuration(player.duration);
    });
    return () => timeSubscription.remove();
  }, [player]);

  useEffect(() => {
    if (playback.source.kind === "desktopLost") router.back();
  }, [playback.source]);

  useEffect(() => {
    if (!controlsVisible || !isPlaying) return;
    const timeout = setTimeout(
      () => setControlsVisible(false),
      CONTROLS_HIDE_MS,
    );
    return () => clearTimeout(timeout);
  }, [controlsVisible, isPlaying, interactions]);

  const touched = () => {
    setControlsVisible(true);
    setInteractions((count) => count + 1);
  };

  const seekTo = (seconds: number) => {
    touched();
    const target = Math.max(0, Math.min(seconds, duration || seconds));
    player.currentTime = target;
    setCurrentTime(target);
    positionRef.current = target;
  };

  const sideInset = isLandscape ? Math.max(insets.left, insets.right) : 0;
  const bottomInset = isLandscape ? spacing.sm : insets.bottom + spacing.sm;

  return (
    <View style={styles.container}>
      {sourceUri ? (
        <VideoView
          key={`${id}:${sourceUri}`}
          player={player}
          style={[styles.video, !isLandscape && { marginTop: insets.top }]}
          nativeControls={false}
          contentFit="contain"
        />
      ) : null}

      <Pressable
        testID="movie-player-surface"
        style={StyleSheet.absoluteFill}
        onPress={() => {
          setControlsVisible((visible) => !visible);
          setInteractions((count) => count + 1);
        }}
        accessibilityLabel={controlsVisible ? "Hide controls" : "Show controls"}
      />

      {playback.source.kind === "preparing" ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.foreground} />
        </View>
      ) : null}

      {playback.source.kind === "failed" ? (
        <View style={styles.center} pointerEvents="box-none">
          <Text style={styles.status}>
            {failureText(playback.source.failure)}
          </Text>
          <Pressable
            style={styles.button}
            onPress={playback.source.canRetry ? playback.retry : router.back}
          >
            <Text style={styles.buttonText}>
              {playback.source.canRetry ? "Try again" : "Back"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {controlsVisible ? (
        <>
          <Pressable
            testID="movie-player-back"
            style={[
              styles.back,
              {
                top: (isLandscape ? 0 : insets.top) + spacing.md,
                left: sideInset + spacing.sm,
              },
            ]}
            onPress={router.back}
            accessibilityLabel="Back"
          >
            <ArrowLeft size={22} color={colors.foreground} />
          </Pressable>

          <View
            style={[
              styles.chrome,
              {
                paddingBottom: bottomInset,
                paddingHorizontal: sideInset + spacing.md,
              },
            ]}
          >
            <Text style={styles.title} numberOfLines={isLandscape ? 1 : 2}>
              {movie?.title ?? ""}
            </Text>
            <PlayerProgressBar
              currentTime={currentTime}
              duration={duration}
              onSeek={seekTo}
              onScrubStart={touched}
              onScrubEnd={touched}
            />
            <View style={styles.actions}>
              <Pressable
                testID="movie-seek-back"
                onPress={() => seekTo(player.currentTime - SEEK_SECONDS)}
                disabled={!sourceUri}
                accessibilityLabel={`Back ${SEEK_SECONDS} seconds`}
                hitSlop={8}
              >
                <RotateCcw size={26} color={colors.foreground} />
              </Pressable>
              <Pressable
                testID="movie-play-pause"
                onPress={() => {
                  touched();
                  if (isPlaying) player.pause();
                  else player.play();
                }}
                disabled={!sourceUri}
                accessibilityLabel={isPlaying ? "Pause" : "Play"}
                hitSlop={8}
              >
                {isPlaying ? (
                  <Pause size={34} color={colors.foreground} />
                ) : (
                  <Play size={34} color={colors.foreground} />
                )}
              </Pressable>
              <Pressable
                testID="movie-seek-forward"
                onPress={() => seekTo(player.currentTime + SEEK_SECONDS)}
                disabled={!sourceUri}
                accessibilityLabel={`Forward ${SEEK_SECONDS} seconds`}
                hitSlop={8}
              >
                <RotateCw size={26} color={colors.foreground} />
              </Pressable>
              <Pressable
                testID="movie-full-screen-toggle"
                onPress={() => {
                  touched();
                  toggleFullScreen(isLandscape);
                }}
                accessibilityLabel={
                  isLandscape ? "Exit full screen" : "Full screen"
                }
                hitSlop={8}
              >
                {isLandscape ? (
                  <Minimize size={24} color={colors.foreground} />
                ) : (
                  <Maximize size={24} color={colors.foreground} />
                )}
              </Pressable>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  video: { flex: 1, backgroundColor: "#000" },
  back: {
    position: "absolute",
    zIndex: 2,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  status: {
    color: colors.foreground,
    fontSize: fontSize.md,
    textAlign: "center",
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 10,
  },
  buttonText: {
    color: colors.primaryForeground,
    fontWeight: fontWeight.semibold,
  },
  chrome: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    paddingTop: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.55)",
    gap: spacing.sm,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
});
