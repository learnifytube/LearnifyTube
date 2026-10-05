import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/api/db";
import type { DeviceReport } from "../../../../shared/mobile-sync-contract";
import {
  customPlaylistItems,
  favorites,
  onDeviceLists,
  phoneListItems,
  syncDevices,
  videoWatchStats,
  youtubeVideos,
} from "@/api/db/schema";
import { computeOnDeviceSet } from "./on-device-set";
import { mergeDeviceWatch } from "./device-watch";

import { FAVORITES_LIST_ID } from "@/lib/lists";

type OnDeviceSetInput = Parameters<typeof computeOnDeviceSet>[0];

export type OnDeviceSetVideo = {
  id: string;
  title: string;
  channelTitle: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  downloadStatus: string | null;
  downloadFileSize: number | null;
  downloadFilePath: string | null;
};

export type DeviceStatus = {
  id: string;
  name: string;
  kind: (typeof syncDevices.$inferSelect)["kind"];
  lastSeenAt: number;
  present: number;
  missing: number;
};

export const loadOnDeviceSetInput = async (db: Database): Promise<OnDeviceSetInput> => {
  const [switchedOn, listItems, favoriteRows, phoneList] = await Promise.all([
    db.select({ listId: onDeviceLists.listId }).from(onDeviceLists),
    db
      .select({ listId: customPlaylistItems.playlistId, videoId: customPlaylistItems.videoId })
      .from(customPlaylistItems),
    db
      .select({ videoId: favorites.entityId })
      .from(favorites)
      .where(eq(favorites.entityType, "video")),
    db.select({ videoId: phoneListItems.videoId }).from(phoneListItems),
  ]);
  return {
    switchedOnListIds: switchedOn.map((row) => row.listId),
    listItems: [
      ...listItems,
      ...favoriteRows.map((row) => ({ listId: FAVORITES_LIST_ID, videoId: row.videoId })),
    ],
    phoneListVideoIds: phoneList.map((row) => row.videoId),
  };
};

export const loadOnDeviceSetIds = async (db: Database): Promise<Set<string>> =>
  computeOnDeviceSet(await loadOnDeviceSetInput(db));

// The On-device set with what Devices need to show and Download each Video.
export const loadOnDeviceSet = async (db: Database): Promise<OnDeviceSetVideo[]> => {
  const ids = [...(await loadOnDeviceSetIds(db))];
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: youtubeVideos.videoId,
      title: youtubeVideos.title,
      channelTitle: youtubeVideos.channelTitle,
      durationSeconds: youtubeVideos.durationSeconds,
      thumbnailUrl: youtubeVideos.thumbnailUrl,
      thumbnailPath: youtubeVideos.thumbnailPath,
      downloadStatus: youtubeVideos.downloadStatus,
      downloadFileSize: youtubeVideos.downloadFileSize,
      downloadFilePath: youtubeVideos.downloadFilePath,
    })
    .from(youtubeVideos)
    .where(inArray(youtubeVideos.videoId, ids));
  return rows;
};

export const setListOnDevices = async (
  db: Database,
  listId: string,
  on: boolean
): Promise<void> => {
  if (on) {
    await db.insert(onDeviceLists).values({ listId, createdAt: Date.now() }).onConflictDoNothing();
  } else {
    await db.delete(onDeviceLists).where(eq(onDeviceLists.listId, listId));
  }
};

export const addToPhoneList = async (db: Database, videoId: string): Promise<void> => {
  await db.insert(phoneListItems).values({ videoId, addedAt: Date.now() }).onConflictDoNothing();
};

export const removeFromPhoneList = async (db: Database, videoId: string): Promise<void> => {
  await db.delete(phoneListItems).where(eq(phoneListItems.videoId, videoId));
};

export const recordDeviceReport = async (
  db: Database,
  report: DeviceReport,
  now: number
): Promise<void> => {
  const device = {
    name: report.name,
    kind: report.kind,
    offlineVideoIdsJson: JSON.stringify(report.offlineVideoIds),
    lastSeenAt: now,
  };
  await db
    .insert(syncDevices)
    .values({ id: report.deviceId, ...device })
    .onConflictDoUpdate({ target: syncDevices.id, set: device });

  const videoIds = report.watch.map((entry) => entry.videoId);
  if (videoIds.length === 0) return;
  const [videos, stats] = await Promise.all([
    db
      .select({ videoId: youtubeVideos.videoId, durationSeconds: youtubeVideos.durationSeconds })
      .from(youtubeVideos)
      .where(inArray(youtubeVideos.videoId, videoIds)),
    db.select().from(videoWatchStats).where(inArray(videoWatchStats.videoId, videoIds)),
  ]);
  const durations = new Map(videos.map((v) => [v.videoId, v.durationSeconds]));
  const statsByVideo = new Map(stats.map((s) => [s.videoId, s]));

  for (const entry of report.watch) {
    // Only Videos the desktop knows; a Device can hold Videos from another desktop.
    if (!durations.has(entry.videoId)) continue;
    const existing = statsByVideo.get(entry.videoId) ?? null;
    const changes = mergeDeviceWatch(existing, entry, durations.get(entry.videoId) ?? null);
    if (!changes) continue;
    if (existing) {
      await db
        .update(videoWatchStats)
        .set({ ...changes, updatedAt: now })
        .where(eq(videoWatchStats.videoId, entry.videoId));
    } else {
      await db.insert(videoWatchStats).values({
        id: crypto.randomUUID(),
        videoId: entry.videoId,
        ...changes,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
};

// Each Device as it last reported, measured against the current On-device set.
export const getDeviceStatuses = async (db: Database): Promise<DeviceStatus[]> => {
  const [devices, set] = await Promise.all([db.select().from(syncDevices), loadOnDeviceSetIds(db)]);
  return devices
    .map((device) => {
      const held = new Set<string>(JSON.parse(device.offlineVideoIdsJson));
      const present = [...set].filter((id) => held.has(id)).length;
      return {
        id: device.id,
        name: device.name,
        kind: device.kind,
        lastSeenAt: device.lastSeenAt,
        present,
        missing: set.size - present,
      };
    })
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
};
