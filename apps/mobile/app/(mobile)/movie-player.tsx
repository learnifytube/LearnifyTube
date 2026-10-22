import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConnectionStore } from "../../stores/connection";
import { useMovieCatalogStore } from "../../stores/movieCatalog";
import { heldMovies } from "../../services/held-movies";
import {
  phoneEpisodePlaybackSource,
  phoneMoviePlaybackSource,
} from "../../services/playback-source";
import { bookPlayer } from "../../services/book-player";
import { useMovieProgressRecorder } from "../../hooks/useMovieProgressRecorder";
import { useResumeWhenStarted } from "../../hooks/useMovieResume";
import { useEpisodeAutoplay } from "../../hooks/useEpisodeAutoplay";
import { usePlayerOverlay } from "../../hooks/usePlayerOverlay";
import { usePlayerTime } from "../../hooks/usePlayerTime";
import { useMovieCaptions } from "../../hooks/useMovieCaptions";
import { findTitle } from "../../services/movie-watch/seriesWatch";
import { resolveRemoteAssetUrl } from "../../services/remoteAssetUrl";
import { MoviePlayerChrome } from "../../components/phone/MoviePlayerChrome";
import { MovieCaptionLine } from "../../components/phone/MovieCaptionLine";
import { MoviePlayerStatus } from "../../components/phone/MoviePlayerStatus";
import {
  followFullScreenBars,
  holdPlayerOrientation,
} from "../../components/phone/playerOrientation";
import { colors, spacing } from "../../theme";
import { ArrowLeft } from "../../theme/icons";
import type { MovieKind } from "../../../shared/mobile-sync-contract";

const CONTROLS_HIDE_MS = 3000;

function openEpisode(episodeId: string) {
  router.replace({
    pathname: "/movie-player",
    params: { kind: "episode", id: episodeId },
  });
}

/**
 * Plays a Movie, or an Episode (`kind=episode`) and then the Episodes after it:
 * its Offline copy when this phone holds one, else Streamed from the desktop;
 * playing never Downloads (ADR-0005).
 */
export default function MoviePlayerScreen() {
  const params = useLocalSearchParams<{ id: string; kind?: string }>();
  const id = params.id ?? "";
  const kind: MovieKind = params.kind === "episode" ? "episode" : "movie";
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const catalog = useMovieCatalogStore();
  const movie = findTitle(catalog, kind, id);
  // A title held here that the desktop no longer lists still plays.
  const hold = heldMovies.useHolds().find((item) => item.id === id);
  const shownTitle = movie?.title ?? hold?.title;
  const [chromeHeight, setChromeHeight] = useState(0);
  const playerRef = useRef<VideoPlayer | null>(null);

  useEffect(() => {
    const release = holdPlayerOrientation();
    const stopBars = followFullScreenBars();
    return () => {
      stopBars();
      release();
    };
  }, []);
  // A Movie and a book never play at once.
  useEffect(() => bookPlayer.pause(), []);

  // The kind never changes while the screen is up, so the hook order holds.
  const source =
    kind === "episode" ? phoneEpisodePlaybackSource : phoneMoviePlaybackSource;
  const playback = source.useSource({
    videoId: id,
    queue: [],
    index: -1,
    getPosition: () => playerRef.current?.currentTime ?? 0,
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
  playerRef.current = player;
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });

  useResumeWhenStarted(player, sourceUri, kind, id);
  useMovieProgressRecorder(player, kind, id);
  useEpisodeAutoplay(player, {
    series: movie?.series ?? null,
    id,
    hasSource: !!sourceUri,
    open: openEpisode,
  });
  const time = usePlayerTime(player, {
    knownDuration: movie?.durationSeconds ?? null,
  });
  const controls = usePlayerOverlay(isPlaying, CONTROLS_HIDE_MS);
  // Two lines at most across the reading width, as for Videos.
  const captionFontSize = Math.round(Math.min(Math.max(width / 34, 16), 24));
  const captionWidth = width * (isLandscape ? 0.7 : 0.92);
  const captions = useMovieCaptions(
    player,
    id,
    movie?.captions ?? [],
    2 * Math.floor(captionWidth / (captionFontSize * 0.55)),
  );

  useEffect(() => {
    if (playback.source.kind === "desktopLost") router.back();
  }, [playback.source]);

  const seekTo = (seconds: number) => {
    controls.show();
    const target = Math.max(0, Math.min(seconds, time.duration || seconds));
    player.currentTime = target;
    time.setPosition(target);
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
        onPress={controls.toggle}
        accessibilityLabel={
          controls.visible ? "Hide controls" : "Show controls"
        }
      />

      <MoviePlayerStatus
        source={playback.source}
        kind={kind}
        retry={playback.retry}
      />

      {captions.text ? (
        <MovieCaptionLine
          text={captions.text}
          bottom={
            controls.visible
              ? chromeHeight + spacing.sm
              : bottomInset + spacing.md
          }
          maxWidth={captionWidth}
          fontSize={captionFontSize}
        />
      ) : null}

      {controls.visible ? (
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

          <MoviePlayerChrome
            title={shownTitle ?? ""}
            isLandscape={isLandscape}
            sideInset={sideInset}
            bottomInset={bottomInset}
            position={time.position}
            duration={time.duration}
            canPlay={!!sourceUri}
            isPlaying={isPlaying}
            captions={{ ...captions, count: movie?.captions.length ?? 0 }}
            onSeek={seekTo}
            onSkip={(seconds) => seekTo(player.currentTime + seconds)}
            onPlayPause={() => {
              controls.show();
              if (isPlaying) player.pause();
              else player.play();
            }}
            onTouch={controls.show}
            onHeight={setChromeHeight}
          />
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
});
