import {
  useEffect,
  useCallback,
  useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  Pressable,
} from "react-native";
import { Link, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDownloadStore } from "../../../stores/downloads";
import { useConnectionStore } from "../../../stores/connection";
import { useSyncStore } from "../../../stores/sync";
import { usePlaybackStore } from "../../../stores/playback";
import { savePlaylist, isPlaylistSaved } from "../../../db/repositories/playlists";
import {
  useBrowseCatalog,
  useBrowseCollectionVideos,
} from "../../../core/hooks/useBrowseCatalog";
import { hasCachedCollectionVideos } from "../../../services/browseCache";
import { ChannelList } from "../../../components/sync";
import { VideoGridCard } from "../../../components/VideoGridCard";
import { colors, radius, spacing, fontSize, fontWeight } from "../../../theme";
import { Smartphone, ArrowLeft, Play } from "../../../theme/icons";
import type { RemoteChannel, RemoteVideoWithStatus } from "../../../types";
import type { StreamingVideo } from "../../../stores/playback";
import { api } from "../../../services/api";
import { offlineCopy } from "../../../services/offline-copy";

export default function HomeScreen() {
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const isConnected = !!serverUrl;

  const queueDownload = useDownloadStore((s) => s.queueDownload);
  const { channels } = useBrowseCatalog();

  const {
    isLoadingChannels,
    isLoadingVideos,
    channelsError,
    videosError,
    selectedChannel,
    selectedVideoIds,
    fetchChannels,
    fetchChannelVideos,
    selectChannel,
    toggleVideoSelection,
    selectAllVideos,
    clearVideoSelection,
  } = useSyncStore();
  const channelVideos = useBrowseCollectionVideos(
    selectedChannel ? "channel" : null,
    selectedChannel?.channelId ?? null
  );

  const startPlaylist = usePlaybackStore((s) => s.startPlaylist);

  // Set of video IDs already synced to mobile
  const getOfflineUri = offlineCopy.useLookup();
  const hasOfflineCopy = (videoId: string) => getOfflineUri(videoId) !== null;

  const [pendingVideoIds, setPendingVideoIds] = useState<Set<string>>(new Set());
  const [, bumpSavedPlaylistVersion] = useState(0);

  const setPending = useCallback((videoId: string, isPending: boolean) => {
    setPendingVideoIds((prev) => {
      const next = new Set(prev);
      if (isPending) {
        next.add(videoId);
      } else {
        next.delete(videoId);
      }
      return next;
    });
  }, []);

  // Fetch channels when connected
  useEffect(() => {
    if (!serverUrl) return;
    fetchChannels(serverUrl);
  }, [serverUrl, fetchChannels]);

  // Clear pending actions when disconnected
  useEffect(() => {
    if (!serverUrl) {
      setPendingVideoIds(new Set());
      clearVideoSelection();
    }
  }, [serverUrl, clearVideoSelection]);

  const hasCachedData = channels.length > 0;

  const showOfflineAlert = useCallback(() => {
    Alert.alert(
      "Offline mode",
      "Reconnect to your desktop app to refresh or sync new videos."
    );
  }, []);

  const handleRefreshChannels = useCallback(() => {
    if (serverUrl) {
      fetchChannels(serverUrl);
      return;
    }
    showOfflineAlert();
  }, [serverUrl, fetchChannels, showOfflineAlert]);

  const handleChannelPress = useCallback(
    (channel: RemoteChannel) => {
      if (hasCachedCollectionVideos("channel", channel.channelId) || !serverUrl) {
        selectChannel(channel);
        return;
      }

      if (serverUrl) {
        fetchChannelVideos(serverUrl, channel);
        return;
      }
    },
    [serverUrl, fetchChannelVideos, selectChannel]
  );

  const handleBackPress = useCallback(() => {
    if (selectedChannel) {
      selectChannel(null);
    }
  }, [selectedChannel, selectChannel]);

  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    []
  );

  const waitForServerDownload = useCallback(
    async (videoId: string) => {
      if (!serverUrl) throw new Error("Not connected to server");
      const timeoutMs = 10 * 60 * 1000;
      const intervalMs = 2000;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const status = await api.getServerDownloadStatus(serverUrl, videoId);
        if (status.status === "completed") return;
        if (status.status === "failed") {
          throw new Error(status.error || "Server download failed");
        }
        await sleep(intervalMs);
      }

      throw new Error("Server download timed out");
    },
    [serverUrl, sleep]
  );

  const waitForLocalVideo = useCallback(
    async (videoId: string) => {
      const timeoutMs = 10 * 60 * 1000;
      const intervalMs = 1000;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (offlineCopy.getUri(videoId) !== null) return;
        await sleep(intervalMs);
      }

      throw new Error("Sync to mobile timed out");
    },
    [sleep]
  );

  // Play a single video (streaming or local)
  const handlePlayVideo = useCallback(
    (video: RemoteVideoWithStatus) => {
      const offlineUri = offlineCopy.getUri(video.id);
      if (!serverUrl && !offlineUri) {
        Alert.alert(
          "Offline mode",
          "This video is not downloaded on mobile yet."
        );
        return;
      }

      // Create streaming video object
      const streamingVideo: StreamingVideo = {
        id: video.id,
        title: video.title,
        channelTitle: video.channelTitle,
        duration: video.duration,
        thumbnailUrl: video.thumbnailUrl ?? undefined,
      };

      // Determine the context title (channels-only screen)
      let contextTitle = "Now Playing";
      let contextId = `single-${video.id}`;
      if (selectedChannel) {
        contextTitle = selectedChannel.channelTitle;
        contextId = `channel-${selectedChannel.channelId}`;
      }

      // Get the current video list for playlist context
      const currentVideos = selectedChannel ? channelVideos : [];

      // Convert to StreamingVideo array
      const playlistStreamingVideos: StreamingVideo[] = currentVideos.map(
        (v) => ({
          id: v.id,
          title: v.title,
          channelTitle: v.channelTitle,
          duration: v.duration,
          thumbnailUrl: v.thumbnailUrl ?? undefined,
        })
      );
      const playablePlaylistVideos = serverUrl
        ? playlistStreamingVideos
        : playlistStreamingVideos.filter(
            (v) => offlineCopy.getUri(v.id) !== null
          );

      // Find index of current video
      const startIndex = playablePlaylistVideos.findIndex(
        (v) => v.id === video.id
      );
      const fallbackVideos =
        serverUrl || offlineUri ? [streamingVideo] : [];
      const videosToPlay =
        playablePlaylistVideos.length > 0 ? playablePlaylistVideos : fallbackVideos;

      if (videosToPlay.length === 0) {
        Alert.alert(
          "Offline mode",
          "No playable video source is available."
        );
        return;
      }

      startPlaylist(
        contextId,
        contextTitle,
        videosToPlay,
        startIndex >= 0 ? startIndex : 0,
        serverUrl ?? undefined
      );

      router.push(`/player/${video.id}`);
    },
    [serverUrl, selectedChannel, channelVideos, startPlaylist, router]
  );

  const handlePlayAll = useCallback(() => {
    if (!selectedChannel) return;
    const contextTitle = selectedChannel.channelTitle;
    const contextId = `channel-${selectedChannel.channelId}`;
    const currentVideos = channelVideos;

    const playableVideos = currentVideos.filter((v) => {
      if (serverUrl) {
        return v.downloadStatus === "completed";
      }
      return offlineCopy.getUri(v.id) !== null;
    });

    if (playableVideos.length === 0) {
      Alert.alert(
        "Offline mode",
        "No downloaded videos are available to play."
      );
      return;
    }

    // Convert to StreamingVideo array
    const videosToPlay: StreamingVideo[] = playableVideos.map((v) => ({
      id: v.id,
      title: v.title,
      channelTitle: v.channelTitle,
      duration: v.duration,
      thumbnailUrl: v.thumbnailUrl ?? undefined,
    }));

    startPlaylist(
      contextId,
      contextTitle,
      videosToPlay,
      0,
      serverUrl ?? undefined
    );
    router.push(`/player/${videosToPlay[0].id}`);
  }, [
    serverUrl,
    selectedChannel,
    channelVideos,
    startPlaylist,
  ]);

  const handleSyncVideo = useCallback(
    (video: RemoteVideoWithStatus) => {
      if (!serverUrl || video.downloadStatus !== "completed") return;

      queueDownload(video.id, {
        title: video.title,
        channelTitle: video.channelTitle,
        duration: video.duration,
        thumbnailUrl: video.thumbnailUrl ?? undefined,
      });
    },
    [serverUrl, queueDownload]
  );

  const handleSyncSelected = useCallback(() => {
    const videos = channelVideos;
    for (const video of videos) {
      if (
        selectedVideoIds.has(video.id) &&
        video.downloadStatus === "completed" &&
        !hasOfflineCopy(video.id)
      ) {
        queueDownload(video.id, {
          title: video.title,
          channelTitle: video.channelTitle,
          duration: video.duration,
          thumbnailUrl: video.thumbnailUrl ?? undefined,
        });
      }
    }
    clearVideoSelection();
  }, [
    channelVideos,
    selectedVideoIds,
    hasOfflineCopy,
    queueDownload,
    clearVideoSelection,
  ]);

  // Not connected and no cache - show connect prompt
  if (!isConnected && !hasCachedData) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.emptyState}>
          <Smartphone size={64} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>LearnifyTube</Text>
          <Text style={styles.emptyText}>
            Connect to your LearnifyTube desktop app to browse and sync videos
          </Text>
          <Link href="/(mobile)/(tabs)/settings" asChild>
            <Pressable style={styles.connectButton}>
              <Text style={styles.connectButtonText}>Go to Settings</Text>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  // Video list view for selected channel
  const isShowingVideos = Boolean(selectedChannel);
  const currentVideos = selectedChannel ? channelVideos : [];
  const currentTitle = selectedChannel ? selectedChannel.channelTitle : "";

  if (isShowingVideos && selectedChannel) {
    const isChannelDetail = true;
    const saveTarget = {
      playlistId: `channel_${selectedChannel.channelId}`,
      playlistTitle: selectedChannel.channelTitle,
      playlistType: "channel" as const,
      sourceId: selectedChannel.channelId,
      thumbnailUrl: selectedChannel.thumbnailUrl,
    };

    // Videos available on server (downloaded on desktop)
    const availableVideos = currentVideos.filter(
      (v) => v.downloadStatus === "completed"
    );
    const syncableCount = serverUrl
      ? availableVideos.filter((v) => !hasOfflineCopy(v.id)).length
      : 0;
    const savedCount = availableVideos.filter((v) =>
      hasOfflineCopy(v.id)
    ).length;
    const totalAvailable = availableVideos.length;
    const isFullySaved = savedCount === totalAvailable && totalAvailable > 0;
    const isPlaylistSaveContext = false;
    const isSaveActionDone =
      isPlaylistSaveContext && saveTarget
        ? isPlaylistSaved(saveTarget.playlistId)
        : isFullySaved;

    const localPlayableCount = currentVideos.filter(
      (v) => hasOfflineCopy(v.id)
    ).length;
    const playableCount = serverUrl ? totalAvailable : localPlayableCount;

    const handleSavePlaylistOffline = () => {
      if (!saveTarget) {
        return;
      }

      const videoInfos = currentVideos.map((v) => ({
        videoId: v.id,
        title: v.title,
        channelTitle: v.channelTitle,
        duration: v.duration,
        thumbnailUrl: v.thumbnailUrl ?? undefined,
        downloadStatus: v.downloadStatus,
        downloadProgress: v.downloadProgress,
        fileSize: v.fileSize,
      }));

      try {
        savePlaylist(
          saveTarget.playlistId,
          saveTarget.playlistTitle,
          saveTarget.playlistType,
          saveTarget.sourceId,
          saveTarget.thumbnailUrl,
          videoInfos
        );
        bumpSavedPlaylistVersion((value) => value + 1);
      } catch (error) {
        console.log("[Home] Failed to save playlist:", error);
        Alert.alert("Save failed", "Could not save playlist. Please try again.");
        return;
      }

      if (!serverUrl) {
        return;
      }

      // Queue downloads for videos not yet synced
      for (const video of availableVideos) {
        if (!hasOfflineCopy(video.id)) {
          queueDownload(video.id, {
            title: video.title,
            channelTitle: video.channelTitle,
            duration: video.duration,
            thumbnailUrl: video.thumbnailUrl ?? undefined,
          });
        }
      }
    };

    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        {/* Header with back button */}
        <View style={styles.videoHeader}>
          <Pressable
            style={styles.backButton}
            onPress={handleBackPress}
          >
            <ArrowLeft size={18} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {currentTitle}
            </Text>
            <Text style={styles.headerSubtitle}>
              {totalAvailable > 0
                ? `${savedCount}/${totalAvailable} saved offline`
                : `${currentVideos.length} videos`}
            </Text>
          </View>
          {/* Save Offline Button */}
          {!isChannelDetail && currentVideos.length > 0 && serverUrl && (
            <Pressable
              style={[
                styles.saveOfflineButton,
                isSaveActionDone && styles.saveOfflineButtonDisabled,
              ]}
              onPress={handleSavePlaylistOffline}
              disabled={isSaveActionDone}
            >
              <Text style={styles.saveOfflineButtonText}>
                {isSaveActionDone
                  ? "Saved"
                  : isPlaylistSaveContext
                    ? "Save Playlist"
                    : "Save All"}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Progress bar */}
        {totalAvailable > 0 && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${(savedCount / totalAvailable) * 100}%` },
                ]}
              />
            </View>
          </View>
        )}

        {/* Action toolbar */}
        {!isChannelDetail && (syncableCount > 0 || playableCount > 0) && (
          <View style={styles.toolbar}>
            {syncableCount > 0 && (
              <Pressable
                style={styles.toolbarButton}
                onPress={
                  selectedVideoIds.size > 0 ? clearVideoSelection : selectAllVideos
                }
              >
                <Text style={styles.toolbarButtonText}>
                  {selectedVideoIds.size > 0
                    ? `Deselect (${selectedVideoIds.size})`
                    : `Select All (${syncableCount})`}
                </Text>
              </Pressable>
            )}
            {selectedVideoIds.size > 0 && (
              <Pressable
                style={styles.syncAllButton}
                onPress={handleSyncSelected}
              >
                <Text style={styles.syncAllButtonText}>
                  Sync {selectedVideoIds.size} video
                  {selectedVideoIds.size !== 1 ? "s" : ""}
                </Text>
              </Pressable>
            )}
            {playableCount > 0 && selectedVideoIds.size === 0 && (
              <Pressable
                style={styles.playAllButton}
                onPress={handlePlayAll}
              >
                <Play size={14} color={colors.foreground} fill={colors.foreground} />
                <Text style={styles.playAllButtonText}>
                  Play All ({playableCount})
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Video grid */}
        {isLoadingVideos ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading videos...</Text>
          </View>
        ) : videosError ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>Failed to load videos</Text>
            <Text style={styles.errorDetail}>{videosError}</Text>
          </View>
        ) : currentVideos.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyListText}>No videos found</Text>
          </View>
        ) : (
          <FlatList
            style={{ flex: 1 }}
            data={currentVideos}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridList}
            renderItem={({ item, index }) => (
              <VideoGridCard
                video={item}
                pending={
                  pendingVideoIds.has(item.id)
                    ? { type: "preparing" }
                    : { type: "none" }
                }
                onPress={() => handlePlayVideo(item)}
              />
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  // Channels list (no tabs)
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ChannelList
        channels={channels}
        isLoading={isLoadingChannels}
        error={channelsError}
        onChannelPress={handleChannelPress}
        onRefresh={handleRefreshChannels}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  loadingText: {
    color: colors.mutedForeground,
    fontSize: fontSize.base,
    marginTop: spacing.sm + 4,
  },
  errorText: {
    color: colors.destructive,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.sm,
  },
  errorDetail: {
    color: colors.mutedForeground,
    fontSize: 13,
    textAlign: "center",
  },
  emptyListText: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: fontSize["3xl"],
    fontWeight: fontWeight.bold,
    marginTop: spacing.md,
    marginBottom: spacing.sm + 4,
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.md,
    textAlign: "center",
    marginBottom: spacing.xl,
    lineHeight: 24,
  },
  connectButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  connectButtonText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  videoHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.muted,
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.sm + 4,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  headerSubtitle: {
    color: colors.mutedForeground,
    fontSize: 13,
    marginTop: 2,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.sm + 4,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolbarButton: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    borderRadius: 6,
    backgroundColor: colors.muted,
  },
  toolbarButtonText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: fontWeight.medium,
  },
  syncAllButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  syncAllButtonText: {
    color: colors.primaryForeground,
    fontSize: 13,
    fontWeight: fontWeight.semibold,
  },
  playAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 6,
    backgroundColor: colors.success,
    marginLeft: "auto",
  },
  playAllButtonText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: fontWeight.semibold,
  },
  gridList: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  gridRow: {
    justifyContent: "space-between",
  },
  videoList: {
    paddingVertical: spacing.sm,
  },
  saveOfflineButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  saveOfflineButtonDisabled: {
    backgroundColor: colors.success,
  },
  saveOfflineButtonText: {
    color: colors.primaryForeground,
    fontSize: 13,
    fontWeight: fontWeight.semibold,
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.muted,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.success,
    borderRadius: 2,
  },
});
