import { api } from "../api";
import { useCurrentVideosStore } from "../../stores/currentVideos";
import { useDesktopWatchedStore } from "../../stores/desktopWatched";
import { collectionQueueId, type RemoteCollectionKind } from "./queueId";

export * from "./queueId";

/**
 * Loads a desktop List or YouTube playlist and keeps what it says about
 * resuming it (ADR-0006): which collection its queue id names, its Current
 * Video (newest wins with this Device's) and the desktop's Watch state of its
 * Videos. A desktop older than resume says none of these.
 */
export async function loadRemoteCollection(
  serverUrl: string,
  kind: RemoteCollectionKind,
  id: string,
) {
  const response =
    kind === "playlist"
      ? await api.getPlaylistVideos(serverUrl, id)
      : await api.getMyListVideos(serverUrl, id);
  const currentVideos = useCurrentVideosStore.getState();
  if (response.collection)
    currentVideos.rememberCollection(
      collectionQueueId(kind, id),
      response.collection,
    );
  if (response.currentVideo) currentVideos.keep(response.currentVideo);
  useDesktopWatchedStore.getState().remember(response.watchedOnDesktop);
  return response;
}
