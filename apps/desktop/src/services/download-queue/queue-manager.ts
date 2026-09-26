import { desc, eq, inArray, sql } from "drizzle-orm";
import { youtubeVideos, userPreferences, playlistItems, channelPlaylists } from "@/api/db/schema";
import type { Database } from "@/api/db";
import { DEFAULT_QUEUE_CONFIG } from "./config";
import type { QueueConfig, QueueStatus, QueueStats, QueuedDownload } from "./types";
import { spawnDownload, killDownload } from "./download-worker";
import { logger } from "@/helpers/logger";
import { app } from "electron";
import path from "path";
import {
  createDefaultFallbackState,
  shouldAutoFallback,
  getNextFallbackState,
  getFallbackRetryDelayMs,
  PLAYER_CLIENTS,
  FORMAT_STRATEGIES,
} from "./fallback-strategy";

/**
 * In-memory queue item
 */
interface QueueItem {
  id: string;
  url: string;
  videoId: string | null;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  status: "queued" | "downloading" | "paused";
  progress: number;
  priority: number;
  queuePosition: number;
  format: string | null;
  quality: string | null;
  errorMessage: string | null;
  errorType: string | null;
  errorDetails: string[] | null;
  isRetryable: boolean;
  retryCount: number;
  maxRetries: number;
  addedAt: number;
  startedAt: number | null;
  pausedAt: number | null;
  // Download progress details
  downloadSpeed: string | null;
  downloadedSize: string | null;
  totalSize: string | null;
  eta: string | null;
  nextRetryAt: number | null;
  // Fallback strategy state
  playerClientIndex: number;
  formatStrategyIndex: number;
  fallbackAttempts: number;
  maxFallbackAttempts: number;
}

/**
 * Sanitize a string so it is safe to use as a folder name on macOS / Windows / Linux.
 * Strips reserved chars, collapses whitespace, trims trailing dots/spaces, and caps length.
 */
const sanitizeFolderName = (name: string): string => {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  // Cap at 100 chars to stay well under filesystem limits when nested
  return cleaned.slice(0, 100);
};

/**
 * Look up the first YouTube playlist a video belongs to, if any.
 * Returns the playlist title to use as a folder name, or null when the video
 * is not associated with any channel playlist.
 */
const getPrimaryPlaylistTitle = async (db: Database, videoId: string): Promise<string | null> => {
  try {
    const rows = await db
      .select({ title: channelPlaylists.title })
      .from(playlistItems)
      .innerJoin(channelPlaylists, eq(channelPlaylists.playlistId, playlistItems.playlistId))
      .where(eq(playlistItems.videoId, videoId))
      .orderBy(playlistItems.position)
      .limit(1);
    return rows[0]?.title ?? null;
  } catch (error) {
    logger.warn("[queue-manager] Failed to look up playlist for video", {
      videoId,
      error,
    });
    return null;
  }
};

/**
 * Get the download path from user preferences or use default
 */
const getDownloadPath = async (db: Database): Promise<string> => {
  try {
    const prefs = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.id, "default"))
      .limit(1);

    if (prefs.length > 0 && prefs[0].downloadPath) {
      return prefs[0].downloadPath;
    }
  } catch (error) {
    logger.warn("[queue-manager] Failed to get download path from preferences", { error });
  }

  // Default path
  return path.join(app.getPath("downloads"), "LearnifyTube");
};

/**
 * Type-safe helper to convert QueueItem to QueuedDownload
 */
const queueItemToQueuedDownload = (item: QueueItem): QueuedDownload => ({
  id: item.id,
  url: item.url,
  videoId: item.videoId,
  title: item.title,
  channelTitle: item.channelTitle,
  thumbnailUrl: item.thumbnailUrl,
  status: item.status,
  progress: item.progress,
  priority: item.priority,
  queuePosition: item.queuePosition,
  format: item.format,
  quality: item.quality,
  filePath: null, // Not available for in-progress items
  fileSize: null, // Not available for in-progress items
  errorMessage: item.errorMessage,
  errorType: item.errorType,
  errorDetails: item.errorDetails,
  isRetryable: item.isRetryable,
  retryCount: item.retryCount,
  maxRetries: item.maxRetries,
  addedAt: item.addedAt,
  startedAt: item.startedAt,
  pausedAt: item.pausedAt,
  completedAt: null, // Not completed yet
  cancelledAt: null, // Not cancelled
  updatedAt: null, // Using real-time queue data
  downloadSpeed: item.downloadSpeed,
  downloadedSize: item.downloadedSize,
  totalSize: item.totalSize,
  eta: item.eta,
  // nextRetryAt is internal queue scheduler metadata, not exposed in API shape
  // Fallback strategy state
  playerClientIndex: item.playerClientIndex,
  formatStrategyIndex: item.formatStrategyIndex,
  fallbackAttempts: item.fallbackAttempts,
  maxFallbackAttempts: item.maxFallbackAttempts,
});

/**
 * Type-safe helper to create QueueItem from interrupted download
 */
