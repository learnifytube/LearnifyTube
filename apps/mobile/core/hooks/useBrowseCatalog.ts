import { useMemo } from "react";
import type { BrowseCachePlaylistKind } from "../../db/repositories/playlists";
import type { RemoteVideoWithStatus } from "../../types";
import {
  getCachedCollectionVideos,
  getCatalogSnapshot,
} from "../../services/browseCache";
import { useLibraryStore } from "../../stores/library";
import { useSyncStore } from "../../stores/sync";

export function useBrowseCatalog() {
  const browseCacheVersion = useSyncStore((state) => state.browseCacheVersion);
  const libraryVideos = useLibraryStore((state) => state.videos);

  return useMemo(
    () => getCatalogSnapshot(),
    [browseCacheVersion, libraryVideos]
  );
}

export function useBrowseCollectionVideos(
  kind: BrowseCachePlaylistKind | null,
  id: string | null
): RemoteVideoWithStatus[] {
  const browseCacheVersion = useSyncStore((state) => state.browseCacheVersion);
  const libraryVideos = useLibraryStore((state) => state.videos);

  return useMemo(() => {
    if (!kind || !id) {
      return [];
    }

    return getCachedCollectionVideos(kind, id);
  }, [kind, id, browseCacheVersion, libraryVideos]);
}
