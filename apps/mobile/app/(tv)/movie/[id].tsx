import { useEffect, useEffectEvent, useRef, useState } from "react";
import { DeviceEventEmitter, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEvent, useEventListener } from "expo";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import type { MovieKind } from "../../../../shared/mobile-sync-contract";
import { useMovieCatalogStore } from "../../../stores/movieCatalog";
import { useTVHistoryStore } from "../../../stores/tvHistory";
import { useTVNoticeStore } from "../../../stores/tvNotice";
import {
  tvEpisodePlaybackSource,
  tvMoviePlaybackSource,
} from "../../../services/playback-source";
import { findTitle } from "../../../services/movie-watch/seriesWatch";
import { useMovieProgressRecorder } from "../../../hooks/useMovieProgressRecorder";
import { useMovieCaptions } from "../../../hooks/useMovieCaptions";
import { useHeldTitles } from "../../../hooks/useHeldTitles";
import { movieStartPosition } from "../../../hooks/useMovieResume";
import { useEpisodeAutoplay } from "../../../hooks/useEpisodeAutoplay";
import { usePlayerOverlay } from "../../../hooks/usePlayerOverlay";
import { usePlayerTime } from "../../../hooks/usePlayerTime";
import { heldSeries } from "../../../components/tv/tvCatalog";
import { desktopConnection } from "../../../services/desktop-connection";
import { goBackOrTVHome } from "../../../components/tv/tvBack";
import { TVMovieMessage } from "../../../components/tv/TVMovieMessage";
import { TVMovieOverlay } from "../../../components/tv/TVMovieOverlay";
import {
  desktopGoneEpisode,
  desktopGoneMovie,
  describeMovieProblem,
  type MovieProblem,
} from "../../../components/tv/tvMessages";
import {
  decideRemoteKey,
  type RemoteKeyEvent,
} from "../../../components/tv/remoteKeys";
import {
  isSeekPending,
  planSeek,
  type PendingSeek,
} from "../../../components/playerSeek";

const OVERLAY_AUTO_HIDE_MS = 5000;

function openEpisode(episodeId: string) {
  router.replace({
    pathname: "/(tv)/movie/[id]",
    params: { id: episodeId, kind: "episode" },
  } as Href);
}

/**
 * Plays a Movie, or an Episode (`kind=episode`) and then the Episodes after it,
 * on the TV: from its Offline copy when the Mirror brought one, else Streamed
 * from the desktop, never Downloaded (ADR-0005), and put in History (an
 * Episode puts its Series there). In Offline mode the Episodes after it are
 * the ones the TV holds. A file the TV's player refuses says so.
 */