const createQueueItemFromVideo = (
  video: {
    videoId: string;
    title: string;
    channelTitle: string | null;
    thumbnailUrl: string | null;
    downloadProgress: number | null;
    updatedAt: number | null;
  },
  downloadId: string,
  queuePosition: number,
  maxRetries: number
): QueueItem => {
  const url = `https://www.youtube.com/watch?v=${video.videoId}`;
  const initialFallback = createDefaultFallbackState();
  return {
    id: downloadId,
    url,
    videoId: video.videoId,
    title: video.title || url,
    channelTitle: video.channelTitle,
    thumbnailUrl: video.thumbnailUrl,
    status: "queued",
    progress: video.downloadProgress || 0,
    priority: 1, // Higher priority for interrupted downloads
    queuePosition,
    format: null,
    quality: null,
    errorMessage: null,
    errorType: null,
    errorDetails: null,
    isRetryable: true,
    retryCount: 0,
    maxRetries,
    addedAt: video.updatedAt || Date.now(),
    startedAt: null,
    pausedAt: null,
    downloadSpeed: null,
    downloadedSize: null,
    totalSize: null,
    eta: null,
    nextRetryAt: null,
    // Initialize fallback state
    playerClientIndex: initialFallback.playerClientIndex,
    formatStrategyIndex: initialFallback.formatStrategyIndex,
    fallbackAttempts: initialFallback.fallbackAttempts,
    maxFallbackAttempts: initialFallback.maxFallbackAttempts,
  };
};

/**
 * Queue manager type (inferred from factory return)
 */
type QueueManagerInstance = {
  updateProgress: (
    downloadId: string,
    progress: number,
    metadata?: {
      title?: string;
      videoId?: string;
      downloadSpeed?: string | null;
      downloadedSize?: string | null;
      totalSize?: string | null;
      eta?: string | null;
    }
  ) => Promise<void>;
  markCompleted: (downloadId: string, filePath: string, fileSize?: number) => Promise<void>;
  markFailed: (
    downloadId: string,
    errorMessage: string,
    errorType?: string,
    errorDetails?: string[]
  ) => Promise<void>;
  restoreInterruptedDownloads: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
  addToQueue: (
    urls: string[],
    options?: {
      priority?: number;
      format?: string;
      quality?: string;
    }
  ) => Promise<string[]>;
  pauseDownload: (downloadId: string) => Promise<void>;
  resumeDownload: (downloadId: string) => Promise<void>;
  cancelDownload: (downloadId: string) => Promise<void>;
  retryDownload: (downloadId: string) => Promise<void>;
  getQueueStatus: () => Promise<QueueStatus>;
  clearCompleted: () => Promise<void>;
};

/**
 * Simple in-memory queue manager that processes downloads with max concurrent limit
 * Download state is synced to youtube_videos table for persistence
 * Implemented as a factory function returning an object (functional pattern)
 */
