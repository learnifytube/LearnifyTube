import { asc, eq, isNotNull, sql } from "drizzle-orm";
import type { Database } from "@/api/db";
import { channels, customPlaylists, youtubeVideos } from "@/api/db/schema";
import { autoKeepColumns, describeAutoKeep, type AutoKeepStatus } from "./auto-keep";

type Subscription = {
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  autoKeep: AutoKeepStatus;
};

type SubscriptionVideo = Pick<
  typeof youtubeVideos.$inferSelect,
  | "id"
  | "videoId"
  | "title"
  | "description"
  | "channelId"
  | "channelTitle"
  | "thumbnailUrl"
  | "thumbnailPath"
  | "durationSeconds"
  | "viewCount"
  | "publishedAt"
  | "downloadStatus"
  | "downloadProgress"
  | "downloadFilePath"
>;

// Subscribe or unsubscribe a Channel. Unsubscribing leaves every kept Video alone; it only
// stops the Channel's new Videos showing up and switches Auto-keep off.
// Returns false when the app does not know the Channel.
export const setSubscribed = async (
  db: Database,
  channelId: string,
  subscribed: boolean
): Promise<boolean> => {
  const updated = await db
    .update(channels)
    .set({
      subscribedAt: subscribed ? sql`coalesce(${channels.subscribedAt}, ${Date.now()})` : null,
      ...(!subscribed && { autoKeepSince: null }),
      updatedAt: Date.now(),
    })
    .where(eq(channels.channelId, channelId))
    .returning({ channelId: channels.channelId });
  return updated.length > 0;
};

export const listSubscriptions = async (db: Database): Promise<Subscription[]> => {
  const rows = await db
    .select({
      channelTitle: channels.channelTitle,
      thumbnailUrl: channels.thumbnailUrl,
      thumbnailPath: channels.thumbnailPath,
      ...autoKeepColumns,
    })
    .from(channels)
    .leftJoin(customPlaylists, eq(customPlaylists.id, channels.autoKeepListId))
    .where(isNotNull(channels.subscribedAt))
    .orderBy(asc(sql`lower(${channels.channelTitle})`));
  return rows.map((row) => ({
    channelId: row.channelId,
    channelTitle: row.channelTitle,
    thumbnailUrl: row.thumbnailUrl,
    thumbnailPath: row.thumbnailPath,
    autoKeep: describeAutoKeep(row),
  }));
};

// Videos from Subscriptions for the Subscriptions page, balanced across Channels: the newest
// found from each Subscription, then the second newest from each, and so on.
export const loadSubscriptionVideos = (
  db: Database,
  { limit = 200, offset = 0 } = {}
): Promise<SubscriptionVideo[]> =>
  db.all<SubscriptionVideo>(sql`
    WITH ranked_videos AS (
      SELECT
        v.*,
        ROW_NUMBER() OVER (PARTITION BY v.channel_id ORDER BY v.created_at DESC) as rn
      FROM youtube_videos v
      JOIN channels c ON c.channel_id = v.channel_id
      WHERE c.subscribed_at IS NOT NULL
    )
    SELECT
      id, video_id as videoId, title, description,
      channel_id as channelId, channel_title as channelTitle,
      thumbnail_url as thumbnailUrl, thumbnail_path as thumbnailPath,
      duration_seconds as durationSeconds, view_count as viewCount,
      published_at as publishedAt, download_status as downloadStatus,
      download_progress as downloadProgress, download_file_path as downloadFilePath
    FROM ranked_videos
    ORDER BY rn ASC, created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
