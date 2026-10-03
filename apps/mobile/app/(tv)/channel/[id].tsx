import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  DeviceEventEmitter,
  FlatList,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  colors,
  fontWeight,
  radius,
  spacing,
  tvFontSize,
  tvRestingBorder,
} from "../../../theme";
import { useConnectionStore } from "../../../stores/connection";
import { api } from "../../../services/api";
import { playQueue } from "../../../services/play-queue";
import {
  cacheRemoteCollectionVideos,
  cacheRemotePlaylists,
  resolveRemoteAssetUrl,
} from "../../../services/browseCache";
import {
  buildCachedPlaylistId,
  getAllSavedPlaylistsWithProgress,
  getSavedPlaylistWithItems,
} from "../../../db/repositories/playlists";
import { TVCard } from "../../../components/tv/TVCard";
import {
  TVFocusPressable,
  type TVFocusPressableHandle,
} from "../../../components/tv/TVFocusPressable";
import {
  TV_GRID_GAP,
  TV_GRID_SIDE_PADDING,
  getLastPageOffset,
  getTVGridCardHeight,
  getTVGridCardWidth,
  getTVGridColumns,
  getTVGridPageSize,
  isLeftEdgeGridIndex,
  isRightEdgeGridIndex,
  turnGridPage,
} from "../../../components/tv/grid";
import { useLibraryCatalog } from "../../../core/hooks/useLibraryCatalog";
import { offlineCopy } from "../../../services/offline-copy";
import { videoThumbnails } from "../../../services/video-thumbnails";
import {
  useTVBackInterceptor,
  goBackOrTVHome,
} from "../../../components/tv/tvBack";
import { useTVMessage } from "../../../components/tv/TVMessage";
import {
  channelNotFound,
  collectionNotReady,
  describeDesktopRequestFailure,
  type TVMessageContent,
} from "../../../components/tv/tvMessages";
import {
  buildTVChannelView,
  heldChannelContents,
  heldPlaylistVideos,
  type TVChannelCard,
  type TVChannelContents,
  type TVOpenPlaylist,
} from "../../../components/tv/tvChannel";

