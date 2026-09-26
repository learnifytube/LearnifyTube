import { and, desc, eq, isNotNull, not, sql } from "drizzle-orm";
import type { Database } from "@/api/db";
import { channels, youtubeVideos } from "@/api/db/schema";
import { isKept } from "./kept";

type SubscriptionVideo = {
  videoId: string;
  title: string;
  channelId: string | null;
  channelTitle: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  publishedAt: number | null;
};

// Videos from Subscriptions not yet kept, newest published first. A Channel the user only
// visited is not a Subscription, so its Videos are left out.
export const loadNewFromSubscriptions = (db: Database, limit = 20): Promise<SubscriptionVideo[]> =>
  db
    .select({
      videoId: youtubeVideos.videoId,
      title: youtubeVideos.title,
      channelId: youtubeVideos.channelId,
      channelTitle: youtubeVideos.channelTitle,
      durationSeconds: youtubeVideos.durationSeconds,
      thumbnailUrl: youtubeVideos.thumbnailUrl,
      thumbnailPath: youtubeVideos.thumbnailPath,
      publishedAt: youtubeVideos.publishedAt,
    })
    .from(youtubeVideos)
    .innerJoin(channels, eq(channels.channelId, youtubeVideos.channelId))
    .where(and(isNotNull(channels.subscribedAt), not(sql`coalesce(${isKept}, 0)`)))
    .orderBy(
      sql`${youtubeVideos.publishedAt} is null`,
      desc(youtubeVideos.publishedAt),
      desc(youtubeVideos.createdAt)
    )
    .limit(limit);
