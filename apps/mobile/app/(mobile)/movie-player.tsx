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
import { heldMovies } from "../../services/held-movies";
import { movieWatchKey, useMovieWatchStore } from "../../stores/movieWatch";
import {
  phoneEpisodePlaybackSource,
  phoneMoviePlaybackSource,
  type PlaybackFailure,
} from "../../services/playback-source";
import { bookPlayer } from "../../services/book-player";
import { useMovieProgressRecorder } from "../../hooks/useMovieProgressRecorder";
import { resumeAt } from "../../services/movie-watch/movieWatch";
import {
  findTitle,
  seriesEpisodeAfter,
} from "../../services/movie-watch/seriesWatch";
import { resolveRemoteAssetUrl } from "../../services/remoteAssetUrl";
import { PlayerProgressBar } from "../../components/phone/PlayerProgressBar";
import {
  holdPlayerOrientation,
  setFullScreenBars,
  toggleFullScreen,
} from "../../components/phone/playerOrientation";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import type { MovieWatch } from "../../../shared/mobile-sync-contract";
import { useMovieCaptions } from "../../hooks/useMovieCaptions";
import {
  ArrowLeft,
  Captions,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "../../theme/icons";

const CONTROLS_HIDE_MS = 3000;
const SEEK_SECONDS = 10;

type TitleKind = MovieWatch["kind"];

function failureText(failure: PlaybackFailure, kind: TitleKind) {
  const what = kind === "episode" ? "episode" : "movie";
  if (failure.kind === "notOnThisTV") {
    return `This ${what} needs the desktop.`;
  }
  return `Couldn't play this ${what}. Try again when the desktop is around.`;
}

/**
 * Plays a Movie, or an Episode (`kind=episode`) and then the Episodes after it:
 * its Offline copy when this phone holds one, else Streamed from the desktop;
 * playing never Downloads (ADR-0005).
 */
export default function MoviePlayerScreen() {
  const params = useLocalSearchParams<{ id: string; kind?: string }>();
  const id = params.id ?? "";
  const kind: TitleKind = params.kind === "episode" ? "episode" : "movie";
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const catalog = useMovieCatalogStore();
  const movie = findTitle(catalog, kind, id);
  // A title held here that the desktop no longer lists still plays.
  const hold = heldMovies.useHolds().find((item) => item.id === id);
  const shownTitle = movie?.title ?? hold?.title;
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(movie?.durationSeconds ?? 0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [interactions, setInteractions] = useState(0);
  const [chromeHeight, setChromeHeight] = useState(0);
  const positionRef = useRef(0);

  useEffect(() => holdPlayerOrientation(), []);
  // A Movie and a book never play at once.
  useEffect(() => bookPlayer.pause(), []);
  useEffect(() => {
    setFullScreenBars(isLandscape);
  }, [isLandscape]);

  // The kind never changes while the screen is up, so the hook order holds.
  const source =
    kind === "episode" ? phoneEpisodePlaybackSource : phoneMoviePlaybackSource;
  const playback = source.useSource({
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
              title: shownTitle,
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
      kept: useMovieWatchStore.getState().progress[movieWatchKey(kind, id)],
      durationSeconds: knownDuration,
    });
    if (start <= 0) return;
    const timeout = setTimeout(() => {
      player.currentTime = start;
    }, 250);
    return () => clearTimeout(timeout);
    // Only when a source starts: a later catalog refresh mustn't seek.
  }, [player, sourceUri, kind, id]);

  useMovieProgressRecorder(player, kind, id);
  // Two lines at most across the reading width, as for Videos.
  const captionFontSize = Math.round(Math.min(Math.max(width / 34, 16), 24));
  const captionWidth = width * (isLandscape ? 0.7 : 0.92);
  const captions = useMovieCaptions(
    player,
    id,
    movie?.captions ?? [],
    2 * Math.floor(captionWidth / (captionFontSize * 0.55)),
  );

  // Episodes autoplay: the next one in Series order that can play.
  const series = movie?.series ?? null;
  useEffect(() => {
    if (!series) return;
    const subscription = player.addListener("playToEnd", () => {
      const next = seriesEpisodeAfter(series, id);
      if (!next) return;
      router.replace({
        pathname: "/movie-player",
        params: { kind: "episode", id: next.id },
      });
    });
    return () => subscription.remove();
  }, [player, series, id]);

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
            {failureText(playback.source.failure, kind)}
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

      {captions.text ? (
        <View
          style={[
            styles.caption,
            {
              bottom: controlsVisible
                ? chromeHeight + spacing.sm
                : bottomInset + spacing.md,
            },
          ]}
          pointerEvents="none"
        >
          <Text
            style={[
              styles.captionLine,
              {
                maxWidth: captionWidth,
                fontSize: captionFontSize,
                lineHeight: Math.round(captionFontSize * 1.45),
              },
            ]}
            textBreakStrategy="balanced"
          >
            <Text style={styles.captionText}>{` ${captions.text} `}</Text>
          </Text>
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
            onLayout={(event) =>
              setChromeHeight(event.nativeEvent.layout.height)
            }
          >
            <Text style={styles.title} numberOfLines={isLandscape ? 1 : 2}>
              {shownTitle ?? ""}
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
              {captions.available ? (
                <Pressable
                  testID="captions-toggle"
                  style={styles.captionsButton}
                  onPress={() => {
                    touched();
                    captions.next();
                  }}
                  accessibilityLabel={
                    captions.selected
                      ? `Captions: ${captions.selected.label}`
                      : "Captions off"
                  }
                  hitSlop={8}
                >
                  <Captions
                    size={26}
                    color={
                      captions.selected ? colors.primary : colors.foreground
                    }
                  />
                  {captions.selected && (movie?.captions.length ?? 0) > 1 ? (
                    <Text style={styles.captionsLabel} numberOfLines={1}>
                      {captions.selected.label}
                    </Text>
                  ) : null}
                </Pressable>
              ) : null}
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
  captionsButton: { alignItems: "center", maxWidth: 96 },
  captionsLabel: { color: colors.primary, fontSize: fontSize.xs },
  caption: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1,
    alignItems: "center",
  },
  captionLine: {
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  captionText: {
    color: "#fff",
    fontWeight: fontWeight.semibold,
    backgroundColor: "rgba(8,8,8,0.72)",
  },
});
