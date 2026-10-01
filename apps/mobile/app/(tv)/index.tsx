import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
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
import {
  colors,
  fontWeight,
  radius,
  spacing,
  tvFontSize,
  tvRestingBorder,
} from "../../theme";
import type { StreamingVideo } from "../../stores/playback";
import { useTVHistoryStore } from "../../stores/tvHistory";
import { useOnDeviceSetStore } from "../../stores/onDeviceSet";
import { api } from "../../services/api";
import { playQueue } from "../../services/play-queue";
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
import {
  buildCachedPlaylistId,
  getAllSavedPlaylistsWithItems,
} from "../../db/repositories/playlists";
import {
  TVFocusPressable,
  type TVFocusPressableHandle,
} from "../../components/tv/TVFocusPressable";
import { TVCard } from "../../components/tv/TVCard";
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
import {
  buildTVCatalog,
  playHeldCollection,
  type CachedCollection,
  type TVBrowseMode,
  type TVCardAction,
  type TVCatalogCard,
  type TVCatalogInput,
} from "../../components/tv/tvCatalog";
import { useLibraryCatalog } from "../../core/hooks/useLibraryCatalog";
import { videoThumbnails } from "../../services/video-thumbnails";
import {
  describeConnectionProblem,
  describeConnectionStatus,
} from "../../components/tv/connectionText";
import { useTVBackInterceptor } from "../../components/tv/tvBack";
import { useTVMessage } from "../../components/tv/TVMessage";
import { collectionNotReady } from "../../components/tv/tvMessages";
import type {
  RemoteChannel,
  RemoteMyList,
  RemotePlaylist,
  RemoteVideoWithStatus,
} from "../../types";

const TABS: Array<{ mode: TVBrowseMode; label: string }> = [
  { mode: "playlists", label: "Playlists" },
  { mode: "mylists", label: "My Lists" },
  { mode: "channels", label: "Channels" },
  { mode: "history", label: "History" },
];

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
        <Text style={styles.indicatorText}>
          {describeConnectionStatus(connection)}
        </Text>
      </TVFocusPressable>
    );
  }

  const label = describeConnectionStatus(connection);
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
  serverUrl: string | null,
) {
  return input.map<StreamingVideo>((item) => ({
    id: item.id,
    title: item.title,
    channelTitle: item.channelTitle,
    duration: item.duration,
    thumbnailUrl:
      resolveRemoteAssetUrl(serverUrl, item.thumbnailUrl) ?? undefined,
  }));
}

function getCachedCollections() {
  return getAllSavedPlaylistsWithItems({
    includeUnpinned: true,
  }).flatMap<CachedCollection>((playlist) =>
    playlist.type === "playlist" ||
    playlist.type === "mylist" ||
    playlist.type === "channel"
      ? [
          {
            id: playlist.id,
            type: playlist.type,
            title: playlist.title,
            sourceId: playlist.sourceId,
            thumbnailUrl: playlist.thumbnailUrl,
            items: playlist.items.map((item) => ({
              id: item.videoId,
              title: item.title,
              channelTitle: item.channelTitle,
              duration: item.duration,
              thumbnailUrl: item.thumbnailUrl ?? undefined,
            })),
          },
        ]
      : [],
  );
}

