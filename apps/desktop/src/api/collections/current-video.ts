import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@/api/db";
import {
  channelPlaylists,
  collectionCurrentVideos,
  customPlaylistItems,
  customPlaylists,
  favorites,
  playlistItems,
  videoWatchStats,
  youtubeVideos,
} from "@/api/db/schema";
import { FAVORITES_LIST_ID } from "@/lib/lists";
import type { CollectionKind, CurrentVideo } from "../../../../shared/mobile-sync-contract";
import { newestWins } from "../../../../shared/newest-wins";
import { whereListPicksUp } from "../../../../shared/list-pickup";

/** A List (Favorites included) or YouTube playlist: the collections with a Current Video (ADR-0006). */
export type CollectionRef = { kind: CollectionKind; id: string };

type YoutubeVideo = typeof youtubeVideos.$inferSelect;

export const loadCurrentVideo = async (
  db: Database,
  { kind, id }: CollectionRef
): Promise<CurrentVideo | null> => {
  const [row] = await db
    .select()
    .from(collectionCurrentVideos)
    .where(
      and(
        eq(collectionCurrentVideos.collectionKind, kind),
        eq(collectionCurrentVideos.collectionId, id)
      )
    )
    .limit(1);
  return row ?? null;
};

const collectionExists = async (db: Database, { kind, id }: CollectionRef): Promise<boolean> => {
  if (kind === "favorites") return id === FAVORITES_LIST_ID;
  const rows =
    kind === "list"
      ? await db
          .select({ id: customPlaylists.id })
          .from(customPlaylists)
          .where(eq(customPlaylists.id, id))
          .limit(1)
      : await db
          .select({ id: channelPlaylists.playlistId })
          .from(channelPlaylists)
          .where(eq(channelPlaylists.playlistId, id))
          .limit(1);
  return rows.length > 0;
};

/** The collection's Video ids in its order. */
const loadVideoIds = async (db: Database, { kind, id }: CollectionRef): Promise<string[]> => {
  if (kind === "favorites") {
    // Newest Favorite first, as the Favorites page lists them.
    const rows = await db
      .select({ videoId: favorites.entityId })
      .from(favorites)
      .where(eq(favorites.entityType, "video"))
      .orderBy(desc(favorites.createdAt));
    return rows.map((row) => row.videoId);
  }
  const rows =
    kind === "list"
      ? await db
          .select({ videoId: customPlaylistItems.videoId })
          .from(customPlaylistItems)
          .where(eq(customPlaylistItems.playlistId, id))
          .orderBy(customPlaylistItems.position)
      : await db
          .select({ videoId: playlistItems.videoId })
          .from(playlistItems)
          .where(eq(playlistItems.playlistId, id))
          .orderBy(playlistItems.position);
  return rows.map((row) => row.videoId);
};

/**
 * A List's or YouTube playlist's Videos in order and its Current Video, as the
 * collection endpoints serve them to Devices. Null for an unknown collection.
 */
export const loadCollection = async (
  db: Database,
  ref: CollectionRef
): Promise<{ videos: YoutubeVideo[]; currentVideo: CurrentVideo | null } | null> => {
  if (!(await collectionExists(db, ref))) return null;
  const [videoIds, currentVideo] = await Promise.all([
    loadVideoIds(db, ref),
    loadCurrentVideo(db, ref),
  ]);
  const rows = videoIds.length
    ? await db.select().from(youtubeVideos).where(inArray(youtubeVideos.videoId, videoIds))
    : [];
  const byId = new Map(rows.map((row) => [row.videoId, row]));
  const videos = videoIds
    .map((videoId) => byId.get(videoId))
    .filter((video): video is YoutubeVideo => video !== undefined);
  return { videos, currentVideo };
};

/**
 * For every List or every YouTube playlist with a Current Video still in it, the
 * Current Video's place in its order, for the progress shown on cards.
 */
