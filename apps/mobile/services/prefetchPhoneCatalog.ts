import { api } from "./api";
import { cacheRecentlyAddedVideos } from "./browseCache";
import { markBrowseCacheChanged, useSyncStore } from "../stores/sync";

/**
 * Refresh the Catalog snapshot behind the phone's Home rows:
 * metadata for collections (channels, playlists, mylists) and desktop library videos.
 * Individual collection videos are fetched on-demand when opened in Discover.
 */
export async function prefetchPhoneCatalog(serverUrl: string): Promise<void> {
  const startedAt = Date.now();
  const sync = useSyncStore.getState();

  await Promise.all([
    sync.fetchChannels(serverUrl),
    sync.fetchMyLists(serverUrl),
    sync.fetchPlaylists(serverUrl),
  ]);

  try {
    const { videos } = await api.getVideos(serverUrl);
    await cacheRecentlyAddedVideos(serverUrl, videos);
  } catch (error) {
    console.warn("[PhoneCatalog] Failed to fetch recently added videos:", error);
  }

  console.info(
    `[PhoneCatalog] Refreshed catalog metadata in ${Date.now() - startedAt} ms`,
  );

  markBrowseCacheChanged();
}
