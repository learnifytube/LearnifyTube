import {
  useCallback,
  useEffect,
  useRef,
  useState } from "react";
import { useLocalSearchParams,
  useRouter } from "expo-router";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VideoGridCard } from "../../../components/VideoGridCard";
import { getSavedPlaylistWithItems } from "../../../db/repositories/playlists";
import type { SavedPlaylistWithItems } from "../../../db/repositories/playlists";
import { api } from "../../../services/api";
import { downloadManager } from "../../../services/downloadManager";
import { offlineCopy } from "../../../services/offline-copy";
import { useConnectionStore } from "../../../stores/connection";
import { useDownloadStore } from "../../../stores/downloads";
import { usePlaybackStore, type StreamingVideo } from "../../../stores/playback";

type SavedPlaylistItem = SavedPlaylistWithItems["items"][number];
type CardPendingState =
  | { type: "none" }
  | { type: "preparing"; label?: string }
  | { type: "downloading"; progress: number }
  | { type: "queued" }
  | { type: "failed"; error?: string };

const PREPARE_CANCELLED_MESSAGE = "Download cancelled";

export default function SavedPlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const getOfflineUri = offlineCopy.useLookup();
  const queueDownload = useDownloadStore((state) => state.queueDownload);
  const downloadQueue = useDownloadStore((state) => state.queue);
  const startPlaylist = usePlaybackStore((state) => state.startPlaylist);

  const [playlist, setPlaylist] = useState<SavedPlaylistWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparingVideoIds, setPreparingVideoIds] = useState<Set<string>>(new Set());

  const isMountedRef = useRef(true);
  const cancelledVideoIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const playlistParamId = Array.isArray(id) ? id[0] : id;

  useEffect(() => {
    if (!playlistParamId) {
      setPlaylist(null);
      setLoading(false);
      return;
    }

    const data = getSavedPlaylistWithItems(playlistParamId);
    setPlaylist(data ?? null);
    setLoading(false);
  }, [playlistParamId]);

  const setPreparingVideo = useCallback((videoId: string, isPreparing: boolean) => {
    setPreparingVideoIds((prev) => {
      const next = new Set(prev);
      if (isPreparing) {
        next.add(videoId);
      } else {
        next.delete(videoId);
      }
      return next;
    });
  }, []);

  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    []
  );

  const waitForServerDownload = useCallback(
    async (videoId: string, shouldAbort: () => boolean) => {
      if (!serverUrl) throw new Error("Not connected to server");
      const timeoutMs = 10 * 60 * 1000;
      const intervalMs = 2000;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (shouldAbort()) throw new Error(PREPARE_CANCELLED_MESSAGE);

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
    async (videoId: string, shouldAbort: () => boolean) => {
      const timeoutMs = 10 * 60 * 1000;
      const intervalMs = 1000;
      const start = Date.now();
      let wasQueued = false;

      while (Date.now() - start < timeoutMs) {
        if (offlineCopy.getUri(videoId) !== null) return;
        if (shouldAbort()) throw new Error(PREPARE_CANCELLED_MESSAGE);

        const item = useDownloadStore.getState().getDownload(videoId);
        if (item) {
          wasQueued = true;
          if (item.status === "failed") {
            throw new Error(item.error || "Mobile download failed");
          }
        } else if (wasQueued) {
          throw new Error(PREPARE_CANCELLED_MESSAGE);
        }

        await sleep(intervalMs);
      }

      throw new Error("Sync to mobile timed out");
    },
    [sleep]
  );

  const playSavedPlaylistVideo = useCallback(
    (item: SavedPlaylistItem) => {
      if (!playlist) return;

      if (!serverUrl && getOfflineUri(item.videoId) === null) {
        Alert.alert(
          "Offline mode",
          "Reconnect to desktop to stream or sync this video."
        );
        return;
      }

      const allPlaylistVideos: StreamingVideo[] = playlist.items.map((videoItem) => ({
        id: videoItem.videoId,
        title: videoItem.title,
        channelTitle: videoItem.channelTitle,
        duration: videoItem.duration,
        thumbnailUrl: videoItem.thumbnailUrl ?? undefined,
      }));

      const playableVideos = serverUrl
        ? allPlaylistVideos
        : allPlaylistVideos.filter((video) => getOfflineUri(video.id) !== null);

      const startIndex = playableVideos.findIndex((video) => video.id === item.videoId);
      if (startIndex < 0) {
        Alert.alert(
          "Offline mode",
          "This video is not downloaded on mobile yet."
        );
        return;
      }

      startPlaylist(
        `saved-${playlist.id}`,
        playlist.title,
        playableVideos,
        startIndex,
        serverUrl ?? undefined
      );
      router.push(`/player/${item.videoId}`);
    },
    [playlist, getOfflineUri, serverUrl, startPlaylist, router]
  );

  const handleVideoPress = useCallback(
    async (item: SavedPlaylistItem) => {
      const alreadyLocal = getOfflineUri(item.videoId) !== null;

      if (alreadyLocal) {
        playSavedPlaylistVideo(item);
        return;
      }

      if (!serverUrl) {
        Alert.alert(
          "Offline mode",
          "Reconnect to desktop to stream or sync this video."
        );
        return;
      }

      const existingDownload = useDownloadStore.getState().getDownload(item.videoId);
      if (
        existingDownload &&
        (existingDownload.status === "queued" || existingDownload.status === "downloading")
      ) {
        return;
      }

      if (preparingVideoIds.has(item.videoId)) return;

      cancelledVideoIdsRef.current.delete(item.videoId);
      setPreparingVideo(item.videoId, true);

      const shouldAbort = () =>
        !isMountedRef.current || cancelledVideoIdsRef.current.has(item.videoId);

      try {
        const response = await api.requestServerDownload(serverUrl, { videoId: item.videoId });
        if (!response.success && !response.status) {
          throw new Error(response.message || "Server refused download request");
        }

        await waitForServerDownload(item.videoId, shouldAbort);

        if (offlineCopy.getUri(item.videoId) === null) {
          queueDownload(item.videoId, {
            title: item.title,
            channelTitle: item.channelTitle,
            duration: item.duration,
            thumbnailUrl: item.thumbnailUrl ?? undefined,
          });

          await waitForLocalVideo(item.videoId, shouldAbort);
        }

        if (!shouldAbort()) {
          playSavedPlaylistVideo(item);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to prepare video";
        if (message === PREPARE_CANCELLED_MESSAGE) {
          return;
        }
        if (isMountedRef.current) {
          Alert.alert("Unable to play video", message);
        }
      } finally {
        cancelledVideoIdsRef.current.delete(item.videoId);
        if (isMountedRef.current) {
          setPreparingVideo(item.videoId, false);
        }
      }
    },
    [
      getOfflineUri,
      playSavedPlaylistVideo,
      preparingVideoIds,
      queueDownload,
      serverUrl,
      setPreparingVideo,
      waitForLocalVideo,
      waitForServerDownload,
    ]
  );

  const handleCancelVideo = useCallback(
    (videoId: string) => {
      cancelledVideoIdsRef.current.add(videoId);
      setPreparingVideo(videoId, false);
      downloadManager.cancel(videoId);
    },
    [setPreparingVideo]
  );

  const getPendingState = useCallback(
    (videoId: string): CardPendingState => {
      if (preparingVideoIds.has(videoId)) {
        return { type: "preparing", label: "Preparing..." };
      }

      const item = downloadQueue.find((download) => download.videoId === videoId);
      if (!item) return { type: "none" };

      if (item.status === "queued") return { type: "queued" };
      if (item.status === "downloading") {
        return { type: "downloading", progress: item.progress };
      }
      if (item.status === "failed") return { type: "failed", error: item.error };

      return { type: "none" };
    },
    [downloadQueue, preparingVideoIds]
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      </SafeAreaView>
    );
  }

  if (!playlist) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Playlist not found</Text>
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const downloadedCount = playlist.items.filter(
    (item) => getOfflineUri(item.videoId) !== null
  ).length;
  const totalCount = playlist.items.length;
  const downloadPercent = totalCount > 0 ? (downloadedCount / totalCount) * 100 : 0;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerBackButton}
          onPress={() => router.back()}
        >
          <Text style={styles.headerBackIcon}>←</Text>
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {playlist.title}
          </Text>
          <Text style={styles.headerSubtitle}>
            {downloadedCount}/{totalCount} available offline
          </Text>
        </View>
      </View>

      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${downloadPercent}%` },
            ]}
          />
        </View>
      </View>

      <FlatList
        data={playlist.items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridList}
        renderItem={({ item, index }) => {
          const pendingState = getPendingState(item.videoId);
          const canCancel =
            pendingState.type === "preparing" ||
            pendingState.type === "queued" ||
            pendingState.type === "downloading";

          return (
            <VideoGridCard
              video={{
                id: item.videoId,
                title: item.title,
                channelTitle: item.channelTitle,
                duration: item.duration,
                thumbnailUrl: item.thumbnailUrl ?? undefined,
              }}
              pending={pendingState}
              onPress={() => {
                void handleVideoPress(item);
              }}
              onCancelPress={
                canCancel ? () => handleCancelVideo(item.videoId) : undefined
              }
            />
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090b",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  errorText: {
    color: "#fafafa",
    fontSize: 18,
    marginBottom: 16,
  },
  backButton: {
    backgroundColor: "#27272a",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backButtonText: {
    color: "#fafafa",
    fontSize: 14,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#27272a",
  },
  headerBackButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#27272a",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  headerBackIcon: {
    color: "#fafafa",
    fontSize: 18,
  },
  headerInfo: {
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
  progressContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
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
  gridList: {
    padding: 12,
    paddingBottom: 24,
  },
  gridRow: {
    justifyContent: "space-between",
  },
});
