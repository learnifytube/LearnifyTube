import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  BackHandler,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useConnectionStore } from "../../../stores/connection";
import { useOnDeviceSetStore } from "../../../stores/onDeviceSet";
import { api } from "../../../services/api";
import { playQueue } from "../../../services/play-queue";
import { prefetchPhoneCatalog } from "../../../services/prefetchPhoneCatalog";
import { resolveRemoteAssetUrl } from "../../../services/browseCache";
import { useBrowseCatalog } from "../../../core/hooks/useBrowseCatalog";
import { VideoGridCard } from "../../../components/VideoGridCard";
import {
  buildPhoneHome,
  type PhoneHomeRow,
} from "../../../components/phone/phoneCatalog";
import { videoThumbnails } from "../../../services/video-thumbnails";
import { offlineCopy } from "../../../services/offline-copy";
import * as watchHistoryRepo from "../../../db/repositories/watchHistory";
import { colors, spacing, fontSize, fontWeight } from "../../../theme";
import { ArrowLeft, Smartphone } from "../../../theme/icons";
import type { StreamingVideo } from "../../../stores/playback";
import type { RemoteVideoWithStatus } from "../../../types";

const POSTER_WIDTH = 168;

// Ask the desktop with the current Pairing code; a stored URL may carry an old one.
function thumbnailFor(video: RemoteVideoWithStatus, serverUrl: string | null) {
  const stored = video.thumbnailUrl;
  if (serverUrl && !stored?.startsWith("data:")) {
    return api.getThumbnailUrl(serverUrl, video.id);
  }
  return resolveRemoteAssetUrl(serverUrl, stored) ?? undefined;
}

function toStreaming(
  videos: RemoteVideoWithStatus[],
  serverUrl: string | null,
): StreamingVideo[] {
  return videos.map((video) => ({
    id: video.id,
    title: video.title,
    channelTitle: video.channelTitle,
    duration: video.duration,
    thumbnailUrl: thumbnailFor(video, serverUrl),
  }));
}

function readContinueWatching() {
  return watchHistoryRepo.getWatchHistory(20).map((item) => ({
    id: item.videoId,
    title: item.title,
    channelTitle: item.channelTitle,
    duration: item.duration,
    thumbnailUrl: item.thumbnailUrl ?? undefined,
    lastPositionSeconds: item.lastPositionSeconds,
    lastWatchedAt: item.lastWatchedAt,
  }));
}

type ContinueWatchingItem = ReturnType<typeof readContinueWatching>[number];

// Every progress save moves lastWatchedAt, so id + lastWatchedAt spots any change.
function sameHistory(a: ContinueWatchingItem[], b: ContinueWatchingItem[]) {
  return (
    a.length === b.length &&
    a.every(
      (item, i) =>
        item.id === b[i].id && item.lastWatchedAt === b[i].lastWatchedAt,
    )
  );
}

function playRow(row: PhoneHomeRow, startIndex: number) {
  const video = playQueue.start({
    id: row.id,
    title: row.title,
    videos: row.videos,
    startIndex,
  });
  if (!video) return;
  router.push(`/player/${video.id}`);
}

