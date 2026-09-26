import { asc, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import {
  customPlaylistItems,
  customPlaylists,
  favorites,
  phoneListItems,
  videoWatchStats,
  youtubeVideos,
} from "@/api/db/schema";
import { getWatchState, type WatchState } from "@/lib/watch-state";
import { BUILT_IN_LIST_NAMES, FAVORITES_LIST_ID, PHONE_LIST_ID } from "@/lib/lists";
import { isKept } from "./kept";

type LibraryVideo = {
  videoId: string;
  title: string;
  channelId: string | null;
  channelTitle: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  downloadStatus: string | null;
  downloadProgress: number | null;
  keptAt: number;
  lastPositionSeconds: number | null;
  lastWatchedAt: number | null;
  watchState: WatchState;
  listIds: string[];
};

// Every Video in the Library (kept: fetched or on its way), with Watch state and Lists
export const loadLibraryVideos = async (
  db: Database
): Promise<{ videos: LibraryVideo[]; lists: { id: string; name: string }[] }> => {
  const [rows, listItems, favoriteRows, phoneRows, lists] = await Promise.all([
    db
      .select({
        videoId: youtubeVideos.videoId,
        title: youtubeVideos.title,
        channelId: youtubeVideos.channelId,
        channelTitle: youtubeVideos.channelTitle,
        durationSeconds: youtubeVideos.durationSeconds,
        thumbnailUrl: youtubeVideos.thumbnailUrl,
        thumbnailPath: youtubeVideos.thumbnailPath,
        downloadStatus: youtubeVideos.downloadStatus,
        downloadProgress: youtubeVideos.downloadProgress,
        keptAt: youtubeVideos.keptAt,
        lastPositionSeconds: videoWatchStats.lastPositionSeconds,
        lastWatchedAt: videoWatchStats.lastWatchedAt,
        watchedAt: videoWatchStats.watchedAt,
      })
      .from(youtubeVideos)
      .leftJoin(videoWatchStats, eq(videoWatchStats.videoId, youtubeVideos.videoId))
      .where(isKept),
    db
      .select({ videoId: customPlaylistItems.videoId, listId: customPlaylistItems.playlistId })
      .from(customPlaylistItems),
    db
      .select({ videoId: favorites.entityId })
      .from(favorites)
      .where(eq(favorites.entityType, "video")),
    db.select({ videoId: phoneListItems.videoId }).from(phoneListItems),
    db
      .select({ id: customPlaylists.id, name: customPlaylists.name })
      .from(customPlaylists)
      .orderBy(asc(customPlaylists.name)),
  ]);

  const listIdsByVideo = new Map<string, string[]>();
  const addListId = (videoId: string, listId: string): void => {
    listIdsByVideo.set(videoId, [...(listIdsByVideo.get(videoId) ?? []), listId]);
  };
  listItems.forEach((item) => addListId(item.videoId, item.listId));
  favoriteRows.forEach((row) => addListId(row.videoId, FAVORITES_LIST_ID));
  phoneRows.forEach((row) => addListId(row.videoId, PHONE_LIST_ID));

  return {
    videos: rows.map(({ keptAt, lastPositionSeconds, watchedAt, ...video }) => ({
      ...video,
      keptAt: keptAt ?? 0,
      lastPositionSeconds,
      watchState: getWatchState({ watchedAt, lastPositionSeconds }),
      listIds: listIdsByVideo.get(video.videoId) ?? [],
    })),
    lists: [
      { id: FAVORITES_LIST_ID, name: BUILT_IN_LIST_NAMES[FAVORITES_LIST_ID] },
      { id: PHONE_LIST_ID, name: BUILT_IN_LIST_NAMES[PHONE_LIST_ID] },
      ...lists,
    ],
  };
};
