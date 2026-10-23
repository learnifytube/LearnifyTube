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
import type { CollectionRef, CurrentVideo } from "../../../../shared/mobile-sync-contract";
import { newestWins } from "../../../../shared/newest-wins";
import { whereListPicksUp } from "../../../../shared/list-pickup";

type YoutubeVideo = typeof youtubeVideos.$inferSelect;

/** Where each kind of collection keeps itself and its Videos; Favorites lives in its own table. */
const COLLECTION_TABLES = {
  list: {
    collections: customPlaylists,
    collectionId: customPlaylists.id,
    items: customPlaylistItems,
  },
  youtube_playlist: {
    collections: channelPlaylists,
    collectionId: channelPlaylists.playlistId,
    items: playlistItems,
  },
} as const;

type TableKind = keyof typeof COLLECTION_TABLES;

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
  const { collections, collectionId } = COLLECTION_TABLES[kind];
  const rows = await db
    .select({ id: collectionId })
    .from(collections)
    .where(eq(collectionId, id))
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
  const { items } = COLLECTION_TABLES[kind];
  const rows = await db
    .select({ videoId: items.videoId })
    .from(items)
    .where(eq(items.playlistId, id))
    .orderBy(items.position);
  return rows.map((row) => row.videoId);
};

type LoadedCollection = {
  /** Every Video id in the collection's order, including Videos the desktop no longer has. */
  videoIds: string[];
  /** The Videos the desktop has, in the collection's order. */
  videos: YoutubeVideo[];
  currentVideo: CurrentVideo | null;
};

const loadWholeCollection = async (
  db: Database,
  ref: CollectionRef
): Promise<LoadedCollection | null> => {
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
  return { videoIds, videos, currentVideo };
};

/**
 * A List's or YouTube playlist's Videos in order, which of them are watched on
 * the desktop, and its Current Video, as the collection endpoints serve them to
 * Devices. Null for an unknown collection.
 */
export const loadCollection = async (
  db: Database,
  ref: CollectionRef
): Promise<{
  videos: YoutubeVideo[];
  watchedVideoIds: Set<string>;
  currentVideo: CurrentVideo | null;
} | null> => {
  const collection = await loadWholeCollection(db, ref);
  if (!collection) return null;
  return {
    videos: collection.videos,
    watchedVideoIds: await loadWatchedVideoIds(
      db,
      collection.videos.map((video) => video.videoId)
    ),
    currentVideo: collection.currentVideo,
  };
};

/** Which of these Videos are watched on the desktop (about 90% played, or marked watched). */
const loadWatchedVideoIds = async (
  db: Database,
  videoIds: readonly string[]
): Promise<Set<string>> => {
  if (videoIds.length === 0) return new Set();
  const rows = await db
    .select({ videoId: videoWatchStats.videoId })
    .from(videoWatchStats)
    .where(
      and(inArray(videoWatchStats.videoId, [...videoIds]), isNotNull(videoWatchStats.watchedAt))
    );
  return new Set(rows.map((row) => row.videoId));
};

/** The Current Video's place among these Videos; null when none is set or it left them. */
export const currentVideoIndexIn = (
  videos: readonly { videoId: string }[],
  currentVideo: Pick<CurrentVideo, "videoId"> | null
): number | null => {
  if (!currentVideo) return null;
  const index = videos.findIndex((video) => video.videoId === currentVideo.videoId);
  return index >= 0 ? index : null;
};

/**
 * For every List or every YouTube playlist with a Current Video still in it, the
 * Current Video's place in its order, for the progress shown on cards.
 */
export const loadCurrentVideoIndexes = async (
  db: Database,
  kind: TableKind
): Promise<Map<string, number>> => {
  const currents = await db
    .select()
    .from(collectionCurrentVideos)
    .where(eq(collectionCurrentVideos.collectionKind, kind));
  if (currents.length === 0) return new Map();
  const { items } = COLLECTION_TABLES[kind];
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
  const order = new Map<string, { videoId: string }[]>();
  for (const row of rows) {
    order.set(row.collectionId, [...(order.get(row.collectionId) ?? []), row]);
  }
  const indexes = new Map<string, number>();
  for (const current of currents) {
    const index = currentVideoIndexIn(order.get(current.collectionId) ?? [], current);
    if (index !== null) indexes.set(current.collectionId, index);
  }
  return indexes;
};

/**
 * Where playing the collection starts (the shared "where a List picks up" rule):
 * the Video and its place among the Videos the desktop has (as the List and
 * playlist pages list them), or null when it has none. A Video still in the
 * collection that the desktop no longer has is missing, so it is skipped.
 */
export const whereCollectionPicksUp = async (
  db: Database,
  ref: CollectionRef
): Promise<{ videoId: string; index: number } | null> => {
  const collection = await loadWholeCollection(db, ref);
  if (!collection || collection.videos.length === 0) return null;
  const has = collection.videos.map((video) => video.videoId);
  const watched = await loadWatchedVideoIds(db, has);
  const picked = whereListPicksUp(
    collection.videoIds.map((id) => ({
      id,
      watched: watched.has(id),
      missing: !has.includes(id),
    })),
    collection.currentVideo?.videoId ?? null
  );
  return picked ? { videoId: picked.id, index: has.indexOf(picked.id) } : null;
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
  for (const kind of Object.keys(COLLECTION_TABLES) as TableKind[]) {
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
