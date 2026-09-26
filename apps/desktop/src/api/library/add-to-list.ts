import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/api/db";
import { customPlaylistItems, customPlaylists, favorites, youtubeVideos } from "@/api/db/schema";
import { FAVORITES_LIST_ID, PHONE_LIST_ID } from "@/lib/lists";
import { addToPhoneList } from "@/api/on-device/store";

// Adds Videos to the end of a List; a Video already in it stays where it is,
// and one the app does not know is skipped.
export const addToList = async (
  db: Database,
  listId: string,
  requestedIds: string[]
): Promise<void> => {
  const now = Date.now();
  const known = await db
    .select({ videoId: youtubeVideos.videoId })
    .from(youtubeVideos)
    .where(inArray(youtubeVideos.videoId, requestedIds));
  const knownIds = new Set(known.map((v) => v.videoId));
  const videoIds = [...new Set(requestedIds)].filter((id) => knownIds.has(id));
  if (videoIds.length === 0) return;

  if (listId === PHONE_LIST_ID) {
    for (const videoId of videoIds) await addToPhoneList(db, videoId);
    return;
  }
  if (listId === FAVORITES_LIST_ID) {
    await db
      .insert(favorites)
      .values(
        videoIds.map((videoId) => ({
          id: crypto.randomUUID(),
          entityType: "video" as const,
          entityId: videoId,
          createdAt: now,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing();
    return;
  }

  const present = await db
    .select({ videoId: customPlaylistItems.videoId })
    .from(customPlaylistItems)
    .where(
      and(
        eq(customPlaylistItems.playlistId, listId),
        inArray(customPlaylistItems.videoId, videoIds)
      )
    );
  const presentIds = new Set(present.map((p) => p.videoId));
  const newIds = videoIds.filter((id) => !presentIds.has(id));
  if (newIds.length === 0) return;

  const [{ maxPosition }] = await db
    .select({ maxPosition: sql<number | null>`max(${customPlaylistItems.position})` })
    .from(customPlaylistItems)
    .where(eq(customPlaylistItems.playlistId, listId));

  const items = newIds.map((videoId, i) => ({
    id: crypto.randomUUID(),
    playlistId: listId,
    videoId,
    position: (maxPosition ?? -1) + 1 + i,
    addedAt: now,
    createdAt: now,
    updatedAt: now,
  }));
  await db.insert(customPlaylistItems).values(items);
  await db
    .update(customPlaylists)
    .set({ itemCount: sql`${customPlaylists.itemCount} + ${items.length}`, updatedAt: now })
    .where(eq(customPlaylists.id, listId));
};
