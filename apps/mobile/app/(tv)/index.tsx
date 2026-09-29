import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  StyleSheet,
  Text,
  View,
  FlatList,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import { RefreshCw, Settings } from "lucide-react-native";
import { router, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePlaybackStore, type StreamingVideo } from "../../stores/playback";
import { useTVHistoryStore } from "../../stores/tvHistory";
import { api } from "../../services/api";
import {
  desktopConnection,
  type DesktopConnectionState,
} from "../../services/desktop-connection";
import {
  cacheRemoteChannels,
  cacheRemoteCollectionVideos,
  getCachedChannels,
  getCachedMyLists,
  getCachedPlaylists,
  cacheRemoteMyLists,
  cacheRemotePlaylists,
  resolveRemoteAssetUrl,
} from "../../services/browseCache";
import { logger } from "../../services/logger";
import { isTVDebugEnabled, tvDebugInfo } from "../../services/tvDebug";
import {
  buildCachedPlaylistId,
  getAllSavedPlaylistsWithProgress,
  getSavedPlaylistWithItems,
  type SavedPlaylistWithItems,
} from "../../db/repositories/playlists";
import {
  TVFocusPressable,
  type TVFocusPressableHandle,
} from "../../components/tv/TVFocusPressable";
import {
  TVCard,
} from "../../components/tv/TVCard";
import {
  TV_GRID_GAP,
  TV_GRID_SIDE_PADDING,
  clampGridFocusIndex,
  getTVGridCardHeight,
  getTVGridCardWidth,
  getTVGridColumns,
  getTVGridPageSize,
  isLeftEdgeGridIndex,
  isRightEdgeGridIndex,
} from "../../components/tv/grid";
import { useLibraryCatalog } from "../../core/hooks/useLibraryCatalog";
import { offlineCopy, type OfflineCopy } from "../../services/offline-copy";
import { describeConnectionProblem } from "../../components/tv/connectionText";
import type {
  RemoteChannel,
  RemoteMyList,
  RemotePlaylist,
  RemoteVideoWithStatus,
} from "../../types";

type TVBrowseMode = "playlists" | "mylists" | "channels" | "history";

type BaseGridCard = {
  id: string;
  title: string;
  subtitle: string;
  thumbnailUrl?: string | null;
  type: "playlist" | "mylist" | "channel" | "history";
};

type OfflineSavedPlaylist = ReturnType<typeof getAllSavedPlaylistsWithProgress>[number];

const CATALOG_ERROR =
  "Couldn't load everything from the desktop. Press refresh to try again.";

function ConnectionIndicator({
  connection,
  onPairAgain,
  onFocus,
}: {
  connection: DesktopConnectionState;
  onPairAgain: () => void;
  onFocus: () => void;
}) {
  if (connection.status === "pairingRequired") {
    return (
      <TVFocusPressable
        style={[styles.indicator, styles.indicatorAction]}
        onPress={onPairAgain}
        onFocus={onFocus}
      >
        <View style={[styles.indicatorDot, styles.indicatorDotWarning]} />
        <Text style={styles.indicatorText}>Pair again</Text>
      </TVFocusPressable>
    );
  }

  const label =
    connection.status === "connected"
      ? "Connected"
      : connection.status === "incompatible"
        ? "Update needed"
        : connection.status === "connecting"
          ? "Connecting…"
          : "Offline";
  return (
    <View style={styles.indicator}>
      <View
        style={[
          styles.indicatorDot,
          connection.status === "connected"
            ? styles.indicatorDotConnected
            : connection.status === "incompatible"
              ? styles.indicatorDotWarning
              : null,
        ]}
      />
      <Text style={styles.indicatorText}>{label}</Text>
    </View>
  );
}

function toStreamingVideos(
  input: RemoteVideoWithStatus[],
  serverUrl: string | null
) {
  return input.map<StreamingVideo>((item) => ({
    id: item.id,
    title: item.title,
    channelTitle: item.channelTitle,
    duration: item.duration,
    thumbnailUrl: resolveThumbnailUrl(serverUrl, item.thumbnailUrl) ?? undefined,
  }));
}

function toSavedPlaylistStreamingVideos(playlist: SavedPlaylistWithItems) {
  return playlist.items.map<StreamingVideo>((item) => ({
    id: item.videoId,
    title: item.title,
    channelTitle: item.channelTitle,
    duration: item.duration,
    thumbnailUrl: item.thumbnailUrl ?? undefined,
  }));
}

