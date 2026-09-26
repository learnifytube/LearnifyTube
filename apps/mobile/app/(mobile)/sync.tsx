import {
  useEffect,
  useCallback,
  useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useSyncStore } from "../../stores/sync";
import { useConnectionStore } from "../../stores/connection";
import { downloadQueue } from "../../services/download-queue";
import { usePlaybackStore } from "../../stores/playback";
import { savePlaylist, isPlaylistSaved } from "../../db/repositories/playlists";
import {
  useBrowseCatalog,
  useBrowseCollectionVideos,
} from "../../core/hooks/useBrowseCatalog";
import {
  hasCachedCollectionVideos,
  shouldRefreshCollectionVideos,
} from "../../services/browseCache";
import {
  SyncTabBar,
  ChannelList,
  PlaylistList,
  VideoListItem,
  MyListsList,
} from "../../components/sync";
import type {
  RemoteChannel,
  RemotePlaylist,
  RemoteVideoWithStatus,
  RemoteMyList,
} from "../../types";
import type { StreamingVideo } from "../../stores/playback";
import { api } from "../../services/api";
import { offlineCopy } from "../../services/offline-copy";

export default function SyncScreen() {
  const router = useRouter();
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const startPlaylist = usePlaybackStore((s) => s.startPlaylist);
  const { channels, playlists, myLists } = useBrowseCatalog();

  const {
    activeTab,
    setActiveTab,
    isLoadingChannels,
    isLoadingPlaylists,
    isLoadingVideos,
    isLoadingMyLists,
    channelsError,
    playlistsError,
    myListsError,
    videosError,
    selectedChannel,
    selectedPlaylist,
    selectedMyList,
    selectedVideoIds,
    fetchChannels,
    fetchPlaylists,
    fetchMyLists,
    fetchChannelVideos,
    fetchPlaylistVideos,
    fetchMyListVideos,
    selectChannel,
    selectPlaylist,
    selectMyList,
    toggleVideoSelection,
    selectAllVideos,
    clearVideoSelection,
  } = useSyncStore();
  const channelVideos = useBrowseCollectionVideos(
    selectedChannel ? "channel" : null,
    selectedChannel?.channelId ?? null
  );
  const playlistVideos = useBrowseCollectionVideos(
    selectedPlaylist ? "playlist" : null,
    selectedPlaylist?.playlistId ?? null
  );
  const myListVideos = useBrowseCollectionVideos(
    selectedMyList ? "mylist" : null,
    selectedMyList?.id ?? null
  );

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

  // Fetch data when tab changes or on mount
  useEffect(() => {
    if (!serverUrl) return;

    if (activeTab === "channels") {
      fetchChannels(serverUrl);
    } else if (activeTab === "playlists") {
      fetchPlaylists(serverUrl);
    } else if (activeTab === "mylists") {
      fetchMyLists(serverUrl);
    }
  }, [
    activeTab,
    serverUrl,
    fetchChannels,
    fetchPlaylists,
    fetchMyLists,
  ]);

  useEffect(() => {
    if (!serverUrl) {
      setPendingVideoIds(new Set());
      clearVideoSelection();
    }
  }, [serverUrl, clearVideoSelection]);

  const hasCachedData =
    channels.length > 0 ||
    playlists.length > 0 ||
    myLists.length > 0;

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

  const handleRefreshPlaylists = useCallback(() => {
    if (serverUrl) {
      fetchPlaylists(serverUrl);
      return;
    }
    showOfflineAlert();
  }, [serverUrl, fetchPlaylists, showOfflineAlert]);

  const handleRefreshMyLists = useCallback(() => {
    if (serverUrl) {
      fetchMyLists(serverUrl);
      return;
    }
    showOfflineAlert();
  }, [serverUrl, fetchMyLists, showOfflineAlert]);

  const handleChannelPress = useCallback(
    (channel: RemoteChannel) => {
      const hasCachedVideos = hasCachedCollectionVideos(
        "channel",
        channel.channelId
      );
      if (!serverUrl) {
        selectChannel(channel);
        return;
      }

      if (hasCachedVideos) {
        selectChannel(channel);
        if (shouldRefreshCollectionVideos("channel", channel.channelId)) {
          fetchChannelVideos(serverUrl, channel);
        }
        return;
      }

      if (serverUrl) {
        fetchChannelVideos(serverUrl, channel);
        return;
      }
    },
    [serverUrl, fetchChannelVideos, selectChannel]
  );

  const handlePlaylistPress = useCallback(
    (playlist: RemotePlaylist) => {
      const hasCachedVideos = hasCachedCollectionVideos(
        "playlist",
        playlist.playlistId
      );
      if (!serverUrl) {
        selectPlaylist(playlist);
        return;
      }

      if (hasCachedVideos) {
        selectPlaylist(playlist);
        if (shouldRefreshCollectionVideos("playlist", playlist.playlistId)) {
          fetchPlaylistVideos(serverUrl, playlist);
        }
        return;
      }

      if (serverUrl) {
        fetchPlaylistVideos(serverUrl, playlist);
        return;
      }
    },
    [serverUrl, fetchPlaylistVideos, selectPlaylist]
  );

  const handleMyListPress = useCallback(
    (myList: RemoteMyList) => {
      const hasCachedVideos = hasCachedCollectionVideos("mylist", myList.id);
      if (!serverUrl) {
        selectMyList(myList);
        return;
      }

      if (hasCachedVideos) {
        selectMyList(myList);
        if (shouldRefreshCollectionVideos("mylist", myList.id)) {
          fetchMyListVideos(serverUrl, myList);
        }
        return;
      }

      if (serverUrl) {
        fetchMyListVideos(serverUrl, myList);
        return;
      }
    },
    [serverUrl, fetchMyListVideos, selectMyList]
  );

  const handleBackPress = useCallback(() => {
    if (selectedChannel) {
      selectChannel(null);
    } else if (selectedPlaylist) {
      selectPlaylist(null);
    } else if (selectedMyList) {
      selectMyList(null);
    }
  }, [
    selectedChannel,
    selectedPlaylist,
    selectedMyList,
    selectChannel,
    selectPlaylist,
    selectMyList,
  ]);

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

      const streamingVideo: StreamingVideo = {
        id: video.id,
        title: video.title,
        channelTitle: video.channelTitle,
        duration: video.duration,
        thumbnailUrl: video.thumbnailUrl ?? undefined,
      };

      let contextTitle = "Now Playing";
      let contextId = `single-${video.id}`;
      let currentVideos: RemoteVideoWithStatus[] = [];

      if (selectedChannel) {
        contextTitle = selectedChannel.channelTitle;
        contextId = `channel-${selectedChannel.channelId}`;
        currentVideos = channelVideos;
      } else if (selectedPlaylist) {
        contextTitle = selectedPlaylist.title;
        contextId = `playlist-${selectedPlaylist.playlistId}`;
        currentVideos = playlistVideos;
      } else if (selectedMyList) {
        contextTitle = selectedMyList.name;
        contextId = `mylist-${selectedMyList.id}`;
        currentVideos = myListVideos;
      }

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
    [
      serverUrl,
      selectedChannel,
      selectedPlaylist,
      selectedMyList,
      channelVideos,
      playlistVideos,
      myListVideos,
      startPlaylist,
      router,
    ]
  );

  const handleSyncVideo = useCallback(
    (video: RemoteVideoWithStatus) => {
      if (!serverUrl || video.downloadStatus !== "completed") return;

      downloadQueue.request(video);
    },
    [serverUrl]
  );

  const handleSyncSelected = useCallback(() => {
    let videos: RemoteVideoWithStatus[] = [];
    if (activeTab === "channels") videos = channelVideos;
    else if (activeTab === "playlists") videos = playlistVideos;
    else if (activeTab === "mylists") videos = myListVideos;

    for (const video of videos) {
      if (
        selectedVideoIds.has(video.id) &&
        video.downloadStatus === "completed" &&
        !hasOfflineCopy(video.id)
      ) {
        downloadQueue.request(video);
      }
    }
    clearVideoSelection();
  }, [
    activeTab,
    channelVideos,
    playlistVideos,
    myListVideos,
    selectedVideoIds,
    hasOfflineCopy,
    clearVideoSelection,
  ]);

  if (!serverUrl && !hasCachedData) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Not connected to server</Text>
        <Pressable
          style={styles.connectButton}
          onPress={() => router.push("/(mobile)/(tabs)/settings")}
        >
          <Text style={styles.connectButtonText}>Connect</Text>
        </Pressable>
      </View>
    );
  }

  // Video list view for selected channel/playlist/subscription/mylist
  const isShowingVideos = selectedChannel || selectedPlaylist || selectedMyList;

  const getCurrentVideos = () => {
    if (selectedChannel) return channelVideos;
    if (selectedPlaylist) return playlistVideos;
    if (selectedMyList) return myListVideos;
    return [];
  };
  const currentVideos = getCurrentVideos();

  const getCurrentTitle = () => {
    if (selectedChannel) return selectedChannel.channelTitle;
    if (selectedPlaylist) return selectedPlaylist.title;
    if (selectedMyList) return selectedMyList.name;
    return "";
  };
  const currentTitle = getCurrentTitle();

  if (isShowingVideos) {
    const isChannelDetail = Boolean(selectedChannel);
    const saveTarget = (() => {
      if (selectedChannel) {
        return {
          playlistId: `channel_${selectedChannel.channelId}`,
          playlistTitle: selectedChannel.channelTitle,
          playlistType: "channel",
          sourceId: selectedChannel.channelId,
          thumbnailUrl: selectedChannel.thumbnailUrl,
        };
      }

      if (selectedPlaylist) {
        return {
          playlistId: `playlist_${selectedPlaylist.playlistId}`,
          playlistTitle: selectedPlaylist.title,
          playlistType: "playlist",
          sourceId: selectedPlaylist.channelId,
          thumbnailUrl: selectedPlaylist.thumbnailUrl,
        };
      }

      if (selectedMyList) {
        return {
          playlistId: `mylist_${selectedMyList.id}`,
          playlistTitle: selectedMyList.name,
          playlistType: "mylist",
          sourceId: selectedMyList.id,
          thumbnailUrl: selectedMyList.thumbnailUrl,
        };
      }

      return null;
    })();

    // Videos available on server (downloaded on desktop)
    const availableVideos = currentVideos.filter(
      (v) => v.downloadStatus === "completed"
    );
    // Videos not yet synced to mobile
    const syncableCount = serverUrl
      ? availableVideos.filter((v) => !hasOfflineCopy(v.id)).length
      : 0;
    // Videos already saved locally
    const savedCount = availableVideos.filter((v) =>
      hasOfflineCopy(v.id)
    ).length;
    const totalAvailable = availableVideos.length;
    const isFullySaved = savedCount === totalAvailable && totalAvailable > 0;
    const isPlaylistSaveContext = Boolean(selectedPlaylist || selectedMyList);
    const isSaveActionDone =
      isPlaylistSaveContext && saveTarget
        ? isPlaylistSaved(saveTarget.playlistId)
        : isFullySaved;

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
        console.log("[Sync] Failed to save playlist:", error);
        Alert.alert("Save failed", "Could not save playlist. Please try again.");
        return;
      }

      if (!serverUrl) {
        return;
      }

      // Queue downloads for videos not yet synced
      for (const video of availableVideos) {
        if (!hasOfflineCopy(video.id)) {
          downloadQueue.request(video);
        }
      }
    };

    return (
      <View style={styles.container}>
        {/* Header with back button */}
        <View style={styles.videoHeader}>
          <Pressable style={styles.backButton} onPress={handleBackPress}>
            <Text style={styles.backIcon}>←</Text>
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

        {/* Selection toolbar */}
        {!isChannelDetail && syncableCount > 0 && (
          <View style={styles.toolbar}>
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
            {selectedVideoIds.size > 0 && (
              <Pressable style={styles.syncAllButton} onPress={handleSyncSelected}>
                <Text style={styles.syncAllButtonText}>
                  Sync {selectedVideoIds.size} video
                  {selectedVideoIds.size !== 1 ? "s" : ""}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Video list */}
        {isLoadingVideos ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.loadingText}>Loading videos...</Text>
          </View>
        ) : videosError ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>Failed to load videos</Text>
            <Text style={styles.errorDetail}>{videosError}</Text>
          </View>
        ) : currentVideos.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No videos found</Text>
          </View>
        ) : (
          <FlatList
            data={currentVideos}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <VideoListItem
                video={item}
                isSelected={selectedVideoIds.has(item.id)}
                isSyncedToMobile={hasOfflineCopy(item.id)}
                onPress={() => {
                  if (
                    serverUrl &&
                    item.downloadStatus === "completed" &&
                    !hasOfflineCopy(item.id)
                  ) {
                    toggleVideoSelection(item.id);
                  }
                }}
                onPlayPress={
                  item.downloadStatus === "completed" || hasOfflineCopy(item.id)
                    ? () => handlePlayVideo(item)
                    : undefined
                }
                onSyncPress={
                  serverUrl &&
                    item.downloadStatus === "completed" &&
                    !hasOfflineCopy(item.id)
                    ? () => handleSyncVideo(item)
                    : undefined
                }
              />
            )}
            contentContainerStyle={styles.videoList}
          />
        )}
      </View>
    );
  }

  // Tab-based list view
  return (
    <View style={styles.container}>
      {!serverUrl && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            Offline mode: showing cached data
          </Text>
          <Pressable
            style={styles.offlineBannerButton}
            onPress={() => router.push("/(mobile)/(tabs)/settings")}
          >
            <Text style={styles.offlineBannerButtonText}>Reconnect</Text>
          </Pressable>
        </View>
      )}
      <SyncTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "channels" && (
        <ChannelList
          channels={channels}
          isLoading={isLoadingChannels}
          error={channelsError}
          onChannelPress={handleChannelPress}
          onRefresh={handleRefreshChannels}
        />
      )}

      {activeTab === "playlists" && (
        <PlaylistList
          playlists={playlists}
          isLoading={isLoadingPlaylists}
          error={playlistsError}
          serverUrl={serverUrl ?? undefined}
          onPlaylistPress={handlePlaylistPress}
          onRefresh={handleRefreshPlaylists}
        />
      )}

      {activeTab === "mylists" && (
        <MyListsList
          myLists={myLists}
          isLoading={isLoadingMyLists}
          error={myListsError}
          onMyListPress={handleMyListPress}
          onRefresh={handleRefreshMyLists}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#27272a",
    backgroundColor: "#111827",
  },
  offlineBannerText: {
    color: "#f3f4f6",
    fontSize: 13,
    fontWeight: "500",
  },
  offlineBannerButton: {
    backgroundColor: "#6366f1",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  offlineBannerButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  loadingText: {
    color: "#71717a",
    fontSize: 14,
    marginTop: 12,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  errorDetail: {
    color: "#71717a",
    fontSize: 13,
    textAlign: "center",
  },
  emptyText: {
    color: "#fafafa",
    fontSize: 18,
    fontWeight: "600",
  },
  connectButton: {
    marginTop: 16,
    backgroundColor: "#6366f1",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  connectButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  videoHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#09090b",
    borderBottomWidth: 1,
    borderBottomColor: "#27272a",
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#27272a",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  backIcon: {
    color: "#fafafa",
    fontSize: 18,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    color: "#fafafa",
    fontSize: 18,
    fontWeight: "600",
  },
  headerSubtitle: {
    color: "#71717a",
    fontSize: 13,
    marginTop: 2,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#09090b",
    borderBottomWidth: 1,
    borderBottomColor: "#27272a",
  },
  toolbarButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#27272a",
  },
  toolbarButtonText: {
    color: "#fafafa",
    fontSize: 13,
    fontWeight: "500",
  },
  syncAllButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#6366f1",
  },
  syncAllButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  gridList: {
    padding: 16,
    paddingBottom: 24,
  },
  gridRow: {
    justifyContent: "space-between",
  },
  videoList: {
    paddingVertical: 8,
  },
  saveOfflineButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#22c55e",
  },
  saveOfflineButtonDisabled: {
    backgroundColor: "#27272a",
  },
  saveOfflineButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  progressContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#09090b",
  },
  progressBar: {
    height: 4,
    backgroundColor: "#27272a",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#22c55e",
    borderRadius: 2,
  },
});
