import { api } from "./api";
import {
  cacheRemoteCollectionVideos,
  getCachedChannels,
  getCachedMyLists,
  getCachedPlaylists,
  shouldRefreshCollectionVideos,
} from "./browseCache";
import type { BrowseCachePlaylistKind } from "../db/repositories/playlists";
import type { RemoteVideoWithStatus } from "../types";
import { useSyncStore } from "../stores/sync";

type CollectionRequest = {
  kind: BrowseCachePlaylistKind;
  id: string;
  title: string;
  sourceId?: string | null;
  thumbnailUrl?: string | null;
  thumbnailFallbackUrl?: string | null;
  itemCount?: number | null;
  load: () => Promise<{ videos: RemoteVideoWithStatus[] }>;
};

/**
 * Refresh the Catalog snapshot behind the phone's Home rows. Collections fetched
 * in the last 15 minutes are left alone, and Video thumbnails are not downloaded.
 */
export async function prefetchPhoneCatalog(serverUrl: string): Promise<void> {
  const startedAt = Date.now();
  const sync = useSyncStore.getState();
  await Promise.all([
    sync.fetchChannels(serverUrl),
    sync.fetchMyLists(serverUrl),
    sync.fetchPlaylists(serverUrl),
  ]);

  const requests: CollectionRequest[] = [
    ...getCachedChannels().map((channel) => ({
      kind: "channel" as const,
      id: channel.channelId,
      title: channel.channelTitle,
      sourceId: channel.channelId,
      thumbnailUrl: channel.thumbnailUrl,
      itemCount: channel.videoCount,
      load: () => api.getChannelVideos(serverUrl, channel.channelId),
    })),
    ...getCachedMyLists().map((list) => ({
      kind: "mylist" as const,
      id: list.id,
      title: list.name,
      sourceId: list.sourceId,
      thumbnailUrl: list.thumbnailUrl,
      itemCount: list.itemCount,
      load: () => api.getMyListVideos(serverUrl, list.id),
    })),
    ...getCachedPlaylists().map((playlist) => ({
      kind: "playlist" as const,
      id: playlist.playlistId,
      title: playlist.title,
      sourceId: playlist.channelId,
      thumbnailUrl: playlist.thumbnailUrl,
      thumbnailFallbackUrl: api.getPlaylistThumbnailUrl(
        serverUrl,
        playlist.playlistId,
      ),
      itemCount: playlist.itemCount,
      load: () => api.getPlaylistVideos(serverUrl, playlist.playlistId),
    })),
  ];
  const stale = requests.filter((request) =>
    shouldRefreshCollectionVideos(request.kind, request.id),
  );

  let videoCount = 0;
  await Promise.all(
    stale.map(async ({ load, ...collection }) => {
      try {
        const { videos } = await load();
        await cacheRemoteCollectionVideos(serverUrl, {
          ...collection,
          videos,
        });
        videoCount += videos.length;
      } catch {
        // Keep the cached row if this collection's Videos fail to load.
      }
    }),
  );

  console.info(
    `[PhoneCatalog] Refreshed ${stale.length}/${requests.length} collections, ${videoCount} Videos in ${Date.now() - startedAt} ms`,
  );

  useSyncStore.setState((state) => ({
    browseCacheVersion: state.browseCacheVersion + 1,
  }));
}
