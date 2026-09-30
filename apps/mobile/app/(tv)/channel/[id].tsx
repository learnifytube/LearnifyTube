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
import { useConnectionStore } from "../../../stores/connection";
import type { StreamingVideo } from "../../../stores/playback";
import { api } from "../../../services/api";
import { playQueue } from "../../../services/play-queue";
import {
  cacheRemoteCollectionVideos,
  cacheRemotePlaylists,
  resolveRemoteAssetUrl,
} from "../../../services/browseCache";
import { logger } from "../../../services/logger";
import { tvDebugInfo } from "../../../services/tvDebug";
import {
  buildCachedPlaylistId,
  getAllSavedPlaylistsWithProgress,
  getSavedPlaylistWithItems,
  type SavedPlaylistWithItems,
} from "../../../db/repositories/playlists";
import {
  TVCard,
} from "../../../components/tv/TVCard";
import {
  TVFocusPressable,
  type TVFocusPressableHandle,
} from "../../../components/tv/TVFocusPressable";
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
} from "../../../components/tv/grid";
import { useLibraryCatalog } from "../../../core/hooks/useLibraryCatalog";
import { offlineCopy, type OfflineCopy } from "../../../services/offline-copy";
import { videoThumbnails } from "../../../services/video-thumbnails";
import { useTVBackInterceptor } from "../../../components/tv/tvBack";
import { useTVMessage } from "../../../components/tv/TVMessage";
import {
  channelNotFound,
  collectionNotReady,
  describeDesktopRequestFailure,
  notOnThisTV,
  type TVMessageContent,
} from "../../../components/tv/tvMessages";
import type { RemotePlaylist, RemoteVideoWithStatus, Video } from "../../../types";

type DetailMode = "playlists" | "videos";

type BaseGridCard = {
  id: string;
  title: string;
  subtitle: string;
  thumbnailUrl?: string | null;
  type: "playlist" | "video";
};

type OfflineSavedPlaylist = ReturnType<typeof getAllSavedPlaylistsWithProgress>[number];

type OfflineChannelFallback = {
  playlists: RemotePlaylist[];
  videos: RemoteVideoWithStatus[];
  hasChannelSummary: boolean;
};

type ActivePlaylistContext = {
  id: string;
  title: string;
};

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

function toOfflineChannelVideos(
  input: Video[],
  getOfflineUri: OfflineCopy["getUri"]
) {
  return input.map<RemoteVideoWithStatus>((item) => ({
    id: item.id,
    title: item.title,
    channelTitle: item.channelTitle,
    duration: item.duration,
    thumbnailUrl: item.thumbnailUrl ?? null,
    downloadStatus: getOfflineUri(item.id) ? "completed" : "pending",
    downloadProgress: null,
    fileSize: null,
  }));
}

function toSavedPlaylistChannelVideos(
  playlist: SavedPlaylistWithItems,
  getOfflineUri: OfflineCopy["getUri"]
) {
  return playlist.items.map<RemoteVideoWithStatus>((item) => ({
    id: item.videoId,
    title: item.title,
    channelTitle: item.channelTitle,
    duration: item.duration,
    thumbnailUrl: item.thumbnailUrl ?? null,
    downloadStatus: getOfflineUri(item.videoId) ? "completed" : "pending",
    downloadProgress: null,
    fileSize: null,
  }));
}

function toOfflineChannelPlaylists(
  playlists: OfflineSavedPlaylist[]
): RemotePlaylist[] {
  return playlists.map((playlist) => ({
    playlistId: playlist.id.startsWith("playlist_")
      ? playlist.id.slice("playlist_".length)
      : playlist.id,
    title: playlist.title,
    thumbnailUrl: playlist.thumbnailUrl ?? null,
    itemCount: playlist.totalCount,
    channelId: playlist.sourceId ?? null,
    type: "custom",
    downloadedCount: playlist.downloadedCount,
  }));
}

