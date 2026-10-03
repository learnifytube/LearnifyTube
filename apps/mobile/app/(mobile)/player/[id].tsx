import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
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
import { useWatchProgressRecorder } from "../../../hooks/useWatchProgressRecorder";
import * as videoRepo from "../../../db/repositories/videos";
import { colors, fontSize, fontWeight, spacing } from "../../../theme";
import { currentCaption } from "../../../components/phone/captions";
import { ArrowLeft, Captions, SkipBack, SkipForward } from "../../../theme/icons";
import type { Transcript } from "../../../types";

function failureText(failure: PlaybackFailure): string {
  if (failure.kind === "videoNotFound") return "This video isn't in the library.";
  if (failure.kind === "notOnThisTV") {
    return "This video isn't on this phone.";
  }
  return "Couldn't play this video. Try again when the desktop is around.";
}

export default function PlayerScreen() {
  const { id, start } = useLocalSearchParams<{ id: string; start?: string }>();
  const insets = useSafeAreaInsets();
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
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionText, setCaptionText] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);

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

  const player = useVideoPlayer(sourceUri ?? "", (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.4;
    instance.staysActiveInBackground = true;
    instance.showNowPlayingNotification = true;
    instance.play();
  });

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
    if (!player) return;
    const timeSub = player.addListener("timeUpdate", (event) => {
      positionRef.current = event.currentTime;
      setCaptionText(currentCaption(transcript?.segments, event.currentTime));
    });
    const endSub = player.addListener("playToEnd", () => {
      if (!hasNextVideo) return;
      const next = playNext();
      if (next) router.replace(`/player/${next.id}`);
    });
    return () => {
      timeSub.remove();
      endSub.remove();
    };
  }, [player, transcript, hasNextVideo, playNext]);

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
    api.getVideoTranscripts(serverUrl, id).then((transcripts) => {
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
    }).catch(() => {});
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

  const goBack = useCallback(() => {
    router.back();
  }, []);

  const preparing = playback.source.kind === "preparing";

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Pressable style={styles.back} onPress={goBack} accessibilityLabel="Back">
        <ArrowLeft size={22} color={colors.foreground} />
      </Pressable>

      {preparing ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.foreground} />
          <Text style={styles.status}>Getting this video ready…</Text>
        </View>
      ) : null}

      {playback.source.kind === "failed" ? (
        <View style={styles.center}>
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

      {sourceUri ? (
        <VideoView
          player={player}
          style={styles.video}
          nativeControls
          contentFit="contain"
        />
      ) : null}

      {captionsOn && captionText ? (
        <View style={[styles.caption, { bottom: insets.bottom + 72 }]} pointerEvents="none">
          <Text style={styles.captionText}>{captionText}</Text>
        </View>
      ) : null}

      <View style={[styles.chrome, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Text style={styles.title} numberOfLines={2}>
          {video?.title ?? ""}
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              const prev = playPrevious();
              if (prev) router.replace(`/player/${prev.id}`);
            }}
            disabled={!hasPreviousVideo}
            accessibilityLabel="Previous"
          >
            <SkipBack
              size={26}
              color={hasPreviousVideo ? colors.foreground : colors.textTertiary}
            />
          </Pressable>
          <Pressable
            onPress={() => setCaptionsOn((value) => !value)}
            accessibilityLabel="Captions"
          >
            <Captions
              size={26}
              color={captionsOn ? colors.primary : colors.foreground}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              const next = playNext();
              if (next) router.replace(`/player/${next.id}`);
            }}
            disabled={!hasNextVideo}
            accessibilityLabel="Next"
          >
            <SkipForward
              size={26}
              color={hasNextVideo ? colors.foreground : colors.textTertiary}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  video: { flex: 1, backgroundColor: "#000" },
  back: {
    position: "absolute",
    top: spacing.md,
    left: spacing.sm,
    zIndex: 2,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
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
    left: spacing.md,
    right: spacing.md,
    alignItems: "center",
  },
  captionText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    overflow: "hidden",
    borderRadius: 6,
  },
  chrome: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: "#000",
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