export default function TVHomeScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const { videos, getOfflineUri } = useLibraryCatalog();
  const getStoredThumbnail = videoThumbnails.useLookup();
  const connection = desktopConnection.useConnection();
  const serverUrl = connection.status === "connected" ? connection.url : null;
  const onDeviceSet = useOnDeviceSetStore((state) => state.videos);
  const recentPlaylists = useTVHistoryStore((state) => state.recentPlaylists);

  const [mode, setMode] = useState<TVBrowseMode>("playlists");
  const {
    show: showTVMessage,
    isOpen: isTVMessageOpen,
    element: tvMessageElement,
  } = useTVMessage();

  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Start from the cached catalog, so connecting doesn't blank the grid while it reloads.
  const [playlists, setPlaylists] =
    useState<RemotePlaylist[]>(getCachedPlaylists);
  const [myLists, setMyLists] = useState<RemoteMyList[]>(getCachedMyLists);
  const [channels, setChannels] = useState<RemoteChannel[]>(getCachedChannels);
  const [cachedCollections, setCachedCollections] =
    useState(getCachedCollections);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);

  const [pageOffsets, setPageOffsets] = useState<Record<TVBrowseMode, number>>({
    playlists: 0,
    mylists: 0,
    channels: 0,
    history: 0,
  });
  const [focusedGridIndex, setFocusedGridIndex] = useState(0);
  const [isGridFocused, setIsGridFocused] = useState(false);
  const [cardNodeHandles, setCardNodeHandles] = useState<
    Array<number | undefined>
  >([]);
  const cardRefs = useRef<Array<TVFocusPressableHandle | null>>([]);
  const tabRefs = useRef<
    Partial<Record<TVBrowseMode, TVFocusPressableHandle | null>>
  >({});
  const settingsRef = useRef<TVFocusPressableHandle>(null);
  // Up from the top row goes to the selected tab, not the nearest header button.
  const [selectedTabHandle, setSelectedTabHandle] = useState<number>();
  // Right on Settings, the last header button, stays put rather than losing focus.
  const [settingsHandle, setSettingsHandle] = useState<number>();
  // Back on the tabs exits the app; from anywhere else it goes up to the selected tab.
  // hasTVPreferredFocus only moves focus when it turns true, so the selected tab's is
  // released for one render first, then set.
  const [tabFocus, setTabFocus] = useState<"initial" | "released" | "selected">(
    "initial",
  );
  const isTabFocused = useRef(false);
  const tabFocusHandlers = {
    onFocus: () => {
      setIsGridFocused(false);
      isTabFocused.current = true;
    },
    onBlur: () => {
      isTabFocused.current = false;
    },
  };

  useTVBackInterceptor(() => {
    if (isTabFocused.current) return false;
    setTabFocus("released");
    // A view focused by hasTVPreferredFocus fires no onFocus, so don't wait for one.
    isTabFocused.current = true;
    return true;
  });

  useEffect(() => {
    if (tabFocus === "released") setTabFocus("selected");
  }, [tabFocus]);

  useEffect(() => {
    const tab = tabRefs.current[mode];
    setSelectedTabHandle(tab ? (findNodeHandle(tab) ?? undefined) : undefined);
  }, [mode]);

  useEffect(() => {
    setSettingsHandle(
      settingsRef.current
        ? (findNodeHandle(settingsRef.current) ?? undefined)
        : undefined,
    );
  }, []);

  const hasTabPreferredFocus = (tab: TVBrowseMode) =>
    tabFocus === "initial"
      ? tab === "playlists" && !focusConnectButton
      : tabFocus === "selected" && tab === mode;

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

  const refreshCachedCollections = useCallback(() => {
    setCachedCollections(getCachedCollections());
  }, []);

  useEffect(() => {
    refreshCachedCollections();
  }, [refreshCachedCollections, videos]);

  useFocusEffect(refreshCachedCollections);

  // A collection still opening when the viewer opens another or leaves is dropped.
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openRequest = useRef(0);
  useFocusEffect(
    useCallback(
      () => () => {
        openRequest.current += 1;
        setOpeningId(null);
      },
      [],
    ),
  );

  const loadRemoteCollections = useCallback(async () => {
    if (!serverUrl) return;

    setIsLoadingCatalog(true);

    try {
      const [playlistResult, myListResult, channelResult] =
        await Promise.allSettled([
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
          playlistResult.value.playlists,
        );
      } else {
        failed = true;
      }

      if (myListResult.status === "fulfilled") {
        nextMyLists = await cacheRemoteMyLists(
          serverUrl,
          myListResult.value.mylists,
        );
      } else {
        failed = true;
      }

      if (channelResult.status === "fulfilled") {
        nextChannels = await cacheRemoteChannels(
          serverUrl,
          channelResult.value.channels,
        );
      } else {
        failed = true;
      }

      setPlaylists(nextPlaylists);
      setMyLists(nextMyLists);
      setChannels(nextChannels);
      refreshCachedCollections();
      // A failed catalog request only affects this screen; the connection's health check
      // decides whether the desktop is gone.
      setCatalogError(failed ? CATALOG_ERROR : null);
    } catch {
      setPlaylists(getCachedPlaylists());
      setMyLists(getCachedMyLists());
      setChannels(getCachedChannels());
      refreshCachedCollections();
      setCatalogError(CATALOG_ERROR);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [refreshCachedCollections, serverUrl]);

  // Reconnecting refreshes the tabs in place; focus and paging stay where they are.
  useEffect(() => {
    if (serverUrl) void loadRemoteCollections();
  }, [loadRemoteCollections, serverUrl]);

  // Memoized: the grid's paging and focus effects key off the cards' identity.
  const catalogInput = useMemo<TVCatalogInput>(
    () => ({
      desktop: serverUrl
        ? {
            url: serverUrl,
            resolveAssetUrl: (assetUrl) =>
              resolveRemoteAssetUrl(serverUrl, assetUrl),
            playlistThumbnailUrl: (playlistId) =>
              api.getPlaylistThumbnailUrl(serverUrl, playlistId),
          }
        : null,
      remote: { playlists, myLists, channels },
      cached: cachedCollections,
      library: videos,
      hasOfflineCopy: (videoId) => getOfflineUri(videoId) !== null,
      getStoredThumbnail,
      onDeviceSet,
      history: recentPlaylists,
    }),
    [
      cachedCollections,
      channels,
      getOfflineUri,
      getStoredThumbnail,
      myLists,
      onDeviceSet,
      playlists,
      recentPlaylists,
      serverUrl,
      videos,
    ],
  );
  const catalog = useMemo(() => buildTVCatalog(catalogInput), [catalogInput]);

  const play = (action: Extract<TVCardAction, { kind: "play" }>) => {
    const first = playQueue.start({
      id: action.playlistId,
      title: action.title,
      videos: action.videos,
      startIndex: action.startIndex,
    });
    if (first) router.push(`/(tv)/player/${first.id}` as Href);
  };

  const playRemoteCollection = async (
    kind: "playlist" | "mylist",
    id: string,
    title: string,
  ) => {
    if (!serverUrl || openingId === id) return;
    const request = ++openRequest.current;
    setOpeningId(id);

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
          kind === "playlist"
            ? playlistMeta?.thumbnailUrl
            : myListMeta?.thumbnailUrl,
        thumbnailFallbackUrl:
          kind === "playlist"
            ? api.getPlaylistThumbnailUrl(serverUrl, id)
            : null,
        itemCount:
          kind === "playlist" ? playlistMeta?.itemCount : myListMeta?.itemCount,
        videos: response.videos,
      });
      refreshCachedCollections();
      if (request !== openRequest.current) return;

      const streamingVideos = toStreamingVideos(normalizedVideos, serverUrl);

      play({
        kind: "play",
        playlistId: `${kind}-${id}`,
        title,
        videos: streamingVideos,
        startIndex: 0,
      });
    } catch {
      if (request !== openRequest.current) return;
      // The desktop may still be fetching this collection; the connection stays as it is.
      // Fall back to what the TV holds from it.
      const collections = getCachedCollections();
      setCachedCollections(collections);
      const cached = collections.find(
        (item) => item.id === buildCachedPlaylistId(kind, id),
      );
      const heldPlayback = cached && playHeldCollection(cached, catalogInput);
      if (heldPlayback) {
        play(heldPlayback);
        return;
      }

      showTVMessage(collectionNotReady);
    } finally {
      if (request === openRequest.current) setOpeningId(null);
    }
  };

  const handleCardPress = (card: TVCatalogCard) => {
    const { action } = card;
    if (action.kind === "play") {
      play(action);
      return;
    }
    if (action.kind === "remote") {
      void playRemoteCollection(action.collection, action.id, action.title);
      return;
    }
    router.push({
      pathname: "/(tv)/channel/[id]",
      params: { id: action.id, title: action.title },
    } as Href);
  };

  const activeCards = catalog.tabs[mode];
  const isFreshTV = !serverUrl && catalog.holdsNothing;
  // Shown once the first attempt has settled, so a paired TV never focuses a button that
  // disappears as it connects.
  const showConnectButton = !serverUrl && connection.status !== "connecting";
  const focusConnectButton = isFreshTV && showConnectButton;
  const openPairing = () => router.push("/(tv)/connect" as Href);

  const currentOffset = pageOffsets[mode];
  const maxOffset = Math.max(0, activeCards.length - pageSize);
  const pageOffset = Math.min(currentOffset, maxOffset);

  const pageItems = useMemo(
    () => activeCards.slice(pageOffset, pageOffset + pageSize),
    [activeCards, pageOffset, pageSize],
  );

  // The cards' ref callbacks run before this, so it reads the page just rendered.
  useEffect(() => {
    setCardNodeHandles(
      pageItems.map((_, index) => {
        const node = cardRefs.current[index];
        return node ? (findNodeHandle(node) ?? undefined) : undefined;
      }),
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
        if (!isGridFocused || isTVMessageOpen) return;
        if (!pageItems.length) return;
        if (
          typeof event.eventKeyAction === "number" &&
          event.eventKeyAction !== 0
        ) {
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
              activeCards.length - 1,
            );
            const nextPageCount = Math.min(
              pageSize,
              activeCards.length - nextOffset,
            );
            setPageOffsets((prev) => ({
              ...prev,
              [mode]: nextOffset,
            }));
            setFocusedGridIndex(
              clampGridFocusIndex(nextGlobalIndex, nextOffset, nextPageCount),
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
            const nextGlobalIndex = Math.max(
              pageOffset + focusedGridIndex - 1,
              0,
            );
            const nextPageCount = Math.min(
              pageSize,
              activeCards.length - nextOffset,
            );
            setPageOffsets((prev) => ({
              ...prev,
              [mode]: nextOffset,
            }));
            setFocusedGridIndex(
              clampGridFocusIndex(nextGlobalIndex, nextOffset, nextPageCount),
            );
          }
        }
      },
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
    isTVMessageOpen,
  ]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.controlsRow}>
        <View style={styles.modeTabs}>
          {TABS.map((tab) => (
            <TVFocusPressable
              key={tab.mode}
              ref={(node) => {
                tabRefs.current[tab.mode] = node;
              }}
              style={[
                styles.modeTab,
                mode === tab.mode && styles.modeTabActive,
              ]}
              onPress={() => setMode(tab.mode)}
              {...tabFocusHandlers}
              onFocus={() => {
                tabFocusHandlers.onFocus();
                setMode(tab.mode);
              }}
              nextFocusDown={cardNodeHandles[0]}
              hasTVPreferredFocus={hasTabPreferredFocus(tab.mode)}
            >
              <Text
                style={[
                  styles.modeTabText,
                  mode === tab.mode && styles.modeTabTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </TVFocusPressable>
          ))}
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
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <RefreshCw size={24} color={colors.foreground} />
            )}
          </TVFocusPressable>
          <TVFocusPressable
            ref={settingsRef}
            style={styles.iconButton}
            onPress={() => router.push("/(tv)/settings" as Href)}
            onFocus={() => setIsGridFocused(false)}
            nextFocusRight={settingsHandle}
          >
            <Settings size={24} color={colors.foreground} />
          </TVFocusPressable>
        </View>
      </View>

      {isLoadingCatalog && activeCards.length === 0 ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}

      {!isLoadingCatalog && activeCards.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{catalog.emptyText[mode]}</Text>
          {catalog.emptyHint ? (
            <Text style={styles.emptyHint}>{catalog.emptyHint}</Text>
          ) : null}
          {isFreshTV ? (
            <Text style={styles.emptyHint}>
              {describeConnectionProblem(connection)}
            </Text>
          ) : null}
          {catalogError && serverUrl ? (
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
          keyExtractor={(item) => item.id}
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
                busy={
                  item.action.kind === "remote" && openingId === item.action.id
                }
                thumbnailUrl={item.thumbnailUrl}
                // Only while paging: a tab press remounts the grid too, and must keep focus.
                hasTVPreferredFocus={
                  isGridFocused && index === focusedGridIndex
                }
                onFocus={() => {
                  setIsGridFocused(true);
                  isTabFocused.current = false;
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
                    ? selectedTabHandle
                    : cardNodeHandles[upTargetIndex]
                }
                nextFocusDown={cardNodeHandles[downTargetIndex]}
                style={gridCardStyle}
              />
            );
          }}
        />
      )}
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
  controlsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  modeTabs: {
    flexDirection: "row",
    gap: spacing.sm,
    flex: 1,
  },
  modeTab: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...tvRestingBorder,
  },
  modeTabActive: {
    backgroundColor: colors.primary,
  },
  modeTabText: {
    color: colors.mutedForeground,
    fontSize: tvFontSize.label,
    fontWeight: fontWeight.semibold,
  },
  modeTabTextActive: {
    color: colors.primaryForeground,
    fontWeight: fontWeight.bold,
  },
  iconActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconButton: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    ...tvRestingBorder,
    alignItems: "center",
    justifyContent: "center",
  },

  loaderWrap: {
    marginTop: spacing["2xl"],
    alignItems: "center",
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
  emptyHint: {
    color: colors.mutedForeground,
    fontSize: tvFontSize.body,
  },
  connectButton: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    ...tvRestingBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  connectButtonText: {
    color: colors.primaryForeground,
    fontSize: tvFontSize.label,
    fontWeight: fontWeight.bold,
  },
  indicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...tvRestingBorder,
  },
  indicatorAction: {
    backgroundColor: colors.card,
  },
  indicatorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.pending,
  },
  indicatorDotConnected: {
    backgroundColor: colors.success,
  },
  indicatorDotWarning: {
    backgroundColor: colors.warning,
  },
  indicatorText: {
    color: colors.mutedForeground,
    fontSize: tvFontSize.caption,
    fontWeight: fontWeight.medium,
  },
  errorText: {
    color: colors.destructive,
    fontSize: tvFontSize.body,
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
