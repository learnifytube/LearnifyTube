import { api } from "./api";
import {
  cacheRemoteCollectionVideos,
  getCachedChannels,
  getCachedMyLists,
  getCachedPlaylists,
} from "./browseCache";
import { useSyncStore } from "../stores/sync";

/** Load Home row contents into the browse cache without changing the old selected-item UI. */
export async function prefetchPhoneCatalog(serverUrl: string): Promise<void> {
  const sync = useSyncStore.getState();
  await Promise.all([
    sync.fetchChannels(serverUrl),
    sync.fetchMyLists(serverUrl),
    sync.fetchPlaylists(serverUrl),
  ]);

  const channels = getCachedChannels();
  const myLists = getCachedMyLists();
  const playlists = getCachedPlaylists();

  await Promise.all([
    ...channels.map(async (channel) => {
      try {
        const { videos } = await api.getChannelVideos(
          serverUrl,
          channel.channelId,
        );
        await cacheRemoteCollectionVideos(serverUrl, {
          kind: "channel",
          id: channel.channelId,
          title: channel.channelTitle,
          sourceId: channel.channelId,
          thumbnailUrl: channel.thumbnailUrl,
          itemCount: channel.videoCount,
          videos,
        });
      } catch {
        // Keep the cached row if this Channel's Videos fail to load.
      }
    }),
    ...myLists.map(async (list) => {
      try {
        const { videos } = await api.getMyListVideos(serverUrl, list.id);
        await cacheRemoteCollectionVideos(serverUrl, {
          kind: "mylist",
          id: list.id,
          title: list.name,
          sourceId: list.sourceId,
          thumbnailUrl: list.thumbnailUrl,
          itemCount: list.itemCount,
          videos,
        });
      } catch {
        // Keep the cached row if this List's Videos fail to load.
      }
    }),
    ...playlists.map(async (playlist) => {
      try {
        const { videos } = await api.getPlaylistVideos(
          serverUrl,
          playlist.playlistId,
        );
        await cacheRemoteCollectionVideos(serverUrl, {
          kind: "playlist",
          id: playlist.playlistId,
          title: playlist.title,
          sourceId: playlist.channelId,
          thumbnailUrl: playlist.thumbnailUrl,
          thumbnailFallbackUrl: api.getPlaylistThumbnailUrl(
            serverUrl,
            playlist.playlistId,
          ),
          itemCount: playlist.itemCount,
          videos,
        });
      } catch {
        // Keep the cached row if this playlist's Videos fail to load.
      }
    }),
  ]);

  useSyncStore.setState((state) => ({
    browseCacheVersion: state.browseCacheVersion + 1,
  }));
}
