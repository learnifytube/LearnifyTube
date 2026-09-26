import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import { logger } from "@/helpers/logger";
import { app } from "electron";
import fs from "fs";
import path from "path";

import {
  mapYtDlpMetadata,
  extractChannelData,
  extractSubtitleLanguages,
} from "@/api/utils/ytdlp-utils/metadata";
import { upsertChannelData } from "@/api/utils/ytdlp-utils/database";
import { spawnYtDlpWithLogging, extractVideoId, runYtDlpJson } from "@/api/utils/ytdlp-utils/ytdlp";
import { downloadImageToCache } from "@/api/utils/ytdlp-utils/cache";
import { eq, desc, inArray, sql, and } from "drizzle-orm";
import { getBackgroundJobsManager } from "@/services/background-jobs/job-manager";
import { getVideoResolution } from "@/services/optimization-queue/optimization-worker";
import {
  youtubeVideos,
  channels,
  channelPlaylists,
  videoWatchStats,
  favorites,
  type YoutubeVideo,
  type ChannelPlaylist,
  type Channel,
} from "@/api/db/schema";
import defaultDb, { type Database } from "@/api/db";
import { getYtDlpAssetName } from "@/api/utils/ytdlp-utils/ytdlp-utils";
import crypto from "crypto";

const getBinDir = (): string => path.join(app.getPath("userData"), "bin");
const getBinaryFilePath = (): string => path.join(getBinDir(), getYtDlpAssetName(process.platform));

const isNodeError = (value: unknown): value is NodeJS.ErrnoException => {
  return typeof value === "object" && value !== null && "code" in value;
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: Array<R | undefined> = [];
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.map((result, index) => {
    if (result === undefined) {
      throw new Error(`mapWithConcurrency missing result at index ${index}`);
    }
    return result;
  });
};

// Helper type for video update fields to avoid repetition
type VideoUpdateFields = {
  title: string;
  description: string | null;
  channelId: string | null;
  channelTitle: string;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  thumbnailUrl: string | null;
  publishedAt: number | null;
  tags: string | null;
  raw: string;
};

// Return types for fetchVideoInfo mutation (discriminated union for type safety)
type VideoInfoData = VideoUpdateFields & {
  videoId: string;
};

type FetchVideoInfoSuccess = {
  success: true;
  info: VideoInfoData;
  availableLanguages: Array<{
    lang: string;
    hasManual: boolean;
    hasAuto: boolean;
    manualFormats: string[];
    autoFormats: string[];
  }>;
};

type FetchVideoInfoFailure = {
  success: false;
  message: string;
};

type FetchVideoInfoResult = FetchVideoInfoSuccess | FetchVideoInfoFailure;

// Helper to transform DB video record to API response format
// Define response types using Drizzle's inferred types
type VideoResponse = {
  id: string;
  videoId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  publishedAt: number | null;
  url: string;
  downloadStatus: string | null;
  downloadProgress: number | null;
  downloadFilePath: string | null;
};

type VideoResponseExtended = VideoResponse & {
  channelId: string | null;
  channelTitle: string | null;
  likeCount: number | null;
  tags: string | null;
  raw: string | null; // raw metadata can be null
  createdAt: number;
  updatedAt: number | null;
  downloadId: null;
  downloadCompletedAt: number | null;
};

function toVideoResponse(v: YoutubeVideo): VideoResponse {
  return {
    id: v.id,
    videoId: v.videoId,
    title: v.title,
    description: v.description,
    thumbnailUrl: v.thumbnailUrl,
    thumbnailPath: v.thumbnailPath,
    durationSeconds: v.durationSeconds,
    viewCount: v.viewCount,
    publishedAt: v.publishedAt,
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    downloadStatus: v.downloadStatus,
    downloadProgress: v.downloadProgress,
    downloadFilePath: v.downloadFilePath,
  };
}

// Extended mapper with all fields for channel details
function toVideoResponseExtended(v: YoutubeVideo): VideoResponseExtended {
  return {
    ...toVideoResponse(v), // Reuse base mapper
    channelId: v.channelId,
    channelTitle: v.channelTitle,
    likeCount: v.likeCount,
    tags: v.tags,
    raw: v.raw,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    downloadId: null,
    downloadCompletedAt: v.lastDownloadedAt ?? null,
  };
}

// Define playlist response type
type PlaylistResponse = {
  id: string;
  playlistId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null; // Added missing field
  videoCount: number | null;
  itemCount: number | null; // Added missing field
  channelId: string | null;
  createdAt: number;
  lastFetchedAt: number | null; // Added missing field
  url: string;
};

// Helper to transform DB playlist record to API response format
function toPlaylistResponse(p: ChannelPlaylist): PlaylistResponse {
  return {
    id: p.id,
    playlistId: p.playlistId,
    title: p.title,
    description: p.description,
    url: p.url ?? `https://www.youtube.com/playlist?list=${p.playlistId}`,
    thumbnailUrl: p.thumbnailUrl,
    thumbnailPath: p.thumbnailPath,
    videoCount: p.itemCount, // itemCount from DB maps to videoCount in API
    itemCount: p.itemCount,
    channelId: p.channelId,
    createdAt: p.createdAt,
    lastFetchedAt: p.lastFetchedAt,
  };
}

// Zod schema for yt-dlp flat-playlist response (fault-tolerant)
const playlistResponseSchema = z
  .object({
    channel_id: z.string().nullish().catch(null),
    channel: z.string().nullish().catch(null),
    uploader: z.string().nullish().catch(null),
    channel_url: z.string().nullish().catch(null),
    entries: z
      .array(
        z.object({
          id: z.string().optional().catch(undefined),
          title: z.string().nullish().catch(null),
          duration: z.number().nullish().catch(null),
          view_count: z.number().nullish().catch(null),
          channel: z.string().nullish().catch(null),
          uploader: z.string().nullish().catch(null),
          thumbnails: z
            .array(z.object({ url: z.string().optional().catch(undefined) }))
            .optional()
            .catch([]),
          thumbnail: z.string().nullish().catch(null),
        })
      )
      .optional()
      .catch([]),
  })
  .passthrough();

// Zod schema for yt-dlp playlist metadata response (fault-tolerant)
const playlistEntrySchema = z
  .object({
    id: z.string().nullish().catch(null),
    playlist_id: z.string().nullish().catch(null),
    title: z.string().nullish().catch(null),
    url: z.string().nullish().catch(null),
    webpage_url: z.string().nullish().catch(null),
    playlist_count: z.number().nullish().catch(null),
    n_entries: z.number().nullish().catch(null),
    thumbnails: z
      .array(z.object({ url: z.string().optional().catch(undefined) }))
      .optional()
      .catch([]),
    thumbnail: z.string().nullish().catch(null),
  })
  .passthrough();

const playlistsListResponseSchema = z
  .object({
    entries: z.array(playlistEntrySchema).optional().catch([]),
  })
  .passthrough();

// Zod schema for playlist detail response (fault-tolerant)
const playlistDetailSchema = z
  .object({
    thumbnails: z
      .array(z.object({ url: z.string().optional().catch(undefined) }))
      .optional()
      .catch([]),
  })
  .passthrough();
