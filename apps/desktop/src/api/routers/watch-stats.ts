import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import { logger } from "@/helpers/logger";
import { desc, inArray } from "drizzle-orm";
import { youtubeVideos, videoWatchStats } from "@/api/db/schema";
import defaultDb from "@/api/db";
import { recordWatchProgress, setWatched } from "@/api/library/watch";

// Return types for watch-stats router
type RecordProgressSuccess = {
  success: true;
};

type RecordProgressFailure = {
  success: false;
};

type RecordProgressResult = RecordProgressSuccess | RecordProgressFailure;

type WatchedVideoWithStats = {
  id: string;
  videoId: string;
  title: string;
  description: string | null;
  channelId: string | null;
  channelTitle: string;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  publishedAt: number | null;
  totalWatchSeconds: number | null;
  lastPositionSeconds: number | null;
  lastWatchedAt: number;
};

type ListRecentWatchedResult = WatchedVideoWithStats[];

export const watchStatsRouter = t.router({
  // Record watch progress (accumulated seconds and last position)
  recordProgress: publicProcedure
    .input(
      z.object({
        videoId: z.string(),
        deltaSeconds: z.number().min(0).max(3600),
        positionSeconds: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ input, ctx }): Promise<RecordProgressResult> => {
      try {
        await recordWatchProgress(ctx.db ?? defaultDb, input);
        return { success: true };
      } catch (e) {
        logger.error("[watch-stats] recordProgress failed", e);
        return { success: false };
      }
    }),

  // Mark a Video watched, or back to unwatched (which also forgets where playback stopped)
  setWatched: publicProcedure
    .input(z.object({ videoId: z.string(), watched: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await setWatched(ctx.db ?? defaultDb, input.videoId, input.watched);
      return { success: true };
    }),

  // List recently watched videos joined with metadata
  listRecentWatched: publicProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).optional(),
          offset: z.number().min(0).optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }): Promise<ListRecentWatchedResult> => {
      const db = ctx.db ?? defaultDb;
      const limit = input?.limit ?? 30;
      const offset = input?.offset ?? 0;
      // Get recent watch stats
      const stats = await db
        .select()
        .from(videoWatchStats)
        .orderBy(desc(videoWatchStats.lastWatchedAt))
        .limit(limit)
        .offset(offset);

      const videoIds = stats.map((s) => s.videoId);
      if (videoIds.length === 0) return [];

      const vids = await db
        .select()
        .from(youtubeVideos)
        .where(inArray(youtubeVideos.videoId, videoIds));

      const map = new Map<string, (typeof vids)[0]>();
      vids.forEach((v) => map.set(v.videoId, v));
      return stats
        .map((s) => {
          const v = map.get(s.videoId);
          if (!v) return null;
          return {
            id: v.id,
            videoId: v.videoId,
            title: v.title,
            description: v.description,
            channelId: v.channelId,
            channelTitle: v.channelTitle,
            thumbnailUrl: v.thumbnailUrl,
            thumbnailPath: v.thumbnailPath,
            durationSeconds: v.durationSeconds,
            viewCount: v.viewCount,
            publishedAt: v.publishedAt,
            totalWatchSeconds: s.totalWatchSeconds,
            lastPositionSeconds: s.lastPositionSeconds,
            lastWatchedAt: s.lastWatchedAt,
          };
        })
        .filter((v): v is WatchedVideoWithStats => v !== null);
    }),
});

// Router type not exported (unused)
