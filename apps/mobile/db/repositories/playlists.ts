import { and, desc, eq } from "drizzle-orm";
import { getDb, getExpoDb, savedPlaylists, savedPlaylistItems } from "../index";
import { offlineCopy } from "../../services/offline-copy";
import type {
  SavedPlaylist,
  NewSavedPlaylist,
  SavedPlaylistItem,
  NewSavedPlaylistItem,
} from "../schema";

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export interface PlaylistVideoInfo {
  videoId: string;
  title: string;
  channelTitle: string;
  duration: number;
  thumbnailUrl?: string | null;
  downloadStatus?: "completed" | "downloading" | "queued" | "pending" | null;
  downloadProgress?: number | null;
  fileSize?: number | null;
}

export interface SavedPlaylistQueryOptions {
  includeUnpinned?: boolean;
}

export interface SavedPlaylistWithItems extends SavedPlaylist {
  items: Array<
    SavedPlaylistItem & {
      isDownloaded: boolean;
    }
  >;
}

export type BrowseCachePlaylistKind = "channel" | "playlist" | "mylist";

interface UpsertSavedPlaylistInput {
  id: string;
  title: string;
  type: string;
  sourceId?: string | null;
  thumbnailUrl?: string | null;
  itemCount?: number | null;
  pin?: boolean;
  savedAt?: number | null;
  detailHydratedAt?: number | null;
  updatedAt?: number | null;
}

function getRawSavedPlaylistById(id: string): SavedPlaylist | undefined {
  return getDb().select().from(savedPlaylists).where(eq(savedPlaylists.id, id)).get();
}

function getPlaylistVisibilityCondition(
  id: string,
  options?: SavedPlaylistQueryOptions
) {
  if (options?.includeUnpinned) {
    return eq(savedPlaylists.id, id);
  }

  return and(eq(savedPlaylists.id, id), eq(savedPlaylists.isPinned, true));
}

// Every playlist's items in one query, each list in playlist order.
function getItemsByPlaylist(): Map<string, SavedPlaylistItem[]> {
  const byPlaylist = new Map<string, SavedPlaylistItem[]>();
  const items = getDb()
    .select()
    .from(savedPlaylistItems)
    .orderBy(savedPlaylistItems.playlistId, savedPlaylistItems.position)
    .all();
  for (const item of items) {
    const playlistItems = byPlaylist.get(item.playlistId);
    if (playlistItems) playlistItems.push(item);
    else byPlaylist.set(item.playlistId, [item]);
  }
  return byPlaylist;
}

function getPlaylistItemsInternal(playlistId: string): SavedPlaylistItem[] {
  return getDb()
    .select()
    .from(savedPlaylistItems)
    .where(eq(savedPlaylistItems.playlistId, playlistId))
    .orderBy(savedPlaylistItems.position)
    .all();
}

function upsertSavedPlaylistRecord({
  id,
  title,
  type,
  sourceId,
  thumbnailUrl,
  itemCount,
  pin,
  savedAt,
  detailHydratedAt,
  updatedAt,
}: UpsertSavedPlaylistInput): SavedPlaylist {
  const now = Date.now();
  const existing = getRawSavedPlaylistById(id);

  const nextIsPinned = pin ?? existing?.isPinned ?? false;
  const nextSavedAtOverride =
    typeof savedAt === "number" && Number.isFinite(savedAt)
      ? Math.max(0, Math.floor(savedAt))
      : null;
  const nextSavedAt =
    nextSavedAtOverride ??
    (nextIsPinned && !existing?.isPinned ? now : existing?.savedAt ?? now);
  const nextUpdatedAt =
    typeof updatedAt === "number" && Number.isFinite(updatedAt)
      ? Math.max(0, Math.floor(updatedAt))
      : now;
  const nextItemCount =
    typeof itemCount === "number" && Number.isFinite(itemCount)
      ? Math.max(0, Math.floor(itemCount))
      : existing?.itemCount ?? 0;
  const values: Omit<NewSavedPlaylist, "id"> = {
    title,
    type,
    sourceId: sourceId ?? existing?.sourceId ?? null,
    thumbnailUrl: thumbnailUrl ?? existing?.thumbnailUrl ?? null,
    itemCount: nextItemCount,
    isPinned: nextIsPinned,
    savedAt: nextSavedAt,
    detailHydratedAt:
      detailHydratedAt === undefined
        ? existing?.detailHydratedAt ?? null
        : detailHydratedAt,
    updatedAt: nextUpdatedAt,
  };

  if (existing) {
    getDb().update(savedPlaylists).set(values).where(eq(savedPlaylists.id, id)).run();
  } else {
    getDb()
      .insert(savedPlaylists)
      .values({
        id,
        ...values,
      })
      .run();
  }

  return getRawSavedPlaylistById(id)!;
}

