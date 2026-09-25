import {
  useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import {
  Alert,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  Pressable,
  Dimensions,
} from "react-native";
import { Link, useRouter, type Href } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLibraryStore } from "../../../stores/library";
import { useDownloadStore } from "../../../stores/downloads";
import { useConnectionStore } from "../../../stores/connection";
import { usePlaybackStore, type StreamingVideo } from "../../../stores/playback";
import { VideoCard } from "../../../components/VideoCard";
import {
  getAllSavedPlaylistsWithProgress,
  getSavedPlaylistWithItems,
} from "../../../db/repositories/playlists";
import * as watchHistoryRepo from "../../../db/repositories/watchHistory";
import { offlineCopy } from "../../../services/offline-copy";
import { colors, spacing, radius, fontSize, fontWeight } from "../../../theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRID_PADDING = spacing.sm + 2;
const GRID_GAP = spacing.sm + 2;
const VIDEO_CARD_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

type SavedPlaylistInfo = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  type: string;
  downloadedCount: number;
  totalCount: number;
};

type PlaylistResumeInfo = {
  videoId: string;
  startSeconds: number;
  label: string;
};

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function createResumeLabel(seconds: number): string {
  return `Resume ${formatDuration(seconds)}`;
}

function clampResumeStart(positionSeconds: number, durationSeconds: number): number {
  const maxDuration = durationSeconds > 0 ? durationSeconds : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(Math.floor(positionSeconds), maxDuration));
}

interface SavedPlaylistCardProps {
  playlist: SavedPlaylistInfo;
  onOpenPress: () => void;
  onResumePress?: () => void;
  resumeLabel?: string;
}

