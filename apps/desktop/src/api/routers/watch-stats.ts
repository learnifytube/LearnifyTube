import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import { logger } from "@/helpers/logger";
import { eq, desc, inArray } from "drizzle-orm";
import { youtubeVideos, videoWatchStats } from "@/api/db/schema";
import defaultDb from "@/api/db";
import { isPlayedEnough } from "@/lib/watch-state";

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
      const db = ctx.db ?? defaultDb;
      const now = Date.now();
      try {
        const existing = await db
          .select()
          .from(videoWatchStats)
          .where(eq(videoWatchStats.videoId, input.videoId))
          .limit(1);

        const [video] = await db
          .select({ durationSeconds: youtubeVideos.durationSeconds })
          .from(youtubeVideos)
          .where(eq(youtubeVideos.videoId, input.videoId))
          .limit(1);
        const playedEnough =
          input.positionSeconds !== undefined &&
          isPlayedEnough(input.positionSeconds, video?.durationSeconds ?? null);

        if (existing.length === 0) {
          await db.insert(videoWatchStats).values({
            id: crypto.randomUUID(),
            videoId: input.videoId,
            totalWatchSeconds: Math.floor(input.deltaSeconds),
            lastPositionSeconds: Math.floor(input.positionSeconds ?? 0),
            lastWatchedAt: now,
            watchedAt: playedEnough ? now : null,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          const prev = existing[0];
          await db
            .update(videoWatchStats)
            .set({
              totalWatchSeconds: Math.max(
                0,
                (prev.totalWatchSeconds ?? 0) + Math.floor(input.deltaSeconds)
              ),
              lastPositionSeconds: Math.floor(
                input.positionSeconds ?? prev.lastPositionSeconds ?? 0
              ),
              lastWatchedAt: now,
              watchedAt: prev.watchedAt ?? (playedEnough ? now : null),
              updatedAt: now,
            })
            .where(eq(videoWatchStats.videoId, input.videoId));
        }
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
      const db = ctx.db ?? defaultDb;
      const now = Date.now();
      const changes = input.watched
        ? { watchedAt: now, updatedAt: now }
        : { watchedAt: null, lastPositionSeconds: 0, updatedAt: now };
      await db
        .insert(videoWatchStats)
        .values({ id: crypto.randomUUID(), videoId: input.videoId, createdAt: now, ...changes })
        .onConflictDoUpdate({ target: videoWatchStats.videoId, set: changes });
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
