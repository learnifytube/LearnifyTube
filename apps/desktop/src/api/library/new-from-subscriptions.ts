import { and, desc, isNotNull, not, sql } from "drizzle-orm";
import type { Database } from "@/api/db";
import { youtubeVideos } from "@/api/db/schema";
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

// Videos from Subscriptions not yet kept, newest published first. There is no "followed"
// flag yet, so every Channel the app knows counts as a Subscription (as on the Subscriptions page).
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
    .where(and(isNotNull(youtubeVideos.channelId), not(sql`coalesce(${isKept}, 0)`)))
    .orderBy(
      sql`${youtubeVideos.publishedAt} is null`,
      desc(youtubeVideos.publishedAt),
      desc(youtubeVideos.createdAt)
    )
    .limit(limit);