const createQueueManager = (
  db: Database,
  config: Partial<QueueConfig> = {}
): QueueManagerInstance => {
  // Private state (closure variables)
  const finalConfig: QueueConfig = { ...DEFAULT_QUEUE_CONFIG, ...config };
  let isProcessing = false;
  let processingInterval: NodeJS.Timeout | null = null;
  const queue: Map<string, QueueItem> = new Map();

  /**
   * Update download progress (called by download-worker)
   */
  const updateProgress = async (
    downloadId: string,
    progress: number,
    metadata?: {
      title?: string;
      videoId?: string;
      downloadSpeed?: string | null;
      downloadedSize?: string | null;
      totalSize?: string | null;
      eta?: string | null;
    }
  ): Promise<void> => {
    const item = queue.get(downloadId);
    if (!item) return;

    item.progress = progress;

    // Update metadata if provided
    if (metadata?.title) {
      item.title = metadata.title;
    }
    if (metadata?.videoId) {
      item.videoId = metadata.videoId;
    }

    // Update download progress details
    // Only update with non-null values to prevent flickering when yt-dlp outputs "Unknown"
    if (metadata?.downloadSpeed !== undefined && metadata.downloadSpeed !== null) {
      item.downloadSpeed = metadata.downloadSpeed;
    }
    if (metadata?.downloadedSize !== undefined && metadata.downloadedSize !== null) {
      item.downloadedSize = metadata.downloadedSize;
    }
    if (metadata?.totalSize !== undefined && metadata.totalSize !== null) {
      item.totalSize = metadata.totalSize;
    }
    if (metadata?.eta !== undefined && metadata.eta !== null) {
      item.eta = metadata.eta;
    }

    // Sync progress to youtube_videos using known videoId (from metadata or existing item)
    const vid = metadata?.videoId ?? item.videoId;
    if (vid) {
      await db
        .update(youtubeVideos)
        .set({
          downloadStatus: "downloading",
          downloadProgress: progress,
          keptAt: sql`COALESCE(${youtubeVideos.keptAt}, ${item.addedAt})`,
          updatedAt: Date.now(),
        })
        .where(eq(youtubeVideos.videoId, vid))
        .execute();
    }
  };

  /**
   * Mark download as completed (called by download-worker)
   */
  const markCompleted = async (
    downloadId: string,
    filePath: string,
    fileSize?: number
  ): Promise<void> => {
    const item = queue.get(downloadId);
    if (!item) return;

    // Remove from queue
    queue.delete(downloadId);

    // Sync to youtube_videos
    if (item.videoId) {
      await db
        .update(youtubeVideos)
        .set({
          downloadStatus: "completed",
          downloadProgress: 100,
          downloadFilePath: filePath,
          downloadFileSize: fileSize || null,
          lastDownloadedAt: Date.now(),
          keptAt: sql`COALESCE(${youtubeVideos.keptAt}, ${item.addedAt})`,
          updatedAt: Date.now(),
        })
        .where(eq(youtubeVideos.videoId, item.videoId))
        .execute();
    }

    logger.info("[queue-manager] Download completed", { downloadId, filePath });
  };

  /**
   * Mark download as failed (called by download-worker)
   * Implements auto-fallback: if error is eligible and fallbacks remain, re-queue with next strategy
   */
  const markFailed = async (
    downloadId: string,
    errorMessage: string,
    errorType?: string,
    errorDetails?: string[]
  ): Promise<void> => {
    const item = queue.get(downloadId);
    if (!item) return;

    const resolvedErrorType = errorType || "unknown";
    const lowerErrorMessage = errorMessage.toLowerCase();
    const userFacingErrorMessage =
      resolvedErrorType === "auth_required" ||
      lowerErrorMessage.includes("sign in") ||
      lowerErrorMessage.includes("not a bot") ||
      lowerErrorMessage.includes("cookies-from-browser")
        ? "YouTube requires sign-in verification. In Settings > System > YouTube Authentication, select a browser cookie source, then retry."
        : errorMessage;

    // Check for auto-fallback eligibility
    if (shouldAutoFallback(errorMessage, resolvedErrorType)) {
      const currentState = {
        playerClientIndex: item.playerClientIndex,
        formatStrategyIndex: item.formatStrategyIndex,
        fallbackAttempts: item.fallbackAttempts,
        maxFallbackAttempts: item.maxFallbackAttempts,
      };

      const nextState = getNextFallbackState(currentState, errorMessage, resolvedErrorType);

      if (nextState) {
        const retryDelayMs = getFallbackRetryDelayMs(
          errorMessage,
          resolvedErrorType,
          nextState.fallbackAttempts
        );

        // Advance fallback state and re-queue
        item.playerClientIndex = nextState.playerClientIndex;
        item.formatStrategyIndex = nextState.formatStrategyIndex;
        item.fallbackAttempts = nextState.fallbackAttempts;
        item.status = "queued";
        item.errorMessage = null;
        item.errorType = null;
        item.errorDetails = null;
        item.progress = 0;
        item.nextRetryAt = retryDelayMs > 0 ? Date.now() + retryDelayMs : null;

        logger.info("[queue-manager] Auto-fallback triggered, re-queuing with new strategy", {
          downloadId,
          videoId: item.videoId,
          previousError: errorMessage,
          previousErrorType: resolvedErrorType,
          newPlayerClient: PLAYER_CLIENTS[nextState.playerClientIndex],
          newFormatStrategy: FORMAT_STRATEGIES[nextState.formatStrategyIndex],
          fallbackAttempt: nextState.fallbackAttempts,
          maxFallbackAttempts: nextState.maxFallbackAttempts,
          retryDelayMs,
          scheduledAt: item.nextRetryAt,
        });

        // Update database to reflect re-queued state
        if (item.videoId) {
          await db
            .update(youtubeVideos)
            .set({
              downloadStatus: "queued",
              downloadProgress: 0,
              updatedAt: Date.now(),
            })
            .where(eq(youtubeVideos.videoId, item.videoId))
            .execute();
        }

        return; // Don't mark as failed, will retry with new fallback strategy
      }
    }

    // No more fallbacks available, mark as truly failed
    item.errorMessage = userFacingErrorMessage;
    item.errorType = resolvedErrorType;
    item.errorDetails = errorDetails || null;
    item.status = "paused"; // Paused so user can retry
    item.nextRetryAt = null;

    // Sync to youtube_videos
    if (item.videoId) {
      await db
        .update(youtubeVideos)
        .set({
          downloadStatus: "failed",
          lastErrorMessage: userFacingErrorMessage,
          errorType: resolvedErrorType,
          isRetryable: true,
          updatedAt: Date.now(),
        })
        .where(eq(youtubeVideos.videoId, item.videoId))
        .execute();
    }

    logger.error("[queue-manager] Download failed (all fallbacks exhausted)", {
      downloadId,
      videoId: item.videoId,
      error: userFacingErrorMessage,
      errorType: resolvedErrorType,
      fallbackAttempts: item.fallbackAttempts,
      maxFallbackAttempts: item.maxFallbackAttempts,
    });
  };

  /**
   * Restore interrupted downloads from database
   */
  const restoreInterruptedDownloads = async (): Promise<void> => {
    try {
      logger.info("[queue-manager] Restoring interrupted downloads from database");

      // Find all videos that were downloading or queued
      const interruptedDownloads = await db
        .select({
          videoId: youtubeVideos.videoId,
          title: youtubeVideos.title,
          channelTitle: youtubeVideos.channelTitle,
          thumbnailUrl: youtubeVideos.thumbnailUrl,
          downloadProgress: youtubeVideos.downloadProgress,
          downloadStatus: youtubeVideos.downloadStatus,
          updatedAt: youtubeVideos.updatedAt,
        })
        .from(youtubeVideos)
        .where(inArray(youtubeVideos.downloadStatus, ["downloading", "queued"]))
        .execute();

      logger.info("[queue-manager] Found interrupted downloads", {
        count: interruptedDownloads.length,
      });

      // Get current max queue position
      const positions = Array.from(queue.values()).map((item) => item.queuePosition);
      let position = positions.length > 0 ? Math.max(...positions) + 1 : 1;

      // Add each interrupted download back to the queue
      for (const video of interruptedDownloads) {
        const downloadId = `download-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        // Use type-safe helper
        const queueItem = createQueueItemFromVideo(
          video,
          downloadId,
          position++,
          finalConfig.maxRetries
        );

        queue.set(downloadId, queueItem);

        // Reset status to queued in database
        await db
          .update(youtubeVideos)
          .set({
            downloadStatus: "queued",
            downloadProgress: 0,
            updatedAt: Date.now(),
          })
          .where(eq(youtubeVideos.videoId, video.videoId))
          .execute();

        logger.debug("[queue-manager] Restored interrupted download", {
          downloadId,
          videoId: video.videoId,
          title: video.title,
        });
      }

      logger.info("[queue-manager] Restored downloads to queue", {
        count: interruptedDownloads.length,
      });
    } catch (error) {
      logger.error("[queue-manager] Failed to restore interrupted downloads", error);
    }
  };

  /**
   * Start the queue processor
   */
  const start = async (): Promise<void> => {
    if (isProcessing) {
      logger.warn("[queue-manager] Queue already running");
      return;
    }

    isProcessing = true;
    logger.info("[queue-manager] Starting queue processor", {
      maxConcurrent: finalConfig.maxConcurrent,
    });

    // Restore interrupted downloads first
    await restoreInterruptedDownloads();

    // Process queue every 2 seconds
    processingInterval = setInterval(() => {
      processQueue().catch((error) => {
        logger.error("[queue-manager] Error processing queue", error);
      });
    }, 2000);

    // Process immediately
    processQueue().catch((error) => {
      logger.error("[queue-manager] Error processing queue", error);
    });
  };

  /**
   * Stop the queue processor
   */
  const stop = (): void => {
    if (!isProcessing) {
      return;
    }

    isProcessing = false;
    if (processingInterval) {
      clearInterval(processingInterval);
      processingInterval = null;
    }

    logger.info("[queue-manager] Stopped queue processor");
  };

  /**
   * Process the queue - start downloads if under max concurrent limit
   */
  const processQueue = async (): Promise<void> => {
    try {
      // Count active downloads in memory
      const activeDownloads = Array.from(queue.values()).filter(
        (item) => item.status === "downloading"
      );
      const activeCount = activeDownloads.length;

      // Check if we can start more downloads
      const availableSlots = finalConfig.maxConcurrent - activeCount;
      if (availableSlots <= 0) {
        return; // All slots filled
      }

      // Get next queued downloads (sorted by priority desc, then queuePosition asc)
      const queuedDownloads = Array.from(queue.values())
        .filter(
          (item) =>
            item.status === "queued" &&
            (item.nextRetryAt === null || item.nextRetryAt <= Date.now())
        )
        .sort((a, b) => {
          if (a.priority !== b.priority) {
            return b.priority - a.priority; // Higher priority first
          }
          return a.queuePosition - b.queuePosition; // Lower position first
        })
        .slice(0, availableSlots);

      // Start each download
      for (const item of queuedDownloads) {
        try {
          // Fetch video metadata from database if we have videoId
          if (item.videoId) {
            const videoData = await db
              .select({
                title: youtubeVideos.title,
                channelTitle: youtubeVideos.channelTitle,
                thumbnailUrl: youtubeVideos.thumbnailUrl,
              })
              .from(youtubeVideos)
              .where(eq(youtubeVideos.videoId, item.videoId))
              .limit(1);

            if (videoData.length > 0) {
              const video = videoData[0];
              item.title = video.title || item.title;
              item.channelTitle = video.channelTitle || item.channelTitle;
              item.thumbnailUrl = video.thumbnailUrl || item.thumbnailUrl;

              logger.debug("[queue-manager] Loaded video metadata from DB", {
                downloadId: item.id,
                videoId: item.videoId,
                title: item.title,
              });
            }
          }

          // Get output path from preferences or use default.
          // Layout: <downloadsRoot>/<channelTitle>/<playlistTitle?>/<filename>
          const downloadsRoot = await getDownloadPath(db);
          const channelFolder = item.channelTitle ? sanitizeFolderName(item.channelTitle) : "";
          const playlistTitle = item.videoId
            ? await getPrimaryPlaylistTitle(db, item.videoId)
            : null;
          const playlistFolder = playlistTitle ? sanitizeFolderName(playlistTitle) : "";
          const outputPath = path.join(
            downloadsRoot,
            ...(channelFolder ? [channelFolder] : []),
            ...(playlistFolder ? [playlistFolder] : []),
            "%(fulltitle)s [%(id)s].%(ext)s"
          );

          // Update status to downloading
          item.status = "downloading";
          item.startedAt = Date.now();
          item.nextRetryAt = null;

          // Sync DB early to reflect downloading state
          if (item.videoId) {
            await db
              .update(youtubeVideos)
              .set({
                downloadStatus: "downloading",
                downloadProgress: 0,
                // The row may only exist now: QuickAdd fetches metadata while the Video is queued
                keptAt: sql`COALESCE(${youtubeVideos.keptAt}, ${item.addedAt})`,
                updatedAt: Date.now(),
              })
              .where(eq(youtubeVideos.videoId, item.videoId))
              .execute();
          }

          // Spawn download with fallback state
          const fallbackState = {
            playerClientIndex: item.playerClientIndex,
            formatStrategyIndex: item.formatStrategyIndex,
            fallbackAttempts: item.fallbackAttempts,
            maxFallbackAttempts: item.maxFallbackAttempts,
          };
          await spawnDownload(
            db,
            item.id,
            item.videoId,
            item.url,
            item.format,
            item.quality,
            outputPath,
            fallbackState
          );

          logger.info("[queue-manager] Started download", {
            id: item.id,
            videoId: item.videoId,
            title: item.title,
            url: item.url,
            playerClient: PLAYER_CLIENTS[item.playerClientIndex],
            formatStrategy: FORMAT_STRATEGIES[item.formatStrategyIndex],
            fallbackAttempt: item.fallbackAttempts,
          });
        } catch (error) {
          logger.error("[queue-manager] Failed to start download", error);
          // Mark as failed
          item.status = "paused";
          item.errorMessage = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      logger.error("[queue-manager] Error in processQueue", error);
    }
  };

  /**
   * Add downloads to queue
   */
  const addToQueue = async (
    urls: string[],
    options: {
      priority?: number;
      format?: string;
      quality?: string;
    } = {}
  ): Promise<string[]> => {
    const downloadIds: string[] = [];
    const skippedUrls: Array<{ url: string; reason: string; videoId: string | null }> = [];

    try {
      // Get current max queue position
      const positions = Array.from(queue.values()).map((item) => item.queuePosition);
      const maxPosition = positions.length > 0 ? Math.max(...positions) : 0;
      let position = maxPosition + 1;

      const now = Date.now();

      for (const url of urls) {
        // Try to extract videoId from URL
        const parseVideoId = (u: string): string | null => {
          try {
            const parsed = new URL(u);
            // watch?v=VIDEOID
            const vParam = parsed.searchParams.get("v");
            if (vParam) return vParam;
            // youtu.be/VIDEOID
            if (parsed.hostname.includes("youtu.be")) {
              const seg = parsed.pathname.split("/").filter(Boolean)[0];
              if (seg) return seg;
            }
            // shorts/VIDEOID or live/VIDEOID
            const parts = parsed.pathname.split("/").filter(Boolean);
            const idx = parts.findIndex((p) => p === "shorts" || p === "live");
            if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
            return null;
          } catch {
            return null;
          }
        };

        const videoId = parseVideoId(url);

        // Check for duplicates in database if we have a videoId
        if (videoId) {
          try {
            const existing = await db
              .select({
                id: youtubeVideos.id,
                videoId: youtubeVideos.videoId,
                title: youtubeVideos.title,
                downloadStatus: youtubeVideos.downloadStatus,
                downloadFilePath: youtubeVideos.downloadFilePath,
              })
              .from(youtubeVideos)
              .where(eq(youtubeVideos.videoId, videoId))
              .limit(1);

            if (existing.length > 0) {
              const video = existing[0];
              const status = video.downloadStatus;

              // Skip if already completed
              if (status === "completed") {
                logger.info("[queue-manager] Skipping duplicate - already downloaded", {
                  videoId,
                  title: video.title,
                  filePath: video.downloadFilePath,
                });
                skippedUrls.push({
                  url,
                  videoId,
                  reason: `Already downloaded: "${video.title}"`,
                });
                continue;
              }

              // Skip only if a worker is actually active in memory.
              // A "queued"/"downloading" status with no in-memory entry means the
              // previous run was interrupted; allow the user to re-add it.
              if (status === "downloading" || status === "queued") {
                const liveEntry = Array.from(queue.values()).find((q) => q.videoId === videoId);
                if (liveEntry) {
                  logger.info("[queue-manager] Skipping duplicate - already in progress", {
                    videoId,
                    title: video.title,
                    status,
                  });
                  skippedUrls.push({
                    url,
                    videoId,
                    reason: `Already ${status}: "${video.title}"`,
                  });
                  continue;
                }

                logger.warn("[queue-manager] Stale download status in DB - resetting", {
                  videoId,
                  title: video.title,
                  status,
                });
                await db
                  .update(youtubeVideos)
                  .set({
                    downloadStatus: null,
                    downloadProgress: null,
                    updatedAt: Date.now(),
                  })
                  .where(eq(youtubeVideos.videoId, videoId))
                  .execute();
              }
            }
          } catch (dbError) {
            logger.warn("[queue-manager] Failed to check for duplicates", {
              videoId,
              error: dbError,
            });
            // Continue with adding to queue if DB check fails
          }
        }

        // Check for duplicates in current in-memory queue. A fetch that failed for good stays
        // paused in memory; adding it again replaces it with a fresh attempt.
        const inQueue = Array.from(queue.values()).find(
          (item) => item.videoId === videoId && videoId !== null
        );
        if (inQueue && inQueue.status === "paused" && inQueue.errorMessage) {
          queue.delete(inQueue.id);
        } else if (inQueue) {
          logger.info("[queue-manager] Skipping duplicate - already in queue", {
            videoId,
            queueId: inQueue.id,
          });
          skippedUrls.push({
            url,
            videoId,
            reason: `Already in queue: "${inQueue.title}"`,
          });
          continue;
        }

        // Generate unique ID
        const id = `download-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        // Initialize fallback state for new download
        const initialFallback = createDefaultFallbackState();

        // Create queue item in memory
        const queueItem: QueueItem = {
          id,
          url,
          videoId, // Best-effort parse from URL
          title: url, // Temp title until metadata is available
          channelTitle: null,
          thumbnailUrl: null,
          status: "queued",
          progress: 0,
          priority: options.priority ?? 0,
          queuePosition: position++,
          format: options.format ?? null,
          quality: options.quality ?? null,
          errorMessage: null,
          errorType: null,
          errorDetails: null,
          isRetryable: true,
          retryCount: 0,
          maxRetries: finalConfig.maxRetries,
          addedAt: now,
          startedAt: null,
          pausedAt: null,
          // Initialize download progress details
          downloadSpeed: null,
          downloadedSize: null,
          totalSize: null,
          eta: null,
          nextRetryAt: null,
          // Initialize fallback state
          playerClientIndex: initialFallback.playerClientIndex,
          formatStrategyIndex: initialFallback.formatStrategyIndex,
          fallbackAttempts: initialFallback.fallbackAttempts,
          maxFallbackAttempts: initialFallback.maxFallbackAttempts,
        };

        queue.set(id, queueItem);
        downloadIds.push(id);

        // Reflect queued state in database for immediate UI feedback
        if (videoId) {
          try {
            await db
              .update(youtubeVideos)
              .set({
                downloadStatus: "queued",
                downloadProgress: 0,
                keptAt: sql`COALESCE(${youtubeVideos.keptAt}, ${now})`,
                updatedAt: now,
              })
              .where(eq(youtubeVideos.videoId, videoId))
              .execute();
          } catch (updateError) {
            logger.warn("[queue-manager] Failed to mark video as queued", {
              videoId,
              error: updateError,
            });
          }
        }
      }

      logger.info("[queue-manager] Added to queue", {
        added: downloadIds.length,
        skipped: skippedUrls.length,
        ids: downloadIds,
      });

      // Log skipped URLs for user feedback
      if (skippedUrls.length > 0) {
        logger.info("[queue-manager] Skipped duplicate URLs", {
          count: skippedUrls.length,
          details: skippedUrls,
        });
      }

      // Auto-start if configured
      if (finalConfig.autoStart && !isProcessing) {
        await start();
      }

      // Return both added and skipped info
      if (skippedUrls.length > 0) {
        // Create custom error with additional properties
        const duplicateError = new Error(
          skippedUrls.length === urls.length
            ? "All videos already downloaded or in queue"
            : `${skippedUrls.length} of ${urls.length} videos skipped (already downloaded or in queue)`
        );
        // Attach metadata to error object
        Object.assign(duplicateError, {
          skippedUrls,
          addedIds: downloadIds,
          isPartialDuplicate: downloadIds.length > 0,
        });
        throw duplicateError;
      }

      return downloadIds;
    } catch (error) {
      // Re-throw with additional context if it's our duplicate error
      if (error && typeof error === "object" && "skippedUrls" in error) {
        throw error;
      }
      logger.error("[queue-manager] Failed to add to queue", error);
      throw error;
    }
  };

  /**
   * Pause a download
   */
  const pauseDownload = async (downloadId: string): Promise<void> => {
    try {
      const item = queue.get(downloadId);
      if (!item) {
        throw new Error(`Download ${downloadId} not found in queue`);
      }

      // Kill the download process if active
      const wasActive = killDownload(downloadId);

      // Update status to paused
      item.status = "paused";
      item.pausedAt = Date.now();

      // Sync to database if video exists
      if (item.videoId) {
        await db
          .update(youtubeVideos)
          .set({
            downloadStatus: "paused",
            updatedAt: Date.now(),
          })
          .where(eq(youtubeVideos.videoId, item.videoId));
      }

      logger.info("[queue-manager] Paused download", {
        downloadId,
        wasActive,
      });
    } catch (error) {
      logger.error("[queue-manager] Failed to pause download", error);
      throw error;
    }
  };

  /**
   * Resume a paused download
   */
  const resumeDownload = async (downloadId: string): Promise<void> => {
    try {
      const item = queue.get(downloadId);
      if (!item) {
        throw new Error(`Download ${downloadId} not found in queue`);
      }

      // Update status to queued - will be picked up by processor
      item.status = "queued";
      item.pausedAt = null;
      item.nextRetryAt = null;

      // Sync to database if video exists
      if (item.videoId) {
        await db
          .update(youtubeVideos)
          .set({
            downloadStatus: "queued",
            updatedAt: Date.now(),
          })
          .where(eq(youtubeVideos.videoId, item.videoId));
      }

      logger.info("[queue-manager] Resumed download", { downloadId });
    } catch (error) {
      logger.error("[queue-manager] Failed to resume download", error);
      throw error;
    }
  };

  /**
   * Cancel a download
   */
  const cancelDownload = async (downloadId: string): Promise<void> => {
    try {
      const item = queue.get(downloadId);
      if (!item) {
        throw new Error(`Download ${downloadId} not found in queue`);
      }

      // Kill the download process if active
      const wasActive = killDownload(downloadId);

      // Remove from queue
      queue.delete(downloadId);

      // Sync to database if video exists
      if (item.videoId) {
        await db
          .update(youtubeVideos)
          .set({
            downloadStatus: "cancelled",
            keptAt: null,
            updatedAt: Date.now(),
          })
          .where(eq(youtubeVideos.videoId, item.videoId));
      }

      logger.info("[queue-manager] Cancelled download", {
        downloadId,
        wasActive,
      });
    } catch (error) {
      logger.error("[queue-manager] Failed to cancel download", error);
      throw error;
    }
  };

  /**
   * Retry a failed download (manual retry resets fallback state)
   */
  const retryDownload = async (downloadId: string): Promise<void> => {
    try {
      const item = queue.get(downloadId);
      if (!item) {
        throw new Error(`Download ${downloadId} not found in queue`);
      }

      // Check if retries exceeded
      if (item.retryCount >= item.maxRetries) {
        throw new Error("Max retries exceeded");
      }

      // Reset fallback state on manual retry (start fresh)
      const freshFallback = createDefaultFallbackState();
      item.playerClientIndex = freshFallback.playerClientIndex;
      item.formatStrategyIndex = freshFallback.formatStrategyIndex;
      item.fallbackAttempts = freshFallback.fallbackAttempts;
      item.maxFallbackAttempts = freshFallback.maxFallbackAttempts;
      item.nextRetryAt = null;

      // Update status to queued
      item.status = "queued";
      item.retryCount++;
      item.errorMessage = null;
      item.errorType = null;
      item.errorDetails = null;
      item.progress = 0;

      logger.info("[queue-manager] Retrying download (fallback state reset)", {
        downloadId,
        videoId: item.videoId,
        retryCount: item.retryCount,
        note: "Manual retry resets fallback state to start fresh",
      });
    } catch (error) {
      logger.error("[queue-manager] Failed to retry download", error);
      throw error;
    }
  };

  /**
   * Get queue status
   */
  const getQueueStatus = async (): Promise<QueueStatus> => {
    try {
      // Get all items from in-memory queue
      const allItems = Array.from(queue.values());

      // Categorize downloads
      const queued = allItems.filter((item) => item.status === "queued");
      const downloading = allItems.filter((item) => item.status === "downloading");
      const paused = allItems.filter((item) => item.status === "paused");

      // Get recent completed/failed from youtube_videos
      const completed = await db
        .select({
          videoId: youtubeVideos.videoId,
          title: youtubeVideos.title,
          channelTitle: youtubeVideos.channelTitle,
          thumbnailUrl: youtubeVideos.thumbnailUrl,
          filePath: youtubeVideos.downloadFilePath,
          lastDownloadedAt: youtubeVideos.lastDownloadedAt,
        })
        .from(youtubeVideos)
        .where(eq(youtubeVideos.downloadStatus, "completed"))
        .orderBy(desc(youtubeVideos.lastDownloadedAt))
        .limit(10)
        .execute();

      const failed = await db
        .select({
          videoId: youtubeVideos.videoId,
          title: youtubeVideos.title,
          channelTitle: youtubeVideos.channelTitle,
          thumbnailUrl: youtubeVideos.thumbnailUrl,
          errorMessage: youtubeVideos.lastErrorMessage,
          errorType: youtubeVideos.errorType,
          updatedAt: youtubeVideos.updatedAt,
        })
        .from(youtubeVideos)
        .where(eq(youtubeVideos.downloadStatus, "failed"))
        .orderBy(youtubeVideos.updatedAt)
        .limit(10)
        .execute();

      // Calculate stats
      const stats: QueueStats = {
        totalQueued: queued.length,
        totalActive: downloading.length,
        totalPaused: paused.length,
        totalCompleted: completed.length,
        totalFailed: failed.length,
        averageProgress:
          downloading.length > 0
            ? downloading.reduce((sum, d) => sum + d.progress, 0) / downloading.length
            : 0,
      };

      // Use type-safe helper for mapping
      return {
        queued: queued.map(queueItemToQueuedDownload),
        downloading: downloading.map(queueItemToQueuedDownload),
        paused: paused.map(queueItemToQueuedDownload),
        completed: completed.map((v) => ({
          id: `completed-${v.videoId}`,
          url: "",
          videoId: v.videoId,
          title: v.title,
          channelTitle: v.channelTitle,
          thumbnailUrl: v.thumbnailUrl,
          status: "completed" as const,
          progress: 100,
          priority: 0,
          queuePosition: null,
          format: null,
          quality: null,
          filePath: v.filePath,
          fileSize: null,
          errorMessage: null,
          errorType: null,
          errorDetails: null,
          isRetryable: false,
          retryCount: 0,
          maxRetries: 0,
          addedAt: v.lastDownloadedAt || Date.now(),
          startedAt: null,
          pausedAt: null,
          completedAt: v.lastDownloadedAt,
          cancelledAt: null,
          updatedAt: v.lastDownloadedAt,
          downloadSpeed: null,
          downloadedSize: null,
          totalSize: null,
          eta: null,
          // Fallback state not relevant for completed downloads
          playerClientIndex: 0,
          formatStrategyIndex: 0,
          fallbackAttempts: 0,
          maxFallbackAttempts: 10,
        })),
        failed: failed.map((v) => ({
          id: `failed-${v.videoId}`,
          url: "",
          videoId: v.videoId,
          title: v.title,
          channelTitle: v.channelTitle,
          thumbnailUrl: v.thumbnailUrl,
          status: "failed" as const,
          progress: 0,
          priority: 0,
          queuePosition: null,
          format: null,
          quality: null,
          filePath: null,
          fileSize: null,
          errorMessage: v.errorMessage,
          errorType: v.errorType,
          errorDetails: null, // Detailed errors only available for recent failures
          isRetryable: true,
          retryCount: 0,
          maxRetries: 3,
          addedAt: v.updatedAt || Date.now(),
          startedAt: null,
          pausedAt: null,
          completedAt: null,
          cancelledAt: null,
          updatedAt: v.updatedAt,
          downloadSpeed: null,
          downloadedSize: null,
          totalSize: null,
          eta: null,
          // Fallback state exhausted for failed downloads
          playerClientIndex: PLAYER_CLIENTS.length - 1,
          formatStrategyIndex: FORMAT_STRATEGIES.length - 1,
          fallbackAttempts: 10,
          maxFallbackAttempts: 10,
        })),
        stats,
      };
    } catch (error) {
      logger.error("[queue-manager] Failed to get queue status", error);
      throw error;
    }
  };

  /**
   * Clear completed downloads from youtube_videos
   */
  const clearCompleted = async (): Promise<void> => {
    try {
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
        .where(eq(youtubeVideos.downloadStatus, "completed"))
        .execute();

      logger.info("[queue-manager] Cleared completed downloads");
    } catch (error) {
      logger.error("[queue-manager] Failed to clear completed", error);
      throw error;
    }
  };

  // Return public API (functional factory pattern)
  return {
    updateProgress,
    markCompleted,
    markFailed,
    restoreInterruptedDownloads,
    start,
    stop,
    addToQueue,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    getQueueStatus,
    clearCompleted,
  };
};

// Singleton instance
let queueManagerInstance: QueueManagerInstance | null = null;

/**
 * Get or create queue manager instance (functional factory pattern)
 */
export const getQueueManager = (
  db: Database,
  config?: Partial<QueueConfig>
): QueueManagerInstance => {
  if (!queueManagerInstance) {
    queueManagerInstance = createQueueManager(db, config);
  }
  return queueManagerInstance;
};

/**
 * Initialize and start queue manager
 */
export const initializeQueueManager = async (
  db: Database,
  config?: Partial<QueueConfig>
): Promise<QueueManagerInstance> => {
  const manager = getQueueManager(db, config);
  if (config?.autoStart !== false) {
    await manager.start();
  }
  return manager;
};

/**
 * Get existing queue manager instance (throws if not initialized)
 */
export const requireQueueManager = (): QueueManagerInstance => {
  if (!queueManagerInstance) {
    throw new Error("QueueManager not initialized. Call initializeQueueManager first.");
  }
  return queueManagerInstance;
};