export const loadCurrentVideoIndexes = async (
  db: Database,
  kind: Exclude<CollectionKind, "favorites">
): Promise<Map<string, number>> => {
  const currents = await db
    .select()
    .from(collectionCurrentVideos)
    .where(eq(collectionCurrentVideos.collectionKind, kind));
  if (currents.length === 0) return new Map();
  const items = kind === "list" ? customPlaylistItems : playlistItems;
  const rows = await db
    .select({ collectionId: items.playlistId, videoId: items.videoId })
    .from(items)
    .where(
      inArray(
        items.playlistId,
        currents.map((current) => current.collectionId)
      )
    )
    .orderBy(items.playlistId, items.position);
  const order = new Map<string, string[]>();
  for (const row of rows) {
    order.set(row.collectionId, [...(order.get(row.collectionId) ?? []), row.videoId]);
  }
  const indexes = new Map<string, number>();
  for (const current of currents) {
    const index = (order.get(current.collectionId) ?? []).indexOf(current.videoId);
    if (index >= 0) indexes.set(current.collectionId, index);
  }
  return indexes;
};

/**
 * Where playing the collection starts (the shared "where a List picks up" rule):
 * the Video and its place in the collection, or null when it has none.
 */
export const whereCollectionPicksUp = async (
  db: Database,
  ref: CollectionRef
): Promise<{ videoId: string; index: number } | null> => {
  const collection = await loadCollection(db, ref);
  if (!collection || collection.videos.length === 0) return null;
  const ids = collection.videos.map((video) => video.videoId);
  const watchedRows = await db
    .select({ videoId: videoWatchStats.videoId })
    .from(videoWatchStats)
    .where(and(inArray(videoWatchStats.videoId, ids), isNotNull(videoWatchStats.watchedAt)));
  const watched = new Set(watchedRows.map((row) => row.videoId));
  const picked = whereListPicksUp(
    ids.map((id) => ({ id, watched: watched.has(id) })),
    collection.currentVideo?.videoId ?? null
  );
  return picked ? { videoId: picked.id, index: ids.indexOf(picked.id) } : null;
};

/**
 * Keeps a Current Video when it is newer than the collection's (newest wins).
 * Current Videos of collections the desktop doesn't have are ignored.
 * Resolves true when it was kept.
 */
export const recordCurrentVideo = async (
  db: Database,
  reported: CurrentVideo
): Promise<boolean> => {
  const ref = { kind: reported.collectionKind, id: reported.collectionId };
  if (!(await collectionExists(db, ref))) return false;
  const existing = await loadCurrentVideo(db, ref);
  if (newestWins(existing, reported) !== reported) return false;
  const values = {
    collectionKind: reported.collectionKind,
    collectionId: reported.collectionId,
    videoId: reported.videoId,
    updatedAt: reported.updatedAt,
  };
  await db
    .insert(collectionCurrentVideos)
    .values(values)
    .onConflictDoUpdate({
      target: [collectionCurrentVideos.collectionKind, collectionCurrentVideos.collectionId],
      set: { videoId: values.videoId, updatedAt: values.updatedAt },
    });
  return true;
};

/** Which kind of collection an id the desktop player was started with names. */
const resolveCollection = async (db: Database, id: string): Promise<CollectionRef | null> => {
  if (id === FAVORITES_LIST_ID) return { kind: "favorites", id };
  for (const kind of ["list", "youtube_playlist"] as const) {
    if (await collectionExists(db, { kind, id })) return { kind, id };
  }
  return null;
};

/**
 * A Video started playing on the desktop. Started from a List, Favorites or
 * YouTube playlist, it becomes that collection's Current Video; started anywhere
 * else (the Library, a Channel), no Current Video moves.
 */
export const recordVideoStarted = async (
  db: Database,
  { videoId, collectionId }: { videoId: string; collectionId: string | null },
  now: number
): Promise<void> => {
  if (!collectionId) return;
  const ref = await resolveCollection(db, collectionId);
  if (!ref) return;
  await recordCurrentVideo(db, {
    collectionKind: ref.kind,
    collectionId: ref.id,
    videoId,
    updatedAt: now,
  });
};
