import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import { logger } from "@/helpers/logger";
import fs from "fs";
import { eq, desc, inArray, and, sql } from "drizzle-orm";
import {
  channelPlaylists,
  playlistItems,
  youtubeVideos,
  channels,
  favorites,
  type ChannelPlaylist,
  type YoutubeVideo,
  type NewYoutubeVideo,
} from "@/api/db/schema";
import defaultDb, { type Database } from "@/api/db";
import {
  currentVideoIndexIn,
  loadCurrentVideo,
  loadCurrentVideoIndexes,
} from "@/api/collections/current-video";
import { FAVORITES_LIST_ID } from "@/lib/lists";
import { spawnYtDlpWithLogging } from "../../utils/ytdlp-utils/ytdlp";
import { downloadImageToCache } from "../../utils/ytdlp-utils/cache";
import { getBinaryFilePath } from "../binary";
import { getBackgroundJobsManager } from "@/services/background-jobs/job-manager";

// Zod schemas for yt-dlp JSON responses (fault-tolerant)
const ytDlpThumbnailSchema = z
  .object({
    url: z.string().optional().catch(undefined),
    width: z.number().optional().catch(undefined),
    height: z.number().optional().catch(undefined),
  })
  .passthrough();

const ytDlpPlaylistEntrySchema = z.object({
  id: z.string().optional().catch(undefined),
  title: z.string().nullish().catch(null),
  duration: z.number().nullish().catch(null),
  view_count: z.number().nullish().catch(null),
  channel: z.string().nullish().catch(null),
  uploader: z.string().nullish().catch(null),
  thumbnails: z.array(ytDlpThumbnailSchema).optional().catch([]),
  thumbnail: z.string().nullish().catch(null),
});

const ytDlpPlaylistDataSchema = z.object({
  title: z.string().nullish().catch(null),
  description: z.string().nullish().catch(null),
  channel: z.string().nullish().catch(null),
  uploader: z.string().nullish().catch(null),
  channel_id: z.string().nullish().catch(null),
  channel_url: z.string().nullish().catch(null),
  thumbnails: z.array(ytDlpThumbnailSchema).optional().catch([]),
  entries: z.array(ytDlpPlaylistEntrySchema).optional().catch([]),
});

// UUID regex pattern - custom playlists use UUIDs, YouTube playlists don't
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlaylistDetailsInput {
  playlistId: string;
  playlistUrl?: string;
  forceRefresh?: boolean;
  limit?: number;
}

export interface PlaylistDetailsVideo {
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
}

export interface PlaylistDetailsResult {
  playlistId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  itemCount: number | null;
  /** The Current Video's place in the playlist; null when none is set or it left. */
  currentVideoIndex: number | null;
  url: string;
  lastFetchedAt: number | null;
  videos: PlaylistDetailsVideo[];
}

export async function getPlaylistDetailsForServer(
  input: PlaylistDetailsInput,
  db: Database = defaultDb
): Promise<PlaylistDetailsResult | null> {
  const details = await loadPlaylistDetails(input, db);
  if (!details) return null;
  const current = await loadCurrentVideo(db, {
    kind: "youtube_playlist",
    id: details.playlistId,
  });
  return { ...details, currentVideoIndex: currentVideoIndexIn(details.videos, current) };
}

