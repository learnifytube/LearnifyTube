import { desc, eq, isNotNull } from "drizzle-orm";
import { getDb, videos, watchStats } from "../index";
import type { WatchStat } from "../schema";

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export interface UpsertWatchProgressInput {
  videoId: string;
  title: string;
  channelTitle: string;
  duration: number;
  thumbnailUrl?: string | null;
  lastPositionSeconds: number;
  additionalWatchSeconds?: number;
  lastWatchedAt?: number;
}

export interface WatchHistoryItem {
  videoId: string;
  title: string;
  channelTitle: string;
  duration: number;
  thumbnailUrl: string | null;
  totalWatchSeconds: number;
  lastPositionSeconds: number;
  lastWatchedAt: number | null;
}

export type WatchHistoryLookup = Record<string, WatchHistoryItem>;

function ensureVideo(input: UpsertWatchProgressInput) {
  const now = Date.now();
  const existing = getDb().select().from(videos).where(eq(videos.id, input.videoId)).get();

  if (existing) {
    getDb()
      .update(videos)
      .set({
        title: input.title || existing.title,
        channelTitle: input.channelTitle || existing.channelTitle,
        duration: input.duration || existing.duration,
        thumbnailUrl: input.thumbnailUrl ?? existing.thumbnailUrl,
        updatedAt: now,
      })
      .where(eq(videos.id, input.videoId))
      .run();
    return;
  }

  getDb()
    .insert(videos)
    .values({
      id: input.videoId,
      title: input.title,
      channelTitle: input.channelTitle,
      duration: input.duration,
      thumbnailUrl: input.thumbnailUrl ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function upsertWatchProgress(input: UpsertWatchProgressInput): WatchStat {
  const now = Date.now();
  const lastPositionSeconds = Math.max(0, Math.floor(input.lastPositionSeconds));
  const additionalWatchSeconds = Math.max(
    0,
    Math.floor(input.additionalWatchSeconds ?? 0)
  );
  const lastWatchedAt = input.lastWatchedAt ?? now;

  ensureVideo(input);

  const existing = getDb()
    .select()
    .from(watchStats)
    .where(eq(watchStats.videoId, input.videoId))
    .get();

  if (existing) {
    getDb()
      .update(watchStats)
      .set({
        totalWatchSeconds: Math.max(
          0,
          (existing.totalWatchSeconds ?? 0) + additionalWatchSeconds
        ),
        lastPositionSeconds,
        lastWatchedAt,
        updatedAt: now,
      })
      .where(eq(watchStats.id, existing.id))
      .run();

    return getDb()
      .select()
      .from(watchStats)
      .where(eq(watchStats.id, existing.id))
      .get()!;
  }

  const id = generateId();
  getDb()
    .insert(watchStats)
    .values({
      id,
      videoId: input.videoId,
      totalWatchSeconds: additionalWatchSeconds,
      lastPositionSeconds,
      lastWatchedAt,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return getDb().select().from(watchStats).where(eq(watchStats.id, id)).get()!;
}

export function getWatchHistory(limit = 100): WatchHistoryItem[] {
  if (limit <= 0) return [];

  const rows = getDb()
    .select({
      videoId: watchStats.videoId,
      title: videos.title,
      channelTitle: videos.channelTitle,
      duration: videos.duration,
      thumbnailUrl: videos.thumbnailUrl,
      totalWatchSeconds: watchStats.totalWatchSeconds,
      lastPositionSeconds: watchStats.lastPositionSeconds,
      lastWatchedAt: watchStats.lastWatchedAt,
    })
    .from(watchStats)
    .innerJoin(videos, eq(watchStats.videoId, videos.id))
    .where(isNotNull(watchStats.lastWatchedAt))
    .orderBy(desc(watchStats.lastWatchedAt))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    videoId: row.videoId,
    title: row.title,
    channelTitle: row.channelTitle,
    duration: row.duration,
    thumbnailUrl: row.thumbnailUrl ?? null,
    totalWatchSeconds: row.totalWatchSeconds ?? 0,
    lastPositionSeconds: row.lastPositionSeconds ?? 0,
    lastWatchedAt: row.lastWatchedAt ?? null,
  }));
}

export function getWatchHistoryLookup(limit = 1000): WatchHistoryLookup {
  const items = getWatchHistory(limit);
  return items.reduce<WatchHistoryLookup>((acc, item) => {
    acc[item.videoId] = item;
    return acc;
  }, {});
}

export function getMostRecentWatchForVideoIds(
  videoIds: string[],
  lookup?: WatchHistoryLookup
): WatchHistoryItem | null {
  if (videoIds.length === 0) return null;

  const historyLookup =
    lookup ?? getWatchHistoryLookup(Math.max(1000, videoIds.length * 5));

  let mostRecent: WatchHistoryItem | null = null;

  for (const videoId of videoIds) {
    const item = historyLookup[videoId];
    if (!item) continue;

    if (!mostRecent) {
      mostRecent = item;
      continue;
    }

    const itemWatchedAt = item.lastWatchedAt ?? 0;
    const mostRecentWatchedAt = mostRecent.lastWatchedAt ?? 0;
    if (itemWatchedAt > mostRecentWatchedAt) {
      mostRecent = item;
    }
  }

  return mostRecent;
}
