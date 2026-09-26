import { z } from "zod";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import type { Database } from "@/api/db";
import { channels, youtubeVideos } from "@/api/db/schema";
import { logger } from "@/helpers/logger";
import type { LatestVideo } from "@/lib/auto-keep";
import { extractChannelData } from "./metadata";
import { upsertChannelData } from "./database";
import { spawnYtDlpWithLogging } from "./ytdlp";
import { downloadImageToCache } from "./cache";

// Zod schema for yt-dlp flat-playlist response (fault-tolerant)
export const playlistResponseSchema = z
  .object({
    channel_id: z.string().nullish().catch(null),
    channel: z.string().nullish().catch(null),
    uploader: z.string().nullish().catch(null),
    channel_url: z.string().nullish().catch(null),
    entries: z
      .array(
        z.object({
          id: z.string().optional().catch(undefined),
          url: z.string().nullish().catch(null),
          title: z.string().nullish().catch(null),
          duration: z.number().nullish().catch(null),
          view_count: z.number().nullish().catch(null),
          channel: z.string().nullish().catch(null),
          uploader: z.string().nullish().catch(null),
          // Approximate ("3 hours ago"), only with the youtubetab:approximate_date extractor arg
          timestamp: z.number().nullish().catch(null),
          live_status: z.string().nullish().catch(null),
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

type Entry = NonNullable<z.infer<typeof playlistResponseSchema>["entries"]>[number];

// What Auto-keep needs from a flat-playlist entry. yt-dlp links Shorts as /shorts/<id>, and
// gives only an approximate publish time: to the hour for Videos under a day old.
const toLatestVideo = (entry: Entry & { id: string }): LatestVideo => ({
  videoId: entry.id,
  publishedAt: entry.timestamp ? entry.timestamp * 1000 : null,
  isShort: entry.url?.includes("/shorts/") ?? false,
  liveStatus: entry.live_status ?? null,
});

const runFlatListing = (binPath: string, url: string, channelId: string): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const proc = spawnYtDlpWithLogging(
      binPath,
      ["-J", "--flat-playlist", "--extractor-args", "youtubetab:approximate_date", url],
      { stdio: ["ignore", "pipe", "pipe"] },
      {
        operation: "list_playlist_videos",
        url,
        channelId,
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

// Fetch a Channel's latest Videos from YouTube (metadata only) and store them, newest first.
// Throws when yt-dlp fails.
export const fetchChannelLatest = async (
  db: Database,
  binPath: string,
  channelId: string,
  limit: number
): Promise<LatestVideo[]> => {
  const url = `https://www.youtube.com/channel/${channelId}/videos?view=0&sort=dd&flow=grid`;
  const listData = playlistResponseSchema.parse(
    JSON.parse(await runFlatListing(binPath, url, channelId))
  );

  // Log available fields from the first entry to understand the data structure
  if (listData.entries?.[0]) {
    logger.info("[ytdlp] Channel latest flat-playlist entry fields", {
      sampleEntry: listData.entries[0],
      availableFields: Object.keys(listData.entries[0]),
    });
  }

  const entries = (listData.entries ?? []).filter((e): e is Entry & { id: string } => !!e.id);
  const now = Date.now();

  // Ensure channel exists in DB before linking videos to it
  try {
    const channelData = extractChannelData({
      ...listData,
      channel_id: listData?.channel_id || channelId,
      channel: listData?.channel || listData?.uploader,
      channel_url: listData?.channel_url || `https://www.youtube.com/channel/${channelId}`,
    });

    if (channelData) {
      await upsertChannelData(db, channelData);
      logger.info("[ytdlp] Upserted channel before linking videos", {
        channelId: channelData.channelId,
        channelTitle: channelData.channelTitle,
      });
    }
  } catch (e) {
    logger.error("[ytdlp] Failed to upsert channel data", { channelId, error: String(e) });
  }

  // Upsert lightweight metadata to DB for caching (avoid expensive individual fetches)
  const latest = entries.slice(0, limit);
  for (const entry of latest) {
    try {
      // Check if video exists in DB
      const existing = await db
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.videoId, entry.id))
        .limit(1);

      const thumbUrl = entry.thumbnails?.[0]?.url ?? entry.thumbnail;
      const thumbPath = thumbUrl ? await downloadImageToCache(thumbUrl, `video_${entry.id}`) : null;

      // Get channel title from metadata or look up from channels table
      let channelTitle = entry.channel ?? entry.uploader ?? null;
      if (!channelTitle) {
        const channelRow = await db
          .select({ channelTitle: channels.channelTitle })
          .from(channels)
          .where(eq(channels.channelId, channelId))
          .limit(1);
        channelTitle = channelRow[0]?.channelTitle ?? null;
      }

      const videoData = {
        videoId: entry.id,
        title: entry.title ?? "Untitled",
        description: null,
        channelId,
        channelTitle: channelTitle ?? "Unknown Channel",
        durationSeconds: entry.duration ?? null,
        viewCount: entry.view_count ?? null,
        likeCount: null,
        thumbnailUrl: entry.thumbnails?.[0]?.url ?? entry.thumbnail ?? null,
        thumbnailPath: thumbPath,
        // A precise date from the full metadata beats the listing's approximate one
        publishedAt: existing[0]?.publishedAt ?? toLatestVideo(entry).publishedAt,
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

  // Update channel's lastLatestFetchedAt timestamp
  try {
    await db
      .update(channels)
      .set({ lastLatestFetchedAt: now, updatedAt: now })
      .where(eq(channels.channelId, channelId));
  } catch (e) {
    logger.error("[ytdlp] Failed to update lastLatestFetchedAt", { channelId, error: String(e) });
  }

  return latest.map(toLatestVideo);
};