export default function TVChannelDetailScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const channelId = Array.isArray(id) ? id[0] : id;
  const channelTitle =
    (Array.isArray(title) ? title[0] : title) ?? channelId ?? "";
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const { videos, getOfflineUri } = useLibraryCatalog();
  const getStoredThumbnail = videoThumbnails.useLookup();

  const [contents, setContents] = useState<TVChannelContents>({
    from: "held",
    playlists: [],
    videos: [],
  });
  const [openedPlaylist, setOpenedPlaylist] = useState<TVOpenPlaylist | null>(
    null,
  );
  const [pageOffset, setPageOffset] = useState(0);
  const [focusedGridIndex, setFocusedGridIndex] = useState(0);
  const [isGridFocused, setIsGridFocused] = useState(false);
  const [cardNodeHandles, setCardNodeHandles] = useState<
    Array<number | undefined>
  >([]);
  const cardRefs = useRef<Array<TVFocusPressableHandle | null>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<TVMessageContent | null>(null);
  const {
    show: showTVMessage,
    isOpen: isTVMessageOpen,
    element: tvMessageElement,
  } = useTVMessage();
  const [isResolvingPlaylist, setIsResolvingPlaylist] = useState(false);
  const gridColumns = useMemo(
    () => getTVGridColumns(windowWidth),
    [windowWidth],
  );
  const pageSize = useMemo(() => getTVGridPageSize(gridColumns), [gridColumns]);
  const gridCardWidth = useMemo(
    () => getTVGridCardWidth(windowWidth, gridColumns),
    [gridColumns, windowWidth],
  );
  const gridCardHeight = useMemo(
    () => getTVGridCardHeight(gridCardWidth),
    [gridCardWidth],
  );
  const gridCardStyle = useMemo(
    () => ({ width: gridCardWidth, height: gridCardHeight }),
    [gridCardHeight, gridCardWidth],
  );

  const resetGrid = () => {
    setPageOffset(0);
    setFocusedGridIndex(0);
  };

  const loadChannelData = useCallback(async () => {
    if (!channelId && !channelTitle) {
      setError(channelNotFound);
      setIsLoading(false);
      return;
    }

    setError(null);
    setOpenedPlaylist(null);
    setIsResolvingPlaylist(false);
    setPageOffset(0);
    setFocusedGridIndex(0);
    const held = heldChannelContents({
      channel: { id: channelId, title: channelTitle },
      saved: getAllSavedPlaylistsWithProgress({ includeUnpinned: true }),
      getSavedPlaylist: (playlistId) =>
        getSavedPlaylistWithItems(playlistId, { includeUnpinned: true }),
      library: videos,
      // Not the reactive lookup: an Offline copy appearing elsewhere must not
      // re-fetch the channel and drop the viewer out of an open playlist.
      hasOfflineCopy: (videoId) => offlineCopy.getUri(videoId) !== null,
    });
    const holdsSomething = held.playlists.length > 0 || held.videos.length > 0;
    // Show what the TV holds until the desktop answers; it stays if the desktop doesn't.
    setContents(held);

    if (!serverUrl) {
      setIsLoading(false);
      return;
    }

    setIsLoading(!holdsSomething);
    try {
      const [playlistsResult, channelVideosResult] = await Promise.allSettled([
        api.getPlaylists(serverUrl),
        api.getChannelVideos(serverUrl, channelId),
      ]);

      if (
        playlistsResult.status === "rejected" &&
        channelVideosResult.status === "rejected"
      ) {
        if (!holdsSomething && !held.known) {
          setError(describeDesktopRequestFailure(playlistsResult.reason));
        }
        return;
      }

      const nextPlaylists =
        playlistsResult.status === "fulfilled"
          ? (
              await cacheRemotePlaylists(
                serverUrl,
                playlistsResult.value.playlists,
              )
            ).filter((item) => item.channelId === channelId)
          : held.playlists;
      const nextVideos =
        channelVideosResult.status === "fulfilled"
          ? await cacheRemoteCollectionVideos(serverUrl, {
              kind: "channel",
              id: channelId ?? channelTitle,
              title: channelTitle,
              sourceId: channelId ?? channelTitle,
              itemCount: channelVideosResult.value.videos.length,
              videos: channelVideosResult.value.videos,
            })
          : held.videos;
      setContents({
        from: "desktop",
        playlists: nextPlaylists,
        videos: nextVideos,
      });
      setPageOffset(0);
      setFocusedGridIndex(0);
    } catch (nextError) {
      if (!holdsSomething && !held.known) {
        setError(describeDesktopRequestFailure(nextError));
      }
    } finally {
      setIsLoading(false);
    }
  }, [channelId, channelTitle, serverUrl, videos]);

  useEffect(() => {
    void loadChannelData();
  }, [loadChannelData]);

  const showPlaylist = (playlist: TVOpenPlaylist) => {
    setOpenedPlaylist(playlist);
    resetGrid();
    setIsGridFocused(true);
    setError(null);
  };

  const openCachedPlaylist = (playlistId: string, playlistTitle: string) => {
    const savedPlaylist = getSavedPlaylistWithItems(
      buildCachedPlaylistId("playlist", playlistId),
      { includeUnpinned: true },
    );
    const heldVideos = savedPlaylist
      ? heldPlaylistVideos(
          savedPlaylist,
          (videoId) => getOfflineUri(videoId) !== null,
        )
      : [];
    if (heldVideos.length === 0) return false;

    showPlaylist({
      id: playlistId,
      title: playlistTitle,
      from: "held",
      videos: heldVideos,
    });
    return true;
  };

  const openPlaylist = async (playlistId: string, playlistTitle: string) => {
    if (!serverUrl || contents.from === "held") {
      openCachedPlaylist(playlistId, playlistTitle);
      return;
    }

    setIsResolvingPlaylist(true);
    try {
      const response = await api.getPlaylistVideos(serverUrl, playlistId);
      const playlistMeta = contents.playlists.find(
        (item) => item.playlistId === playlistId,
      );
      const playlistVideos = await cacheRemoteCollectionVideos(serverUrl, {
        kind: "playlist",
        id: playlistId,
        title: playlistTitle,
        sourceId: playlistMeta?.channelId ?? channelId ?? null,
        thumbnailUrl: playlistMeta?.thumbnailUrl,
        thumbnailFallbackUrl: api.getPlaylistThumbnailUrl(
          serverUrl,
          playlistId,
        ),
        itemCount: playlistMeta?.itemCount,
        videos: response.videos,
      });
      showPlaylist({
        id: playlistId,
        title: playlistTitle,
        from: "desktop",
        videos: playlistVideos,
      });
    } catch {
      // The desktop may still be fetching this playlist; only the connection's health
      // check decides whether it is gone.
      if (openCachedPlaylist(playlistId, playlistTitle)) return;
      showTVMessage(collectionNotReady);
    } finally {
      setIsResolvingPlaylist(false);
    }
  };

  const pressCard = ({ action }: TVChannelCard) => {
    if (action.kind === "openPlaylist") {
      void openPlaylist(action.playlistId, action.title);
      return;
    }
    const first = playQueue.start(action.queue);
    if (first) router.push(`/(tv)/player/${first.id}` as Href);
  };

  const closePlaylist = useCallback(() => {
    if (!openedPlaylist) return false;

    setOpenedPlaylist(null);
    setPageOffset(0);
    setFocusedGridIndex(0);
    setIsGridFocused(true);
    setIsResolvingPlaylist(false);
    return true;
  }, [openedPlaylist]);

  const handleBack = () => {
    if (!closePlaylist()) goBackOrTVHome();
  };

  useTVBackInterceptor(closePlaylist);

  // Memoized: the focus-graph effects below key off the page's card identity.
  const view = useMemo(
    () =>
      buildTVChannelView({
        channel: { id: channelId, title: channelTitle },
        contents,
        open: openedPlaylist,
        desktop: serverUrl
          ? {
              url: serverUrl,
              resolveAssetUrl: (assetUrl) =>
                resolveRemoteAssetUrl(serverUrl, assetUrl),
              playlistThumbnailUrl: (playlistId) =>
                api.getPlaylistThumbnailUrl(serverUrl, playlistId),
              videoThumbnailUrl: (videoId) =>
                api.getThumbnailUrl(serverUrl, videoId),
            }
          : null,
        hasOfflineCopy: (videoId) => getOfflineUri(videoId) !== null,
        getStoredThumbnail,
      }),
    [
      channelId,
      channelTitle,
      contents,
      getOfflineUri,
      getStoredThumbnail,
      openedPlaylist,
      serverUrl,
    ],
  );
  const cards = view.cards;
  const gridKey = openedPlaylist ? `playlist-${openedPlaylist.id}` : "channel";

  const clampedOffset = Math.min(
    Math.floor(pageOffset / pageSize) * pageSize,
    getLastPageOffset(cards.length, pageSize),
  );
  const pageItems = useMemo(
    () => cards.slice(clampedOffset, clampedOffset + pageSize),
    [cards, clampedOffset, pageSize],
  );

  useEffect(() => {
    setCardNodeHandles([]);
    cardRefs.current = [];
  }, [clampedOffset, gridKey, pageItems.length]);

  useEffect(() => {
    setCardNodeHandles(
      pageItems.map((_, index) => {
        const node = cardRefs.current[index];
        return node ? (findNodeHandle(node) ?? undefined) : undefined;
      }),
    );
  }, [pageItems]);

  useEffect(() => {
    if (pageOffset !== clampedOffset) {
      setPageOffset(clampedOffset);
    }
  }, [clampedOffset, pageOffset]);

  useEffect(() => {
    if (pageItems.length === 0) {
      if (focusedGridIndex !== 0) {
        setFocusedGridIndex(0);
      }
      return;
    }

    if (focusedGridIndex > pageItems.length - 1) {
      setFocusedGridIndex(pageItems.length - 1);
    }
  }, [focusedGridIndex, pageItems.length]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "onHWKeyEvent",
      (event: { eventType?: string; eventKeyAction?: number }) => {
        if (!isGridFocused || isTVMessageOpen) return;
        if (!pageItems.length) return;
        if (
          typeof event.eventKeyAction === "number" &&
          event.eventKeyAction !== 0
        ) {
          return;
        }

        if (event.eventType !== "left" && event.eventType !== "right") return;
        const turn = turnGridPage({
          direction: event.eventType,
          focusedIndex: focusedGridIndex,
          pageOffset: clampedOffset,
          itemCount: cards.length,
          columns: gridColumns,
          pageSize,
        });
        if (!turn) return;
        setPageOffset(turn.pageOffset);
        setFocusedGridIndex(turn.focusedIndex);
      },
    );

    return () => {
      subscription.remove();
    };
  }, [
    cards.length,
    clampedOffset,
    focusedGridIndex,
    gridColumns,
    isGridFocused,
    pageItems.length,
    pageSize,
    isTVMessageOpen,
  ]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <TVFocusPressable
          style={styles.backButton}
          hasTVPreferredFocus
          onFocus={() => setIsGridFocused(false)}
          onPress={handleBack}
        >
          <Text style={styles.backButtonText}>Back</Text>
        </TVFocusPressable>

        <TVFocusPressable
          style={styles.settingsButton}
          onFocus={() => setIsGridFocused(false)}
          onPress={() => router.push("/(tv)/settings" as Href)}
        >
          <Text style={styles.settingsButtonText}>Settings</Text>
        </TVFocusPressable>
      </View>

      {isLoading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}

      {!isLoading && isResolvingPlaylist ? (
        <View style={styles.selectionLoader}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}

      {!isLoading && error ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{error.title}</Text>
          <Text style={styles.errorText}>{error.text}</Text>
          {error.canRetry ? (
            <TVFocusPressable
              style={styles.retryButton}
              onPress={() => void loadChannelData()}
              hasTVPreferredFocus
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TVFocusPressable>
          ) : null}
        </View>
      ) : null}

      {!isLoading && !error && cards.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{view.emptyText}</Text>
        </View>
      ) : null}

      {!isLoading && !error && cards.length > 0 ? (
        <FlatList
          data={pageItems}
          key={`${gridKey}-${clampedOffset}`}
          keyExtractor={(item) => `${item.action.kind}-${item.id}`}
          numColumns={gridColumns}
          scrollEnabled={false}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={({ item, index }) => {
            const isLeftEdge = isLeftEdgeGridIndex(index, gridColumns);
            const isRightEdge = isRightEdgeGridIndex(
              index,
              gridColumns,
              pageItems.length,
            );
            const rightTargetIndex = isRightEdge ? index : index + 1;
            const leftTargetIndex = isLeftEdge ? index : index - 1;
            const upTargetIndex =
              index >= gridColumns ? index - gridColumns : undefined;
            const downCandidateIndex = index + gridColumns;
            const downTargetIndex =
              downCandidateIndex < pageItems.length
                ? downCandidateIndex
                : index;

            return (
              <TVCard
                title={item.title}
                subtitle={item.subtitle}
                thumbnailUrl={item.thumbnailUrl}
                hasTVPreferredFocus={index === focusedGridIndex}
                onFocus={() => {
                  setIsGridFocused(true);
                  setFocusedGridIndex(index);
                }}
                onPress={() => pressCard(item)}
                pressableRef={(node) => {
                  cardRefs.current[index] = node;
                }}
                nextFocusLeft={cardNodeHandles[leftTargetIndex]}
                nextFocusRight={cardNodeHandles[rightTargetIndex]}
                nextFocusUp={
                  upTargetIndex === undefined
                    ? undefined
                    : cardNodeHandles[upTargetIndex]
                }
                nextFocusDown={cardNodeHandles[downTargetIndex]}
                style={gridCardStyle}
              />
            );
          }}
        />
      ) : null}
      {tvMessageElement}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: TV_GRID_SIDE_PADDING,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  backButton: {
    borderRadius: radius.full,
    backgroundColor: colors.card,
    ...tvRestingBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backButtonText: {
    color: colors.foreground,
    fontSize: tvFontSize.label,
    fontWeight: fontWeight.semibold,
  },
  settingsButton: {
    borderRadius: radius.full,
    backgroundColor: colors.card,
    ...tvRestingBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  settingsButtonText: {
    color: colors.foreground,
    fontSize: tvFontSize.label,
    fontWeight: fontWeight.semibold,
  },
  loaderWrap: {
    marginTop: spacing["2xl"],
    alignItems: "center",
  },
  selectionLoader: {
    position: "absolute",
    top: 96,
    right: TV_GRID_SIDE_PADDING,
    zIndex: 20,
  },
  emptyState: {
    marginTop: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  emptyText: {
    color: colors.foreground,
    fontSize: tvFontSize.title,
    fontWeight: fontWeight.bold,
  },
  errorText: {
    color: colors.destructive,
    fontSize: tvFontSize.body,
  },
  retryButton: {
    marginTop: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    ...tvRestingBorder,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryButtonText: {
    color: colors.primaryForeground,
    fontSize: tvFontSize.label,
    fontWeight: fontWeight.bold,
  },
  grid: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  row: {
    justifyContent: "flex-start",
    gap: TV_GRID_GAP,
    marginBottom: TV_GRID_GAP,
  },
});
