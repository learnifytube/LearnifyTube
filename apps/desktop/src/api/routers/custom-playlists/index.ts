import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import { logger } from "@/helpers/logger";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  customPlaylists,
  customPlaylistItems,
  favorites,
  youtubeVideos,
  type CustomPlaylist,
  type YoutubeVideo,
} from "@/api/db/schema";
import defaultDb from "@/api/db";
import { setListOnDevices } from "@/api/on-device/store";
import {
  deleteVideoLibraryData,
  findReferencedVideoIds,
} from "@/api/utils/video-library-cleanup";
import { getQueueManager } from "@/services/download-queue/queue-manager";
import { getOptimizationQueueManager } from "@/services/optimization-queue/queue-manager";

export const customPlaylistsRouter = t.router({
  // Create a new custom playlist
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const now = Date.now();
      const id = crypto.randomUUID();

      try {
        await db.insert(customPlaylists).values({
          id,
          name: input.name,
          description: input.description ?? null,
          itemCount: 0,
          viewCount: 0,
          currentVideoIndex: 0,
          totalWatchTimeSeconds: 0,
          createdAt: now,
          updatedAt: now,
        });

        logger.info("[customPlaylists] Created playlist", { id, name: input.name });

        return { success: true, id, name: input.name };
      } catch (e) {
        logger.error("[customPlaylists] Failed to create playlist", { error: String(e) });
        return { success: false, message: "Failed to create playlist" };
      }
    }),

  // List all custom playlists
  listAll: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(500).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input?.limit ?? 100;

      try {
        const playlists = await db
          .select()
          .from(customPlaylists)
          .orderBy(desc(customPlaylists.lastViewedAt), desc(customPlaylists.updatedAt))
          .limit(limit);

        // For each playlist, get the first 3 videos' thumbnails for preview
        const playlistsWithThumbnails = await Promise.all(
          playlists.map(async (playlist) => {
            const previewItems = await db
              .select({
                videoId: customPlaylistItems.videoId,
                video: youtubeVideos,
              })
              .from(customPlaylistItems)
              .leftJoin(youtubeVideos, eq(customPlaylistItems.videoId, youtubeVideos.videoId))
              .where(eq(customPlaylistItems.playlistId, playlist.id))
              .orderBy(customPlaylistItems.position)
              .limit(3);

            const previewThumbnails = previewItems
              .filter((item) => item.video !== null)
              .map((item) => ({
                videoId: item.video!.videoId,
                thumbnailUrl: item.video!.thumbnailUrl,
                thumbnailPath: item.video!.thumbnailPath,
                title: item.video!.title,
              }));

            const firstVideo = previewItems[0]?.video;

            return {
              ...playlist,
              thumbnailUrl: firstVideo?.thumbnailUrl ?? null,
              thumbnailPath: firstVideo?.thumbnailPath ?? null,
              previewThumbnails,
            };
          })
        );

        return playlistsWithThumbnails;
      } catch (e) {
        logger.error("[customPlaylists] listAll failed", { error: String(e) });
        return [];
      }
    }),

  // Get playlist details with all videos
  getDetails: publicProcedure
    .input(
      z.object({
        playlistId: z.string(),
        limit: z.number().min(1).max(500).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const limit = input.limit ?? 200;

      try {
        // Get playlist metadata
        const [playlist] = await db
          .select()
          .from(customPlaylists)
          .where(eq(customPlaylists.id, input.playlistId))
          .limit(1);

        if (!playlist) {
          return null;
        }

        // Get playlist items with video details
        const items = await db
          .select({
            position: customPlaylistItems.position,
            addedAt: customPlaylistItems.addedAt,
            videoId: customPlaylistItems.videoId,
            video: youtubeVideos,
          })
          .from(customPlaylistItems)
          .leftJoin(youtubeVideos, eq(customPlaylistItems.videoId, youtubeVideos.videoId))
          .where(eq(customPlaylistItems.playlistId, input.playlistId))
          .orderBy(customPlaylistItems.position)
          .limit(limit);

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
            channelTitle: item.video.channelTitle,
            url: `https://www.youtube.com/watch?v=${item.video.videoId}`,
            downloadStatus: item.video.downloadStatus,
            downloadProgress: item.video.downloadProgress,
            downloadFilePath: item.video.downloadFilePath,
            addedAt: item.addedAt,
            position: item.position,
          }));

        const firstVideo = videos[0];

        return {
          id: playlist.id,
          name: playlist.name,
          description: playlist.description,
          itemCount: playlist.itemCount,
          viewCount: playlist.viewCount,
          lastViewedAt: playlist.lastViewedAt,
          currentVideoIndex: playlist.currentVideoIndex ?? 0,
          totalWatchTimeSeconds: playlist.totalWatchTimeSeconds,
          createdAt: playlist.createdAt,
          updatedAt: playlist.updatedAt,
          thumbnailUrl: firstVideo?.thumbnailUrl ?? null,
          thumbnailPath: firstVideo?.thumbnailPath ?? null,
          videos,
        };
      } catch (e) {
        logger.error("[customPlaylists] getDetails failed", {
          playlistId: input.playlistId,
          error: String(e),
        });
        return null;
      }
    }),

  // Update playlist name/description
  update: publicProcedure
    .input(
      z.object({
        playlistId: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const now = Date.now();

      try {
        const updateData: Partial<CustomPlaylist> = { updatedAt: now };
        if (input.name !== undefined) updateData.name = input.name;
        if (input.description !== undefined) updateData.description = input.description;

        await db
          .update(customPlaylists)
          .set(updateData)
          .where(eq(customPlaylists.id, input.playlistId));

        logger.info("[customPlaylists] Updated playlist", { playlistId: input.playlistId });

        return { success: true };
      } catch (e) {
        logger.error("[customPlaylists] update failed", {
          playlistId: input.playlistId,
          error: String(e),
        });
        return { success: false, message: "Failed to update playlist" };
      }
    }),

  // Delete a playlist
  delete: publicProcedure
    .input(
      z.object({
        playlistId: z.string(),
        deleteVideosData: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;

      try {
        const [playlist] = await db
          .select({
            id: customPlaylists.id,
            name: customPlaylists.name,
          })
          .from(customPlaylists)
          .where(eq(customPlaylists.id, input.playlistId))
          .limit(1);

        if (!playlist) {
          return { success: false as const, message: "Playlist not found" };
        }

        await setListOnDevices(db, input.playlistId, false);

        const playlistItemsToDelete = await db
          .select({ videoId: customPlaylistItems.videoId })
          .from(customPlaylistItems)
          .where(eq(customPlaylistItems.playlistId, input.playlistId));

        const playlistVideoIds = [...new Set(playlistItemsToDelete.map((item) => item.videoId))];
        let removableVideoIds: string[] = [];
        let deletedVideosCount = 0;
        let retainedVideosCount = 0;

        if (input.deleteVideosData && playlistVideoIds.length > 0) {
          const referencedVideoIds = await findReferencedVideoIds(db, playlistVideoIds, {
            excludeCustomPlaylistId: input.playlistId,
          });
          removableVideoIds = playlistVideoIds.filter((videoId) => !referencedVideoIds.has(videoId));

          retainedVideosCount = playlistVideoIds.length - removableVideoIds.length;

          if (removableVideoIds.length > 0) {
            const queueManager = getQueueManager(defaultDb);
            const queueStatus = await queueManager.getQueueStatus();
            const activeQueueItems = [
              ...queueStatus.queued,
              ...queueStatus.downloading,
              ...queueStatus.paused,
            ].filter(
              (item): item is typeof item & { videoId: string } =>
                typeof item.videoId === "string" && removableVideoIds.includes(item.videoId)
            );

            if (activeQueueItems.length > 0) {
              const queueResults = await Promise.allSettled(
                activeQueueItems.map((item) => queueManager.cancelDownload(item.id))
              );

              queueResults.forEach((result, index) => {
                if (result.status === "rejected") {
                  logger.warn("[customPlaylists] Failed to cancel queued download before delete", {
                    playlistId: input.playlistId,
                    videoId: activeQueueItems[index]?.videoId,
                    error: String(result.reason),
                  });
                }
              });
            }

            const optimizationQueueManager = getOptimizationQueueManager();
            const optimizationStatus = optimizationQueueManager.getQueueStatus();
            const activeOptimizations = [
              ...optimizationStatus.queued,
              ...optimizationStatus.optimizing,
            ].filter((job) => removableVideoIds.includes(job.videoId));

            if (activeOptimizations.length > 0) {
              const optimizationResults = await Promise.allSettled(
                activeOptimizations.map((job) => optimizationQueueManager.cancelOptimization(job.id))
              );

              optimizationResults.forEach((result, index) => {
                if (result.status === "rejected") {
                  logger.warn("[customPlaylists] Failed to cancel optimization before delete", {
                    playlistId: input.playlistId,
                    videoId: activeOptimizations[index]?.videoId,
                    error: String(result.reason),
                  });
                }
              });
            }
          }
        }

        await db
          .delete(favorites)
          .where(
            and(eq(favorites.entityType, "custom_playlist"), eq(favorites.entityId, input.playlistId))
          );

        await db.delete(customPlaylists).where(eq(customPlaylists.id, input.playlistId));

        if (input.deleteVideosData && removableVideoIds.length > 0) {
          const cleanupResult = await deleteVideoLibraryData(db, removableVideoIds);
          deletedVideosCount = cleanupResult.deletedVideoIds.length;

          retainedVideosCount = playlistVideoIds.length - deletedVideosCount;
        }

        logger.info("[customPlaylists] Deleted playlist", {
          playlistId: input.playlistId,
          deleteVideosData: input.deleteVideosData,
          deletedVideosCount,
          retainedVideosCount,
          playlistName: playlist.name,
        });

        return {
          success: true as const,
          deletedVideosCount,
          retainedVideosCount,
        };
      } catch (e) {
        logger.error("[customPlaylists] delete failed", {
          playlistId: input.playlistId,
          error: String(e),
        });
        return { success: false as const, message: "Failed to delete playlist" };
      }
    }),

  // Add a video to a playlist
  addVideo: publicProcedure
    .input(
      z.object({
        playlistId: z.string(),
        videoId: z.string(),
        // Optional video metadata for creating entry if it doesn't exist
        title: z.string().optional(),
        channelTitle: z.string().optional(),
        thumbnailUrl: z.string().optional(),
        durationSeconds: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const now = Date.now();

      try {
        // Check if video already exists in playlist
        const existing = await db
          .select()
          .from(customPlaylistItems)
          .where(
            and(
              eq(customPlaylistItems.playlistId, input.playlistId),
              eq(customPlaylistItems.videoId, input.videoId)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          return { success: false, message: "Video already in playlist" };
        }

        // Ensure video exists in youtubeVideos table (required for foreign key)
        const existingVideo = await db
          .select()
          .from(youtubeVideos)
          .where(eq(youtubeVideos.videoId, input.videoId))
          .limit(1);

        if (existingVideo.length === 0) {
          // Create a basic entry for the video
          await db.insert(youtubeVideos).values({
            id: crypto.randomUUID(),
            videoId: input.videoId,
            title: input.title ?? "Unknown Video",
            channelTitle: input.channelTitle ?? "Unknown Channel",
            thumbnailUrl: input.thumbnailUrl,
            durationSeconds: input.durationSeconds,
            createdAt: now,
            updatedAt: now,
          });
          logger.info("[customPlaylists] Created video entry for playlist item", {
            videoId: input.videoId,
            title: input.title,
          });
        }

        // Get current max position
        const maxPositionResult = await db
          .select({ maxPos: sql<number>`MAX(${customPlaylistItems.position})` })
          .from(customPlaylistItems)
          .where(eq(customPlaylistItems.playlistId, input.playlistId));

        const nextPosition = (maxPositionResult[0]?.maxPos ?? -1) + 1;

        // Insert the new item
        await db.insert(customPlaylistItems).values({
          id: crypto.randomUUID(),
          playlistId: input.playlistId,
          videoId: input.videoId,
          position: nextPosition,
          addedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        // Update item count
        await db
          .update(customPlaylists)
          .set({
            itemCount: sql`${customPlaylists.itemCount} + 1`,
            updatedAt: now,
          })
          .where(eq(customPlaylists.id, input.playlistId));

        logger.info("[customPlaylists] Added video to playlist", {
          playlistId: input.playlistId,
          videoId: input.videoId,
        });

        return { success: true, position: nextPosition };
      } catch (e) {
        logger.error("[customPlaylists] addVideo failed", {
          playlistId: input.playlistId,
          videoId: input.videoId,
          error: String(e),
        });
        return { success: false, message: "Failed to add video to playlist" };
      }
    }),

  // Remove a video from a playlist
  removeVideo: publicProcedure
    .input(
      z.object({
        playlistId: z.string(),
        videoId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const now = Date.now();

      try {
        // Get the item to find its position
        const [item] = await db
          .select()
          .from(customPlaylistItems)
          .where(
            and(
              eq(customPlaylistItems.playlistId, input.playlistId),
              eq(customPlaylistItems.videoId, input.videoId)
            )
          )
          .limit(1);

        if (!item) {
          return { success: false, message: "Video not in playlist" };
        }

        // Delete the item
        await db
          .delete(customPlaylistItems)
          .where(
            and(
              eq(customPlaylistItems.playlistId, input.playlistId),
              eq(customPlaylistItems.videoId, input.videoId)
            )
          );

        // Update positions of remaining items
        await db
          .update(customPlaylistItems)
          .set({
            position: sql`${customPlaylistItems.position} - 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(customPlaylistItems.playlistId, input.playlistId),
              sql`${customPlaylistItems.position} > ${item.position}`
            )
          );

        // Update item count
        await db
          .update(customPlaylists)
          .set({
            itemCount: sql`MAX(${customPlaylists.itemCount} - 1, 0)`,
            updatedAt: now,
          })
          .where(eq(customPlaylists.id, input.playlistId));

        logger.info("[customPlaylists] Removed video from playlist", {
          playlistId: input.playlistId,
          videoId: input.videoId,
        });

        return { success: true };
      } catch (e) {
        logger.error("[customPlaylists] removeVideo failed", {
          playlistId: input.playlistId,
          videoId: input.videoId,
          error: String(e),
        });
        return { success: false, message: "Failed to remove video from playlist" };
      }
    }),

  // Reorder videos in a playlist (move up/down)
  reorderVideos: publicProcedure
    .input(
      z.object({
        playlistId: z.string(),
        videoId: z.string(),
        direction: z.enum(["up", "down"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const now = Date.now();

      try {
        // Get the current item
        const [currentItem] = await db
          .select()
          .from(customPlaylistItems)
          .where(
            and(
              eq(customPlaylistItems.playlistId, input.playlistId),
              eq(customPlaylistItems.videoId, input.videoId)
            )
          )
          .limit(1);

        if (!currentItem) {
          return { success: false, message: "Video not in playlist" };
        }

        const currentPosition = currentItem.position;
        const targetPosition = input.direction === "up" ? currentPosition - 1 : currentPosition + 1;

        if (targetPosition < 0) {
          return { success: false, message: "Already at the top" };
        }

        // Get the item at the target position
        const [targetItem] = await db
          .select()
          .from(customPlaylistItems)
          .where(
            and(
              eq(customPlaylistItems.playlistId, input.playlistId),
              eq(customPlaylistItems.position, targetPosition)
            )
          )
          .limit(1);

        if (!targetItem) {
          return { success: false, message: "Already at the end" };
        }

        // Swap positions
        await db
          .update(customPlaylistItems)
          .set({ position: targetPosition, updatedAt: now })
          .where(eq(customPlaylistItems.id, currentItem.id));

        await db
          .update(customPlaylistItems)
          .set({ position: currentPosition, updatedAt: now })
          .where(eq(customPlaylistItems.id, targetItem.id));

        // Update playlist timestamp
        await db
          .update(customPlaylists)
          .set({ updatedAt: now })
          .where(eq(customPlaylists.id, input.playlistId));

        logger.info("[customPlaylists] Reordered video", {
          playlistId: input.playlistId,
          videoId: input.videoId,
          from: currentPosition,
          to: targetPosition,
        });

        return { success: true, newPosition: targetPosition };
      } catch (e) {
        logger.error("[customPlaylists] reorderVideos failed", {
          playlistId: input.playlistId,
          videoId: input.videoId,
          error: String(e),
        });
        return { success: false, message: "Failed to reorder videos" };
      }
    }),

  // Get which playlists contain a specific video
  getPlaylistsForVideo: publicProcedure
    .input(z.object({ videoId: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;

      try {
        const items = await db
          .select({
            playlistId: customPlaylistItems.playlistId,
            playlist: customPlaylists,
          })
          .from(customPlaylistItems)
          .innerJoin(customPlaylists, eq(customPlaylistItems.playlistId, customPlaylists.id))
          .where(eq(customPlaylistItems.videoId, input.videoId));

        return items.map((item) => ({
          id: item.playlist.id,
          name: item.playlist.name,
        }));
      } catch (e) {
        logger.error("[customPlaylists] getPlaylistsForVideo failed", {
          videoId: input.videoId,
          error: String(e),
        });
        return [];
      }
    }),

  // Update playlist playback position
  updatePlayback: publicProcedure
    .input(
      z.object({
        playlistId: z.string(),
        currentVideoIndex: z.number().min(0),
        watchTimeSeconds: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const now = Date.now();

      try {
        const [existing] = await db
          .select()
          .from(customPlaylists)
          .where(eq(customPlaylists.id, input.playlistId))
          .limit(1);

        if (!existing) {
          return { success: false, message: "Playlist not found" };
        }

        const newTotalWatchTime =
          (existing.totalWatchTimeSeconds || 0) + (input.watchTimeSeconds || 0);

        await db
          .update(customPlaylists)
          .set({
            currentVideoIndex: input.currentVideoIndex,
            totalWatchTimeSeconds: newTotalWatchTime,
            updatedAt: now,
          })
          .where(eq(customPlaylists.id, input.playlistId));

        return {
          success: true,
          currentVideoIndex: input.currentVideoIndex,
          totalWatchTimeSeconds: newTotalWatchTime,
        };
      } catch (e) {
        logger.error("[customPlaylists] updatePlayback failed", {
          playlistId: input.playlistId,
          error: String(e),
        });
        return { success: false, message: "Failed to update playback position" };
      }
    }),

  // Update playlist view stats
  updateView: publicProcedure
    .input(z.object({ playlistId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const now = Date.now();

      try {
        const [existing] = await db
          .select()
          .from(customPlaylists)
          .where(eq(customPlaylists.id, input.playlistId))
          .limit(1);

        if (!existing) {
          return { success: false, message: "Playlist not found" };
        }

        const newViewCount = (existing.viewCount || 0) + 1;

        await db
          .update(customPlaylists)
          .set({
            viewCount: newViewCount,
            lastViewedAt: now,
            updatedAt: now,
          })
          .where(eq(customPlaylists.id, input.playlistId));

        return {
          success: true,
          viewCount: newViewCount,
          lastViewedAt: now,
        };
      } catch (e) {
        logger.error("[customPlaylists] updateView failed", {
          playlistId: input.playlistId,
          error: String(e),
        });
        return { success: false, message: "Failed to update view stats" };
      }
    }),
});