function getOfflineChannelFallback(
  channelId: string | undefined,
  channelTitle: string,
  videos: Video[],
  getOfflineUri: OfflineCopy["getUri"]
): OfflineChannelFallback {
  const savedPlaylists = getAllSavedPlaylistsWithProgress({
    includeUnpinned: true,
  });
  const savedChannelSummary = savedPlaylists.find(
    (item) =>
      item.type === "channel" &&
      ((channelId ? item.sourceId === channelId : false) || item.title === channelTitle)
  );
  const savedChannelPlaylists = channelId
    ? savedPlaylists.filter(
        (item) => item.type === "playlist" && item.sourceId === channelId
      )
    : [];
  const savedChannel = savedChannelSummary
    ? getSavedPlaylistWithItems(savedChannelSummary.id, { includeUnpinned: true })
    : undefined;

  const localVideos = videos.filter((video) => {
    if (video.channelTitle !== channelTitle) {
      return false;
    }
    return !!getOfflineUri(video.id);
  });

  // Offline, only what plays: playlists holding a Video, and the Videos held.
  return {
    playlists: toOfflineChannelPlaylists(
      savedChannelPlaylists.filter((item) => item.downloadedCount > 0)
    ),
    videos: [
      ...(savedChannel
        ? toSavedPlaylistChannelVideos(savedChannel, getOfflineUri)
        : []
      ).filter((item) => item.downloadStatus === "completed"),
      ...toOfflineChannelVideos(
        localVideos.filter(
          (video) => !savedChannel?.items.some((item) => item.videoId === video.id)
        ),
        getOfflineUri
      ),
    ],
    hasChannelSummary: !!savedChannelSummary,
  };
}

function resolveThumbnailUrl(
  serverUrl: string | null,
  thumbnailUrl?: string | null
): string | null {
  return resolveRemoteAssetUrl(serverUrl, thumbnailUrl);
}