function SavedPlaylistCard({
  playlist,
  onOpenPress,
  onResumePress,
  resumeLabel,
}: SavedPlaylistCardProps) {
  return (
    <View style={styles.playlistCardShell}>
      <Pressable style={styles.playlistCard} onPress={onOpenPress}>
        <View style={styles.playlistThumbnail}>
          {playlist.thumbnailUrl ? (
            <Image
              source={{ uri: playlist.thumbnailUrl }}
              style={styles.playlistImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.playlistPlaceholder}>
              <Text style={styles.playlistPlaceholderText}>{playlist.title.charAt(0)}</Text>
            </View>
          )}
        </View>
        <Text style={styles.playlistTitle} numberOfLines={2}>
          {playlist.title}
        </Text>
        <View style={styles.playlistProgress}>
          <View style={styles.playlistProgressBar}>
            <View
              style={[
                styles.playlistProgressFill,
                {
                  width: `${playlist.totalCount > 0
                    ? (playlist.downloadedCount / playlist.totalCount) * 100
                    : 0
                    }%`,
                },
              ]}
            />
          </View>
          <Text style={styles.playlistProgressText}>
            {playlist.downloadedCount}/{playlist.totalCount}
          </Text>
        </View>
      </Pressable>

      {onResumePress && resumeLabel ? (
        <Pressable style={styles.playlistResumeButton} onPress={onResumePress}>
          <Text style={styles.playlistResumeText} numberOfLines={1}>
            {resumeLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SavedTabContent() {
  const router = useRouter();

  const videos = useLibraryStore((state) => state.videos);
  const downloadQueue = useDownloadStore((state) => state.queue);
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const startPlaylist = usePlaybackStore((state) => state.startPlaylist);

  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylistInfo[]>([]);
  const [watchHistoryLookup, setWatchHistoryLookup] =
    useState<watchHistoryRepo.WatchHistoryLookup>({});

  const loadData = useCallback(() => {
    const playlists = getAllSavedPlaylistsWithProgress();
    setSavedPlaylists(playlists);
    setWatchHistoryLookup(watchHistoryRepo.getWatchHistoryLookup(1500));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, videos]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const getOfflineUri = offlineCopy.useLookup();
  const downloadedVideos = videos.filter((v) => getOfflineUri(v.id) !== null);
  const activeDownloads = downloadQueue.filter((d) => d.status === "downloading");
  const queuedDownloads = downloadQueue.filter((d) => d.status === "queued");

  const getVideoResumeSeconds = useCallback(
    (videoId: string, duration: number) => {
      const item = watchHistoryLookup[videoId];
      if (!item) return 0;
      return clampResumeStart(item.lastPositionSeconds, duration);
    },
    [watchHistoryLookup]
  );

  const playlistResumeById = useMemo(() => {
    const result = new Map<string, PlaylistResumeInfo>();

    for (const playlist of savedPlaylists) {
      const fullPlaylist = getSavedPlaylistWithItems(playlist.id);
      if (!fullPlaylist || fullPlaylist.items.length === 0) continue;

      const mostRecent = watchHistoryRepo.getMostRecentWatchForVideoIds(
        fullPlaylist.items.map((item) => item.videoId),
        watchHistoryLookup
      );
      if (!mostRecent) continue;

      const startSeconds = clampResumeStart(
        mostRecent.lastPositionSeconds,
        mostRecent.duration
      );
      if (startSeconds <= 0) continue;

      result.set(playlist.id, {
        videoId: mostRecent.videoId,
        startSeconds,
        label: createResumeLabel(startSeconds),
      });
    }

    return result;
  }, [savedPlaylists, watchHistoryLookup]);

  const handlePlaylistPress = useCallback(
    (playlistId: string) => {
      router.push(`/saved-playlist/${playlistId}`);
    },
    [router]
  );

  const handleResumePlaylistPress = useCallback(
    (playlistId: string) => {
      const fullPlaylist = getSavedPlaylistWithItems(playlistId);
      if (!fullPlaylist || fullPlaylist.items.length === 0) {
        return;
      }

      const resumeInfo = playlistResumeById.get(playlistId);
      const resumeVideoId = resumeInfo?.videoId ?? fullPlaylist.items[0].videoId;

      const playlistVideos: StreamingVideo[] = fullPlaylist.items.map((item) => ({
        id: item.videoId,
        title: item.title,
        channelTitle: item.channelTitle,
        duration: item.duration,
        thumbnailUrl: item.thumbnailUrl ?? undefined,
        localPath: getOfflineUri(item.videoId) ?? undefined,
      }));

      const playableVideos = serverUrl
        ? playlistVideos
        : playlistVideos.filter((item) => !!item.localPath);

      if (playableVideos.length === 0) {
        Alert.alert(
          "Offline mode",
          "Reconnect to desktop or download videos to resume this playlist."
        );
        return;
      }

      const startIndex = playableVideos.findIndex((item) => item.id === resumeVideoId);
      const safeStartIndex = startIndex >= 0 ? startIndex : 0;
      const selectedVideo = playableVideos[safeStartIndex];
      const startSeconds =
        safeStartIndex === startIndex ? resumeInfo?.startSeconds ?? 0 : 0;

      startPlaylist(
        `saved-${fullPlaylist.id}`,
        fullPlaylist.title,
        playableVideos,
        safeStartIndex,
        serverUrl ?? undefined
      );

      const route =
        startSeconds > 0
          ? (`/player/${selectedVideo.id}?start=${startSeconds}` as Href)
          : (`/player/${selectedVideo.id}` as Href);
      router.push(route);
    },
    [getOfflineUri, playlistResumeById, router, serverUrl, startPlaylist]
  );

  const renderPlaylistCard = (playlist: SavedPlaylistInfo, index: number) => {
    const resumeInfo = playlistResumeById.get(playlist.id);

    return (
      <SavedPlaylistCard
        key={playlist.id}
        playlist={playlist}
        onOpenPress={() => handlePlaylistPress(playlist.id)}
        onResumePress={
          resumeInfo ? () => handleResumePlaylistPress(playlist.id) : undefined
        }
        resumeLabel={resumeInfo?.label}
      />
    );
  };

  return videos.length === 0 && savedPlaylists.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📚</Text>
          <Text style={styles.emptyTitle}>No Videos Yet</Text>
          <Text style={styles.emptyText}>
            Sync videos from your LearnifyTube desktop app
          </Text>
          <Link href="/(mobile)/(tabs)/settings" asChild>
            <Pressable style={styles.syncButton}>
              <Text style={styles.syncButtonText}>Sync Videos</Text>
            </Pressable>
          </Link>
        </View>
      ) : (
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {savedPlaylists.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Saved Playlists</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.playlistsRow}
              >
                {savedPlaylists.map((playlist, index) =>
                  renderPlaylistCard(playlist, index)
                )}
              </ScrollView>
            </View>
          )}

          <View style={styles.header}>
            <View style={styles.headerInfo}>
              <Text style={styles.headerText}>
                {downloadedVideos.length} video
                {downloadedVideos.length !== 1 ? "s" : ""} downloaded
              </Text>
              {(activeDownloads.length > 0 || queuedDownloads.length > 0) && (
                <View style={styles.downloadStatus}>
                  {activeDownloads.length > 0 && (
                    <Text style={styles.downloadStatusText}>
                      {activeDownloads.length} downloading
                      {activeDownloads[0] && ` (${activeDownloads[0].progress}%)`}
                    </Text>
                  )}
                  {queuedDownloads.length > 0 && (
                    <Text style={styles.queuedStatusText}>
                      {queuedDownloads.length} queued
                    </Text>
                  )}
                </View>
              )}
            </View>
          </View>

          {videos.length > 0 && (
            <View style={styles.videosGrid}>
              {videos.map((video) => {
                const resumeSeconds = getVideoResumeSeconds(video.id, video.duration);
                const playerHref =
                  resumeSeconds > 0
                    ? (`/player/${video.id}?start=${resumeSeconds}` as Href)
                    : (`/player/${video.id}` as Href);

                return (
                  <VideoCard
                    key={video.id}
                    video={video}
                    playerHref={playerHref}
                    resumeLabel={
                      resumeSeconds > 0 ? createResumeLabel(resumeSeconds) : undefined
                    }
                    style={[styles.downloadedVideoCard, { width: VIDEO_CARD_WIDTH }]}
                  />
                );
              })}
            </View>
          )}
        </ScrollView>
      );

}

export default function ListsScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <SavedTabContent />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  section: {
    paddingTop: spacing.md,
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm + 4,
  },
  playlistsRow: {
    paddingHorizontal: spacing.sm + 4,
    gap: spacing.sm + 4,
  },
  playlistCardShell: {
    width: 150,
    marginRight: spacing.sm + 4,
  },
  playlistCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.sm + 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  playlistThumbnail: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.muted,
    marginBottom: spacing.sm,
  },
  playlistImage: {
    width: "100%",
    height: "100%",
  },
  playlistPlaceholder: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.primary,
  },
  playlistPlaceholderText: {
    color: colors.primaryForeground,
    fontSize: 32,
    fontWeight: "700",
  },
  playlistTitle: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  playlistProgress: {
    gap: spacing.xs,
  },
  playlistProgressBar: {
    height: 4,
    backgroundColor: colors.muted,
    borderRadius: 2,
    overflow: "hidden",
  },
  playlistProgressFill: {
    height: "100%",
    backgroundColor: colors.success,
  },
  playlistProgressText: {
    color: colors.mutedForeground,
    fontSize: 11,
  },
  playlistResumeButton: {
    marginTop: spacing.xs + 2,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: `${colors.primary}66`,
    backgroundColor: `${colors.primary}22`,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    alignItems: "center",
  },
  playlistResumeText: {
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerInfo: {
    flex: 1,
  },
  headerText: {
    color: colors.mutedForeground,
    fontSize: fontSize.base,
  },
  downloadStatus: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  downloadStatusText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  queuedStatusText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
  videosGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: GRID_PADDING,
    paddingTop: spacing.sm,
    gap: GRID_GAP,
  },
  downloadedVideoCard: {
    width: VIDEO_CARD_WIDTH,
    flex: 0,
    margin: 0,
    marginBottom: spacing.sm + 2,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: fontSize["2xl"],
    fontWeight: fontWeight.bold,
    marginBottom: spacing.sm,
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.md,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  syncButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 6,
    borderRadius: radius.lg,
  },
  syncButtonText: {
    color: colors.primaryForeground,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