function resolveThumbnailUrl(
  serverUrl: string | null,
  thumbnailUrl?: string | null
): string | null {
  return resolveRemoteAssetUrl(serverUrl, thumbnailUrl);
}

export default function TVHomeScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const { videos, offlineVideos, getOfflineUri } = useLibraryCatalog();
  const connection = desktopConnection.useConnection();
  const serverUrl = connection.url;
  const startPlaylist = usePlaybackStore((state) => state.startPlaylist);
  const recentPlaylists = useTVHistoryStore((state) => state.recentPlaylists);
  const upsertRecentPlaylist = useTVHistoryStore(
    (state) => state.upsertRecentPlaylist
  );

  const [mode, setMode] = useState<TVBrowseMode>("playlists");

  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Start from the cached catalog, so connecting doesn't blank the grid while it reloads.
  const [playlists, setPlaylists] = useState<RemotePlaylist[]>(getCachedPlaylists);
  const [myLists, setMyLists] = useState<RemoteMyList[]>(getCachedMyLists);
  const [channels, setChannels] = useState<RemoteChannel[]>(getCachedChannels);
  const [offlineSavedPlaylists, setOfflineSavedPlaylists] = useState<
    OfflineSavedPlaylist[]
  >(() => getAllSavedPlaylistsWithProgress({ includeUnpinned: true }));
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);

  const [pageOffsets, setPageOffsets] = useState<Record<TVBrowseMode, number>>({
    playlists: 0,
    mylists: 0,
    channels: 0,
    history: 0,
  });
  const [focusedGridIndex, setFocusedGridIndex] = useState(0);
  const [isGridFocused, setIsGridFocused] = useState(false);
  const [cardNodeHandles, setCardNodeHandles] = useState<Array<number | undefined>>(
    []
  );
  const cardRefs = useRef<Array<TVFocusPressableHandle | null>>([]);

  const gridColumns = useMemo(() => getTVGridColumns(windowWidth), [windowWidth]);
  const pageSize = useMemo(() => getTVGridPageSize(gridColumns), [gridColumns]);
  const gridCardWidth = useMemo(
    () => getTVGridCardWidth(windowWidth, gridColumns),
    [gridColumns, windowWidth]
  );
  const gridCardHeight = useMemo(
    () => getTVGridCardHeight(gridCardWidth),
    [gridCardWidth]
  );
  const gridCardStyle = useMemo(
    () => ({ width: gridCardWidth, height: gridCardHeight }),
    [gridCardHeight, gridCardWidth]
  );

  const canStream = !!serverUrl && connection.status === "connected";

  const logOfflinePlaylistSnapshot = useCallback(
    (reason: string, playlistsSnapshot: OfflineSavedPlaylist[]) => {
      if (!isTVDebugEnabled()) {
        return;
      }

      const playlistDebug = playlistsSnapshot
        .filter((playlist) => playlist.type === "playlist")
        .map((playlist) => {
          const savedPlaylist = getSavedPlaylistWithItems(playlist.id, {
            includeUnpinned: true,
          });
          const cachedItems = savedPlaylist?.items ?? [];
          const downloadedItems = cachedItems.filter((item) => item.isDownloaded);
          const missingItems = cachedItems.filter((item) => !item.isDownloaded);

          return {
            playlistId: playlist.id,
            sourceId: playlist.sourceId,
            title: playlist.title,
            downloadedCount: playlist.downloadedCount,
            totalCount: playlist.totalCount,
            itemCountField: playlist.itemCount,
            cachedItemRows: cachedItems.length,
            downloadedItemIdsSample: downloadedItems
              .slice(0, 5)
              .map((item) => item.videoId),
            missingItemIdsSample: missingItems
              .slice(0, 5)
              .map((item) => item.videoId),
          };
        });

      tvDebugInfo("[TV Offline Debug] Playlist progress snapshot", {
        reason,
        offlineVideoCount: videos.filter((video) => offlineCopy.getUri(video.id))
          .length,
        playlistCount: playlistDebug.length,
        playlists: playlistDebug,
      });
    },
    [videos]
  );

  const refreshOfflineCatalog = useCallback(
    (reason = "unknown") => {
      const snapshot = getAllSavedPlaylistsWithProgress({
        includeUnpinned: true,
      });
      setOfflineSavedPlaylists(snapshot);
      logOfflinePlaylistSnapshot(reason, snapshot);
    },
    [logOfflinePlaylistSnapshot]
  );

  useEffect(() => {
    refreshOfflineCatalog("library-videos-changed");
  }, [refreshOfflineCatalog, videos]);

  useFocusEffect(
    useCallback(() => {
      refreshOfflineCatalog("tv-home-focus");
    }, [refreshOfflineCatalog])
  );

  const loadRemoteCollections = useCallback(async () => {
    if (!serverUrl) {
      setPlaylists([]);
      setMyLists([]);
      setChannels([]);
      return;
    }

    setIsLoadingCatalog(true);

    try {
      const [playlistResult, myListResult, channelResult] = await Promise.allSettled([
        api.getPlaylists(serverUrl),
        api.getMyLists(serverUrl),
        api.getChannels(serverUrl),
      ]);
      let nextPlaylists = getCachedPlaylists();
      let nextMyLists = getCachedMyLists();
      let nextChannels = getCachedChannels();
      let failed = false;

      if (playlistResult.status === "fulfilled") {
        nextPlaylists = await cacheRemotePlaylists(
          serverUrl,
          playlistResult.value.playlists
        );
        tvDebugInfo("[TV Offline Debug] Remote playlist counts", {
          serverUrl,
          playlistCount: nextPlaylists.length,
          playlists: nextPlaylists.map((playlist) => ({
            playlistId: playlist.playlistId,
            title: playlist.title,
            remoteDownloadedCount: playlist.downloadedCount,
            remoteItemCount: playlist.itemCount,
          })),
        });
      } else {
        failed = true;
      }

      if (myListResult.status === "fulfilled") {
        nextMyLists = await cacheRemoteMyLists(serverUrl, myListResult.value.mylists);
      } else {
        failed = true;
      }

      if (channelResult.status === "fulfilled") {
        nextChannels = await cacheRemoteChannels(
          serverUrl,
          channelResult.value.channels
        );
      } else {
        failed = true;
      }

      setPlaylists(nextPlaylists);
      setMyLists(nextMyLists);
      setChannels(nextChannels);
      refreshOfflineCatalog("remote-catalog-loaded");
      // A failed catalog request only affects this screen; the connection's health check
      // decides whether the desktop is gone.
      setCatalogError(failed ? CATALOG_ERROR : null);
    } catch {
      setPlaylists(getCachedPlaylists());
      setMyLists(getCachedMyLists());
      setChannels(getCachedChannels());
      refreshOfflineCatalog("remote-catalog-load-failed");
      setCatalogError(CATALOG_ERROR);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [refreshOfflineCatalog, serverUrl]);

  // Reconnecting refreshes the tabs in place; focus and paging stay where they are.
  useEffect(() => {
    if (serverUrl) void loadRemoteCollections();
  }, [loadRemoteCollections, serverUrl]);

  const playSavedPlaylistFromCache = useCallback(
    (savedPlaylistId: string): boolean => {
      const savedPlaylist = getSavedPlaylistWithItems(savedPlaylistId, {
        includeUnpinned: true,
      });
      if (!savedPlaylist) {
        return false;
      }
      if (savedPlaylist.items.length === 0) {
        Alert.alert(
          "Offline mode",
          "This list is not cached yet. Reconnect to desktop to load it first."
        );
        return true;
      }

      const playableVideos = toSavedPlaylistStreamingVideos(
        savedPlaylist
      ).filter((item) => getOfflineUri(item.id) !== null);

      tvDebugInfo("[TV Offline Debug] Offline playlist playback attempt", {
        savedPlaylistId,
        title: savedPlaylist.title,
        cachedItemCount: savedPlaylist.items.length,
        playableVideoCount: playableVideos.length,
        downloadedItemIdsSample: savedPlaylist.items
          .filter((item) => item.isDownloaded)
          .slice(0, 5)
          .map((item) => item.videoId),
        missingItemIdsSample: savedPlaylist.items
          .filter((item) => !item.isDownloaded)
          .slice(0, 5)
          .map((item) => item.videoId),
      });

      if (playableVideos.length === 0) {
        logger.warn("[TV Offline Debug] Offline playlist blocked", {
          savedPlaylistId,
          title: savedPlaylist.title,
          reason: "no-local-videos-on-tv",
        });
        Alert.alert(
          "Offline mode",
          "Download videos in this list first or reconnect to desktop to stream."
        );
        return true;
      }

      const nextPlaylistId = `offline-${savedPlaylist.id}`;
      upsertRecentPlaylist({
        playlistId: nextPlaylistId,
        title: savedPlaylist.title,
        videos: playableVideos,
        startIndex: 0,
        serverUrl: null,
      });
      startPlaylist(nextPlaylistId, savedPlaylist.title, playableVideos, 0);
      router.push(`/(tv)/player/${playableVideos[0].id}` as Href);
      return true;
    },
    [getOfflineUri, startPlaylist, upsertRecentPlaylist]
  );

  const playRemoteCollection = useCallback(
    async (kind: "playlist" | "mylist", id: string, title: string) => {
      if (!serverUrl) return;

      try {
        const response =
          kind === "playlist"
            ? await api.getPlaylistVideos(serverUrl, id)
            : await api.getMyListVideos(serverUrl, id);
        const playlistMeta =
          kind === "playlist"
            ? playlists.find((item) => item.playlistId === id)
            : undefined;
        const myListMeta =
          kind === "mylist" ? myLists.find((item) => item.id === id) : undefined;
        const normalizedVideos = await cacheRemoteCollectionVideos(serverUrl, {
          kind,
          id,
          title,
          sourceId: kind === "playlist" ? playlistMeta?.channelId : id,
          thumbnailUrl:
            kind === "playlist" ? playlistMeta?.thumbnailUrl : myListMeta?.thumbnailUrl,
          thumbnailFallbackUrl:
            kind === "playlist" ? api.getPlaylistThumbnailUrl(serverUrl, id) : null,
          itemCount:
            kind === "playlist" ? playlistMeta?.itemCount : myListMeta?.itemCount,
          videos: response.videos,
        });
        refreshOfflineCatalog();

        const streamingVideos = toStreamingVideos(normalizedVideos, serverUrl);
        tvDebugInfo("[TV Playback Debug] Remote collection prepared", {
          kind,
          id,
          title,
          totalVideos: streamingVideos.length,
          localPlayableCount: streamingVideos.filter(
            (item) => getOfflineUri(item.id) !== null
          ).length,
          sourceKind: "desktop-playback",
          serverUrl,
        });
        if (streamingVideos.length === 0) {
          return;
        }

        const nextPlaylistId = `${kind}-${id}`;
        upsertRecentPlaylist({
          playlistId: nextPlaylistId,
          title,
          videos: streamingVideos,
          startIndex: 0,
          serverUrl,
        });
        startPlaylist(nextPlaylistId, title, streamingVideos, 0, serverUrl);
        router.push(`/(tv)/player/${streamingVideos[0].id}` as Href);
      } catch {
        // The desktop may still be fetching this collection; the connection stays as it is.
        refreshOfflineCatalog();

        // Fall back to what the TV holds from this list; the cache's own messages assume
        // Offline mode, so they aren't shown here.
        const cachedPlaylist = getSavedPlaylistWithItems(
          buildCachedPlaylistId(kind, id),
          { includeUnpinned: true }
        );
        if (
          cachedPlaylist?.items.some((item) => getOfflineUri(item.videoId) !== null) &&
          playSavedPlaylistFromCache(cachedPlaylist.id)
        ) {
          return;
        }

        Alert.alert(
          "Not ready yet",
          "The desktop couldn't open this list just now. Try again in a moment."
        );
      }
    },
    [
      getOfflineUri,
      myLists,
      playlists,
      playSavedPlaylistFromCache,
      refreshOfflineCatalog,
      serverUrl,
      startPlaylist,
      upsertRecentPlaylist,
    ]
  );

  const playOfflineCollection = useCallback(
    (savedPlaylistId: string) => {
      playSavedPlaylistFromCache(savedPlaylistId);
    },
    [playSavedPlaylistFromCache]
  );

  const offlinePlaylistCards = useMemo<BaseGridCard[]>(
    () =>
      offlineSavedPlaylists
        .filter((item) => item.type === "playlist")
        .map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: `${item.downloadedCount}/${item.totalCount} ready`,
          thumbnailUrl: item.thumbnailUrl,
          type: "playlist",
        })),
    [offlineSavedPlaylists]
  );

  const offlineMyListCards = useMemo<BaseGridCard[]>(
    () =>
      offlineSavedPlaylists
        .filter((item) => item.type === "mylist")
        .map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: `${item.downloadedCount}/${item.totalCount} ready`,
          thumbnailUrl: item.thumbnailUrl,
          type: "mylist",
        })),
    [offlineSavedPlaylists]
  );

  const offlineChannelCards = useMemo<BaseGridCard[]>(() => {
    const savedChannels = offlineSavedPlaylists.filter(
      (item) => item.type === "channel"
    );
    const cards: BaseGridCard[] = [];
    const seenChannelTitles = new Set<string>();

    for (const item of savedChannels) {
      const channelTitle = item.title.trim() || "Unknown channel";
      seenChannelTitles.add(channelTitle);
      cards.push({
        id: item.sourceId ?? channelTitle,
        title: channelTitle,
        subtitle: `${item.downloadedCount}/${item.totalCount} ready`,
        thumbnailUrl: item.thumbnailUrl,
        type: "channel",
      });
    }

    const localOnlyCounts = new Map<
      string,
      { count: number; thumbnailUrl?: string | null }
    >();
    for (const video of offlineVideos) {
      const channelTitle = video.channelTitle.trim() || "Unknown channel";
      if (seenChannelTitles.has(channelTitle)) {
        continue;
      }

      const existing = localOnlyCounts.get(channelTitle);
      localOnlyCounts.set(channelTitle, {
        count: (existing?.count ?? 0) + 1,
        thumbnailUrl: existing?.thumbnailUrl ?? video.thumbnailUrl,
      });
    }

    for (const [channelTitle, info] of Array.from(localOnlyCounts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      cards.push({
        id: channelTitle,
        title: channelTitle,
        subtitle: `${info.count} downloaded`,
        thumbnailUrl: info.thumbnailUrl,
        type: "channel",
      });
    }

    return cards;
  }, [offlineSavedPlaylists, offlineVideos]);

  const playlistCards = useMemo<BaseGridCard[]>(
    () => {
      if (!canStream) {
        return offlinePlaylistCards;
      }

      return playlists.map((item) => ({
        id: item.playlistId,
        title: item.title,
        subtitle: `${item.downloadedCount} ready`,
        thumbnailUrl:
          resolveThumbnailUrl(serverUrl, item.thumbnailUrl) ??
          (serverUrl ? api.getPlaylistThumbnailUrl(serverUrl, item.playlistId) : null),
        type: "playlist",
      }));
    },
    [canStream, offlinePlaylistCards, playlists, serverUrl]
  );

  const myListCards = useMemo<BaseGridCard[]>(
    () => {
      if (!canStream) {
        return offlineMyListCards;
      }

      return myLists.map((item) => ({
        id: item.id,
        title: item.name,
        subtitle: item.isFavorite
          ? `Favorite · ${item.itemCount} videos`
          : `${item.itemCount} videos`,
        thumbnailUrl: resolveThumbnailUrl(serverUrl, item.thumbnailUrl),
        type: "mylist",
      }));
    },
    [canStream, myLists, offlineMyListCards, serverUrl]
  );

  const channelCards = useMemo<BaseGridCard[]>(
    () => {
      if (!canStream) {
        return offlineChannelCards;
      }

      return channels.map((item) => ({
        id: item.channelId,
        title: item.channelTitle,
        subtitle: `${item.videoCount} videos`,
        thumbnailUrl: resolveThumbnailUrl(serverUrl, item.thumbnailUrl),
        type: "channel",
      }));
    },
    [canStream, channels, offlineChannelCards, serverUrl]
  );

  const historyCards = useMemo<BaseGridCard[]>(() => {
    const cards: BaseGridCard[] = [];

    for (const item of recentPlaylists) {
      if (
        !canStream &&
        !item.videos.some((video) => getOfflineUri(video.id) !== null)
      ) {
        continue;
      }

      const total = item.videos.length;
      const currentPosition = total > 0 ? Math.min(item.lastIndex + 1, total) : 0;
      const currentVideo = item.videos[item.lastIndex];
      const historyServerUrl = canStream ? item.serverUrl ?? serverUrl ?? null : null;
      const subtitle = currentVideo
        ? `Resume ${currentPosition}/${total} - ${currentVideo.title}`
        : `Resume ${currentPosition}/${total}`;

      cards.push({
        id: item.playlistId,
        title: item.title,
        subtitle,
        thumbnailUrl:
          resolveThumbnailUrl(historyServerUrl, currentVideo?.thumbnailUrl) ??
          resolveThumbnailUrl(historyServerUrl, item.videos[0]?.thumbnailUrl),
        type: "history",
      });
    }

    return cards;
  }, [canStream, getOfflineUri, recentPlaylists, serverUrl]);

  const activeCards = useMemo(() => {
    if (mode === "playlists") return playlistCards;
    if (mode === "mylists") return myListCards;
    if (mode === "history") return historyCards;
    return channelCards;
  }, [channelCards, historyCards, mode, myListCards, playlistCards]);
  const hasAnyOfflineCache =
    offlineSavedPlaylists.length > 0 || offlineVideos.length > 0 || recentPlaylists.length > 0;
  const isFreshTV = !hasAnyOfflineCache && !canStream;
  // Shown once the first attempt has settled, so a paired TV never focuses a button that
  // disappears as it connects.
  const showConnectButton = !canStream && connection.status !== "connecting";
  const focusConnectButton = isFreshTV && showConnectButton;
  const emptyStateText = isFreshTV
    ? "Nothing on this TV yet"
    : mode === "playlists"
      ? "No playlists here yet"
      : mode === "mylists"
        ? "No lists here yet"
        : mode === "channels"
          ? "No channels here yet"
          : "No history yet";
  const openPairing = () => router.push("/(tv)/connect" as Href);

  const currentOffset = pageOffsets[mode];
  const maxOffset = Math.max(0, activeCards.length - pageSize);
  const pageOffset = Math.min(currentOffset, maxOffset);

  const pageItems = useMemo(
    () => activeCards.slice(pageOffset, pageOffset + pageSize),
    [activeCards, pageOffset, pageSize]
  );

  useEffect(() => {
    setCardNodeHandles([]);
    cardRefs.current = [];
  }, [mode, pageItems.length, pageOffset]);

  useEffect(() => {
    setCardNodeHandles(
      pageItems.map((_, index) => {
        const node = cardRefs.current[index];
        return node ? findNodeHandle(node) ?? undefined : undefined;
      })
    );
  }, [pageItems]);

  useEffect(() => {
    if (currentOffset !== pageOffset) {
      setPageOffsets((prev) => ({
        ...prev,
        [mode]: pageOffset,
      }));
    }
  }, [currentOffset, mode, pageOffset]);

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
        if (!isGridFocused) return;
        if (!pageItems.length) return;
        if (typeof event.eventKeyAction === "number" && event.eventKeyAction !== 0) {
          return;
        }

        if (
          event.eventType === "right" &&
          isRightEdgeGridIndex(focusedGridIndex, gridColumns, pageItems.length)
        ) {
          const nextOffset = Math.min(pageOffset + 1, maxOffset);
          if (nextOffset !== pageOffset) {
            const nextGlobalIndex = Math.min(
              pageOffset + focusedGridIndex + 1,
              activeCards.length - 1
            );
            const nextPageCount = Math.min(pageSize, activeCards.length - nextOffset);
            setPageOffsets((prev) => ({
              ...prev,
              [mode]: nextOffset,
            }));
            setFocusedGridIndex(
              clampGridFocusIndex(nextGlobalIndex, nextOffset, nextPageCount)
            );
          }
        }

        if (
          event.eventType === "left" &&
          isLeftEdgeGridIndex(focusedGridIndex, gridColumns) &&
          pageOffset > 0
        ) {
          const nextOffset = Math.max(0, pageOffset - 1);
          if (nextOffset !== pageOffset) {
            const nextGlobalIndex = Math.max(pageOffset + focusedGridIndex - 1, 0);
            const nextPageCount = Math.min(pageSize, activeCards.length - nextOffset);
            setPageOffsets((prev) => ({
              ...prev,
              [mode]: nextOffset,
            }));
            setFocusedGridIndex(
              clampGridFocusIndex(nextGlobalIndex, nextOffset, nextPageCount)
            );
          }
        }
      }
    );

    return () => {
      subscription.remove();
    };
  }, [
    activeCards.length,
    focusedGridIndex,
    gridColumns,
    isGridFocused,
    maxOffset,
    mode,
    pageItems.length,
    pageOffset,
    pageSize,
  ]);

  const handleCardPress = useCallback(
    (card: BaseGridCard) => {
      if (card.type === "playlist") {
        if (!canStream) {
          playOfflineCollection(card.id);
          return;
        }
        void playRemoteCollection("playlist", card.id, card.title);
        return;
      }

      if (card.type === "mylist") {
        if (!canStream) {
          playOfflineCollection(card.id);
          return;
        }
        void playRemoteCollection("mylist", card.id, card.title);
        return;
      }

      if (card.type === "history") {
        const target = recentPlaylists.find((item) => item.playlistId === card.id);
        if (!target || target.videos.length === 0) return;

        const playableVideos = canStream
          ? target.videos
          : target.videos.filter((video) => getOfflineUri(video.id) !== null);

        if (playableVideos.length === 0) {
          Alert.alert(
            "Offline mode",
            "Reconnect to desktop or download videos to resume this item."
          );
          return;
        }

        const preferredVideoId =
          target.lastVideoId ?? target.videos[target.lastIndex]?.id ?? null;
        const resumeIndex = preferredVideoId
          ? playableVideos.findIndex((video) => video.id === preferredVideoId)
          : -1;
        const safeIndex = resumeIndex >= 0 ? resumeIndex : 0;
        const safeVideo = playableVideos[safeIndex];
        if (!safeVideo) return;

        const historyServerUrl = canStream ? target.serverUrl ?? serverUrl ?? null : null;
        upsertRecentPlaylist({
          playlistId: target.playlistId,
          title: target.title,
          videos: playableVideos,
          startIndex: safeIndex,
          serverUrl: historyServerUrl,
        });
        startPlaylist(
          target.playlistId,
          target.title,
          playableVideos,
          safeIndex,
          historyServerUrl ?? undefined
        );
        router.push(`/(tv)/player/${safeVideo.id}` as Href);
        return;
      }

      router.push({
        pathname: "/(tv)/channel/[id]",
        params: { id: card.id, title: card.title },
      } as Href);
    },
    [
      canStream,
      getOfflineUri,
      playOfflineCollection,
      playRemoteCollection,
      recentPlaylists,
      serverUrl,
      startPlaylist,
      upsertRecentPlaylist,
    ]
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.controlsRow}>
        <View style={styles.modeTabs}>
          <TVFocusPressable
            style={[styles.modeTab, mode === "playlists" && styles.modeTabActive]}
            onPress={() => setMode("playlists")}
            onFocus={() => setIsGridFocused(false)}
            hasTVPreferredFocus={!focusConnectButton}
          >
            <Text style={styles.modeTabText}>Playlists</Text>
          </TVFocusPressable>
          <TVFocusPressable
            style={[styles.modeTab, mode === "mylists" && styles.modeTabActive]}
            onPress={() => setMode("mylists")}
            onFocus={() => setIsGridFocused(false)}
          >
            <Text style={styles.modeTabText}>My Lists</Text>
          </TVFocusPressable>
          <TVFocusPressable
            style={[styles.modeTab, mode === "channels" && styles.modeTabActive]}
            onPress={() => setMode("channels")}
            onFocus={() => setIsGridFocused(false)}
          >
            <Text style={styles.modeTabText}>Channels</Text>
          </TVFocusPressable>
          <TVFocusPressable
            style={[styles.modeTab, mode === "history" && styles.modeTabActive]}
            onPress={() => setMode("history")}
            onFocus={() => setIsGridFocused(false)}
          >
            <Text style={styles.modeTabText}>History</Text>
          </TVFocusPressable>
        </View>

        <View style={styles.iconActions}>
          <ConnectionIndicator
            connection={connection}
            onPairAgain={openPairing}
            onFocus={() => setIsGridFocused(false)}
          />
          <TVFocusPressable
            style={styles.iconButton}
            onPress={() => {
              desktopConnection.retryNow();
              if (serverUrl) void loadRemoteCollections();
            }}
            onFocus={() => setIsGridFocused(false)}
            disabled={isLoadingCatalog}
          >
            {isLoadingCatalog ? (
              <ActivityIndicator size="small" color="#fffef2" />
            ) : (
              <RefreshCw size={24} color="#fffef2" />
            )}
          </TVFocusPressable>
          <TVFocusPressable
            style={styles.iconButton}
            onPress={() => router.push("/(tv)/settings" as Href)}
            onFocus={() => setIsGridFocused(false)}
          >
            <Settings size={24} color="#fffef2" />
          </TVFocusPressable>
        </View>
      </View>

      {isLoadingCatalog && activeCards.length === 0 ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#ffd93d" />
        </View>
      ) : null}

      {!isLoadingCatalog && activeCards.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{emptyStateText}</Text>
          {isFreshTV ? (
            <Text style={styles.emptyHint}>
              {describeConnectionProblem(connection)}
            </Text>
          ) : null}
          {catalogError && canStream ? (
            <Text style={styles.errorText}>{catalogError}</Text>
          ) : null}
          {showConnectButton ? (
            <TVFocusPressable
              style={styles.connectButton}
              onPress={openPairing}
              onFocus={() => setIsGridFocused(false)}
              hasTVPreferredFocus={focusConnectButton}
            >
              <Text style={styles.connectButtonText}>Connect to desktop</Text>
            </TVFocusPressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={pageItems}
          key={`${mode}-${pageOffset}`}
          keyExtractor={(item) => `${item.type}-${item.id}`}
          numColumns={gridColumns}
          scrollEnabled={false}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={({ item, index }) => {
            const isLeftEdge = isLeftEdgeGridIndex(index, gridColumns);
            const isRightEdge = isRightEdgeGridIndex(
              index,
              gridColumns,
              pageItems.length
            );
            const rightTargetIndex = isRightEdge ? index : index + 1;
            const leftTargetIndex = isLeftEdge ? index : index - 1;
            const upTargetIndex = index >= gridColumns ? index - gridColumns : undefined;
            const downCandidateIndex = index + gridColumns;
            const downTargetIndex =
              downCandidateIndex < pageItems.length ? downCandidateIndex : index;

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
                onPress={() => handleCardPress(item)}
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
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f1b3a",
    paddingHorizontal: TV_GRID_SIDE_PADDING,
    paddingBottom: 24,
  },
  controlsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 18,
    marginBottom: 12,
  },
  modeTabs: {
    flexDirection: "row",
    gap: 10,
    flex: 1,
  },
  modeTab: {
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: "#8ec5ff",
    backgroundColor: "#2d7ff9",
  },
  modeTabActive: {
    borderColor: "#ffd93d",
    backgroundColor: "#40c4aa",
  },
  modeTabText: {
    color: "#fffef2",
    fontSize: 18,
    fontWeight: "800",
  },
  iconActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 54,
    height: 54,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffb86b",
    backgroundColor: "#ff6b6b",
    alignItems: "center",
    justifyContent: "center",
  },

  loaderWrap: {
    marginTop: 48,
    alignItems: "center",
  },
  emptyState: {
    marginTop: 24,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#8ec5ff",
    backgroundColor: "#2d7ff9",
    padding: 18,
    gap: 8,
  },
  emptyText: {
    color: "#fffef2",
    fontSize: 22,
    fontWeight: "800",
  },
  emptyHint: {
    color: "#eaf5ff",
    fontSize: 18,
    fontWeight: "700",
  },
  connectButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff6b6b",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  connectButtonText: {
    color: "#fffef2",
    fontSize: 20,
    fontWeight: "900",
  },
  indicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(15, 27, 58, 0.6)",
  },
  indicatorAction: {
    borderWidth: 2,
    borderColor: "#ffd93d",
  },
  indicatorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#94a3b8",
  },
  indicatorDotConnected: {
    backgroundColor: "#40c4aa",
  },
  indicatorDotWarning: {
    backgroundColor: "#ffb86b",
  },
  indicatorText: {
    color: "#fffef2",
    fontSize: 16,
    fontWeight: "700",
  },
  errorText: {
    color: "#ffe3e3",
    fontSize: 16,
    fontWeight: "700",
  },
  grid: {
    paddingBottom: 24,
  },
  row: {
    justifyContent: "flex-start",
    gap: TV_GRID_GAP,
    marginBottom: TV_GRID_GAP,
  },
});
