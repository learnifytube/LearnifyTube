import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  RemoteChannel,
  RemotePlaylist,
  RemoteFavorite,
  RemoteVideoWithStatus,
  ServerDownloadStatus,
  RemoteMyList,
  BrowseTab,
} from "../types";
import { api } from "../services/api";
import {
  cacheRemoteChannels,
  getCachedChannels,
  getCachedCollectionVideos,
  hasCachedCollectionVideos,
  getCachedMyLists,
  getCachedPlaylists,
  cacheRemoteCollectionVideos,
  cacheRemoteMyLists,
  cacheRemotePlaylists,
} from "../services/browseCache";
import * as favoritesRepo from "../db/repositories/favorites";

type FavoriteEntityType = "video" | "custom_playlist" | "channel_playlist";

type SyncTab = BrowseTab;

interface SyncStore {
  // Tab state
  activeTab: SyncTab;
  setActiveTab: (tab: SyncTab) => void;

  // Loading states
  isLoadingChannels: boolean;
  isLoadingPlaylists: boolean;
  isLoadingFavorites: boolean;
  isLoadingVideos: boolean;
  isLoadingSubscriptions: boolean;
  isLoadingMyLists: boolean;

  // Error states
  channelsError: string | null;
  playlistsError: string | null;
  favoritesError: string | null;
  videosError: string | null;
  subscriptionsError: string | null;
  myListsError: string | null;

  // Data
  browseCacheVersion: number;
  channels: RemoteChannel[];
  playlists: RemotePlaylist[];
  favorites: RemoteFavorite[];
  myLists: RemoteMyList[];
  channelVideosCache: Record<string, RemoteVideoWithStatus[]>;
  playlistVideosCache: Record<string, RemoteVideoWithStatus[]>;
  myListVideosCache: Record<string, RemoteVideoWithStatus[]>;

  // Selected item + its videos
  selectedChannel: RemoteChannel | null;
  channelVideos: RemoteVideoWithStatus[];
  selectedPlaylist: RemotePlaylist | null;
  playlistVideos: RemoteVideoWithStatus[];
  subscriptionVideos: RemoteVideoWithStatus[];
  selectedMyList: RemoteMyList | null;
  myListVideos: RemoteVideoWithStatus[];

  // Server download tracking
  serverDownloadRequests: Map<string, ServerDownloadStatus>;

  // Selection for batch operations
  selectedVideoIds: Set<string>;

  // Track favorited playlist IDs for quick lookup
  favoritePlaylistIds: Set<string>;

  // Actions
  fetchChannels: (serverUrl: string) => Promise<void>;
  fetchPlaylists: (serverUrl: string) => Promise<void>;
  fetchFavorites: (serverUrl: string) => Promise<void>;
  loadFavoritesLocal: () => void;
  fetchChannelVideos: (serverUrl: string, channel: RemoteChannel) => Promise<void>;
  fetchPlaylistVideos: (serverUrl: string, playlist: RemotePlaylist) => Promise<void>;
  fetchSubscriptions: (serverUrl: string) => Promise<void>;
  fetchMyLists: (serverUrl: string) => Promise<void>;
  fetchMyListVideos: (serverUrl: string, myList: RemoteMyList) => Promise<void>;

  selectChannel: (channel: RemoteChannel | null) => void;
  selectPlaylist: (playlist: RemotePlaylist | null) => void;
  selectMyList: (myList: RemoteMyList | null) => void;

  toggleVideoSelection: (videoId: string) => void;
  selectAllVideos: () => void;
  clearVideoSelection: () => void;

  updateServerDownloadStatus: (videoId: string, status: ServerDownloadStatus) => void;
  clearServerDownloadStatus: (videoId: string) => void;

  // Favorites management
  addToFavorites: (
    serverUrl: string | null,
    entityType: FavoriteEntityType,
    entityId: string
  ) => Promise<void>;
  removeFromFavorites: (
    serverUrl: string | null,
    entityType: FavoriteEntityType,
    entityId: string
  ) => Promise<void>;

  reset: () => void;
}

interface SyncCacheState {
  activeTab: SyncTab;
}

const initialState = {
  activeTab: "mylists" as SyncTab,
  isLoadingChannels: false,
  isLoadingPlaylists: false,
  isLoadingFavorites: false,
  isLoadingVideos: false,
  isLoadingSubscriptions: false,
  isLoadingMyLists: false,
  channelsError: null,
  playlistsError: null,
  favoritesError: null,
  videosError: null,
  subscriptionsError: null,
  myListsError: null,
  browseCacheVersion: 0,
  channels: [],
  playlists: [],
  favorites: [],
  myLists: [],
  channelVideosCache: {},
  playlistVideosCache: {},
  myListVideosCache: {},
  selectedChannel: null,
  channelVideos: [],
  selectedPlaylist: null,
  playlistVideos: [],
  subscriptionVideos: [],
  selectedMyList: null,
  myListVideos: [],
  serverDownloadRequests: new Map<string, ServerDownloadStatus>(),
  selectedVideoIds: new Set<string>(),
  favoritePlaylistIds: new Set<string>(),
};

