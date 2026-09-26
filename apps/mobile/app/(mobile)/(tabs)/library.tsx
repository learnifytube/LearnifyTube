import {
  useEffect,
  useCallback,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { downloadQueue } from "../../../services/download-queue";
import { useConnectionStore } from "../../../stores/connection";
import { useSyncStore } from "../../../stores/sync";
import { usePlaybackStore } from "../../../stores/playback";
import { savePlaylist, isPlaylistSaved } from "../../../db/repositories/playlists";
import {
  useBrowseCatalog,
  useBrowseCollectionVideos,
} from "../../../core/hooks/useBrowseCatalog";
import {
  hasCachedCollectionVideos,
  shouldRefreshCollectionVideos,
} from "../../../services/browseCache";
import {
  PlaylistList,
  MyListsList,
  VideoListItem,
} from "../../../components/sync";
import { SavedTabContent } from "./lists";
import { colors, spacing, fontSize, fontWeight } from "../../../theme";
import { ArrowLeft } from "../../../theme/icons";
import type { RemotePlaylist, RemoteMyList, RemoteVideoWithStatus } from "../../../types";
import type { StreamingVideo } from "../../../stores/playback";
import { offlineCopy } from "../../../services/offline-copy";

type LibraryTab = "mylists" | "playlists" | "saved";

const LIBRARY_TABS: { key: LibraryTab; label: string }[] = [
  { key: "mylists", label: "My Lists" },
  { key: "playlists", label: "Playlists" },
  { key: "saved", label: "Saved" },
];

export default function LibraryScreen() {
  const router = useRouter();
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const startPlaylist = usePlaybackStore((s) => s.startPlaylist);
  const { playlists, myLists } = useBrowseCatalog();

  const [libraryTab, setLibraryTab] = useState<LibraryTab>("mylists");

  const {
    isLoadingPlaylists,
    isLoadingVideos,
    isLoadingMyLists,
    playlistsError,
    myListsError,
    videosError,
    selectedPlaylist,
    selectedMyList,
    selectedVideoIds,
    favoritePlaylistIds,
    fetchPlaylists,
    fetchMyLists,
    fetchFavorites,
    loadFavoritesLocal,
    fetchPlaylistVideos,
    fetchMyListVideos,
    selectPlaylist,
    selectMyList,
    toggleVideoSelection,
    selectAllVideos,
    clearVideoSelection,
    addToFavorites,
    removeFromFavorites,
  } = useSyncStore();
  const playlistVideos = useBrowseCollectionVideos(
    selectedPlaylist ? "playlist" : null,
    selectedPlaylist?.playlistId ?? null
  );
  const myListVideos = useBrowseCollectionVideos(
    selectedMyList ? "mylist" : null,
    selectedMyList?.id ?? null
  );

  const getOfflineUri = offlineCopy.useLookup();
  const hasOfflineCopy = (videoId: string) => getOfflineUri(videoId) !== null;
  const [, bumpSavedPlaylistVersion] = useState(0);

  useEffect(() => {
    if (!serverUrl) return;
    if (libraryTab === "mylists") {
      fetchMyLists(serverUrl);
    } else if (libraryTab === "playlists") {
      fetchPlaylists(serverUrl);
    }
  }, [libraryTab, serverUrl, fetchMyLists, fetchPlaylists]);

  useEffect(() => {
    loadFavoritesLocal();
    if (serverUrl) {
      void fetchFavorites(serverUrl);
    }
  }, [serverUrl, fetchFavorites, loadFavoritesLocal]);

  useEffect(() => {
    if (!serverUrl) {
      clearVideoSelection();
    }
  }, [serverUrl, clearVideoSelection]);

  const showOfflineAlert = useCallback(() => {
    Alert.alert(
      "Offline mode",
      "Reconnect to your desktop app to refresh or sync new videos."
    );
  }, []);

  const handleRefreshMyLists = useCallback(() => {
    if (serverUrl) {
      fetchMyLists(serverUrl);
      return;
    }
    showOfflineAlert();
  }, [serverUrl, fetchMyLists, showOfflineAlert]);

  const handleRefreshPlaylists = useCallback(() => {
    if (serverUrl) {
      fetchPlaylists(serverUrl);
      return;
    }
    showOfflineAlert();
  }, [serverUrl, fetchPlaylists, showOfflineAlert]);

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
    if (selectedPlaylist) {
      selectPlaylist(null);
    } else if (selectedMyList) {
      selectMyList(null);
    }
  }, [selectedPlaylist, selectedMyList, selectPlaylist, selectMyList]);

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
      if (selectedPlaylist) {
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
      const startIndex = playablePlaylistVideos.findIndex((v) => v.id === video.id);
      const fallbackVideos =
        serverUrl || offlineUri ? [streamingVideo] : [];
      const videosToPlay =
        playablePlaylistVideos.length > 0
          ? playablePlaylistVideos
          : fallbackVideos;

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
      selectedPlaylist,
      selectedMyList,
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
    const videos = selectedPlaylist ? playlistVideos : myListVideos;
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
    selectedPlaylist,
    playlistVideos,
    myListVideos,
    selectedVideoIds,
    hasOfflineCopy,
    clearVideoSelection,
  ]);

  const handlePlaylistSavePress = useCallback(
    async (playlist: RemotePlaylist) => {
      const entityType =
        playlist.type === "custom" ? "custom_playlist" : "channel_playlist";
      const isFavorited = favoritePlaylistIds.has(playlist.playlistId);
      try {
        if (isFavorited) {
          await removeFromFavorites(serverUrl, entityType, playlist.playlistId);
        } else {
          await addToFavorites(serverUrl, entityType, playlist.playlistId);
        }
      } catch (error) {
        console.error("[Library] Failed to toggle favorite:", error);
      }
    },
    [serverUrl, favoritePlaylistIds, addToFavorites, removeFromFavorites]
  );

  const isShowingVideos = selectedPlaylist || selectedMyList;
  const currentVideos = selectedPlaylist
    ? playlistVideos
    : selectedMyList
      ? myListVideos
      : [];
  const currentTitle = selectedPlaylist
    ? selectedPlaylist.title
    : selectedMyList
      ? selectedMyList.name
      : "";

  if (isShowingVideos && (selectedPlaylist || selectedMyList)) {
    const saveTarget = selectedPlaylist
      ? {
          playlistId: `playlist_${selectedPlaylist.playlistId}`,
          playlistTitle: selectedPlaylist.title,
          playlistType: "playlist" as const,
          sourceId: selectedPlaylist.channelId,
          thumbnailUrl: selectedPlaylist.thumbnailUrl,
        }
      : selectedMyList
        ? {
            playlistId: `mylist_${selectedMyList.id}`,
            playlistTitle: selectedMyList.name,
            playlistType: "mylist" as const,
            sourceId: selectedMyList.id,
            thumbnailUrl: selectedMyList.thumbnailUrl,
          }
        : null;

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
    const isPlaylistSaveContext = Boolean(selectedPlaylist || selectedMyList);
    const isSaveActionDone =
      isPlaylistSaveContext && saveTarget
        ? isPlaylistSaved(saveTarget.playlistId)
        : savedCount === totalAvailable && totalAvailable > 0;

    const handleSavePlaylistOffline = () => {
      if (!saveTarget) return;
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
        bumpSavedPlaylistVersion((v) => v + 1);
      } catch (error) {
        Alert.alert("Save failed", "Could not save playlist. Please try again.");
        return;
      }
      if (!serverUrl) return;
      for (const video of availableVideos) {
        if (!hasOfflineCopy(video.id)) {
          downloadQueue.request(video);
        }
      }
    };

    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.videoHeader}>
          <Pressable style={styles.backButton} onPress={handleBackPress}>
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
          {currentVideos.length > 0 && serverUrl && (
            <Pressable
              style={[
                styles.saveOfflineButton,
                isSaveActionDone && styles.saveOfflineButtonDisabled,
              ]}
              onPress={handleSavePlaylistOffline}
              disabled={isSaveActionDone}
            >
              <Text style={styles.saveOfflineButtonText}>
                {isSaveActionDone ? "Saved" : "Save Playlist"}
              </Text>
            </Pressable>
          )}
        </View>

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

        {syncableCount > 0 && (
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.tabBar}>
        {LIBRARY_TABS.map((tab) => {
          const isActive = libraryTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setLibraryTab(tab.key)}
            >
              <Text
                style={[styles.tabText, isActive && styles.tabTextActive]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {libraryTab === "mylists" && (
        <MyListsList
          myLists={myLists}
          isLoading={isLoadingMyLists}
          error={myListsError}
          onMyListPress={handleMyListPress}
          onRefresh={handleRefreshMyLists}
        />
      )}

      {libraryTab === "playlists" && (
        <PlaylistList
          playlists={playlists}
          isLoading={isLoadingPlaylists}
          error={playlistsError}
          serverUrl={serverUrl ?? undefined}
          favoritePlaylistIds={favoritePlaylistIds}
          onPlaylistPress={handlePlaylistPress}
          onSavePress={handlePlaylistSavePress}
          onRefresh={handleRefreshPlaylists}
        />
      )}

      {libraryTab === "saved" && (
        <View style={styles.savedContent}>
          <SavedTabContent />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabText: {
    color: colors.mutedForeground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  tabTextActive: {
    color: colors.foreground,
  },
  savedContent: {
    flex: 1,
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
  saveOfflineButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    borderRadius: 8,
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
  emptyText: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  videoList: {
    paddingVertical: spacing.sm,
  },
});
