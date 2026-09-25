import { useMemo } from "react";
import { offlineCopy } from "../../services/offline-copy";
import { useLibraryStore } from "../../stores/library";
import type { TVLibraryVideoItem } from "../types/surface";

export function useLibraryCatalog() {
  const videos = useLibraryStore((state) => state.videos);
  const getOfflineUri = offlineCopy.useLookup();

  const offlineVideos: TVLibraryVideoItem[] = useMemo(
    () =>
      videos
        .filter((item) => !!getOfflineUri(item.id))
        .map((item) => ({
          id: item.id,
          title: item.title,
          channelTitle: item.channelTitle,
          duration: item.duration,
          thumbnailUrl: item.thumbnailUrl,
        })),
    [getOfflineUri, videos]
  );

  return {
    videos,
    offlineVideos,
    getOfflineUri,
  };
}
