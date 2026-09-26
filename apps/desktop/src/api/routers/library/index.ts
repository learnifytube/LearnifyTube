import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { publicProcedure, t } from "@/api/trpc";
import {
  customPlaylistItems,
  customPlaylists,
  favorites,
  phoneListItems,
  videoWatchStats,
  youtubeVideos,
} from "@/api/db/schema";
import defaultDb from "@/api/db";
import { getWatchState } from "@/lib/watch-state";
import { FAVORITES_LIST_ID, PHONE_LIST_ID } from "@/lib/lists";

export const libraryRouter = t.router({
  // Every Video in the Library (kept: fetched or on its way), with Watch state and Lists
  list: publicProcedure.query(async ({ ctx }) => {
    const db = ctx.db ?? defaultDb;

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
          watchedAt: videoWatchStats.watchedAt,
        })
        .from(youtubeVideos)
        .leftJoin(videoWatchStats, eq(videoWatchStats.videoId, youtubeVideos.videoId))
        .where(
          and(
            isNotNull(youtubeVideos.keptAt),
            isNotNull(youtubeVideos.downloadStatus),
            ne(youtubeVideos.downloadStatus, "cancelled")
          )
        ),
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
    const addToList = (videoId: string, listId: string): void => {
      listIdsByVideo.set(videoId, [...(listIdsByVideo.get(videoId) ?? []), listId]);
    };
    listItems.forEach((item) => addToList(item.videoId, item.listId));
    favoriteRows.forEach((row) => addToList(row.videoId, FAVORITES_LIST_ID));
    phoneRows.forEach((row) => addToList(row.videoId, PHONE_LIST_ID));

    return {
      videos: rows.map(({ keptAt, lastPositionSeconds, watchedAt, ...video }) => ({
        ...video,
        keptAt: keptAt ?? 0,
        lastPositionSeconds,
        watchState: getWatchState({ watchedAt, lastPositionSeconds }),
        listIds: listIdsByVideo.get(video.videoId) ?? [],
      })),
      lists: [
        { id: FAVORITES_LIST_ID, name: "Favorites" },
        { id: PHONE_LIST_ID, name: "Phone List" },
        ...lists,
      ],
    };
  }),
});
