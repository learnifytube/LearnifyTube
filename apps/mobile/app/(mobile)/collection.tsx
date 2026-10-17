import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useConnectionStore } from "../../stores/connection";
import { api } from "../../services/api";
import { playQueue } from "../../services/play-queue";
import {
  cacheRemoteCollectionVideos,
  getCachedCollectionVideos,
  resolveRemoteAssetUrl,
} from "../../services/browseCache";
import { markBrowseCacheChanged, useSyncStore } from "../../stores/sync";
import { videoThumbnails } from "../../services/video-thumbnails";
import { offlineCopy } from "../../services/offline-copy";
import { VideoGridCard } from "../../components/VideoGridCard";
import { colors, spacing, fontSize, fontWeight } from "../../theme";
import { ArrowLeft } from "../../theme/icons";
import type { RemoteVideoWithStatus } from "../../types";
import type { StreamingVideo } from "../../stores/playback";
import type { BrowseCachePlaylistKind } from "../../db/repositories/playlists";

export default function CollectionScreen() {
  const { kind, id, title } = useLocalSearchParams<{
    kind: BrowseCachePlaylistKind;
    id: string;
    title?: string;
  }>();

  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const connected = !!serverUrl;
  const browseCacheVersion = useSyncStore((state) => state.browseCacheVersion);
  const getOfflineUri = offlineCopy.useLookup();
  const getStoredThumbnail = videoThumbnails.useLookup();

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const cachedVideos = useMemo(() => {
    if (!kind || !id) return [];
    return getCachedCollectionVideos(kind, id);
  }, [kind, id, browseCacheVersion]);

  const [videos, setVideos] = useState<RemoteVideoWithStatus[]>(cachedVideos);

  useEffect(() => {
    setVideos(cachedVideos);
  }, [cachedVideos]);

  const fetchCollection = useCallback(async () => {
    if (!serverUrl || !kind || !id) return;
    try {
      let remoteVideos: RemoteVideoWithStatus[] = [];
      if (kind === "channel") {
        const res = await api.getChannelVideos(serverUrl, id);
        remoteVideos = res.videos;
      } else if (kind === "playlist") {
        const res = await api.getPlaylistVideos(serverUrl, id);
        remoteVideos = res.videos;
      } else if (kind === "mylist") {
        const res = await api.getMyListVideos(serverUrl, id);
        remoteVideos = res.videos;
      }

      await cacheRemoteCollectionVideos(serverUrl, {
        kind,
        id,
        title: title ?? id,
        videos: remoteVideos,
      });
      markBrowseCacheChanged();
    } catch (err) {
      console.warn(`[CollectionScreen] Failed to fetch ${kind} ${id}:`, err);
    }
  }, [serverUrl, kind, id, title]);

  useEffect(() => {
    if (!serverUrl || !kind || !id) return;
    let cancelled = false;
    if (cachedVideos.length === 0) {
      setLoading(true);
    }
    fetchCollection().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serverUrl, kind, id, fetchCollection, cachedVideos.length]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchCollection();
    } finally {
      setRefreshing(false);
    }
  }, [fetchCollection]);

  const streamingVideos: StreamingVideo[] = useMemo(() => {
    return videos
      .filter((video) => connected || getOfflineUri(video.id) !== null)
      .map((video) => ({
        id: video.id,
        title: video.title,
        channelTitle: video.channelTitle,
        duration: video.duration,
        thumbnailUrl:
          getStoredThumbnail(video.id) ??
          (serverUrl && !video.thumbnailUrl?.startsWith("data:")
            ? api.getThumbnailUrl(serverUrl, video.id)
            : resolveRemoteAssetUrl(serverUrl, video.thumbnailUrl) ?? undefined),
      }));
  }, [videos, connected, getOfflineUri, getStoredThumbnail, serverUrl]);

  const playAt = (startIndex: number) => {
    const video = playQueue.start({
      id: `${kind}-${id}`,
      title: title ?? "Collection",
      videos: streamingVideos,
      startIndex,
    });
    if (!video) return;
    router.push(`/player/${video.id}`);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="collection-back"
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityLabel="Back"
        >
          <ArrowLeft size={20} color={colors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title ?? id}
        </Text>
      </View>

      {loading && streamingVideos.length === 0 ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}

      <FlatList
        data={streamingVideos}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No videos available</Text>
              <Text style={styles.emptyText}>
                {connected
                  ? "This collection does not contain any videos yet."
                  : "Connect to your desktop app to stream videos from this collection."}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <View style={styles.gridItem}>
            <VideoGridCard video={item} onPress={() => playAt(index)} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    flex: 1,
  },
  loaderWrap: {
    paddingTop: spacing.xl,
    alignItems: "center",
  },
  grid: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xl,
  },
  gridItem: { width: "50%" },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing["2xl"],
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    textAlign: "center",
    lineHeight: 20,
  },
});