export const useSyncStore = create<SyncStore>()(
  persist(
    (set, get) => {
      const readFavoriteSnapshot = () => favoritesRepo.getFavoritesSnapshotLocal();
      const applyFavoriteSnapshot = (overrides?: Partial<SyncStore>) => {
        const snapshot = readFavoriteSnapshot();
        set({
          favorites: snapshot.favorites,
          favoritePlaylistIds: snapshot.favoritePlaylistIds,
          ...overrides,
        });
        return snapshot;
      };

      const syncPendingFavoriteActions = async (serverUrl: string) => {
        const pendingActions = favoritesRepo.getPendingFavoriteActionsLocal();

        for (const action of pendingActions) {
          const entityType = action.entityType as FavoriteEntityType;
          if (action.pendingAction === "add") {
            await api.addFavorite(serverUrl, entityType, action.entityId);
            favoritesRepo.resolveFavoriteSyncLocal(entityType, action.entityId, true);
            continue;
          }

          if (action.pendingAction === "remove") {
            await api.removeFavorite(serverUrl, entityType, action.entityId);
            favoritesRepo.resolveFavoriteSyncLocal(entityType, action.entityId, false);
          }
        }
      };

      return {
        ...initialState,
        setActiveTab: (tab) => {
          set({
            activeTab: tab,
            selectedChannel: null,
            channelVideos: [],
            selectedPlaylist: null,
            playlistVideos: [],
            selectedMyList: null,
            myListVideos: [],
            selectedVideoIds: new Set(),
            videosError: null,
          });
        },

        fetchChannels: async (serverUrl) => {
          set({ isLoadingChannels: true, channelsError: null });
          try {
            const { channels: remoteChannels } = await api.getChannels(serverUrl);
            const channels = await cacheRemoteChannels(serverUrl, remoteChannels);
            set((state) => ({
              channels,
              isLoadingChannels: false,
              browseCacheVersion: state.browseCacheVersion + 1,
            }));
          } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to fetch channels";
            const hasCachedChannels = getCachedChannels().length > 0;
            set({
              channelsError: hasCachedChannels ? null : message,
              isLoadingChannels: false,
            });
          }
        },

      fetchPlaylists: async (serverUrl) => {
        set({ isLoadingPlaylists: true, playlistsError: null });
        try {
          const { playlists: remotePlaylists } = await api.getPlaylists(serverUrl);
          const playlists = await cacheRemotePlaylists(serverUrl, remotePlaylists);
          set((state) => ({
            playlists,
            isLoadingPlaylists: false,
            browseCacheVersion: state.browseCacheVersion + 1,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to fetch playlists";
          const hasCachedPlaylists = getCachedPlaylists().length > 0;
          set({
            playlistsError: hasCachedPlaylists ? null : message,
            isLoadingPlaylists: false,
          });
        }
      },

      loadFavoritesLocal: () => {
        applyFavoriteSnapshot();
      },

      fetchFavorites: async (serverUrl) => {
        applyFavoriteSnapshot({
          isLoadingFavorites: true,
          favoritesError: null,
        });
        try {
          await syncPendingFavoriteActions(serverUrl);
          const { favorites } = await api.getFavorites(serverUrl);
          favoritesRepo.mergeRemoteFavorites(favorites);
          applyFavoriteSnapshot({
            isLoadingFavorites: false,
            favoritesError: null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to fetch favorites";
          const snapshot = readFavoriteSnapshot();
          set({
            favorites: snapshot.favorites,
            favoritePlaylistIds: snapshot.favoritePlaylistIds,
            favoritesError:
              snapshot.favorites.length > 0 ||
              snapshot.favoritePlaylistIds.size > 0 ||
              favoritesRepo.hasPendingFavoriteActionsLocal()
                ? null
                : message,
            isLoadingFavorites: false,
          });
        }
      },

      fetchChannelVideos: async (serverUrl, channel) => {
        const cachedVideos = getCachedCollectionVideos("channel", channel.channelId);
        const hasHydratedVideos = hasCachedCollectionVideos("channel", channel.channelId);
        set({
          isLoadingVideos: true,
          videosError: null,
          selectedChannel: channel,
          selectedPlaylist: null,
          selectedMyList: null,
          channelVideos: cachedVideos,
          playlistVideos: [],
          myListVideos: [],
          selectedVideoIds: new Set(),
        });
        try {
          const { videos: remoteVideos } = await api.getChannelVideos(
            serverUrl,
            channel.channelId
          );
          const videos = await cacheRemoteCollectionVideos(serverUrl, {
            kind: "channel",
            id: channel.channelId,
            title: channel.channelTitle,
            sourceId: channel.channelId,
            thumbnailUrl: channel.thumbnailUrl,
            itemCount: channel.videoCount,
            videos: remoteVideos,
          });
          set((state) => ({
            channelVideos: videos,
            channelVideosCache: {
              ...state.channelVideosCache,
              [channel.channelId]: videos,
            },
            isLoadingVideos: false,
            browseCacheVersion: state.browseCacheVersion + 1,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to fetch videos";
          set({
            videosError: hasHydratedVideos ? null : message,
            isLoadingVideos: false,
            channelVideos: cachedVideos,
          });
        }
      },

      fetchPlaylistVideos: async (serverUrl, playlist) => {
        const cachedVideos = getCachedCollectionVideos("playlist", playlist.playlistId);
        const hasHydratedVideos = hasCachedCollectionVideos("playlist", playlist.playlistId);
        set({
          isLoadingVideos: true,
          videosError: null,
          selectedPlaylist: playlist,
          selectedChannel: null,
          selectedMyList: null,
          playlistVideos: cachedVideos,
          channelVideos: [],
          myListVideos: [],
          selectedVideoIds: new Set(),
        });
        try {
          const { videos: remoteVideos } = await api.getPlaylistVideos(
            serverUrl,
            playlist.playlistId
          );
          const videos = await cacheRemoteCollectionVideos(serverUrl, {
            kind: "playlist",
            id: playlist.playlistId,
            title: playlist.title,
            sourceId: playlist.channelId,
            thumbnailUrl: playlist.thumbnailUrl,
            thumbnailFallbackUrl: api.getPlaylistThumbnailUrl(
              serverUrl,
              playlist.playlistId
            ),
            itemCount: playlist.itemCount,
            videos: remoteVideos,
          });
          set((state) => ({
            playlistVideos: videos,
            playlistVideosCache: {
              ...state.playlistVideosCache,
              [playlist.playlistId]: videos,
            },
            isLoadingVideos: false,
            browseCacheVersion: state.browseCacheVersion + 1,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to fetch videos";
          set({
            videosError: hasHydratedVideos ? null : message,
            isLoadingVideos: false,
            playlistVideos: cachedVideos,
          });
        }
      },

      fetchSubscriptions: async (serverUrl) => {
        set({ isLoadingSubscriptions: true, subscriptionsError: null });
        try {
          const { videos } = await api.getSubscriptions(serverUrl);
          set({ subscriptionVideos: videos, isLoadingSubscriptions: false });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to fetch subscriptions";
          const hasCachedSubscriptions = get().subscriptionVideos.length > 0;
          set({
            subscriptionsError: hasCachedSubscriptions ? null : message,
            isLoadingSubscriptions: false,
          });
        }
      },

      fetchMyLists: async (serverUrl) => {
        set({ isLoadingMyLists: true, myListsError: null });
        try {
          const { mylists: remoteMyLists } = await api.getMyLists(serverUrl);
          const myLists = await cacheRemoteMyLists(serverUrl, remoteMyLists);
          set((state) => ({
            myLists,
            isLoadingMyLists: false,
            browseCacheVersion: state.browseCacheVersion + 1,
          }));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to fetch my lists";
          const hasCachedMyLists = getCachedMyLists().length > 0;
          set({
            myListsError: hasCachedMyLists ? null : message,
            isLoadingMyLists: false,
          });
        }
      },

      fetchMyListVideos: async (serverUrl, myList) => {
        const cachedVideos = getCachedCollectionVideos("mylist", myList.id);
        const hasHydratedVideos = hasCachedCollectionVideos("mylist", myList.id);
        set({
          isLoadingVideos: true,
          videosError: null,
          selectedMyList: myList,
          selectedChannel: null,
          selectedPlaylist: null,
          myListVideos: cachedVideos,
          channelVideos: [],
          playlistVideos: [],
          selectedVideoIds: new Set(),
        });
        try {
          const { videos: remoteVideos } = await api.getMyListVideos(serverUrl, myList.id);
          const videos = await cacheRemoteCollectionVideos(serverUrl, {
            kind: "mylist",
            id: myList.id,
            title: myList.name,
            sourceId: myList.id,
            thumbnailUrl: myList.thumbnailUrl,
            itemCount: myList.itemCount,
            videos: remoteVideos,
          });
          set((state) => ({
            myListVideos: videos,
            myListVideosCache: {
              ...state.myListVideosCache,
              [myList.id]: videos,
            },
            isLoadingVideos: false,
            browseCacheVersion: state.browseCacheVersion + 1,
          }));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to fetch videos";
          set({
            videosError: hasHydratedVideos ? null : message,
            isLoadingVideos: false,
            myListVideos: cachedVideos,
          });
        }
      },

      selectChannel: (channel) => {
        const channelVideos = channel
          ? getCachedCollectionVideos("channel", channel.channelId)
          : [];
        set({
          selectedChannel: channel,
          selectedPlaylist: null,
          selectedMyList: null,
          channelVideos,
          playlistVideos: [],
          myListVideos: [],
          selectedVideoIds: new Set(),
          videosError: null,
          isLoadingVideos: false,
        });
      },

      selectPlaylist: (playlist) => {
        const playlistVideos = playlist
          ? getCachedCollectionVideos("playlist", playlist.playlistId)
          : [];
        set({
          selectedPlaylist: playlist,
          selectedChannel: null,
          selectedMyList: null,
          playlistVideos,
          channelVideos: [],
          myListVideos: [],
          selectedVideoIds: new Set(),
          videosError: null,
          isLoadingVideos: false,
        });
      },

      selectMyList: (myList) => {
        const myListVideos = myList
          ? getCachedCollectionVideos("mylist", myList.id)
          : [];
        set({
          selectedMyList: myList,
          selectedChannel: null,
          selectedPlaylist: null,
          myListVideos,
          channelVideos: [],
          playlistVideos: [],
          selectedVideoIds: new Set(),
          videosError: null,
          isLoadingVideos: false,
        });
      },

      toggleVideoSelection: (videoId) => {
        const { selectedVideoIds } = get();
        const newSelection = new Set(selectedVideoIds);
        if (newSelection.has(videoId)) {
          newSelection.delete(videoId);
        } else {
          newSelection.add(videoId);
        }
        set({ selectedVideoIds: newSelection });
      },

      selectAllVideos: () => {
        const {
          activeTab,
          selectedChannel,
          selectedPlaylist,
          selectedMyList,
        } = get();
        let videos: RemoteVideoWithStatus[] = [];
        if (activeTab === "channels" && selectedChannel) {
          videos = getCachedCollectionVideos("channel", selectedChannel.channelId);
        } else if (activeTab === "playlists" && selectedPlaylist) {
          videos = getCachedCollectionVideos("playlist", selectedPlaylist.playlistId);
        } else if (activeTab === "mylists" && selectedMyList) {
          videos = getCachedCollectionVideos("mylist", selectedMyList.id);
        }
        const downloadableVideos = videos.filter((v) => v.downloadStatus === "completed");
        set({ selectedVideoIds: new Set(downloadableVideos.map((v) => v.id)) });
      },

      clearVideoSelection: () => {
        set({ selectedVideoIds: new Set() });
      },

      updateServerDownloadStatus: (videoId, status) => {
        const { serverDownloadRequests } = get();
        const newMap = new Map(serverDownloadRequests);
        newMap.set(videoId, status);
        set({ serverDownloadRequests: newMap });
      },

      clearServerDownloadStatus: (videoId) => {
        const { serverDownloadRequests } = get();
        const newMap = new Map(serverDownloadRequests);
        newMap.delete(videoId);
        set({ serverDownloadRequests: newMap });
      },

      addToFavorites: async (serverUrl, entityType, entityId) => {
        favoritesRepo.addFavoriteLocal(entityType, entityId);
        applyFavoriteSnapshot();

        if (!serverUrl) {
          return;
        }

        try {
          await syncPendingFavoriteActions(serverUrl);
          const { favorites } = await api.getFavorites(serverUrl);
          favoritesRepo.mergeRemoteFavorites(favorites);
          applyFavoriteSnapshot();
        } catch (error) {
          console.error("[SyncStore] Failed to add favorite:", error);
          applyFavoriteSnapshot();
        }
      },

      removeFromFavorites: async (serverUrl, entityType, entityId) => {
        favoritesRepo.removeFavoriteLocal(entityType, entityId);
        applyFavoriteSnapshot();

        if (!serverUrl) {
          return;
        }

        try {
          await syncPendingFavoriteActions(serverUrl);
          const { favorites } = await api.getFavorites(serverUrl);
          favoritesRepo.mergeRemoteFavorites(favorites);
          applyFavoriteSnapshot();
        } catch (error) {
          console.error("[SyncStore] Failed to remove favorite:", error);
          applyFavoriteSnapshot();
        }
      },

        reset: () => {
          set({
            ...initialState,
            serverDownloadRequests: new Map(),
            selectedVideoIds: new Set(),
            favoritePlaylistIds: new Set(),
          });
        },
      };
    },
    {
      name: "learnify-sync-cache",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state): SyncCacheState => ({
        activeTab: state.activeTab,
      }),
    }
  )
);

/** Screens reading the Catalog snapshot read it again after a write outside this store. */
export function markBrowseCacheChanged() {
  useSyncStore.setState((state) => ({
    browseCacheVersion: state.browseCacheVersion + 1,
  }));
}