export default function HomeScreen() {
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const savedUrl = useConnectionStore((state) => state.savedUrl);
  const connected = !!serverUrl;
  const { channels, playlists, myLists, getCollectionVideos } =
    useBrowseCatalog();
  const onDeviceSet = useOnDeviceSetStore((state) => state.videos);
  const getOfflineUri = offlineCopy.useLookup();
  const getStoredThumbnail = videoThumbnails.useLookup();
  const [openRow, setOpenRow] = useState<PhoneHomeRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [continueWatching, setContinueWatching] =
    useState(readContinueWatching);

  // Home stays mounted behind the other tabs and the player, so it rereads
  // Continue watching on focus. Keep the old array when nothing changed:
  // a new one rebuilds every row and stalls the JS thread on each tab switch.
  useFocusEffect(
    useCallback(() => {
      const next = readContinueWatching();
      setContinueWatching((current) =>
        sameHistory(current, next) ? current : next,
      );
    }, []),
  );

  // The See-all grid is local state, so hardware Back would otherwise exit the app.
  // Scoped to focus so Back from the player still closes the player.
  useFocusEffect(
    useCallback(() => {
      if (!openRow) return;
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          setOpenRow(null);
          return true;
        },
      );
      return () => subscription.remove();
    }, [openRow]),
  );

  useEffect(() => {
    if (!serverUrl) return;
    let cancelled = false;
    setLoading(true);
    prefetchPhoneCatalog(serverUrl).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  const rows = useMemo(
    () =>
      buildPhoneHome({
        connected,
        hasOfflineCopy: (videoId) => getOfflineUri(videoId) !== null,
        getStoredThumbnail,
        resolveAssetUrl: (assetUrl) =>
          resolveRemoteAssetUrl(serverUrl, assetUrl),
        continueWatching,
        onDeviceSet,
        channels: channels.map((channel) => ({
          channel,
          videos: toStreaming(
            getCollectionVideos("channel", channel.channelId),
            serverUrl,
          ),
        })),
        lists: myLists.map((list) => ({
          list,
          videos: toStreaming(
            getCollectionVideos("mylist", list.id),
            serverUrl,
          ),
        })),
        playlists: playlists.map((playlist) => ({
          playlist,
          videos: toStreaming(
            getCollectionVideos("playlist", playlist.playlistId),
            serverUrl,
          ),
        })),
      }),
    [
      connected,
      getOfflineUri,
      getStoredThumbnail,
      serverUrl,
      continueWatching,
      onDeviceSet,
      channels,
      myLists,
      playlists,
      getCollectionVideos,
    ],
  );

  const empty = rows.length === 0;
  const needsPairing = empty && !connected && !savedUrl;

  if (openRow) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Pressable
            testID="row-grid-back"
            style={styles.backButton}
            onPress={() => setOpenRow(null)}
            accessibilityLabel="Back"
          >
            <ArrowLeft size={20} color={colors.foreground} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {openRow.title}
          </Text>
        </View>
        <FlatList
          data={openRow.videos}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          renderItem={({ item, index }) => (
            <View style={styles.gridItem}>
              <VideoGridCard
                video={item}
                onPress={() => playRow(openRow, index)}
              />
            </View>
          )}
        />
      </SafeAreaView>
    );
  }

  if (needsPairing) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.emptyState}>
          <Smartphone size={64} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>LearnifyTube</Text>
          <Text style={styles.emptyText}>
            Pair with your desktop to browse the videos you love
          </Text>
          <Pressable
            testID="open-connect"
            style={styles.connectButton}
            onPress={() => router.push("/(mobile)/connect")}
          >
            <Text style={styles.connectButtonText}>Pair with desktop</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Rows and their posters are virtualized: a collection can hold hundreds of
  // Videos, and mounting every poster at once stalls the UI thread.
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={styles.scroll}
        initialNumToRender={3}
        windowSize={5}
        ListHeaderComponent={
          <>
            <Text style={styles.screenTitle}>Home</Text>
            {loading && rows.length === 0 ? (
              <ActivityIndicator
                color={colors.primary}
                style={styles.spinner}
              />
            ) : null}
            {empty && !loading ? (
              <Text style={styles.emptyText}>
                Nothing to play on this phone yet. Open a video while the
                desktop is connected and it stays here.
              </Text>
            ) : null}
          </>
        }
        renderItem={({ item: row }) => (
          <View style={styles.rowBlock}>
            <Pressable
              testID={`row-see-all-${row.id}`}
              onPress={() => setOpenRow(row)}
              style={styles.rowHeader}
            >
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowMore}>See all</Text>
            </Pressable>
            <FlatList
              horizontal
              data={row.videos}
              keyExtractor={(video) => video.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowScroll}
              initialNumToRender={3}
              maxToRenderPerBatch={4}
              windowSize={3}
              renderItem={({ item: video, index }) => (
                <View style={styles.poster}>
                  <VideoGridCard
                    video={video}
                    onPress={() => playRow(row, index)}
                  />
                </View>
              )}
            />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: spacing.xl },
  screenTitle: {
    color: colors.foreground,
    fontSize: fontSize["2xl"],
    fontWeight: fontWeight.bold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  spinner: { marginTop: spacing.lg },
  rowBlock: { marginBottom: spacing.lg },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    flex: 1,
    marginRight: spacing.sm,
  },
  rowMore: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  rowScroll: { paddingHorizontal: spacing.sm },
  poster: { width: POSTER_WIDTH },
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
  grid: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xl },
  gridItem: { width: "50%" },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: fontSize["2xl"],
    fontWeight: fontWeight.bold,
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.base,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: spacing.md,
  },
  connectButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    borderRadius: 12,
    marginTop: spacing.sm,
  },
  connectButtonText: {
    color: colors.primaryForeground,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
