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
import {
  playQueue,
  playableVideos,
  type ListVideo,
} from "../../services/play-queue";
import { deviceMirror } from "../../services/device-mirror";
import {
  collectionQueueId,
  loadRemoteCollection,
} from "../../services/remote-collection";
import {
  cacheRemoteCollectionVideos,
  getCachedCollectionVideos,
  resolveRemoteAssetUrl,
} from "../../services/browseCache";
import { markBrowseCacheChanged, useSyncStore } from "../../stores/sync";
import {
  currentVideoOf,
  useCurrentVideosStore,
} from "../../stores/currentVideos";
import { videoThumbnails } from "../../services/video-thumbnails";
import { offlineCopy } from "../../services/offline-copy";
import { VideoGridCard } from "../../components/VideoGridCard";
import { colors, spacing, fontSize, fontWeight, radius } from "../../theme";
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

  const screenKey = collectionQueueId(kind, id);
  // The List or YouTube playlist this screen shows, once a desktop that
  // knows Current Videos said so (null for a Channel or an older desktop).
  const collection = useCurrentVideosStore(
    (state) => state.collections[screenKey] ?? null,
  );
  const currentVideoId = useCurrentVideosStore((state) =>
    collection
      ? (currentVideoOf(state.currentVideos, collection)?.videoId ?? null)
      : null,
  );

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
      } else if (kind === "playlist" || kind === "mylist") {
        remoteVideos = (await loadRemoteCollection(serverUrl, kind, id)).videos;
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

  // Another Device or the desktop moved a Current Video: load the List again,
  // so Resume follows it.
  useEffect(() => {
    if (kind !== "playlist" && kind !== "mylist") return;
    return deviceMirror.onCurrentVideosChanged(() => void fetchCollection());
  }, [kind, fetchCollection]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchCollection();
    } finally {
      setRefreshing(false);
    }
  }, [fetchCollection]);

  // The whole collection in order; in Offline mode a Video with no Offline
  // copy can't play, so the grid and queues leave it out.
  const listVideos: ListVideo[] = videos.map((video) => ({
    id: video.id,
    title: video.title,
    channelTitle: video.channelTitle,
    duration: video.duration,
    thumbnailUrl:
      getStoredThumbnail(video.id) ??
      (serverUrl && !video.thumbnailUrl?.startsWith("data:")
        ? api.getThumbnailUrl(serverUrl, video.id)
        : (resolveRemoteAssetUrl(serverUrl, video.thumbnailUrl) ?? undefined)),
    unavailable: !connected && getOfflineUri(video.id) === null,
  }));
  const streamingVideos = playableVideos(listVideos);

  const queue = {
    id: screenKey,
    title: title ?? "Collection",
    videos: streamingVideos,
    collection,
  };

  const open = (video: StreamingVideo | null) => {
    if (video) router.push(`/player/${video.id}`);
  };

  const playAt = (startIndex: number) =>
    open(playQueue.start({ ...queue, startIndex }));

  const resumeVideo = collection
    ? playQueue.whereResumes({
        videos: listVideos,
        collection,
        currentVideoId,
      })
    : null;

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

      {collection && resumeVideo ? (
        <View style={styles.actions}>
          <Pressable
            testID="collection-resume"
            style={[styles.action, styles.resumeAction]}
            onPress={() =>
              open(
                playQueue.resume({ ...queue, videos: listVideos, collection }),
              )
            }
          >
            <Text style={styles.resumeText} numberOfLines={1}>
              Resume · {resumeVideo.title}
            </Text>
          </Pressable>
          <Pressable
            testID="collection-play-from-start"
            style={styles.action}
            onPress={() => playAt(0)}
          >
            <Text style={styles.actionText}>Play from start</Text>
          </Pressable>
        </View>
      ) : null}

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
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  action: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
    justifyContent: "center",
  },
  resumeAction: { flex: 1, backgroundColor: colors.primary },
  resumeText: {
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  actionText: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
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