export default function TVChannelDetailScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const channelId = Array.isArray(id) ? id[0] : id;
  const channelTitle = (Array.isArray(title) ? title[0] : title) ?? channelId ?? "";
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const { videos, offlineVideos, getOfflineUri } = useLibraryCatalog();
  const getStoredThumbnail = videoThumbnails.useLookup();

  const [detailMode, setDetailMode] = useState<DetailMode>("playlists");
  const [channelPlaylists, setChannelPlaylists] = useState<RemotePlaylist[]>([]);
  const [channelVideos, setChannelVideos] = useState<RemoteVideoWithStatus[]>([]);
  const [pageOffset, setPageOffset] = useState(0);
  const [focusedGridIndex, setFocusedGridIndex] = useState(0);
  const [isGridFocused, setIsGridFocused] = useState(false);
  const [cardNodeHandles, setCardNodeHandles] = useState<Array<number | undefined>>(
    []
  );
  const cardRefs = useRef<Array<TVFocusPressableHandle | null>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<TVMessageContent | null>(null);
  const {
    show: showTVMessage,
    isOpen: isTVMessageOpen,
    element: tvMessageElement,
  } = useTVMessage();
  const [emptyMessage, setEmptyMessage] = useState("No playlists or videos");
  const [isUsingOfflineFallback, setIsUsingOfflineFallback] = useState(!serverUrl);
  const [activePlaylist, setActivePlaylist] =
    useState<ActivePlaylistContext | null>(null);
  const [isResolvingPlaylist, setIsResolvingPlaylist] = useState(false);
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

  const loadChannelData = useCallback(async () => {
    if (!channelId && !channelTitle) {
      setError(channelNotFound);
      setIsLoading(false);
      return;
    }

    setError(null);
    setActivePlaylist(null);
    setIsResolvingPlaylist(false);
    const offlineFallback = getOfflineChannelFallback(
      channelId,
      channelTitle,
      videos,
      // Not the reactive lookup: an Offline copy appearing elsewhere must not
      // re-fetch the channel and drop the viewer out of an open playlist.
      offlineCopy.getUri
    );
    const hasOfflinePlaylists = offlineFallback.playlists.length > 0;
    const hasOfflineVideos = offlineFallback.videos.length > 0;
    const hasOfflineFallback = hasOfflinePlaylists || hasOfflineVideos;
    const offlineEmptyStateMessage = offlineFallback.hasChannelSummary
      ? "Nothing from this channel is on this TV."
      : "No playlists or videos";

    if (!serverUrl) {
      setChannelPlaylists(offlineFallback.playlists);
      setChannelVideos(offlineFallback.videos);
      setDetailMode(hasOfflinePlaylists ? "playlists" : "videos");
      setIsUsingOfflineFallback(true);
      setEmptyMessage(offlineEmptyStateMessage);
      setPageOffset(0);
      setFocusedGridIndex(0);
      setIsLoading(false);
      return;
    }

    setIsUsingOfflineFallback(hasOfflineFallback);
    setChannelPlaylists(hasOfflinePlaylists ? offlineFallback.playlists : []);
    setChannelVideos(hasOfflineVideos ? offlineFallback.videos : []);
    setDetailMode(hasOfflinePlaylists ? "playlists" : "videos");
    setEmptyMessage("No playlists or videos");
    setPageOffset(0);
    setFocusedGridIndex(0);
    setIsLoading(!hasOfflineFallback);

    try {
      const [playlistsResult, channelVideosResult] = await Promise.allSettled([
        api.getPlaylists(serverUrl),
        api.getChannelVideos(serverUrl, channelId),
      ]);
      let nextChannelPlaylists = hasOfflinePlaylists ? offlineFallback.playlists : [];
      let nextChannelVideos = hasOfflineVideos ? offlineFallback.videos : [];
      let hasRemoteSuccess = false;
      let nextError: unknown = null;

      if (playlistsResult.status === "fulfilled") {
        const cachedPlaylists = await cacheRemotePlaylists(
          serverUrl,
          playlistsResult.value.playlists
        );
        nextChannelPlaylists = cachedPlaylists.filter(
          (item) => item.channelId === channelId
        );
        hasRemoteSuccess = true;
      } else {
        nextError = playlistsResult.reason;
      }

      if (channelVideosResult.status === "fulfilled") {
        nextChannelVideos = await cacheRemoteCollectionVideos(serverUrl, {
          kind: "channel",
          id: channelId ?? channelTitle,
          title: channelTitle,
          sourceId: channelId ?? channelTitle,
          itemCount: channelVideosResult.value.videos.length,
          videos: channelVideosResult.value.videos,
        });
        hasRemoteSuccess = true;
      } else if (!nextError) {
        nextError = channelVideosResult.reason;
      }

      if (hasRemoteSuccess) {
        setChannelPlaylists(nextChannelPlaylists);
        setChannelVideos(nextChannelVideos);
        setDetailMode(nextChannelPlaylists.length > 0 ? "playlists" : "videos");
        setError(null);
        setIsUsingOfflineFallback(false);
        setEmptyMessage("No playlists or videos");
        setPageOffset(0);
        setFocusedGridIndex(0);
        return;
      }

      if (hasOfflineFallback) {
        setChannelPlaylists(offlineFallback.playlists);
        setChannelVideos(offlineFallback.videos);
        setDetailMode(hasOfflinePlaylists ? "playlists" : "videos");
        setError(null);
        setIsUsingOfflineFallback(true);
        setEmptyMessage(offlineEmptyStateMessage);
        return;
      }

      if (offlineFallback.hasChannelSummary) {
        setChannelPlaylists([]);
        setChannelVideos([]);
        setDetailMode("videos");
        setError(null);
        setIsUsingOfflineFallback(true);
        setEmptyMessage(offlineEmptyStateMessage);
        return;
      }

      setError(describeDesktopRequestFailure(nextError));
    } catch (nextError) {
      if (hasOfflineFallback) {
        setChannelPlaylists(offlineFallback.playlists);
        setChannelVideos(offlineFallback.videos);
        setDetailMode(hasOfflinePlaylists ? "playlists" : "videos");
        setError(null);
        setIsUsingOfflineFallback(true);
        setEmptyMessage(offlineEmptyStateMessage);
      } else if (offlineFallback.hasChannelSummary) {
        setChannelPlaylists([]);
        setChannelVideos([]);
        setDetailMode("videos");
        setError(null);
        setIsUsingOfflineFallback(true);
        setEmptyMessage(offlineEmptyStateMessage);
      } else {
        setError(describeDesktopRequestFailure(nextError));
      }
    } finally {
      setIsLoading(false);
    }
  }, [channelId, channelTitle, serverUrl, videos]);

  useEffect(() => {
    void loadChannelData();
  }, [loadChannelData]);

  const showPlaylistVideos = useCallback(
    (
      videos: RemoteVideoWithStatus[],
      playlistId: string,
      playlistTitle: string,
      useOfflineFallback: boolean
    ) => {
      setChannelVideos(videos);
      setActivePlaylist({
        id: playlistId,
        title: playlistTitle,
      });
      setDetailMode("videos");
      setIsUsingOfflineFallback(useOfflineFallback);
      setEmptyMessage("No videos in this playlist");
      setPageOffset(0);
      setFocusedGridIndex(0);
      setIsGridFocused(true);
      setError(null);
    },
    []
  );

  const openCachedPlaylist = useCallback(
    (cachedPlaylistId: string, playlistId: string, playlistTitle: string): boolean => {
      const savedPlaylist = getSavedPlaylistWithItems(cachedPlaylistId, {
        includeUnpinned: true,
      });
      const heldVideos = savedPlaylist
        ? toSavedPlaylistChannelVideos(savedPlaylist, getOfflineUri).filter(
            (item) => item.downloadStatus === "completed"
          )
        : [];
      if (heldVideos.length === 0) return false;

      showPlaylistVideos(
        heldVideos,
        playlistId,
        playlistTitle,
        true
      );
      tvDebugInfo("[TV Offline Debug] Open cached playlist", {
        cachedPlaylistId,
        playlistId,
        playlistTitle,
        cachedItemCount: savedPlaylist?.items.length ?? 0,
        localPlayableCount: heldVideos.length,
      });
      return true;
    },
    [getOfflineUri, showPlaylistVideos]
  );

  const openPlaylist = useCallback(
    async (playlistId: string, playlistTitle: string) => {
      const cachedPlaylistId = buildCachedPlaylistId("playlist", playlistId);
      if (!serverUrl || isUsingOfflineFallback) {
        openCachedPlaylist(cachedPlaylistId, playlistId, playlistTitle);
        return;
      }

      setIsResolvingPlaylist(true);
      try {
        const response = await api.getPlaylistVideos(serverUrl, playlistId);
        const playlistMeta = channelPlaylists.find(
          (item) => item.playlistId === playlistId
        );
        const normalizedVideos = await cacheRemoteCollectionVideos(serverUrl, {
          kind: "playlist",
          id: playlistId,
          title: playlistTitle,
          sourceId: playlistMeta?.channelId ?? channelId ?? null,
          thumbnailUrl: playlistMeta?.thumbnailUrl,
          thumbnailFallbackUrl: api.getPlaylistThumbnailUrl(serverUrl, playlistId),
          itemCount: playlistMeta?.itemCount,
          videos: response.videos,
        });
        showPlaylistVideos(
          normalizedVideos,
          playlistId,
          playlistTitle,
          false
        );
      } catch {
        // The desktop may still be fetching this playlist; only the connection's health
        // check decides whether it is gone.
        if (openCachedPlaylist(cachedPlaylistId, playlistId, playlistTitle)) {
          return;
        }
        showTVMessage(collectionNotReady);
      } finally {
        setIsResolvingPlaylist(false);
      }
    },
    [
      channelId,
      channelPlaylists,
      isUsingOfflineFallback,
      openCachedPlaylist,
      serverUrl,
      showPlaylistVideos,
      showTVMessage,
    ]
  );

  const playFromChannelVideos = useCallback(
    (videoId: string) => {
      const selectedVideo = channelVideos.find((item) => item.id === videoId);
      if (!selectedVideo) return;
      const canStream = !!serverUrl && !isUsingOfflineFallback;

      if (!canStream && !getOfflineUri(videoId)) {
        // Connected but showing what the TV holds means the desktop didn't answer.
        showTVMessage(
          serverUrl ? describeDesktopRequestFailure(null) : notOnThisTV
        );
        return;
      }

      const streamingVideos = toStreamingVideos(channelVideos, serverUrl);
      const playableVideos = canStream
        ? streamingVideos
        : streamingVideos.filter((item) => getOfflineUri(item.id) !== null);
      tvDebugInfo("[TV Playback Debug] Channel playlist prepared", {
        videoId,
        playbackPlaylistId: activePlaylist?.id ?? channelId ?? channelTitle,
        totalVideos: streamingVideos.length,
        localPlayableCount: streamingVideos.filter(
          (item) => getOfflineUri(item.id) !== null
        ).length,
        canStream,
      });
      const startIndex = playableVideos.findIndex((item) => item.id === videoId);
      if (startIndex < 0 || playableVideos.length === 0) return;

      const playbackPlaylistId = activePlaylist
        ? `playlist-${activePlaylist.id}`
        : `channel-${channelId ?? channelTitle}`;
      const playbackTitle = activePlaylist?.title ?? channelTitle ?? "Channel";
      playQueue.start({
        id: playbackPlaylistId,
        title: playbackTitle,
        videos: playableVideos,
        startIndex,
      });
      router.push(`/(tv)/player/${videoId}` as Href);
    },
    [
      channelVideos,
      channelId,
      channelTitle,
      activePlaylist,
      getOfflineUri,
      isUsingOfflineFallback,
      serverUrl,
      showTVMessage,
    ]
  );

  const closePlaylist = useCallback(() => {
    if (detailMode !== "videos" || !activePlaylist) return false;

    setDetailMode("playlists");
    setActivePlaylist(null);
    setPageOffset(0);
    setFocusedGridIndex(0);
    setIsGridFocused(true);
    setIsResolvingPlaylist(false);
    return true;
  }, [activePlaylist, detailMode]);

  const handleBack = useCallback(() => {
    if (!closePlaylist()) router.back();
  }, [closePlaylist]);

  useTVBackInterceptor(closePlaylist);

  const cards = useMemo<BaseGridCard[]>(() => {
    const thumbnailServerUrl = isUsingOfflineFallback ? null : serverUrl;

    if (detailMode === "playlists") {
      return channelPlaylists.map((item) => ({
        id: item.playlistId,
        title: item.title,
        subtitle: `${item.downloadedCount} ready`,
        thumbnailUrl:
          resolveThumbnailUrl(thumbnailServerUrl, item.thumbnailUrl) ??
          (thumbnailServerUrl
            ? api.getPlaylistThumbnailUrl(thumbnailServerUrl, item.playlistId)
            : null),
        type: "playlist",
      }));
    }

    return channelVideos.map((item) => ({
      id: item.id,
      title: item.title,
      subtitle: item.channelTitle,
      thumbnailUrl:
        getStoredThumbnail(item.id) ??
        resolveThumbnailUrl(thumbnailServerUrl, item.thumbnailUrl) ??
        (thumbnailServerUrl ? api.getThumbnailUrl(thumbnailServerUrl, item.id) : null),
      type: "video",
    }));
  }, [
    channelPlaylists,
    channelVideos,
    detailMode,
    getStoredThumbnail,
    isUsingOfflineFallback,
    serverUrl,
  ]);

  const maxOffset = Math.max(0, cards.length - pageSize);
  const clampedOffset = Math.min(pageOffset, maxOffset);
  const pageItems = useMemo(
    () => cards.slice(clampedOffset, clampedOffset + pageSize),
    [cards, clampedOffset, pageSize]
  );

  useEffect(() => {
    setCardNodeHandles([]);
    cardRefs.current = [];
  }, [clampedOffset, detailMode, pageItems.length]);

  useEffect(() => {
    setCardNodeHandles(
      pageItems.map((_, index) => {
        const node = cardRefs.current[index];
        return node ? findNodeHandle(node) ?? undefined : undefined;
      })
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
        if (typeof event.eventKeyAction === "number" && event.eventKeyAction !== 0) {
          return;
        }

        if (
          event.eventType === "right" &&
          isRightEdgeGridIndex(focusedGridIndex, gridColumns, pageItems.length)
        ) {
          const nextOffset = Math.min(clampedOffset + 1, maxOffset);
          if (nextOffset !== clampedOffset) {
            const nextGlobalIndex = Math.min(
              clampedOffset + focusedGridIndex + 1,
              cards.length - 1
            );
            const nextPageCount = Math.min(pageSize, cards.length - nextOffset);
            setPageOffset(nextOffset);
            setFocusedGridIndex(
              clampGridFocusIndex(nextGlobalIndex, nextOffset, nextPageCount)
            );
          }
        }

        if (
          event.eventType === "left" &&
          isLeftEdgeGridIndex(focusedGridIndex, gridColumns) &&
          clampedOffset > 0
        ) {
          const nextOffset = Math.max(0, clampedOffset - 1);
          if (nextOffset !== clampedOffset) {
            const nextGlobalIndex = Math.max(clampedOffset + focusedGridIndex - 1, 0);
            const nextPageCount = Math.min(pageSize, cards.length - nextOffset);
            setPageOffset(nextOffset);
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
    cards.length,
    clampedOffset,
    focusedGridIndex,
    gridColumns,
    isGridFocused,
    maxOffset,
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
          <ActivityIndicator size="large" color="#ffd93d" />
        </View>
      ) : null}

      {!isLoading && isResolvingPlaylist ? (
        <View style={styles.selectionLoader}>
          <ActivityIndicator size="large" color="#ffd93d" />
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
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : null}

      {!isLoading && !error && cards.length > 0 ? (
        <FlatList
          data={pageItems}
          key={`${detailMode}-${clampedOffset}`}
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
                onPress={() => {
                  if (item.type === "playlist") {
                    void openPlaylist(item.id, item.title);
                  } else {
                    playFromChannelVideos(item.id);
                  }
                }}
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
    backgroundColor: "#0f1b3a",
    paddingHorizontal: TV_GRID_SIDE_PADDING,
    paddingBottom: 24,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  backButton: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff8a00",
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  backButtonText: {
    color: "#fffef2",
    fontSize: 20,
    fontWeight: "900",
  },
  settingsButton: {
    borderRadius: 16,
    backgroundColor: "#ff6b6b",
    borderColor: "#ffb86b",
    borderWidth: 2,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  settingsButtonText: {
    color: "#fffdf4",
    fontSize: 20,
    fontWeight: "800",
  },
  loaderWrap: {
    marginTop: 48,
    alignItems: "center",
  },
  selectionLoader: {
    position: "absolute",
    top: 96,
    right: TV_GRID_SIDE_PADDING,
    zIndex: 20,
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
  errorText: {
    color: "#ffe3e3",
    fontSize: 16,
    fontWeight: "700",
  },
  retryButton: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff6b6b",
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryButtonText: {
    color: "#fffef2",
    fontSize: 18,
    fontWeight: "900",
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