async function loadPlaylistDetails(
  input: PlaylistDetailsInput,
  db: Database
): Promise<Omit<PlaylistDetailsResult, "currentVideoIndex"> | null> {
  // Reject UUID-formatted playlist IDs - these are custom playlists, not YouTube playlists
  if (UUID_REGEX.test(input.playlistId)) {
    logger.warn("[playlists] Rejected UUID playlist ID - use custom playlists router", {
      playlistId: input.playlistId,
    });
    return null;
  }
  // Favorites is a List, not a YouTube playlist: never fetch it from YouTube.
  if (input.playlistId === FAVORITES_LIST_ID) return null;

  const limit = input.limit ?? 200;

  const binPath = getBinaryFilePath();

  // Try to read basic playlist metadata from DB first
  let playlistMeta: ChannelPlaylist | null = null;
  try {
    const existing = await db
      .select()
      .from(channelPlaylists)
      .where(eq(channelPlaylists.playlistId, input.playlistId))
      .limit(1);
    playlistMeta = existing[0] ?? null;
  } catch (e) {
    logger.warn("[playlists] Failed to load playlist meta", {
      playlistId: input.playlistId,
      error: String(e),
    });
  }

  // If we have cached data and not forcing refresh, return from DB
  if (playlistMeta && !input.forceRefresh) {
    try {
      const items = await db
        .select({
          position: playlistItems.position,
          videoId: playlistItems.videoId,
          video: youtubeVideos,
        })
        .from(playlistItems)
        .leftJoin(youtubeVideos, eq(playlistItems.videoId, youtubeVideos.videoId))
        .where(eq(playlistItems.playlistId, input.playlistId))
        .orderBy(playlistItems.position)
        .limit(limit);

      if (items.length > 0) {
        const videos = items
          .filter((item): item is typeof item & { video: YoutubeVideo } => item.video !== null)
          .map((item) => ({
            id: item.video.id,
            videoId: item.video.videoId,
            title: item.video.title,
            description: item.video.description,
            thumbnailUrl: item.video.thumbnailUrl,
            thumbnailPath: item.video.thumbnailPath,
            durationSeconds: item.video.durationSeconds,
            viewCount: item.video.viewCount,
            publishedAt: item.video.publishedAt,
            url: `https://www.youtube.com/watch?v=${item.video.videoId}`,
            downloadStatus: item.video.downloadStatus,
            downloadProgress: item.video.downloadProgress,
            downloadFilePath: item.video.downloadFilePath,
          }));

        return {
          playlistId: playlistMeta.playlistId,
          title: playlistMeta.title,
          description: playlistMeta.description,
          thumbnailUrl: playlistMeta.thumbnailUrl,
          thumbnailPath: playlistMeta.thumbnailPath,
          itemCount: playlistMeta.itemCount,
          url:
            playlistMeta.url ?? `https://www.youtube.com/playlist?list=${playlistMeta.playlistId}`,
          lastFetchedAt: playlistMeta.lastFetchedAt,
          videos,
        };
      }
    } catch {
      logger.error("[playlists] Failed to load cached items", { playlistId: input.playlistId });
    }
  }

  // If no binary and no force refresh, return what we have or null
  if (!fs.existsSync(binPath)) {
    return playlistMeta
      ? {
          playlistId: playlistMeta.playlistId,
          title: playlistMeta.title,
          description: playlistMeta.description,
          thumbnailUrl: playlistMeta.thumbnailUrl,
          thumbnailPath: playlistMeta.thumbnailPath,
          itemCount: playlistMeta.itemCount,
          url:
            playlistMeta.url ?? `https://www.youtube.com/playlist?list=${playlistMeta.playlistId}`,
          lastFetchedAt: playlistMeta.lastFetchedAt,
          videos: [],
        }
      : null;
  }

  // Create background job for tracking
  const jobManager = getBackgroundJobsManager();
  const job = jobManager.createJob({
    type: "playlist_fetch",
    title: playlistMeta?.title ? `Loading ${playlistMeta.title}...` : "Loading playlist...",
    entityId: input.playlistId,
  });
  jobManager.startJob(job.id);

  const url =
    input.playlistUrl ??
    playlistMeta?.url ??
    `https://www.youtube.com/playlist?list=${input.playlistId}`;

  let data;
  try {
    // Fetch playlist JSON
    const json = await new Promise<string>((resolve, reject) => {
      const proc = spawnYtDlpWithLogging(
        binPath,
        ["-J", "--flat-playlist", url],
        { stdio: ["ignore", "pipe", "pipe"] },
        {
          operation: "get_playlist_details",
          url,
          playlistId: input.playlistId,
          other: { flatPlaylist: true },
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
      proc.on("close", (code) =>
        code === 0 ? resolve(out) : reject(new Error(err || `yt-dlp exited ${code}`))
      );
    });

    data = ytDlpPlaylistDataSchema.parse(JSON.parse(json));
  } catch (error) {
    jobManager.failJob(job.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
  const entries = (data.entries ?? []).slice(0, limit);
  const now = Date.now();

  // Ensure channel exists in DB before linking videos to it
  if (playlistMeta?.channelId || data?.channel_id) {
    try {
      const { extractChannelData } = await import("@/api/utils/ytdlp-utils/metadata");
      const { upsertChannelData } = await import("@/api/utils/ytdlp-utils/database");

      const channelData = extractChannelData({
        channel_id: data.channel_id ?? playlistMeta?.channelId ?? null,
        channel: data.channel ?? data.uploader ?? null,
        uploader: data.uploader ?? null,
        channel_url:
          data.channel_url ??
          (playlistMeta?.channelId
            ? `https://www.youtube.com/channel/${playlistMeta.channelId}`
            : null),
        channel_title: data.title ?? null,
        channel_description: data.description ?? null,
      });

      // upsertChannelData handles null check internally
      await upsertChannelData(db, channelData);
      if (channelData) {
        logger.info("[playlists] Upserted channel before linking videos", {
          channelId: channelData.channelId,
          channelTitle: channelData.channelTitle,
          playlistId: input.playlistId,
        });
      }
    } catch (e) {
      logger.error("[playlists] Failed to upsert channel data", {
        channelId: playlistMeta?.channelId || data?.channel_id,
        playlistId: input.playlistId,
        error: String(e),
      });
    }
  }

  // Update playlist meta in DB
  try {
    const thumbTop =
      data?.thumbnails?.[data.thumbnails.length - 1]?.url || data?.thumbnails?.[0]?.url || null;
    const downloadedThumb = thumbTop
      ? await downloadImageToCache(thumbTop, `playlist_${input.playlistId}`)
      : null;

    const existing = await db
      .select()
      .from(channelPlaylists)
      .where(eq(channelPlaylists.playlistId, input.playlistId))
      .limit(1);

    const metaUpdate = {
      title: data?.title || playlistMeta?.title || "Untitled",
      description: data?.description || playlistMeta?.description || null,
      thumbnailUrl: thumbTop || playlistMeta?.thumbnailUrl || null,
      thumbnailPath: downloadedThumb ?? playlistMeta?.thumbnailPath ?? null,
      itemCount:
        (Array.isArray(data?.entries) ? data.entries.length : playlistMeta?.itemCount) ?? null,
      url,
      raw: JSON.stringify(data),
      updatedAt: now,
      lastFetchedAt: now,
    };

    if (existing.length === 0) {
      await db.insert(channelPlaylists).values({
        id: crypto.randomUUID(),
        playlistId: input.playlistId,
        channelId: playlistMeta?.channelId ?? null,
        createdAt: now,
        ...metaUpdate,
      });
    } else {
      await db
        .update(channelPlaylists)
        .set(metaUpdate)
        .where(eq(channelPlaylists.playlistId, input.playlistId));
    }
  } catch {
    logger.warn("[playlists] failed to upsert meta", { playlistId: input.playlistId });
  }

  // Upsert videos and playlist items
  const videoIds: string[] = [];
  for (let idx = 0; idx < entries.length; idx++) {
    const e = entries[idx];
    const vid = e?.id;
    if (!vid) continue;
    videoIds.push(vid);

    try {
      const existing = await db
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.videoId, vid))
        .limit(1);
      const thumb = e?.thumbnails?.[0]?.url || e?.thumbnail || null;
      const thumbPath = thumb ? await downloadImageToCache(thumb, `video_${vid}`) : null;

      // Get channel title from metadata or look up from channels table
      let channelTitle = e.channel ?? e.uploader ?? null;
      if (!channelTitle && playlistMeta?.channelId) {
        const channelRow = await db
          .select({ channelTitle: channels.channelTitle })
          .from(channels)
          .where(eq(channels.channelId, playlistMeta.channelId))
          .limit(1);
        channelTitle = channelRow[0]?.channelTitle ?? null;
      }

      const videoData: Omit<NewYoutubeVideo, "id" | "createdAt"> = {
        videoId: vid,
        title: e.title ?? "Untitled",
        description: null,
        channelId: playlistMeta?.channelId ?? null,
        channelTitle: channelTitle ?? "Unknown Channel",
        durationSeconds: e.duration ?? null,
        viewCount: e.view_count ?? null,
        likeCount: null,
        thumbnailUrl: thumb,
        thumbnailPath: thumbPath,
        publishedAt: null,
        tags: null,
        raw: JSON.stringify(e),
        updatedAt: now,
      };

      if (existing.length === 0) {
        await db.insert(youtubeVideos).values({
          id: crypto.randomUUID(),
          createdAt: now,
          ...videoData,
        });
      } else {
        await db
          .update(youtubeVideos)
          .set({ ...videoData, thumbnailPath: thumbPath ?? existing[0]?.thumbnailPath ?? null })
          .where(eq(youtubeVideos.videoId, vid));
      }

      // Upsert playlist item
      try {
        const existingItem = await db
          .select()
          .from(playlistItems)
          .where(
            and(eq(playlistItems.playlistId, input.playlistId), eq(playlistItems.videoId, vid))
          )
          .limit(1);

        if (existingItem.length === 0) {
          await db.insert(playlistItems).values({
            id: crypto.randomUUID(),
            playlistId: input.playlistId,
            videoId: vid,
            position: idx,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          await db
            .update(playlistItems)
            .set({ position: idx, updatedAt: now })
            .where(eq(playlistItems.id, existingItem[0].id));
        }
      } catch {
        logger.error("[playlists] Failed to upsert item", {
          playlistId: input.playlistId,
          videoId: vid,
        });
      }
    } catch {
      logger.error("[playlists] Failed to upsert video", { videoId: vid });
    }
  }

  // Fetch full videos with download status
  const videos = videoIds.length
    ? await db.select().from(youtubeVideos).where(inArray(youtubeVideos.videoId, videoIds))
    : [];

  const orderMap = new Map<string, number>();
  videoIds.forEach((id, idx) => orderMap.set(id, idx));
  videos.sort((a: YoutubeVideo, b: YoutubeVideo) => {
    const aIndex = orderMap.get(a.videoId) ?? 0;
    const bIndex = orderMap.get(b.videoId) ?? 0;
    return aIndex - bIndex;
  });

  // Mark job as completed
  jobManager.completeJob(job.id);

  return {
    playlistId: input.playlistId,
    title: data?.title || playlistMeta?.title || "Untitled",
    description: data?.description || playlistMeta?.description || null,
    thumbnailUrl:
      (Array.isArray(data?.thumbnails) && data.thumbnails.length > 0
        ? data.thumbnails[data.thumbnails.length - 1]?.url || data.thumbnails[0]?.url
        : null) ||
      playlistMeta?.thumbnailUrl ||
      null,
    thumbnailPath: playlistMeta?.thumbnailPath || null,
    itemCount: Array.isArray(data?.entries)
      ? data.entries.length
      : (playlistMeta?.itemCount ?? null),
    url,
    lastFetchedAt: Date.now(),
    videos: videos.map((v: YoutubeVideo) => ({
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
    })),
  };
}

export const playlistsRouter = t.router({
  // Get detailed playlist information with videos
  getDetails: publicProcedure
    .input(
      z.object({
        playlistId: z.string(),
        playlistUrl: z.string().url().optional(),
        forceRefresh: z.boolean().optional(),
        limit: z.number().min(1).max(500).optional(),
      })
    )
    .query(async ({ input, ctx }) => getPlaylistDetailsForServer(input, ctx.db ?? defaultDb)),

  // List all playlists
  listAll: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(500).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input?.limit ?? 100;

      try {
        const playlists = await db
          .select({
            id: channelPlaylists.id,
            playlistId: channelPlaylists.playlistId,
            channelId: channelPlaylists.channelId,
            title: channelPlaylists.title,
            description: channelPlaylists.description,
            thumbnailUrl: channelPlaylists.thumbnailUrl,
            thumbnailPath: channelPlaylists.thumbnailPath,
            itemCount: channelPlaylists.itemCount,
            url: channelPlaylists.url,
            viewCount: channelPlaylists.viewCount,
            lastViewedAt: channelPlaylists.lastViewedAt,
            totalWatchTimeSeconds: channelPlaylists.totalWatchTimeSeconds,
            createdAt: channelPlaylists.createdAt,
            updatedAt: channelPlaylists.updatedAt,
            lastFetchedAt: channelPlaylists.lastFetchedAt,
          })
          .from(channelPlaylists)
          // Most-recently-viewed first (treat never-viewed as oldest), then newest added.
          .orderBy(
            sql`${channelPlaylists.lastViewedAt} IS NULL`,
            desc(channelPlaylists.lastViewedAt),
            desc(channelPlaylists.createdAt)
          )
          .limit(limit);

        // Get channel info for each playlist
        const channelIds = [
          ...new Set(playlists.map((p) => p.channelId).filter((id): id is string => id !== null)),
        ];
        const channelsData =
          channelIds.length > 0
            ? await db.select().from(channels).where(inArray(channels.channelId, channelIds))
            : [];

        const channelMap = new Map(channelsData.map((c) => [c.channelId, c]));
        const currentVideoIndexes = await loadCurrentVideoIndexes(db, "youtube_playlist");

        return playlists.map((p) => {
          const channel = p.channelId ? channelMap.get(p.channelId) : null;
          return {
            ...p,
            // The Current Video's place in the playlist, for card progress; null when none.
            currentVideoIndex: currentVideoIndexes.get(p.playlistId) ?? null,
            channelTitle: channel?.channelTitle || null,
          };
        });
      } catch (e) {
        logger.error("[playlists] listAll failed", e);
        return [];
      }
    }),

  remove: publicProcedure
    .input(z.object({ playlistId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;

      try {
        const existing = await db
          .select({
            playlistId: channelPlaylists.playlistId,
            title: channelPlaylists.title,
            channelId: channelPlaylists.channelId,
          })
          .from(channelPlaylists)
          .where(eq(channelPlaylists.playlistId, input.playlistId))
          .limit(1);

        const playlist = existing[0];
        if (!playlist) {
          return { success: false as const, message: "Playlist not found" };
        }

        await db
          .delete(favorites)
          .where(
            and(
              eq(favorites.entityType, "channel_playlist"),
              eq(favorites.entityId, input.playlistId)
            )
          );

        await db.delete(channelPlaylists).where(eq(channelPlaylists.playlistId, input.playlistId));

        logger.info("[playlists] Removed playlist from library", {
          playlistId: input.playlistId,
          title: playlist.title,
          channelId: playlist.channelId,
        });

        return {
          success: true as const,
          playlistId: input.playlistId,
          title: playlist.title,
          channelId: playlist.channelId,
        };
      } catch (error) {
        logger.error("[playlists] remove failed", {
          playlistId: input.playlistId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, message: "Failed to remove playlist" };
      }
    }),

  // Update playlist view stats
  updateView: publicProcedure
    .input(z.object({ playlistId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const now = Date.now();

      try {
        const existing = await db
          .select()
          .from(channelPlaylists)
          .where(eq(channelPlaylists.playlistId, input.playlistId))
          .limit(1);

        if (existing.length === 0) {
          return { success: false, message: "Playlist not found" };
        }

        const current = existing[0];
        const newViewCount = (current.viewCount || 0) + 1;

        await db
          .update(channelPlaylists)
          .set({
            viewCount: newViewCount,
            lastViewedAt: now,
            updatedAt: now,
          })
          .where(eq(channelPlaylists.playlistId, input.playlistId));

        return {
          success: true,
          viewCount: newViewCount,
          lastViewedAt: now,
        };
      } catch (e) {
        logger.error("[playlists] updateView failed", e);
        return { success: false, message: "Failed to update view stats" };
      }
    }),

  // Get all video-playlist mappings directly from database (no API calls)
  // This is an efficient alternative to calling getDetails for each playlist
  getAllVideoPlaylistMappings: publicProcedure.query(async ({ ctx }) => {
    const db = ctx.db ?? defaultDb;

    try {
      // Get YouTube playlist items with playlist titles
      const youtubeItems = await db
        .select({
          videoId: playlistItems.videoId,
          playlistTitle: channelPlaylists.title,
        })
        .from(playlistItems)
        .innerJoin(channelPlaylists, eq(playlistItems.playlistId, channelPlaylists.playlistId));

      // Import custom playlist tables dynamically to avoid circular deps
      const { customPlaylists, customPlaylistItems } = await import("@/api/db/schema");

      // Get custom playlist items with playlist names
      const customItems = await db
        .select({
          videoId: customPlaylistItems.videoId,
          playlistTitle: customPlaylists.name,
        })
        .from(customPlaylistItems)
        .innerJoin(customPlaylists, eq(customPlaylistItems.playlistId, customPlaylists.id));

      // Combine both sources
      return [...youtubeItems, ...customItems];
    } catch (e) {
      logger.error("[playlists] getAllVideoPlaylistMappings failed", e);
      return [];
    }
  }),
});

// Router type not exported (unused)
