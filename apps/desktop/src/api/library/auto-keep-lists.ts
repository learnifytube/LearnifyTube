import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/api/db";
import {
  autoKeepListItems,
  channels,
  customPlaylistItems,
  customPlaylists,
  favorites,
  phoneListItems,
  videoWatchStats,
} from "@/api/db/schema";
import { logger } from "@/helpers/logger";
import { FAVORITES_LIST_ID, PHONE_LIST_ID } from "@/lib/lists";

// When each of these Videos went into the List, for those in it
const loadEntryTimes = async (
  db: Database,
  listId: string,
  videoIds: string[]
): Promise<Map<string, number>> => {
  const rows =
    listId === PHONE_LIST_ID
      ? await db
          .select({ videoId: phoneListItems.videoId, addedAt: phoneListItems.addedAt })
          .from(phoneListItems)
          .where(inArray(phoneListItems.videoId, videoIds))
      : listId === FAVORITES_LIST_ID
        ? await db
            .select({ videoId: favorites.entityId, addedAt: favorites.createdAt })
            .from(favorites)
            .where(and(eq(favorites.entityType, "video"), inArray(favorites.entityId, videoIds)))
        : await db
            .select({ videoId: customPlaylistItems.videoId, addedAt: customPlaylistItems.addedAt })
            .from(customPlaylistItems)
            .where(
              and(
                eq(customPlaylistItems.playlistId, listId),
                inArray(customPlaylistItems.videoId, videoIds)
              )
            );
  return new Map(rows.map((row) => [row.videoId, row.addedAt]));
};

// Take a Video out of a List, but only the entry that went in at addedAt: one the user put
// back since is theirs.
const removeListEntry = async (
  db: Database,
  { listId, videoId, addedAt }: { listId: string; videoId: string; addedAt: number }
): Promise<void> => {
  if (listId === PHONE_LIST_ID) {
    await db
      .delete(phoneListItems)
      .where(and(eq(phoneListItems.videoId, videoId), eq(phoneListItems.addedAt, addedAt)));
    return;
  }
  if (listId === FAVORITES_LIST_ID) {
    await db
      .delete(favorites)
      .where(
        and(
          eq(favorites.entityType, "video"),
          eq(favorites.entityId, videoId),
          eq(favorites.createdAt, addedAt)
        )
      );
    return;
  }
  const [removed] = await db
    .delete(customPlaylistItems)
    .where(
      and(
        eq(customPlaylistItems.playlistId, listId),
        eq(customPlaylistItems.videoId, videoId),
        eq(customPlaylistItems.addedAt, addedAt)
      )
    )
    .returning({ position: customPlaylistItems.position });
  if (!removed) return;
  const now = Date.now();
  await db
    .update(customPlaylistItems)
    .set({ position: sql`${customPlaylistItems.position} - 1`, updatedAt: now })
    .where(
      and(
        eq(customPlaylistItems.playlistId, listId),
        sql`${customPlaylistItems.position} > ${removed.position}`
      )
    );
  await db
    .update(customPlaylists)
    .set({ itemCount: sql`MAX(${customPlaylists.itemCount} - 1, 0)`, updatedAt: now })
    .where(eq(customPlaylists.id, listId));
};

// Remember which of these Videos a Subscription's Auto-keep just put into the List: those
// whose entry went in from `since` on. A Video already in the List stays the user's.
export const recordAutoKeptEntries = async (
  db: Database,
  {
    channelId,
    listId,
    videoIds,
    since,
  }: {
    channelId: string;
    listId: string;
    videoIds: string[];
    since: number;
  }
): Promise<void> => {
  const times = await loadEntryTimes(db, listId, videoIds);
  const added = [...times].filter(([, addedAt]) => addedAt >= since);
  if (added.length === 0) return;
  await db
    .insert(autoKeepListItems)
    .values(added.map(([videoId, addedAt]) => ({ listId, videoId, channelId, addedAt })))
    .onConflictDoUpdate({
      target: [autoKeepListItems.listId, autoKeepListItems.videoId],
      set: { channelId, addedAt: sql`excluded.added_at` },
    });
};

// For Subscriptions set to "Remove from the List once watched": take each watched Video they
// auto-kept out of the List it went into. It stays in the Library, and is not put back if
// marked unwatched. Called whenever Videos become watched (limit to those), and for one
// Subscription when the setting is switched on.
export const removeWatchedAutoKept = async (
  db: Database,
  scope: { videoIds: string[] } | { channelId: string }
): Promise<void> => {
  if ("videoIds" in scope && scope.videoIds.length === 0) return;
  const inScope: SQL =
    "videoIds" in scope
      ? inArray(autoKeepListItems.videoId, scope.videoIds)
      : eq(autoKeepListItems.channelId, scope.channelId);
  const entries = await db
    .select({
      listId: autoKeepListItems.listId,
      videoId: autoKeepListItems.videoId,
      addedAt: autoKeepListItems.addedAt,
    })
    .from(autoKeepListItems)
    .innerJoin(channels, eq(channels.channelId, autoKeepListItems.channelId))
    .innerJoin(videoWatchStats, eq(videoWatchStats.videoId, autoKeepListItems.videoId))
    .where(
      and(
        inScope,
        eq(channels.autoKeepRemoveWatched, true),
        isNotNull(channels.autoKeepSince),
        isNotNull(videoWatchStats.watchedAt)
      )
    );

  for (const entry of entries) {
    await removeListEntry(db, entry);
    await db
      .delete(autoKeepListItems)
      .where(
        and(
          eq(autoKeepListItems.listId, entry.listId),
          eq(autoKeepListItems.videoId, entry.videoId)
        )
      );
  }
  if (entries.length > 0) {
    logger.info("[auto-keep] Removed watched Videos from their Lists", { count: entries.length });
  }
};