function upsertPlaylistItem(
  playlistId: string,
  video: PlaylistVideoInfo,
  position: number,
  existing?: SavedPlaylistItem
) {
  const now = Date.now();
  const values: Omit<NewSavedPlaylistItem, "id"> = {
    playlistId,
    videoId: video.videoId,
    title: video.title,
    channelTitle: video.channelTitle,
    duration: video.duration,
    thumbnailUrl: video.thumbnailUrl ?? existing?.thumbnailUrl ?? null,
    downloadStatus: video.downloadStatus ?? existing?.downloadStatus ?? null,
    downloadProgress: video.downloadProgress ?? existing?.downloadProgress ?? null,
    fileSize: video.fileSize ?? existing?.fileSize ?? null,
    position,
    createdAt: existing?.createdAt ?? now,
  };

  if (existing) {
    getDb()
      .update(savedPlaylistItems)
      .set(values)
      .where(eq(savedPlaylistItems.id, existing.id))
      .run();
    return;
  }

  getDb()
    .insert(savedPlaylistItems)
    .values({
      id: generateId(),
      ...values,
    })
    .run();
}

function replacePlaylistItems(playlistId: string, videoInfos: PlaylistVideoInfo[]) {
  getDb().delete(savedPlaylistItems).where(eq(savedPlaylistItems.playlistId, playlistId)).run();

  videoInfos.forEach((video, index) => {
    upsertPlaylistItem(playlistId, video, index);
  });
}

export function buildCachedPlaylistId(
  kind: BrowseCachePlaylistKind,
  sourceId: string
): string {
  return `${kind}_${sourceId}`;
}

// Get all saved playlists
export function getAllSavedPlaylists(
  options?: SavedPlaylistQueryOptions
): SavedPlaylist[] {
  if (options?.includeUnpinned) {
    return getDb()
      .select()
      .from(savedPlaylists)
      .orderBy(
        desc(savedPlaylists.savedAt),
        desc(savedPlaylists.updatedAt),
        savedPlaylists.title
      )
      .all();
  }

  return getDb()
    .select()
    .from(savedPlaylists)
    .where(eq(savedPlaylists.isPinned, true))
    .orderBy(
      desc(savedPlaylists.savedAt),
      desc(savedPlaylists.updatedAt),
      savedPlaylists.title
    )
    .all();
}

// Get saved playlist by ID
export function getSavedPlaylistById(
  id: string,
  options?: SavedPlaylistQueryOptions
): SavedPlaylist | undefined {
  return getDb()
    .select()
    .from(savedPlaylists)
    .where(getPlaylistVisibilityCondition(id, options))
    .get();
}

// Get saved playlist with all items and download status
export function getSavedPlaylistWithItems(
  id: string,
  options?: SavedPlaylistQueryOptions
): SavedPlaylistWithItems | undefined {
  const playlist = getSavedPlaylistById(id, options);
  if (!playlist) return undefined;

  const items = getPlaylistItemsInternal(id);

  const itemsWithStatus = items.map((item) => ({
    ...item,
    isDownloaded: offlineCopy.getUri(item.videoId) !== null,
  }));

  return {
    ...playlist,
    items: itemsWithStatus,
  };
}

// Get all saved playlists with their items, in playlist order
export function getAllSavedPlaylistsWithItems(
  options?: SavedPlaylistQueryOptions
) {
  const itemsByPlaylist = getItemsByPlaylist();
  return getAllSavedPlaylists(options).map((playlist) => ({
    ...playlist,
    items: itemsByPlaylist.get(playlist.id) ?? [],
  }));
}

function withProgress<T extends SavedPlaylist>(playlist: T, videoIds: string[]) {
  return {
    ...playlist,
    downloadedCount: videoIds.filter(
      (videoId) => offlineCopy.getUri(videoId) !== null
    ).length,
    totalCount: Math.max(playlist.itemCount ?? 0, videoIds.length),
  };
}

// Get all saved playlists with item counts and download progress. Reads only
// each item's Video id: item rows can be large.
export function getAllSavedPlaylistsWithProgress(
  options?: SavedPlaylistQueryOptions
) {
  const videoIdsByPlaylist = new Map<string, string[]>();
  const items = getDb()
    .select({
      playlistId: savedPlaylistItems.playlistId,
      videoId: savedPlaylistItems.videoId,
    })
    .from(savedPlaylistItems)
    .all();
  for (const { playlistId, videoId } of items) {
    const videoIds = videoIdsByPlaylist.get(playlistId);
    if (videoIds) videoIds.push(videoId);
    else videoIdsByPlaylist.set(playlistId, [videoId]);
  }

  return getAllSavedPlaylists(options).map((playlist) =>
    withProgress(playlist, videoIdsByPlaylist.get(playlist.id) ?? [])
  );
}