type FetchChannelInfoResult = {
  success: true;
  channel: Channel | null;
};

async function upsertVideoSearchFts(
  db: Database,
  videoId: string,
  title: string | null | undefined,
  transcript: string | null | undefined
): Promise<void> {
  try {
    // FTS5 virtual tables with UNINDEXED columns don't support WHERE clauses on those columns
    // Since video_id is UNINDEXED (to save index space), we use INSERT OR REPLACE with rowid
    // The strategy: just INSERT and let FTS5 handle it (duplicates are acceptable for search)
    // We'll deduplicate results in search queries using GROUP BY
    await db.run(
      sql`INSERT INTO video_search_fts (video_id, title, transcript) VALUES (${videoId}, ${title ?? ""}, ${transcript ?? ""})`
    );
  } catch {
    // Silently ignore errors - FTS is a nice-to-have feature for search
    // If it fails, video metadata will still be accessible through regular queries
    logger.debug("[fts] insert skipped", { videoId, reason: "already exists or error" });
  }
}

export const ytdlpRouter = t.router({
  // Fetch video metadata from URL (always stores in DB for caching)
  fetchVideoInfo: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input, ctx }): Promise<FetchVideoInfoResult> => {
      const db = ctx.db ?? defaultDb;
      const binPath = getBinaryFilePath();
      if (!fs.existsSync(binPath)) {
        return {
          success: false,
          message: "yt-dlp binary not installed",
        };
      }

      // Extract video ID from URL to check cache
      const videoIdMatch = input.url.match(/[?&]v=([^&]+)/);
      const urlVideoId = videoIdMatch ? videoIdMatch[1] : null;

      // extractSubtitleLanguages is imported from utils/metadata.ts

      // Try to get existing metadata from DB first
      if (urlVideoId) {
        const existingVideo = await db
          .select()
          .from(youtubeVideos)
          .where(eq(youtubeVideos.videoId, urlVideoId))
          .limit(1);

        if (existingVideo.length > 0) {
          // Use cached metadata from DB
          logger.info("[ytdlp] fetchVideoInfo using cached metadata from DB", {
            videoId: urlVideoId,
          });
          const existing = existingVideo[0];
          const mapped = {
            videoId: existing.videoId,
            title: existing.title,
            description: existing.description,
            channelId: existing.channelId,
            channelTitle: existing.channelTitle,
            durationSeconds: existing.durationSeconds,
            viewCount: existing.viewCount,
            likeCount: existing.likeCount,
            thumbnailUrl: existing.thumbnailUrl,
            publishedAt: existing.publishedAt,
            tags: existing.tags,
            raw: existing.raw ?? "{}",
          };

          // Extract subtitle languages from cached raw JSON
          let availableLanguages: Array<{
            lang: string;
            hasManual: boolean;
            hasAuto: boolean;
            manualFormats: string[];
            autoFormats: string[];
          }> = [];
          try {
            if (existing.raw) {
              const rawMeta: unknown = JSON.parse(existing.raw);
              availableLanguages = extractSubtitleLanguages(rawMeta);
            }
          } catch (e) {
            logger.warn("[ytdlp] Failed to parse cached raw JSON for subtitles", {
              videoId: urlVideoId,
              error: String(e),
            });
          }

          return {
            success: true,
            info: mapped,
            availableLanguages,
          };
        }
      }

      // Run yt-dlp -J to fetch metadata (cache miss or store=false)
      logger.info("[ytdlp] fetchVideoInfo fetching from yt-dlp", { url: input.url });
      let meta: unknown = null;
      try {
        const metaJson = await new Promise<string>((resolve, reject) => {
          const proc = spawnYtDlpWithLogging(
            binPath,
            ["-J", input.url],
            { stdio: ["ignore", "pipe", "pipe"] },
            {
              operation: "fetch_video_info",
              url: input.url,
              videoId: extractVideoId(input.url),
            }
          );
          let out = "";
          let err = "";
          proc.stdout?.on("data", (d: Buffer | string) => (out += d.toString()));
          proc.stderr?.on("data", (d: Buffer | string) => (err += d.toString()));
          proc.on("error", reject);
          proc.on("close", (code) => {
            if (code === 0) resolve(out);
            else reject(new Error(err || `yt-dlp -J exited with code ${code}`));
          });
        });
        meta = JSON.parse(metaJson);
      } catch (e) {
        logger.error("[ytdlp] fetchVideoInfo failed", e);
        return { success: false, message: String(e) };
      }

      const mapped = mapYtDlpMetadata(meta);
      // Cache video thumbnail locally for offline use
      const mappedThumbPath = mapped.thumbnailUrl
        ? await downloadImageToCache(mapped.thumbnailUrl, `video_${mapped.videoId}`)
        : null;

      // Extract subtitle languages from metadata
      const availableLanguages = extractSubtitleLanguages(meta);

      // Extract and upsert channel data
      const channelData = extractChannelData(meta);
      logger.info("[ytdlp] Extracted channel data", {
        hasChannelData: !!channelData,
        channelId: channelData?.channelId,
        channelTitle: channelData?.channelTitle,
        metaKeys: Object.keys(meta || {}).filter(
          (k) => k.includes("channel") || k.includes("uploader")
        ),
      });
      if (channelData) {
        await upsertChannelData(db, channelData);
      } else {
        logger.warn("[ytdlp] No channel data extracted from metadata");
      }

      // Always store in DB for caching
      if (mapped.videoId) {
        const now = Date.now();
        try {
          const existing = await db
            .select()
            .from(youtubeVideos)
            .where(eq(youtubeVideos.videoId, mapped.videoId))
            .limit(1);

          // Look up channel title from DB if mapped returns "Unknown Channel"
          let channelTitle = mapped.channelTitle;
          if (channelTitle === "Unknown Channel" && mapped.channelId) {
            const channelRow = await db
              .select({ channelTitle: channels.channelTitle })
              .from(channels)
              .where(eq(channels.channelId, mapped.channelId))
              .limit(1);
            if (channelRow[0]?.channelTitle) {
              channelTitle = channelRow[0].channelTitle;
            }
          }

          // Common fields for both insert and update
          const commonFields: VideoUpdateFields = {
            title: mapped.title,
            description: mapped.description,
            channelId: mapped.channelId,
            channelTitle,
            durationSeconds: mapped.durationSeconds,
            viewCount: mapped.viewCount,
            likeCount: mapped.likeCount,
            thumbnailUrl: mapped.thumbnailUrl,
            publishedAt: mapped.publishedAt,
            tags: mapped.tags,
            raw: mapped.raw,
          };

          if (existing.length === 0) {
            await db.insert(youtubeVideos).values({
              id: crypto.randomUUID(),
              videoId: mapped.videoId,
              thumbnailPath: mappedThumbPath,
              createdAt: now,
              updatedAt: now,
              ...commonFields,
            });
            // Seed FTS with title only (transcript may come later)
            await upsertVideoSearchFts(db, mapped.videoId, mapped.title, "");
          } else {
            await db
              .update(youtubeVideos)
              .set({
                ...commonFields,
                thumbnailPath: mappedThumbPath ?? existing[0]?.thumbnailPath ?? null,
                updatedAt: now,
              })
              .where(eq(youtubeVideos.videoId, mapped.videoId));
            await upsertVideoSearchFts(db, mapped.videoId, mapped.title, undefined);
          }
        } catch (e) {
          logger.error("[ytdlp] DB upsert in fetchVideoInfo failed", e);
        }
      }

      return {
        success: true,
        info: mapped,
        availableLanguages,
      };
    }),
  // List completed downloads with basic video info
  listCompletedDownloads: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input?.limit ?? 50;
      try {
        // Primary: read from unified youtube_videos fields
        const rows = await db
          .select({
            videoId: youtubeVideos.videoId,
            title: youtubeVideos.title,
            thumbnailUrl: youtubeVideos.thumbnailUrl,
            thumbnailPath: youtubeVideos.thumbnailPath,
            filePath: youtubeVideos.downloadFilePath,
            completedAt: youtubeVideos.lastDownloadedAt,
          })
          .from(youtubeVideos)
          .where(eq(youtubeVideos.downloadStatus, "completed"))
          .orderBy(desc(youtubeVideos.lastDownloadedAt))
          .limit(limit);
        return rows;
      } catch (e) {
        // If unified columns missing, return empty list instead of falling back
        logger.error("[ytdlp] listCompletedDownloads failed", e);
        return [];
      }
    }),

  listDownloadedVideosDetailed: publicProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(1000).optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input?.limit ?? 500;

      const rows = await db
        .select({
          videoId: youtubeVideos.videoId,
          title: youtubeVideos.title,
          channelTitle: youtubeVideos.channelTitle,
          thumbnailUrl: youtubeVideos.thumbnailUrl,
          thumbnailPath: youtubeVideos.thumbnailPath,
          filePath: youtubeVideos.downloadFilePath,
          downloadFileSize: youtubeVideos.downloadFileSize,
          downloadStatus: youtubeVideos.downloadStatus,
          downloadProgress: youtubeVideos.downloadProgress,
          durationSeconds: youtubeVideos.durationSeconds,
          lastDownloadedAt: youtubeVideos.lastDownloadedAt,
          createdAt: youtubeVideos.createdAt,
          updatedAt: youtubeVideos.updatedAt,
          totalWatchSeconds: videoWatchStats.totalWatchSeconds,
          lastWatchedAt: videoWatchStats.lastWatchedAt,
          lastPositionSeconds: videoWatchStats.lastPositionSeconds,
        })
        .from(youtubeVideos)
        .leftJoin(videoWatchStats, eq(videoWatchStats.videoId, youtubeVideos.videoId))
        .where(eq(youtubeVideos.downloadStatus, "completed"))
        .orderBy(desc(youtubeVideos.lastDownloadedAt))
        .limit(limit);

      return await mapWithConcurrency(rows, 4, async (row) => {
        const fileExists = row.filePath ? fs.existsSync(row.filePath) : false;
        let fileSizeBytes = row.downloadFileSize ?? null;
        let resolution: { width: number; height: number } | null = null;

        if (!fileSizeBytes && row.filePath && fileExists) {
          try {
            const stats = fs.statSync(row.filePath);
            fileSizeBytes = stats.size;
          } catch (error) {
            logger.warn("[ytdlp] Unable to stat file", {
              filePath: row.filePath,
              error: String(error),
            });
          }
        }

        if (row.filePath && fileExists) {
          resolution = await getVideoResolution(row.filePath);
        }

        return {
          videoId: row.videoId,
          title: row.title,
          channelTitle: row.channelTitle,
          thumbnailUrl: row.thumbnailUrl,
          thumbnailPath: row.thumbnailPath,
          filePath: row.filePath,
          fileExists,
          fileSizeBytes,
          videoWidth: resolution?.width ?? null,
          videoHeight: resolution?.height ?? null,
          downloadStatus: row.downloadStatus,
          downloadProgress: row.downloadProgress,
          durationSeconds: row.durationSeconds,
          lastDownloadedAt: row.lastDownloadedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          totalWatchSeconds: row.totalWatchSeconds,
          lastWatchedAt: row.lastWatchedAt,
          lastPositionSeconds: row.lastPositionSeconds,
        };
      });
    }),

  // Get a single video/download by ID (for tracking download progress)
  getVideoById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      try {
        const result = await db
          .select()
          .from(youtubeVideos)
          .where(eq(youtubeVideos.id, input.id))
          .limit(1);

        if (result.length === 0) {
          return null;
        }

        const video = result[0];
        return {
          id: video.id,
          videoId: video.videoId,
          title: video.title,
          description: video.description,
          status: video.downloadStatus,
          progress: video.downloadProgress ?? 0,
          filePath: video.downloadFilePath,
          fileSize: video.downloadFileSize,
          thumbnailUrl: video.thumbnailUrl,
          thumbnailPath: video.thumbnailPath,
          durationSeconds: video.durationSeconds,
          channelTitle: video.channelTitle,
          errorMessage: video.lastErrorMessage,
          errorType: video.errorType,
          isRetryable: video.isRetryable,
          lastDownloadedAt: video.lastDownloadedAt,
          createdAt: video.createdAt,
          updatedAt: video.updatedAt,
        };
      } catch (e) {
        logger.error("[ytdlp] getVideoById failed", e);
        return null;
      }
    }),

  // Get a single video by its YouTube videoId
  getVideoByVideoId: publicProcedure
    .input(z.object({ videoId: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      try {
        const result = await db
          .select()
          .from(youtubeVideos)
          .where(eq(youtubeVideos.videoId, input.videoId))
          .limit(1);

        if (result.length === 0) return null;
        const v = result[0];
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
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          downloadStatus: v.downloadStatus,
          downloadProgress: v.downloadProgress,
          downloadFilePath: v.downloadFilePath,
          lastDownloadedAt: v.lastDownloadedAt,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
        };
      } catch (e) {
        logger.error("[ytdlp] getVideoByVideoId failed", e);
        return null;
      }
    }),

  deleteDownloadedVideo: publicProcedure
    .input(z.object({ videoId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      try {
        const existing = await db
          .select({
            videoId: youtubeVideos.videoId,
            title: youtubeVideos.title,
            filePath: youtubeVideos.downloadFilePath,
          })
          .from(youtubeVideos)
          .where(eq(youtubeVideos.videoId, input.videoId))
          .limit(1);

        if (existing.length === 0) {
          return { success: false as const, message: "Video not found" };
        }

        const video = existing[0];
        if (video.filePath) {
          try {
            await fs.promises.unlink(video.filePath);
          } catch (error) {
            if (!isNodeError(error) || error.code !== "ENOENT") {
              logger.error("[ytdlp] Failed to remove file", {
                path: video.filePath,
                error: String(error),
              });
              throw error;
            }
          }
        }

        await db
          .update(youtubeVideos)
          .set({
            downloadStatus: null,
            downloadProgress: null,
            downloadFilePath: null,
            downloadFileSize: null,
            lastDownloadedAt: null,
            keptAt: null,
            updatedAt: Date.now(),
          })
          .where(eq(youtubeVideos.videoId, input.videoId))
          .execute();

        logger.info("[ytdlp] Removed downloaded video", {
          videoId: input.videoId,
          title: video.title,
        });

        return { success: true as const };
      } catch (error) {
        logger.error("[ytdlp] deleteDownloadedVideo failed", error);
        return {
          success: false as const,
          message: error instanceof Error ? error.message : "Failed to delete video",
        };
      }
    }),

  // List unique channels from downloaded videos
  listChannels: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input?.limit ?? 50;

      // Get channels from channels table with video count
      const channelRows = await db
        .select()
        .from(channels)
        .orderBy(desc(channels.updatedAt))
        .limit(limit);

      // Count videos for each channel
      const channelsWithVideoCounts = await Promise.all(
        channelRows.map(async (channel) => {
          const videosCount = await db
            .select({ count: youtubeVideos.id })
            .from(youtubeVideos)
            .where(eq(youtubeVideos.channelId, channel.channelId));

          return {
            id: channel.id,
            channelId: channel.channelId,
            channelTitle: channel.channelTitle,
            channelDescription: channel.channelDescription,
            thumbnailUrl: channel.thumbnailUrl,
            thumbnailPath: channel.thumbnailPath,
            subscriberCount: channel.subscriberCount,
            videoCount: videosCount.length,
            customUrl: channel.customUrl,
            lastUpdated: channel.updatedAt,
          };
        })
      );

      // Sort by video count
      return channelsWithVideoCounts.sort((a, b) => b.videoCount - a.videoCount);
    }),

  // Get videos by channel ID
  getVideosByChannel: publicProcedure
    .input(z.object({ channelId: z.string(), limit: z.number().min(1).max(200).optional() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input?.limit ?? 50;

      const videos = await db
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.channelId, input.channelId))
        .orderBy(desc(youtubeVideos.publishedAt))
        .limit(limit);

      return videos;
    }),

  // Get channel details with videos
  getChannelDetails: publicProcedure
    .input(z.object({ channelId: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const t0 = Date.now();
      logger.info("[getChannelDetails] start", { channelId: input.channelId });

      // Get channel info
      const channelRows = await db
        .select()
        .from(channels)
        .where(eq(channels.channelId, input.channelId))
        .limit(1);

      if (channelRows.length === 0) {
        logger.warn("[getChannelDetails] channel not found", {
          channelId: input.channelId,
          durationMs: Date.now() - t0,
        });
        return null;
      }

      const channel = channelRows[0];
      logger.debug("[getChannelDetails] channel row", {
        id: channel.id,
        channelId: channel.channelId,
        title: channel.channelTitle,
        thumbnailUrl: channel.thumbnailUrl,
        thumbnailPath: channel.thumbnailPath,
        hasDescription: !!channel.channelDescription,
      });

      // Get videos from this channel (unique list)
      const videoRows = await db
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.channelId, input.channelId))
        .orderBy(desc(youtubeVideos.publishedAt))
        .limit(50);

      const videoIds = videoRows
        .map((v) => v.videoId)
        .filter((id): id is string => id !== null && id !== "");

      // No videos -> early return
      if (videoIds.length === 0) {
        return { channel, videos: [], totalVideos: 0 };
      }

      // Compose response with unified download summary from youtube_videos
      const videos = videoRows.map(toVideoResponseExtended);

      const durationMs = Date.now() - t0;
      logger.info("[getChannelDetails] done", {
        channelId: input.channelId,
        totalVideos: videos.length,
        durationMs,
      });
      return { channel, videos, totalVideos: videos.length };
    }),

  removeChannel: publicProcedure
    .input(z.object({ channelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const now = Date.now();

      try {
        const channelRows = await db
          .select({
            channelId: channels.channelId,
            channelTitle: channels.channelTitle,
          })
          .from(channels)
          .where(eq(channels.channelId, input.channelId))
          .limit(1);

        const channel = channelRows[0];
        if (!channel) {
          return { success: false as const, message: "Channel not found" };
        }

        const relatedPlaylists = await db
          .select({ playlistId: channelPlaylists.playlistId })
          .from(channelPlaylists)
          .where(eq(channelPlaylists.channelId, input.channelId));

        const playlistIds = relatedPlaylists.map((playlist) => playlist.playlistId);

        await db
          .update(youtubeVideos)
          .set({
            channelId: null,
            updatedAt: now,
          })
          .where(eq(youtubeVideos.channelId, input.channelId));

        if (playlistIds.length > 0) {
          await db
            .delete(favorites)
            .where(
              and(
                eq(favorites.entityType, "channel_playlist"),
                inArray(favorites.entityId, playlistIds)
              )
            );
        }

        await db.delete(channelPlaylists).where(eq(channelPlaylists.channelId, input.channelId));
        await db.delete(channels).where(eq(channels.channelId, input.channelId));

        logger.info("[ytdlp] Removed channel from library", {
          channelId: input.channelId,
          channelTitle: channel.channelTitle,
          removedPlaylistsCount: playlistIds.length,
        });

        return {
          success: true as const,
          channelId: input.channelId,
          channelTitle: channel.channelTitle,
          removedPlaylistsCount: playlistIds.length,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("[ytdlp] Failed to remove channel", {
          channelId: input.channelId,
          error: errorMsg,
        });
        return {
          success: false as const,
          message: errorMsg || "Failed to remove channel",
        };
      }
    }),

  // Get video playback info by videoId (for PlayerPage)
  getVideoPlayback: publicProcedure
    .input(z.object({ videoId: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const rows = await db
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.videoId, input.videoId))
        .limit(1);
      const v = rows[0];
      if (!v) return null;

      // Extract subtitle languages from cached raw JSON
      let availableLanguages: Array<{
        lang: string;
        hasManual: boolean;
        hasAuto: boolean;
        manualFormats: string[];
        autoFormats: string[];
      }> = [];
      if (v.raw) {
        try {
          const meta: unknown = JSON.parse(v.raw);
          availableLanguages = extractSubtitleLanguages(meta);
        } catch {
          // Silently fail - raw JSON might not exist or be malformed
        }
      }

      // Get watch progress (last position) if available
      let lastPositionSeconds: number | undefined = undefined;
      try {
        const watchStats = await db
          .select({ lastPositionSeconds: videoWatchStats.lastPositionSeconds })
          .from(videoWatchStats)
          .where(eq(videoWatchStats.videoId, input.videoId))
          .limit(1);
        if (watchStats.length > 0 && watchStats[0].lastPositionSeconds !== null) {
          lastPositionSeconds = watchStats[0].lastPositionSeconds;
        }
      } catch {
        // Silently fail - watch stats might not exist
      }

      // Generate media server URL for reliable streaming
      let mediaUrl: string | null = null;
      if (v.downloadFilePath && fs.existsSync(v.downloadFilePath)) {
        try {
          const { getMediaServer } = await import("@/main/mediaServer");
          const mediaServer = getMediaServer();
          mediaUrl = mediaServer.getMediaUrl(v.downloadFilePath);
        } catch (error) {
          logger.error("[ytdlp] Failed to generate media URL", {
            videoId: input.videoId,
            error: String(error),
          });
        }
      }

      return {
        videoId: v.videoId,
        title: v.title,
        description: v.description,
        filePath: v.downloadFilePath,
        mediaUrl, // HTTP URL for streaming
        status: v.downloadStatus,
        progress: v.downloadProgress,
        availableLanguages,
        lastPositionSeconds,
        thumbnailUrl: v.thumbnailUrl,
        thumbnailPath: v.thumbnailPath,
        channelTitle: v.channelTitle,
        durationSeconds: v.durationSeconds,
      } as const;
    }),

  // Reset download status for a video (for re-downloading)
  resetDownloadStatus: publicProcedure
    .input(z.object({ videoId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      logger.info("[ytdlp] Resetting download status", { videoId: input.videoId });

      await db
        .update(youtubeVideos)
        .set({
          downloadStatus: null,
          downloadProgress: null,
          downloadFilePath: null,
          downloadFileSize: null,
          lastErrorMessage: null,
          errorType: null,
          updatedAt: Date.now(),
        })
        .where(eq(youtubeVideos.videoId, input.videoId))
        .execute();

      return { success: true };
    }),

  // Full-text search across video titles + transcripts
  searchVideosText: publicProcedure
    .input(z.object({ q: z.string().min(1), limit: z.number().min(1).max(100).optional() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input.limit ?? 20;
      try {
        const rows = await db.all(
          sql`SELECT video_id, title FROM video_search_fts WHERE video_search_fts MATCH ${input.q} LIMIT ${limit * 2}`
        );

        // Validate FTS results
        const ftsResultSchema = z.array(z.object({ video_id: z.string(), title: z.string() }));
        const parseResult = ftsResultSchema.safeParse(rows);
        if (!parseResult.success) {
          logger.error("[fts] Invalid FTS result structure", parseResult.error);
          return [];
        }

        // Deduplicate video_ids (FTS may contain duplicates since video_id is UNINDEXED)
        const uniqueIds = [...new Set(parseResult.data.map((r) => r.video_id))].slice(0, limit);
        if (uniqueIds.length === 0) return [];

        // Join with youtube_videos to return richer info
        const vids = await db
          .select()
          .from(youtubeVideos)
          .where(inArray(youtubeVideos.videoId, uniqueIds));
        const map = new Map(vids.map((v) => [v.videoId, v]));
        return uniqueIds.map((id) => map.get(id)).filter((v): v is YoutubeVideo => v !== undefined);
      } catch (e) {
        logger.error("[fts] search failed", e);
        return [];
      }
    }),

  // Fetch channel information from a channel URL (for adding channels)
  fetchChannelInfo: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input, ctx }): Promise<FetchChannelInfoResult> => {
      const db = ctx.db ?? defaultDb;
      const binPath = getBinaryFilePath();
      if (!fs.existsSync(binPath)) {
        throw new Error("yt-dlp binary not installed");
      }

      logger.info("[ytdlp] Fetching channel info from URL", { url: input.url });

      // Create background job for tracking
      const jobManager = getBackgroundJobsManager();
      const job = jobManager.createJob({
        type: "channel_fetch",
        title: "Loading channel info...",
      });
      jobManager.startJob(job.id);

      // For channel URLs, use --flat-playlist with limit to avoid fetching all videos
      // This gets channel metadata quickly without processing every video
      let meta: unknown;
      try {
        // Use --flat-playlist --playlist-end 1 to get channel info + first video entry only
        // This is much faster than fetching all videos
        const metaJson = await new Promise<string>((resolve, reject) => {
          const proc = spawnYtDlpWithLogging(
            binPath,
            ["-J", "--flat-playlist", "--playlist-end", "1", input.url],
            { stdio: ["ignore", "pipe", "pipe"] },
            {
              operation: "fetch_channel_info",
              url: input.url,
            }
          );
          let out = "";
          let err = "";
          proc.stdout?.on("data", (d: Buffer | string) => {
            out += d.toString();
          });
          proc.stderr?.on("data", (d: Buffer | string) => {
            err += d.toString();
          });
          proc.on("error", reject);
          proc.on("close", (code) => {
            if (code === 0) resolve(out);
            else reject(new Error(err || `yt-dlp -J exited with code ${code}`));
          });
        });

        meta = JSON.parse(metaJson);
      } catch (error) {
        jobManager.failJob(job.id, error instanceof Error ? error.message : String(error));
        logger.error("[ytdlp] Failed to fetch channel info", {
          url: input.url,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      // Extract channel data from the response
      const channelData = extractChannelData(meta);

      if (!channelData || !channelData.channelId) {
        jobManager.failJob(job.id, "Failed to extract channel data from YouTube response");
        throw new Error("Failed to extract channel data from YouTube response");
      }

      // Upsert channel in database
      await upsertChannelData(db, channelData);

      logger.info("[ytdlp] Successfully fetched channel info", {
        channelId: channelData.channelId,
        channelTitle: channelData.channelTitle,
        hasThumbnail: !!channelData.thumbnailUrl,
      });

      // Fetch and return channel from DB
      const updatedChannel = await db
        .select()
        .from(channels)
        .where(eq(channels.channelId, channelData.channelId))
        .limit(1);

      // Mark job as completed
      jobManager.completeJob(job.id);

      return {
        success: true as const,
        channel: updatedChannel[0] || null,
      };
    }),

  // Refresh channel information from YouTube (fetches fresh data including logo)
  refreshChannelInfo: publicProcedure
    .input(z.object({ channelId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const binPath = getBinaryFilePath();

      try {
        // Fetch fresh channel data from YouTube
        const channelUrl = `https://www.youtube.com/channel/${input.channelId}`;
        logger.info("[ytdlp] Refreshing channel info from YouTube", { channelId: input.channelId });

        const meta = await runYtDlpJson(binPath, channelUrl);

        // Extract channel data from the response
        const channelData = extractChannelData(meta);

        if (!channelData || !channelData.channelId) {
          throw new Error("Failed to extract channel data from YouTube response");
        }

        // Update channel in database
        await upsertChannelData(db, channelData);

        logger.info("[ytdlp] Successfully refreshed channel info", {
          channelId: channelData.channelId,
          channelTitle: channelData.channelTitle,
          hasThumbnail: !!channelData.thumbnailUrl,
        });

        // Fetch and return updated channel from DB
        const updatedChannel = await db
          .select()
          .from(channels)
          .where(eq(channels.channelId, input.channelId))
          .limit(1);

        return {
          success: true,
          channel: updatedChannel[0] || null,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("[ytdlp] Failed to refresh channel info", {
          channelId: input.channelId,
          error: errorMsg,
        });
        return {
          success: false,
          error: errorMsg || "Failed to refresh channel information",
          channel: null,
        };
      }
    }),

  // List latest videos from a channel via yt-dlp (metadata-only, fast)
  listChannelLatest: publicProcedure
    .input(
      z.object({
        channelId: z.string(),
        limit: z.number().min(1).max(100).optional(),
        forceRefresh: z.boolean().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input.limit ?? 24;

      // 1) Check if we've fetched before by checking channel's lastLatestFetchedAt
      try {
        const channel = await db
          .select()
          .from(channels)
          .where(eq(channels.channelId, input.channelId))
          .limit(1);

        // If channel exists and has lastLatestFetchedAt, and we're not forcing refresh, use cached data
        if (channel.length > 0 && channel[0].lastLatestFetchedAt !== null && !input.forceRefresh) {
          const cached = await db
            .select()
            .from(youtubeVideos)
            .where(eq(youtubeVideos.channelId, input.channelId))
            .orderBy(desc(youtubeVideos.publishedAt))
            .limit(limit);
          if (cached.length > 0) {
            return cached.map(toVideoResponse);
          }
        }
      } catch (e) {
        logger.error("[ytdlp] Failed to check channel fetch status (latest)", {
          channelId: input.channelId,
          error: String(e),
        });
      }

      const binPath = getBinaryFilePath();
      if (!fs.existsSync(binPath)) {
        // No binary available -> return DB even if empty
        const fallback = await db
          .select()
          .from(youtubeVideos)
          .where(eq(youtubeVideos.channelId, input.channelId))
          .orderBy(desc(youtubeVideos.publishedAt))
          .limit(limit);
        return fallback.map(toVideoResponse);
      }

      // Create background job for tracking
      const jobManager = getBackgroundJobsManager();
      const job = jobManager.createJob({
        type: "channel_latest",
        title: "Loading latest videos...",
        entityId: input.channelId,
      });
      jobManager.startJob(job.id);

      let listData;
      try {
        const url = `https://www.youtube.com/channel/${input.channelId}/videos?view=0&sort=dd&flow=grid`;
        const listing = await new Promise<string>((resolve, reject) => {
          const proc = spawnYtDlpWithLogging(
            binPath,
            ["-J", "--flat-playlist", url],
            { stdio: ["ignore", "pipe", "pipe"] },
            {
              operation: "list_playlist_videos",
              url,
              channelId: input.channelId,
              other: { flatPlaylist: true, sort: "dd" },
            }
          );
          let out = "";
          let err = "";
          proc.stdout?.on("data", (d: Buffer | string) => (out += d.toString()));
          proc.stderr?.on("data", (d: Buffer | string) => (err += d.toString()));
          proc.on("error", reject);
          proc.on("close", (code) =>
            code === 0 ? resolve(out) : reject(new Error(err || `yt-dlp exited ${code}`))
          );
        });

        listData = playlistResponseSchema.parse(JSON.parse(listing));
      } catch (error) {
        jobManager.failJob(job.id, error instanceof Error ? error.message : String(error));
        throw error;
      }

      // Log available fields from the first entry to understand the data structure
      if (listData.entries?.[0]) {
        logger.info("[ytdlp] listChannelLatest flat-playlist entry fields", {
          sampleEntry: listData.entries[0],
          availableFields: Object.keys(listData.entries[0]),
        });
      }

      const entries = (listData.entries ?? []).filter((e) => e.id);
      // limit already computed above
      const now = Date.now();

      // Ensure channel exists in DB before linking videos to it
      try {
        const channelData = extractChannelData({
          ...listData,
          channel_id: listData?.channel_id || input.channelId,
          channel: listData?.channel || listData?.uploader,
          channel_url:
            listData?.channel_url || `https://www.youtube.com/channel/${input.channelId}`,
        });

        if (channelData) {
          await upsertChannelData(db, channelData);
          logger.info("[ytdlp] Upserted channel before linking videos", {
            channelId: channelData.channelId,
            channelTitle: channelData.channelTitle,
          });
        }
      } catch (e) {
        logger.error("[ytdlp] Failed to upsert channel data", {
          channelId: input.channelId,
          error: String(e),
        });
      }

      // Upsert lightweight metadata to DB for caching (avoid expensive individual fetches)
      const videoIds: string[] = [];
      for (const entry of entries.slice(0, limit)) {
        if (!entry.id) continue;
        videoIds.push(entry.id);

        try {
          // Check if video exists in DB
          const existing = await db
            .select()
            .from(youtubeVideos)
            .where(eq(youtubeVideos.videoId, entry.id))
            .limit(1);

          const thumbUrl = entry.thumbnails?.[0]?.url ?? entry.thumbnail;
          const thumbPath = thumbUrl
            ? await downloadImageToCache(thumbUrl, `video_${entry.id}`)
            : null;

          // Get channel title from metadata or look up from channels table
          let channelTitle = entry.channel ?? entry.uploader ?? null;
          if (!channelTitle && input.channelId) {
            const channelRow = await db
              .select({ channelTitle: channels.channelTitle })
              .from(channels)
              .where(eq(channels.channelId, input.channelId))
              .limit(1);
            channelTitle = channelRow[0]?.channelTitle ?? null;
          }

          const videoData = {
            videoId: entry.id,
            title: entry.title ?? "Untitled",
            description: null,
            channelId: input.channelId,
            channelTitle: channelTitle ?? "Unknown Channel",
            durationSeconds: entry.duration ?? null,
            viewCount: entry.view_count ?? null,
            likeCount: null,
            thumbnailUrl: entry.thumbnails?.[0]?.url ?? entry.thumbnail ?? null,
            thumbnailPath: thumbPath,
            publishedAt: null,
            tags: null,
            raw: JSON.stringify(entry),
            updatedAt: now,
          };

          if (existing.length === 0) {
            // Insert new video
            await db.insert(youtubeVideos).values({
              id: crypto.randomUUID(),
              ...videoData,
              createdAt: now,
            });
          } else {
            // Update existing video metadata (preserve download status)
            await db
              .update(youtubeVideos)
              .set({ ...videoData, thumbnailPath: thumbPath ?? existing[0]?.thumbnailPath ?? null })
              .where(eq(youtubeVideos.videoId, entry.id));
          }
        } catch (e) {
          logger.error("[ytdlp] Failed to upsert video from flat-playlist", {
            videoId: entry.id,
            error: String(e),
          });
        }
      }

      // Fetch and return full video data from DB (includes download status)
      if (videoIds.length === 0) return [];

      const videos = await db
        .select()
        .from(youtubeVideos)
        .where(inArray(youtubeVideos.videoId, videoIds))
        .orderBy(desc(youtubeVideos.publishedAt));

      // Update channel's lastLatestFetchedAt timestamp
      try {
        await db
          .update(channels)
          .set({ lastLatestFetchedAt: now, updatedAt: now })
          .where(eq(channels.channelId, input.channelId));
      } catch (e) {
        logger.error("[ytdlp] Failed to update lastLatestFetchedAt", {
          channelId: input.channelId,
          error: String(e),
        });
      }

      // Mark job as completed
      jobManager.completeJob(job.id);

      return videos.map(toVideoResponse);
    }),

  // List popular videos from a channel via yt-dlp (metadata-only, fast)
  listChannelPopular: publicProcedure
    .input(
      z.object({
        channelId: z.string(),
        limit: z.number().min(1).max(100).optional(),
        forceRefresh: z.boolean().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input.limit ?? 24;

      // 1) Check if we've fetched before by checking channel's lastPopularFetchedAt
      try {
        const channel = await db
          .select()
          .from(channels)
          .where(eq(channels.channelId, input.channelId))
          .limit(1);

        // If channel exists and has lastPopularFetchedAt, and we're not forcing refresh, use cached data
        if (channel.length > 0 && channel[0].lastPopularFetchedAt !== null && !input.forceRefresh) {
          const cached = await db
            .select()
            .from(youtubeVideos)
            .where(eq(youtubeVideos.channelId, input.channelId))
            .limit(limit);
          if (cached.length > 0) {
            // Sort by viewCount desc locally, fallback by updatedAt
            const sorted = [...cached].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
            return sorted.map(toVideoResponse);
          }
        }
      } catch (e) {
        logger.error("[ytdlp] Failed to check channel fetch status (popular)", {
          channelId: input.channelId,
          error: String(e),
        });
      }

      const binPath = getBinaryFilePath();
      if (!fs.existsSync(binPath)) {
        const fallback = await db
          .select()
          .from(youtubeVideos)
          .where(eq(youtubeVideos.channelId, input.channelId))
          .limit(limit);
        const sorted = [...fallback].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
        return sorted.map(toVideoResponse);
      }

      // Create background job for tracking
      const jobManager = getBackgroundJobsManager();
      const job = jobManager.createJob({
        type: "channel_popular",
        title: "Loading popular videos...",
        entityId: input.channelId,
      });
      jobManager.startJob(job.id);

      let listData;
      try {
        const url = `https://www.youtube.com/channel/${input.channelId}/videos?view=0&sort=p&flow=grid`;
        const listing = await new Promise<string>((resolve, reject) => {
          const proc = spawnYtDlpWithLogging(
            binPath,
            ["-J", "--flat-playlist", url],
            { stdio: ["ignore", "pipe", "pipe"] },
            {
              operation: "fetch_channel_videos",
              url,
              channelId: input.channelId,
              other: { flatPlaylist: true },
            }
          );
          let out = "";
          let err = "";
          proc.stdout?.on("data", (d: Buffer | string) => (out += d.toString()));
          proc.stderr?.on("data", (d: Buffer | string) => (err += d.toString()));
          proc.on("error", reject);
          proc.on("close", (code) =>
            code === 0 ? resolve(out) : reject(new Error(err || `yt-dlp exited ${code}`))
          );
        });

        listData = playlistResponseSchema.parse(JSON.parse(listing));
      } catch (error) {
        jobManager.failJob(job.id, error instanceof Error ? error.message : String(error));
        throw error;
      }

      // Log available fields from the first entry to understand the data structure
      if (listData.entries?.[0]) {
        logger.info("[ytdlp] listChannelPopular flat-playlist entry fields", {
          sampleEntry: listData.entries[0],
          availableFields: Object.keys(listData.entries[0]),
        });
      }

      const entries = (listData.entries ?? []).filter((e) => e.id);
      // limit already computed above
      const now = Date.now();

      // Ensure channel exists in DB before linking videos to it
      try {
        const channelData = extractChannelData({
          ...listData,
          channel_id: listData?.channel_id || input.channelId,
          channel: listData?.channel || listData?.uploader,
          channel_url:
            listData?.channel_url || `https://www.youtube.com/channel/${input.channelId}`,
        });

        if (channelData) {
          await upsertChannelData(db, channelData);
          logger.info("[ytdlp] Upserted channel before linking videos (popular)", {
            channelId: channelData.channelId,
            channelTitle: channelData.channelTitle,
          });
        }
      } catch (e) {
        logger.error("[ytdlp] Failed to upsert channel data (popular)", {
          channelId: input.channelId,
          error: String(e),
        });
      }

      // Upsert lightweight metadata to DB for caching (avoid expensive individual fetches)
      const videoIds: string[] = [];
      for (const entry of entries.slice(0, limit)) {
        if (!entry.id) continue;
        videoIds.push(entry.id);

        try {
          // Check if video exists in DB
          const existing = await db
            .select()
            .from(youtubeVideos)
            .where(eq(youtubeVideos.videoId, entry.id))
            .limit(1);

          const thumbUrl = entry.thumbnails?.[0]?.url ?? entry.thumbnail;
          const thumbPath = thumbUrl
            ? await downloadImageToCache(thumbUrl, `video_${entry.id}`)
            : null;

          // Get channel title from metadata or look up from channels table
          let channelTitle = entry.channel ?? entry.uploader ?? null;
          if (!channelTitle && input.channelId) {
            const channelRow = await db
              .select({ channelTitle: channels.channelTitle })
              .from(channels)
              .where(eq(channels.channelId, input.channelId))
              .limit(1);
            channelTitle = channelRow[0]?.channelTitle ?? null;
          }

          const videoData = {
            videoId: entry.id,
            title: entry.title ?? "Untitled",
            description: null,
            channelId: input.channelId,
            channelTitle: channelTitle ?? "Unknown Channel",
            durationSeconds: entry.duration ?? null,
            viewCount: entry.view_count ?? null,
            likeCount: null,
            thumbnailUrl: entry.thumbnails?.[0]?.url ?? entry.thumbnail ?? null,
            thumbnailPath: thumbPath,
            publishedAt: null,
            tags: null,
            raw: JSON.stringify(entry),
            updatedAt: now,
          };

          if (existing.length === 0) {
            // Insert new video
            await db.insert(youtubeVideos).values({
              id: crypto.randomUUID(),
              ...videoData,
              createdAt: now,
            });
          } else {
            // Update existing video metadata (preserve download status)
            await db
              .update(youtubeVideos)
              .set({ ...videoData, thumbnailPath: thumbPath ?? existing[0]?.thumbnailPath ?? null })
              .where(eq(youtubeVideos.videoId, entry.id));
          }
        } catch (e) {
          logger.error("[ytdlp] Failed to upsert video from flat-playlist", {
            videoId: entry.id,
            error: String(e),
          });
        }
      }

      // Fetch and return full video data from DB (includes download status)
      if (videoIds.length === 0) return [];

      const videos = await db
        .select()
        .from(youtubeVideos)
        .where(inArray(youtubeVideos.videoId, videoIds));

      // Sort by viewCount desc locally, fallback by updatedAt
      const sorted = [...videos].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));

      // Update channel's lastPopularFetchedAt timestamp
      try {
        await db
          .update(channels)
          .set({ lastPopularFetchedAt: now, updatedAt: now })
          .where(eq(channels.channelId, input.channelId));
      } catch (e) {
        logger.error("[ytdlp] Failed to update lastPopularFetchedAt", {
          channelId: input.channelId,
          error: String(e),
        });
      }

      // Mark job as completed
      jobManager.completeJob(job.id);

      return sorted.map(toVideoResponse);
    }),

  // List playlists of a channel via yt-dlp (offline-first, cached in DB)
  listChannelPlaylists: publicProcedure
    .input(
      z.object({
        channelId: z.string(),
        limit: z.number().min(1).max(200).optional(),
        forceRefresh: z.boolean().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input.limit ?? 30;

      // 1) Check if we've fetched before by checking channel's lastPlaylistsFetchedAt
      try {
        const channel = await db
          .select()
          .from(channels)
          .where(eq(channels.channelId, input.channelId))
          .limit(1);

        // If channel exists and has lastPlaylistsFetchedAt, and we're not forcing refresh, use cached data
        if (
          channel.length > 0 &&
          channel[0].lastPlaylistsFetchedAt !== null &&
          !input.forceRefresh
        ) {
          const cached = await db
            .select()
            .from(channelPlaylists)
            .where(eq(channelPlaylists.channelId, input.channelId))
            .orderBy(desc(channelPlaylists.updatedAt))
            .limit(limit);
          if (cached.length > 0) {
            return cached.map(toPlaylistResponse);
          }
        }
      } catch (e) {
        logger.error("[ytdlp] Failed to check channel fetch status (playlists)", {
          channelId: input.channelId,
          error: String(e),
        });
      }

      const binPath = getBinaryFilePath();
      if (!fs.existsSync(binPath)) {
        // No binary -> return cached
        const fallback = await db
          .select()
          .from(channelPlaylists)
          .where(eq(channelPlaylists.channelId, input.channelId))
          .orderBy(desc(channelPlaylists.updatedAt))
          .limit(limit);
        return fallback.map(toPlaylistResponse);
      }

      // Create background job for tracking
      const jobManager = getBackgroundJobsManager();
      const job = jobManager.createJob({
        type: "channel_playlists",
        title: "Loading channel playlists...",
        entityId: input.channelId,
      });
      jobManager.startJob(job.id);

      let data;
      try {
        // 2) Refresh from yt-dlp
        const url = `https://www.youtube.com/channel/${input.channelId}/playlists`;
        const json = await new Promise<string>((resolve, reject) => {
          const proc = spawnYtDlpWithLogging(
            binPath,
            ["-J", "--flat-playlist", url],
            { stdio: ["ignore", "pipe", "pipe"] },
            {
              operation: "fetch_channel_playlists",
              url,
              channelId: input.channelId,
              other: { flatPlaylist: true },
            }
          );
          let out = "";
          let err = "";
          proc.stdout?.on("data", (d: Buffer | string) => (out += d.toString()));
          proc.stderr?.on("data", (d: Buffer | string) => (err += d.toString()));
          proc.on("error", reject);
          proc.on("close", (code) =>
            code === 0 ? resolve(out) : reject(new Error(err || `yt-dlp exited ${code}`))
          );
        });
        data = playlistsListResponseSchema.parse(JSON.parse(json));
      } catch (error) {
        jobManager.failJob(job.id, error instanceof Error ? error.message : String(error));
        throw error;
      }
      const entries = (data.entries ?? []).slice(0, limit);
      const now = Date.now();

      if (entries[0]) {
        logger.info("[ytdlp] listChannelPlaylists flat entry sample", {
          keys: Object.keys(entries[0]),
          id: entries[0].id ?? entries[0].playlist_id,
          title: entries[0].title,
          thumbTop: entries[0].thumbnails?.[0]?.url ?? entries[0].thumbnail ?? null,
        });
      }

      for (let idx = 0; idx < entries.length; idx++) {
        const e = entries[idx];
        const pid = e.id ?? e.playlist_id;
        if (!pid) continue;
        const title = e.title ?? "Untitled";
        let thumb = e.thumbnails?.[0]?.url ?? e.thumbnail ?? null;
        const url = e.url ?? e.webpage_url ?? `https://www.youtube.com/playlist?list=${pid}`;
        const itemCount = e.playlist_count ?? e.n_entries ?? null;

        if (!thumb) {
          logger.debug("[ytdlp] playlist thumbnail missing, enriching", { playlistId: pid, url });
          try {
            const detailJson = await new Promise<string>((resolve, reject) => {
              const proc = spawnYtDlpWithLogging(
                binPath,
                ["-J", url],
                { stdio: ["ignore", "pipe", "pipe"] },
                {
                  operation: "fetch_playlist_metadata",
                  url,
                  playlistId: pid,
                  channelId: input.channelId,
                  other: { itemIndex: idx },
                }
              );
              let out = "";
              let err = "";
              proc.stdout?.on("data", (d: Buffer | string) => (out += d.toString()));
              proc.stderr?.on("data", (d: Buffer | string) => (err += d.toString()));
              proc.on("error", reject);
              proc.on("close", (code) =>
                code === 0 ? resolve(out) : reject(new Error(err || `yt-dlp exited ${code}`))
              );
            });
            const detail = playlistDetailSchema.parse(JSON.parse(detailJson));
            if (detail.thumbnails && detail.thumbnails.length > 0) {
              thumb =
                detail.thumbnails[detail.thumbnails.length - 1]?.url ??
                detail.thumbnails[0]?.url ??
                null;
              logger.debug("[ytdlp] playlist thumbnail enriched", { playlistId: pid, thumb });
            } else {
              logger.warn("[ytdlp] playlist detail has no thumbnails", {
                playlistId: pid,
              });
            }
          } catch (err) {
            logger.warn("[ytdlp] playlist enrich failed", { playlistId: pid, error: String(err) });
          }
        }

        // Attempt to cache thumbnail locally (for offline)
        let thumbnailPathLocal: string | null = null;
        if (thumb) {
          thumbnailPathLocal = await downloadImageToCache(thumb, `playlist_${pid}`);
        }

        try {
          const existing = await db
            .select()
            .from(channelPlaylists)
            .where(eq(channelPlaylists.playlistId, pid))
            .limit(1);

          if (existing.length === 0) {
            await db.insert(channelPlaylists).values({
              id: crypto.randomUUID(),
              playlistId: pid,
              channelId: input.channelId,
              title,
              description: null,
              thumbnailUrl: thumb,
              thumbnailPath: thumbnailPathLocal,
              itemCount,
              url,
              raw: JSON.stringify(e),
              createdAt: now,
              updatedAt: now,
              lastFetchedAt: now,
            });
            logger.info("[ytdlp] playlist inserted", { playlistId: pid, hasThumb: !!thumb });
          } else {
            await db
              .update(channelPlaylists)
              .set({
                channelId: input.channelId,
                title,
                thumbnailUrl: thumb,
                thumbnailPath: thumbnailPathLocal ?? existing[0]?.thumbnailPath ?? null,
                itemCount,
                url,
                raw: JSON.stringify(e),
                updatedAt: now,
                lastFetchedAt: now,
              })
              .where(eq(channelPlaylists.playlistId, pid));
            logger.debug("[ytdlp] playlist updated", { playlistId: pid, hasThumb: !!thumb });
          }
        } catch (err) {
          logger.error("[ytdlp] playlist upsert failed", { playlistId: pid, error: String(err) });
        }
      }

      const cached = await db
        .select()
        .from(channelPlaylists)
        .where(eq(channelPlaylists.channelId, input.channelId))
        .orderBy(desc(channelPlaylists.updatedAt))
        .limit(limit);

      // Update channel's lastPlaylistsFetchedAt timestamp
      try {
        await db
          .update(channels)
          .set({ lastPlaylistsFetchedAt: now, updatedAt: now })
          .where(eq(channels.channelId, input.channelId));
      } catch (e) {
        logger.error("[ytdlp] Failed to update lastPlaylistsFetchedAt", {
          channelId: input.channelId,
          error: String(e),
        });
      }

      // Mark job as completed
      jobManager.completeJob(job.id);

      return cached.map(toPlaylistResponse);
    }),
});

// Router type not exported (unused)
