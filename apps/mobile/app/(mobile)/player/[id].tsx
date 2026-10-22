import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView, type VideoMetadata } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibraryStore } from "../../../stores/library";
import { usePlaybackStore } from "../../../stores/playback";
import { useConnectionStore } from "../../../stores/connection";
import { useSettingsStore } from "../../../stores/settings";
import { downloadQueue } from "../../../services/download-queue";
import {
  phonePlaybackSource,
  type PlaybackFailure,
} from "../../../services/playback-source";
import { api } from "../../../services/api";
import { bookPlayer } from "../../../services/book-player";
import { playQueue } from "../../../services/play-queue";
import { videoThumbnails } from "../../../services/video-thumbnails";
import { useWatchProgressRecorder } from "../../../hooks/useWatchProgressRecorder";
import { videoStartPosition } from "../../../db/repositories/watchHistory";
import * as videoRepo from "../../../db/repositories/videos";
import { colors, fontSize, fontWeight, spacing } from "../../../theme";
import { currentCaption } from "../../../components/captions";
import {
  holdPlayerOrientation,
  setFullScreenBars,
  toggleFullScreen,
} from "../../../components/phone/playerOrientation";
import {
  ArrowLeft,
  Captions,
  Headphones,
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "../../../theme/icons";
import { PlayerProgressBar } from "../../../components/phone/PlayerProgressBar";
import { ListeningModeView } from "../../../components/phone/ListeningModeView";
import {
  SeekButton,
  SEEK_BUTTON_SIZE,
} from "../../../components/phone/SeekButton";
import {
  addSeekNudge,
  isSeekPending,
  planSeek,
  type PendingSeek,
  type SeekNudge,
} from "../../../components/playerSeek";
import { resolveListeningDisplay } from "../../../components/phone/listeningMode";
import type { Transcript } from "../../../types";

const CONTROLS_HIDE_MS = 3000;

function failureText(failure: PlaybackFailure): string {
  if (failure.kind === "videoNotFound")
    return "This video isn't in the library.";
  if (failure.kind === "notOnThisTV") {
    return "This video isn't on this phone.";
  }
  return "Couldn't play this video. Try again when the desktop is around.";
}

export default function PlayerScreen() {
  const { id, start } = useLocalSearchParams<{ id: string; start?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const libraryVideo = useLibraryStore((state) =>
    state.videos.find((item) => item.id === id),
  );
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const captionLang = useSettingsStore((state) => state.translationTargetLang);
  const playlistVideos = usePlaybackStore((state) => state.playlistVideos);
  const currentIndex = usePlaybackStore((state) => state.currentIndex);
  const playNext = usePlaybackStore((state) => state.playNext);
  const playPrevious = usePlaybackStore((state) => state.playPrevious);
  const hasNextVideo = usePlaybackStore((state) => state.hasNext());
  const hasPreviousVideo = usePlaybackStore((state) => state.hasPrevious());
  const setCurrentIndex = usePlaybackStore((state) => state.setCurrentIndex);

  const playlistVideo = playlistVideos.find((item) => item.id === id);
  const video = libraryVideo ?? playlistVideo;
  const positionRef = useRef(0);
  const pendingSeekRef = useRef<PendingSeek | null>(null);
  const [seekNudge, setSeekNudge] = useState<SeekNudge | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video?.duration ?? 0);
  const [listeningMode, setListeningMode] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionText, setCaptionText] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [isVideoViewReady, setIsVideoViewReady] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [interactions, setInteractions] = useState(0);
  const [chromeHeight, setChromeHeight] = useState(0);

  // Captions: bigger in landscape, at most two lines across the reading width.
  const captionFontSize = Math.round(Math.min(Math.max(width / 34, 16), 24));
  const captionWidth = width * (isLandscape ? 0.7 : 0.92);
  const captionMaxChars =
    2 * Math.floor(captionWidth / (captionFontSize * 0.55));

  useEffect(() => holdPlayerOrientation(), []);

  // A Video and a book never play at once.
  useEffect(() => bookPlayer.pause(), []);

  // Started from a List, the Video becomes the List's Current Video.
  useEffect(() => {
    if (id) playQueue.videoStarted(id);
  }, [id]);

  useEffect(() => {
    setFullScreenBars(isLandscape);
  }, [isLandscape]);

  useEffect(() => {
    if (!id) return;
    const index = playlistVideos.findIndex((item) => item.id === id);
    if (index >= 0 && index !== currentIndex) setCurrentIndex(index);
  }, [id, playlistVideos, currentIndex, setCurrentIndex]);

  useEffect(() => {
    if (!video) return;
    downloadQueue.request({
      id: video.id,
      title: video.title,
      channelTitle: video.channelTitle,
      duration: video.duration,
      thumbnailUrl: video.thumbnailUrl,
    });
  }, [video]);

  const playback = phonePlaybackSource.useSource({
    videoId: id ?? "",
    queue: playlistVideos,
    index: currentIndex,
    getPosition: () => positionRef.current,
  });

  const sourceUri =
    playback.source.kind === "offline" || playback.source.kind === "stream"
      ? playback.source.uri
      : null;

  // A new source object restarts the player, so the Android media notification's
  // title, channel and artwork are fixed when each source starts.
  const [playerSource, setPlayerSource] = useState<{
    uri: string;
    metadata: VideoMetadata;
  } | null>(null);
  if ((playerSource?.uri ?? null) !== sourceUri) {
    setPlayerSource(
      sourceUri
        ? {
            uri: sourceUri,
            metadata: {
              title: video?.title,
              artist: video?.channelTitle,
              artwork:
                (id ? videoThumbnails.getUri(id) : null) ??
                (serverUrl && id
                  ? api.getThumbnailUrl(serverUrl, id)
                  : video?.thumbnailUrl),
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
    // Where this phone left the Video (from the beginning once watched),
    // unless the link names its own start.
    if (playerSource && id && !start) {
      const at = videoStartPosition(id, video?.duration);
      if (at > 0) instance.currentTime = at;
    }
    instance.play();
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });

  useEffect(() => {
    setIsVideoViewReady(false);
    if (!sourceUri) return;
    const timeout = setTimeout(() => setIsVideoViewReady(true), 0);
    return () => clearTimeout(timeout);
  }, [sourceUri, id]);

  useWatchProgressRecorder(player, video);

  useEffect(() => {
    if (!player || !start) return;
    const seconds = Number(start);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const timeout = setTimeout(() => {
      player.currentTime = seconds;
    }, 250);
    return () => clearTimeout(timeout);
  }, [player, start, id]);

  useEffect(() => {
    if (video?.duration) {
      setDuration(video.duration);
    }
  }, [video?.duration]);

  useEffect(() => {
    if (!player) return;
    const timeSub = player.addListener("timeUpdate", (event) => {
      positionRef.current = event.currentTime;
      // Until the player catches up, keep showing where the seek is heading.
      if (!isSeekPending(pendingSeekRef.current, Date.now())) {
        setCurrentTime(event.currentTime);
      }
      if (player.duration > 0) {
        setDuration(player.duration);
      }
      setCaptionText(
        currentCaption(
          transcript?.segments,
          event.currentTime,
          captionMaxChars,
        ),
      );
    });
    // While a Video prepares the player has no source, and Android reports that
    // empty player as played to its end; only a Video that played can end.
    const endSub = player.addListener("playToEnd", () => {
      if (!playerSource || !hasNextVideo) return;
      const next = playNext();
      if (next) router.replace(`/player/${next.id}`);
    });
    return () => {
      timeSub.remove();
      endSub.remove();
    };
  }, [
    player,
    playerSource,
    transcript,
    captionMaxChars,
    hasNextVideo,
    playNext,
  ]);

  useEffect(() => {
    setTranscript(null);
    setCaptionText(null);
    if (!id) return;
    const stored = videoRepo.getVideoWithTranscripts(id);
    const local =
      stored?.transcripts.find((item) => item.language === captionLang) ??
      stored?.transcripts.find((item) => !item.isAutoGenerated) ??
      stored?.transcripts[0] ??
      null;
    if (local) {
      setTranscript(local);
      return;
    }
    if (!serverUrl) return;
    let cancelled = false;
    api
      .getVideoTranscripts(serverUrl, id)
      .then((transcripts) => {
        if (cancelled || transcripts.length === 0) return;
        for (const item of transcripts) {
          videoRepo.upsertTranscript(
            id,
            item.language,
            item.segments,
            item.isAutoGenerated ?? false,
          );
        }
        setTranscript(
          transcripts.find((item) => item.language === captionLang) ??
            transcripts.find((item) => !item.isAutoGenerated) ??
            transcripts[0],
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, serverUrl, captionLang]);

  useEffect(() => {
    if (playback.source.kind !== "desktopLost") return;
    if (playback.source.nextIndex === null) {
      router.back();
      return;
    }
    const next = playlistVideos[playback.source.nextIndex];
    if (next) router.replace(`/player/${next.id}`);
  }, [playback.source, playlistVideos]);

  // While playing, the controls hide a few seconds after the last touch (kept visible in listening mode).
  useEffect(() => {
    if (!controlsVisible || !isPlaying || listeningMode) return;
    const timeout = setTimeout(
      () => setControlsVisible(false),
      CONTROLS_HIDE_MS,
    );
    return () => clearTimeout(timeout);
  }, [controlsVisible, isPlaying, interactions, listeningMode]);

  const touched = () => {
    setControlsVisible(true);
    setInteractions((count) => count + 1);
  };

  const toggleControls = () => {
    setControlsVisible((visible) => !visible);
    setInteractions((count) => count + 1);
  };

  const toggleListeningMode = () => {
    touched();
    setListeningMode((value) => {
      const next = !value;
      if (next) setControlsVisible(true);
      return next;
    });
  };

  const handleSeek = (seconds: number) => {
    touched();
    if (!player) return;
    player.currentTime = seconds;
    setCurrentTime(seconds);
    positionRef.current = seconds;
  };

  const seekBy = (direction: 1 | -1) => {
    touched();
    if (!player) return;
    const now = Date.now();
    // A Video that played to its end still wants to play; a seek mustn't resume it.
    if (!isPlaying) player.pause();
    const next = planSeek({
      currentTime: player.currentTime,
      duration: player.duration,
      pending: pendingSeekRef.current,
      now,
      direction,
    });
    pendingSeekRef.current = next;
    player.currentTime = next.target;
    setCurrentTime(next.target);
    positionRef.current = next.target;
    setSeekNudge((previous) => addSeekNudge(previous, direction, now));
  };

  const handleReplaySentence = (sentenceStart: number) => {
    touched();
    if (!player) return;
    player.currentTime = sentenceStart;
    setCurrentTime(sentenceStart);
    positionRef.current = sentenceStart;
  };

  const goBack = useCallback(() => {
    router.back();
  }, []);

  const preparing = playback.source.kind === "preparing";
  const sideInset = isLandscape ? Math.max(insets.left, insets.right) : 0;
  const bottomInset = isLandscape ? spacing.sm : insets.bottom + spacing.sm;
  const captionBottom = controlsVisible
    ? chromeHeight + spacing.sm
    : bottomInset + spacing.md;

  // Over the picture: mid-height above the controls, a quarter in from each side.
  // In Listening mode: just above the controls, leaving the caption its width.
  const seekSideOffset = listeningMode
    ? sideInset + spacing.lg
    : sideInset + (width - 2 * sideInset) / 4 - SEEK_BUTTON_SIZE / 2;
  const seekPosition = listeningMode
    ? { bottom: chromeHeight + spacing.md }
    : { top: (height - chromeHeight - SEEK_BUTTON_SIZE) / 2 };

  const listeningDisplay = resolveListeningDisplay(
    transcript?.segments,
    currentTime,
    captionMaxChars,
  );

  return (
    <View style={styles.container}>
      {sourceUri && isVideoViewReady ? (
        <VideoView
          key={`${id}:${sourceUri}`}
          player={player}
          style={[styles.video, !isLandscape && { marginTop: insets.top }]}
          nativeControls={false}
          contentFit="contain"
        />
      ) : null}

      <Pressable
        testID="player-surface"
        style={StyleSheet.absoluteFill}
        onPress={toggleControls}
        accessibilityLabel={controlsVisible ? "Hide controls" : "Show controls"}
      />

      {preparing ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.foreground} />
          <Text style={styles.status}>Getting this video ready…</Text>
        </View>
      ) : null}

      {playback.source.kind === "failed" ? (
        <View style={styles.center} pointerEvents="box-none">
          <Text style={styles.status}>
            {failureText(playback.source.failure)}
          </Text>
          {playback.source.canRetry ? (
            <Pressable style={styles.retry} onPress={playback.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.retry} onPress={goBack}>
              <Text style={styles.retryText}>Back</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {listeningMode ? (
        <ListeningModeView
          isLandscape={isLandscape}
          videoTitle={video?.title ?? ""}
          displayState={listeningDisplay}
          onReplaySentence={handleReplaySentence}
          onTouched={touched}
        />
      ) : null}

      {!listeningMode && captionsOn && captionText ? (
        <View
          style={[styles.caption, { bottom: captionBottom }]}
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
            <Text style={styles.captionText}>{` ${captionText} `}</Text>
          </Text>
        </View>
      ) : null}

      {controlsVisible ? (
        <>
          <Pressable
            testID="player-back"
            style={[
              styles.back,
              {
                top: (isLandscape ? 0 : insets.top) + spacing.md,
                left: sideInset + spacing.sm,
              },
            ]}
            onPress={goBack}
            accessibilityLabel="Back"
          >
            <ArrowLeft size={22} color={colors.foreground} />
          </Pressable>

          {sourceUri ? (
            <>
              <SeekButton
                direction={-1}
                nudge={seekNudge}
                onPress={() => seekBy(-1)}
                style={[seekPosition, { left: seekSideOffset }]}
              />
              <SeekButton
                direction={1}
                nudge={seekNudge}
                onPress={() => seekBy(1)}
                style={[seekPosition, { right: seekSideOffset }]}
              />
            </>
          ) : null}

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
              {video?.title ?? ""}
            </Text>

            <PlayerProgressBar
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
              onScrubStart={touched}
              onScrubEnd={touched}
            />

            <View style={styles.actions}>
              <Pressable
                testID="captions-toggle"
                onPress={() => {
                  touched();
                  setCaptionsOn((value) => !value);
                }}
                accessibilityLabel="Captions"
                hitSlop={8}
              >
                <Captions
                  size={26}
                  color={captionsOn ? colors.primary : colors.foreground}
                />
              </Pressable>
              <Pressable
                testID="listening-mode-toggle"
                onPress={toggleListeningMode}
                accessibilityLabel={
                  listeningMode ? "Exit listening mode" : "Listening mode"
                }
                hitSlop={8}
              >
                <Headphones
                  size={26}
                  color={listeningMode ? colors.primary : colors.foreground}
                />
              </Pressable>
              <Pressable
                testID="previous-video"
                onPress={() => {
                  touched();
                  const prev = playPrevious();
                  if (prev) router.replace(`/player/${prev.id}`);
                }}
                disabled={!hasPreviousVideo}
                accessibilityLabel="Previous"
                hitSlop={8}
              >
                <SkipBack
                  size={26}
                  color={
                    hasPreviousVideo ? colors.foreground : colors.textTertiary
                  }
                />
              </Pressable>
              <Pressable
                testID="play-pause"
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
                testID="next-video"
                onPress={() => {
                  touched();
                  const next = playNext();
                  if (next) router.replace(`/player/${next.id}`);
                }}
                disabled={!hasNextVideo}
                accessibilityLabel="Next"
                hitSlop={8}
              >
                <SkipForward
                  size={26}
                  color={hasNextVideo ? colors.foreground : colors.textTertiary}
                />
              </Pressable>
              <Pressable
                testID="full-screen-toggle"
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
  retry: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 10,
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: fontWeight.semibold,
  },
  caption: {
    position: "absolute",
    left: 0,
    right: 0,
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