// Get all saved playlists with their items, item counts and download progress,
// in two queries however many playlists there are.
export function getAllSavedPlaylistsWithItemsAndProgress(
  options?: SavedPlaylistQueryOptions
) {
  return getAllSavedPlaylistsWithItems(options).map((playlist) =>
    withProgress(
      {
        ...playlist,
        items: playlist.items.map((item) => ({
          ...item,
          isDownloaded: offlineCopy.getUri(item.videoId) !== null,
        })),
      },
      playlist.items.map((item) => item.videoId)
    )
  );
}

// Catalog items and Videos keep only the desktop's thumbnail URL; older
// versions stored each as base64, which made every catalog and Library read
// move megabytes. Runs on SQLite's own thread.
export async function dropInlineThumbnails() {
  await getExpoDb().execAsync(
    "UPDATE saved_playlist_items SET thumbnail_url = NULL WHERE thumbnail_url LIKE 'data:%';" +
      "UPDATE videos SET thumbnail_url = NULL WHERE thumbnail_url LIKE 'data:%';"
  );
}

// Save a playlist with its videos
export function savePlaylist(
  playlistId: string,
  title: string,
  type: string,
  sourceId: string | null,
  thumbnailUrl: string | null,
  videoInfos: PlaylistVideoInfo[]
): SavedPlaylist {
  const playlist = upsertSavedPlaylistRecord({
    id: playlistId,
    title,
    type,
    sourceId,
    thumbnailUrl,
    itemCount: videoInfos.length,
    pin: true,
  });

  replacePlaylistItems(playlistId, videoInfos);

  return playlist;
}

export function upsertBrowseCachePlaylist(input: {
  playlistId: string;
  title: string;
  type: BrowseCachePlaylistKind;
  sourceId?: string | null;
  thumbnailUrl?: string | null;
  itemCount?: number | null;
  savedAt?: number | null;
  detailHydratedAt?: number | null;
}): SavedPlaylist {
  return upsertSavedPlaylistRecord({
    id: input.playlistId,
    title: input.title,
    type: input.type,
    sourceId: input.sourceId,
    thumbnailUrl: input.thumbnailUrl,
    itemCount: input.itemCount,
    savedAt: input.savedAt,
    detailHydratedAt: input.detailHydratedAt,
  });
}

export function mergeBrowseCachePlaylistItems(
  playlistId: string,
  videoInfos: PlaylistVideoInfo[],
  options?: {
    detailHydratedAt?: number | null;
  }
) {
  const playlist = getRawSavedPlaylistById(playlistId);
  if (!playlist) {
    throw new Error(`Playlist cache row not found: ${playlistId}`);
  }
  const detailHydratedAt =
    options?.detailHydratedAt === undefined
      ? Date.now()
      : options.detailHydratedAt;

  replacePlaylistItems(playlistId, videoInfos);

  getDb()
    .update(savedPlaylists)
    .set({
      itemCount: videoInfos.length,
      detailHydratedAt,
      updatedAt: Date.now(),
    })
    .where(eq(savedPlaylists.id, playlistId))
    .run();
}

export function hasHydratedPlaylistDetails(
  id: string,
  options?: SavedPlaylistQueryOptions
): boolean {
  const playlist = getSavedPlaylistById(id, options);
  return typeof playlist?.detailHydratedAt === "number";
}

// Delete a saved playlist
export function deleteSavedPlaylist(id: string) {
  const existing = getRawSavedPlaylistById(id);
  if (!existing) return;

  getDb()
    .update(savedPlaylists)
    .set({
      isPinned: false,
      updatedAt: Date.now(),
    })
    .where(eq(savedPlaylists.id, id))
    .run();
}

// Check if a playlist is saved
export function isPlaylistSaved(id: string): boolean {
  const playlist = getRawSavedPlaylistById(id);
  return !!playlist?.isPinned;
}

// Get playlist items for a saved playlist
export function getPlaylistItems(
  playlistId: string,
  options?: SavedPlaylistQueryOptions
): SavedPlaylistItem[] {
  if (!getSavedPlaylistById(playlistId, options)) {
    return [];
  }

  return getPlaylistItemsInternal(playlistId);
}