export default function TVMoviePlayerScreen() {
  const params = useLocalSearchParams<{ id: string; kind?: string }>();
  const id = params.id ?? "";
  const kind: MovieKind = params.kind === "episode" ? "episode" : "movie";
  const catalog = useMovieCatalogStore();
  const movie = findTitle(catalog, kind, id);
  const heldTitles = useHeldTitles();
  const hold = heldTitles.find((title) => title.id === id);
  const connected = desktopConnection.useConnection().status === "connected";
  const showNotice = useTVNoticeStore((state) => state.show);

  const playerRef = useRef<VideoPlayer | null>(null);
  // The kind never changes while the screen is up, so the hook order holds.
  const playbackSource =
    kind === "episode" ? tvEpisodePlaybackSource : tvMoviePlaybackSource;
  const { source, retry } = playbackSource.useSource({
    videoId: id,
    queue: [],
    index: -1,
    getPosition: () => playerRef.current?.currentTime ?? 0,
  });
  const uri =
    source.kind === "offline" || source.kind === "stream" ? source.uri : null;

  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    // Often enough for Captions to keep up with the picture.
    instance.timeUpdateEventInterval = 0.25;
    const start =
      source.kind === "offline" && source.resumeAt !== null
        ? source.resumeAt
        : movieStartPosition(kind, id);
    if (start > 0) instance.currentTime = start;
    instance.play();
  });
  playerRef.current = player;
  useMovieProgressRecorder(player, kind, id);
  const captions = useMovieCaptions(player, id, movie?.captions ?? []);

  const { status } = useEvent(player, "statusChange", {
    status: player.status,
    error: undefined,
  });
  useEventListener(player, "statusChange", ({ status: next, error }) => {
    if (next === "error") {
      console.warn("[TVMoviePlayer] The player refused the file:", error);
    }
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });

  // History keeps the Movie, or the Series an Episode belongs to.
  const series = movie?.series ?? null;
  const seriesId = series?.id;
  const historyTitle = series ? series.title : movie?.title;
  useEffect(() => {
    if (!historyTitle) return;
    useTVHistoryStore
      .getState()
      .recordTitle(
        seriesId
          ? { kind: "series", seriesId, title: historyTitle }
          : { kind: "movie", movieId: id, title: historyTitle },
      );
  }, [id, seriesId, historyTitle]);

  // In Offline mode, autoplay goes on only to the Episodes the TV holds.
  useEpisodeAutoplay(player, {
    series:
      series && !connected
        ? heldSeries(series, (episodeId) =>
            heldTitles.some((title) => title.id === episodeId),
          )
        : series,
    id,
    hasSource: !!uri,
    open: openEpisode,
  });

  // The desktop went away mid-Stream and the TV doesn't hold this title.
  const desktopLost = source.kind === "desktopLost";
  useEffect(() => {
    if (!desktopLost) return;
    showNotice(kind === "episode" ? desktopGoneEpisode : desktopGoneMovie);
    goBackOrTVHome();
  }, [desktopLost, kind, showNotice]);

  const overlay = usePlayerOverlay(isPlaying, OVERLAY_AUTO_HIDE_MS);
  const [preferPlayFocus, setPreferPlayFocus] = useState(true);
  const progressFocusedRef = useRef(false);
  const suppressNextPressRef = useRef(false);
  const pendingSeekRef = useRef<PendingSeek | null>(null);
  // Until the player catches up, keep showing where the seek is heading.
  const time = usePlayerTime(player, {
    knownDuration: movie?.durationSeconds ?? null,
    holdPosition: () => isSeekPending(pendingSeekRef.current, Date.now()),
  });

  const showOverlay = (preferFocus = false) => {
    overlay.show();
    if (preferFocus) setPreferPlayFocus(true);
  };

  const remoteKey = useEffectEvent((event: RemoteKeyEvent) => {
    const command = decideRemoteKey(event, {
      overlayVisible: overlay.visible,
      progressFocused: progressFocusedRef.current,
    });
    if (command.kind === "ignore") return;
    suppressNextPressRef.current =
      command.kind === "wake" && command.suppressPress;
    if (command.kind === "wake") return showOverlay(true);
    if (command.kind === "hide") return overlay.hide();
    if (command.kind === "seek") {
      const next = planSeek({
        currentTime: player.currentTime,
        duration: player.duration,
        pending: pendingSeekRef.current,
        now: Date.now(),
        direction: command.direction,
      });
      pendingSeekRef.current = next;
      player.currentTime = next.target;
      time.setPosition(next.target);
    }
    showOverlay();
  });
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "onHWKeyEvent",
      (event: RemoteKeyEvent) => remoteKey(event),
    );
    return () => subscription.remove();
  }, []);

  // A press that wakes the overlay only wakes it.
  const pressed = (action: () => void, focusPlayOnWake = true): void => {
    if (!overlay.visible || suppressNextPressRef.current) {
      suppressNextPressRef.current = false;
      showOverlay(focusPlayOnWake);
      return;
    }
    action();
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
      ? describeMovieProblem(problem, kind)
      : {
          title: movie?.title ?? hold?.title ?? "Starting",
          text: "Please wait",
        };
    const canRetry =
      !!problem &&
      source.kind === "failed" &&
      source.canRetry &&
      describeMovieProblem(problem, kind).canRetry;
    return <TVMovieMessage message={message} retry={canRetry ? retry : null} />;
  }

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

      <TVMovieOverlay
        visible={overlay.visible}
        title={movie?.title ?? hold?.title ?? "Now Playing"}
        streaming={source.kind === "stream"}
        position={time.position}
        duration={time.duration}
        isPlaying={isPlaying}
        preferPlayFocus={preferPlayFocus}
        captions={captions}
        captionText={captions.text}
        onPlayPause={() =>
          pressed(() => (player.playing ? player.pause() : player.play()))
        }
        onCaptions={() => pressed(captions.next, false)}
        onFocusInside={() => showOverlay()}
        onPlayFocus={() => setPreferPlayFocus(false)}
        onProgressFocus={(focused) => {
          progressFocusedRef.current = focused;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fullscreen: { flex: 1, backgroundColor: "#000" },
  video: { flex: 1, backgroundColor: "#000" },
});
