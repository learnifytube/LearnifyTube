import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as os from "os";
import { eq, and, inArray, count, desc, sql, lte, asc } from "drizzle-orm";
import { logger } from "../helpers/logger";
import defaultDb from "../api/db";
import {
  youtubeVideos,
  videoTranscripts,
  channels,
  channelPlaylists,
  customPlaylists,
  playlistItems,
  customPlaylistItems,
  favorites,
  flashcards,
  savedWords,
  translationCache,
  translationContexts,
} from "../api/db/schema";
import { app, powerMonitor, powerSaveBlocker } from "electron";
import { getMdnsService } from "./mdnsService";
import { getQueueManager } from "../services/download-queue/queue-manager";
import { parseVttToSegments, downloadTranscript } from "../api/routers/transcripts";
import { downloadImageToCache } from "../api/utils/ytdlp-utils/thumbnail";
import { getPlaylistDetailsForServer } from "../api/routers/playlists";
import { z } from "zod";
import { authorizeSyncRequest, withPairingToken } from "./security/sync-auth";
import { createPairingStore, type PairingStore } from "./security/pairing-store";
import {
  MOBILE_SYNC_PROTOCOL_VERSION,
  MIN_SUPPORTED_MOBILE_SYNC_PROTOCOL_VERSION,
  type SyncServerInfo,
} from "../../../shared/mobile-sync-contract";

/**
 * HTTP server for mobile sync - allows the mobile companion app
 * to discover and download videos over local WiFi.
 */

const DEFAULT_PORT = 53318;
const MOBILE_SYNC_RESUME_REANNOUNCE_DELAY_MS = 1500;
const MOBILE_SYNC_POWER_BLOCKER_TYPE = "prevent-app-suspension";

type FavoriteEntityType = "video" | "custom_playlist" | "channel_playlist";
const MY_LIST_FAVORITE_ENTITY_TYPES: FavoriteEntityType[] = [
  "custom_playlist",
  "channel_playlist",
];

function isFavoriteEntityType(s: string): s is FavoriteEntityType {
  return s === "video" || s === "custom_playlist" || s === "channel_playlist";
}

interface RemoteVideo {
  id: string;
  title: string;
  channelTitle: string;
  duration: number;
  fileSize: number;
  hasTranscript: boolean;
  thumbnailUrl?: string;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

const transcriptSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});

const transcriptSegmentsSchema = z.array(transcriptSegmentSchema);
const stringArraySchema = z.array(z.string());

const transcriptDownloadBodySchema = z.object({
  lang: z.string().optional(),
});

const addFavoriteBodySchema = z.object({
  entityType: z.enum(["video", "custom_playlist", "channel_playlist"]).optional(),
  entityId: z.string().optional(),
});

const downloadRequestBodySchema = z.object({
  videoId: z.string().optional(),
  url: z.string().optional(),
});

const flashcardReviewBodySchema = z.object({
  id: z.string().optional(),
  grade: z.number().optional(),
});

const translateBodySchema = z.object({
  text: z.string().optional(),
  sourceLang: z.string().optional(),
  targetLang: z.string().optional(),
  videoId: z.string().optional(),
  timestampSeconds: z.number().optional(),
  contextText: z.string().optional(),
});

const saveWordBodySchema = z.object({
  translationId: z.string().optional(),
  notes: z.string().optional(),
});

const parseTranscriptSegments = (raw: string | null): TranscriptSegment[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const validated = transcriptSegmentsSchema.safeParse(parsed);
    return validated.success ? validated.data : [];
  } catch {
    return [];
  }
};

const parseStringArray = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const validated = stringArraySchema.safeParse(parsed);
    return validated.success ? validated.data : [];
  } catch {
    return [];
  }
};

const parseJsonUnknown = (raw: string): unknown => JSON.parse(raw);

interface VideoMeta {
  id: string;
  title: string;
  channelTitle: string;
  duration: number;
  description?: string | null;
  transcript?: {
    language: string;
    segments: TranscriptSegment[];
  };
}

export interface ConnectedDevice {
  ip: string;
  lastSeen: number;
  requestCount: number;
  userAgent?: string;
}

// Sync API response types
interface RemoteChannel {
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  videoCount: number;
}

interface RemotePlaylist {
  playlistId: string;
  title: string;
  thumbnailUrl: string | null;
  itemCount: number | null;
  channelId: string | null;
  type: "channel" | "custom";
  downloadedCount: number;
}

interface RemoteMyList {
  id: string;
  name: string;
  itemCount: number;
  thumbnailUrl: string | null;
  sourceType: "custom_playlist" | "channel_playlist";
  sourceId: string;
  isFavorite: boolean;
}

interface RemoteVideoWithStatus {
  id: string;
  title: string;
  channelTitle: string;
  duration: number;
  thumbnailUrl: string | null;
  downloadStatus: "completed" | "downloading" | "queued" | "pending" | null;
  downloadProgress: number | null;
  fileSize: number | null;
}

interface RemoteFavorite {
  id: string;
  entityType: "video" | "custom_playlist" | "channel_playlist";
  entityId: string;
  // Populated fields based on type
  video?: RemoteVideoWithStatus;
  playlist?: RemotePlaylist;
}

interface ServerDownloadStatus {
  videoId: string;
  status: "queued" | "downloading" | "completed" | "failed" | "pending" | null;
  progress: number | null;
  error: string | null;
}

const VIRTUAL_INTERFACE_NAME_PATTERN =
  /(docker|tailscale|tun|tap|utun|veth|vmnet|vbox|virtual|bridge|br-|ham|zt|wg|hyper-v)/i;

type MobileSyncServer = {
  start: (port?: number) => Promise<number>;
  stop: () => Promise<void>;
  getPort: () => number;
  isRunning: () => boolean;
  getConnectedDevices: () => ConnectedDevice[];
};

/**
 * Get the local IP address for LAN access
 */
function isPrivateLanAddress(address: string): boolean {
  return (
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function getInterfacePriority(name: string, address: string): number {
  const normalizedName = name.toLowerCase();
  const isVirtual = VIRTUAL_INTERFACE_NAME_PATTERN.test(normalizedName);
  const isWifiLike = /(wifi|wi-fi|wlan|wl|airport|en0)/i.test(normalizedName);
  const isEthernetLike = /(ethernet|eth|en|lan)/i.test(normalizedName);

  if (isPrivateLanAddress(address) && isWifiLike && !isVirtual) return 0;
  if (isPrivateLanAddress(address) && isEthernetLike && !isVirtual) return 1;
  if (isPrivateLanAddress(address) && !isVirtual) return 2;
  if (isPrivateLanAddress(address)) return 3;
  if (!isVirtual) return 4;
  return 5;
}

function getCandidateLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const candidates: Array<{ address: string; priority: number }> = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const iface of entries || []) {
      if (iface.family !== "IPv4" || iface.internal) {
        continue;
      }

      candidates.push({
        address: iface.address,
        priority: getInterfacePriority(name, iface.address),
      });
    }
  }

  candidates.sort((a, b) => a.priority - b.priority || a.address.localeCompare(b.address));

  return Array.from(new Set(candidates.map((candidate) => candidate.address)));
}

export function getLocalIpAddress(): string | null {
  return getCandidateLocalIpAddresses()[0] ?? null;
}

let pairingStore: PairingStore | null = null;

// Created lazily: app.getPath("userData") is only reliable once Electron is ready.
const getPairingStore = (): PairingStore => {
  if (!pairingStore) {
    pairingStore = createPairingStore(
      path.join(app.getPath("userData"), "mobile-sync-pairing.json")
    );
  }
  return pairingStore;
};

/** The code a mobile device must present to use the sync server. */
export const getMobileSyncPairingCode = (): string => getPairingStore().getCode();

/** Replace the pairing code; every paired device must enter the new one. */
export const resetMobileSyncPairingCode = (): string => getPairingStore().reset();

const createMobileSyncServer = (): MobileSyncServer => {
  let server: http.Server | null = null;
  let port = 0;
  const connectedDevices = new Map<string, ConnectedDevice>();
  const playlistHydrationRequests = new Map<string, Promise<void>>();
  let keepAwakeBlockerId: number | null = null;
  let resumeReannounceTimer: ReturnType<typeof setTimeout> | null = null;
  let powerMonitorListenersRegistered = false;

  // Clean up stale devices (not seen in last 5 minutes)
  const cleanupStaleDevices = (): void => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    for (const [ip, device] of connectedDevices.entries()) {
      if (device.lastSeen < fiveMinutesAgo) {
        connectedDevices.delete(ip);
      }
    }
  };

  const trackDevice = (req: http.IncomingMessage): void => {
    const ip = req.socket.remoteAddress?.replace("::ffff:", "") ?? "unknown";
    const userAgent = req.headers["user-agent"];

    const existing = connectedDevices.get(ip);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.requestCount++;
      if (userAgent) existing.userAgent = userAgent;
    } else {
      connectedDevices.set(ip, {
        ip,
        lastSeen: Date.now(),
        requestCount: 1,
        userAgent,
      });
      logger.info("[MobileSyncServer] New device connected:", { ip, userAgent });
    }

    // Cleanup stale devices periodically
    cleanupStaleDevices();
  };

  // Absolute URL for an image the mobile app loads natively (no headers), so it carries the pairing code.
  const assetUrl = (pathname: string): string =>
    withPairingToken(`http://${getLocalIpAddress()}:${port}${pathname}`, getMobileSyncPairingCode());

  const sendJson = (res: http.ServerResponse, data: unknown, statusCode = 200): void => {
    logger.info(`[MobileSyncServer] → ${statusCode} JSON response`);
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify(data));
  };

  const sendError = (res: http.ServerResponse, message: string, statusCode = 500): void => {
    sendJson(res, { error: message }, statusCode);
  };

  const clearResumeReannounceTimer = (): void => {
    if (!resumeReannounceTimer) {
      return;
    }

    clearTimeout(resumeReannounceTimer);
    resumeReannounceTimer = null;
  };

  const ensureKeepAwakeBlocker = (): void => {
    if (keepAwakeBlockerId !== null && powerSaveBlocker.isStarted(keepAwakeBlockerId)) {
      return;
    }

    keepAwakeBlockerId = powerSaveBlocker.start(MOBILE_SYNC_POWER_BLOCKER_TYPE);
    logger.info("[MobileSyncServer] Enabled power save blocker", {
      blockerId: keepAwakeBlockerId,
      blockerType: MOBILE_SYNC_POWER_BLOCKER_TYPE,
    });
  };

  const releaseKeepAwakeBlocker = (): void => {
    if (keepAwakeBlockerId === null) {
      return;
    }

    if (powerSaveBlocker.isStarted(keepAwakeBlockerId)) {
      powerSaveBlocker.stop(keepAwakeBlockerId);
      logger.info("[MobileSyncServer] Released power save blocker", {
        blockerId: keepAwakeBlockerId,
      });
    }

    keepAwakeBlockerId = null;
  };

  const getCompletedVideoCount = async (): Promise<number> => {
    const videos = await defaultDb
      .select()
      .from(youtubeVideos)
      .where(eq(youtubeVideos.downloadStatus, "completed"));

    return videos.length;
  };

  const refreshMdnsAdvertisement = async (reason: string): Promise<void> => {
    if (!server?.listening || port <= 0) {
      return;
    }

    try {
      const videoCount = await getCompletedVideoCount();
      const ip = getLocalIpAddress();

      logger.info("[MobileSyncServer] Refreshing mDNS advertisement", {
        reason,
        ip,
        port,
        videoCount,
      });

      getMdnsService().publish(port, videoCount);
      getMdnsService().startScanning();
    } catch (error) {
      logger.error("[MobileSyncServer] Failed to refresh mDNS advertisement", {
        reason,
        error,
      });
    }
  };

  const registerPowerMonitorListeners = (): void => {
    if (powerMonitorListenersRegistered) {
      return;
    }

    powerMonitor.on("suspend", () => {
      if (!server?.listening) {
        return;
      }

      logger.warn("[MobileSyncServer] System is suspending while Mobile Sync is running");
    });

    powerMonitor.on("resume", () => {
      if (!server?.listening) {
        return;
      }

      logger.info("[MobileSyncServer] System resumed, re-announcing Mobile Sync service");
      clearResumeReannounceTimer();
      resumeReannounceTimer = setTimeout(() => {
        resumeReannounceTimer = null;
        void refreshMdnsAdvertisement("system-resume");
      }, MOBILE_SYNC_RESUME_REANNOUNCE_DELAY_MS);
    });

    powerMonitorListenersRegistered = true;
  };

  const handleApiInfo = async (res: http.ServerResponse): Promise<void> => {
    try {
      const videos = await defaultDb
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.downloadStatus, "completed"));

      // Only count videos where the file actually exists
      const availableCount = videos.filter((video) => {
        if (!video.downloadFilePath) return false;
        return fs.existsSync(video.downloadFilePath);
      }).length;

      const info: SyncServerInfo = {
        name: "LearnifyTube",
        version: app.getVersion(),
        videoCount: availableCount,
        syncProtocolVersion: MOBILE_SYNC_PROTOCOL_VERSION,
        minSupportedMobileSyncProtocolVersion: MIN_SUPPORTED_MOBILE_SYNC_PROTOCOL_VERSION,
      };
      sendJson(res, info);
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting server info", error);
      sendError(res, "Failed to get server info");
    }
  };

  const handleApiVideos = async (res: http.ServerResponse): Promise<void> => {
    try {
      const videos = await defaultDb
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.downloadStatus, "completed"));

      // Check which videos have transcripts
      const transcripts = await defaultDb.select().from(videoTranscripts);
      const videosWithTranscripts = new Set(transcripts.map((t) => t.videoId));

      // Filter to only videos where the file actually exists on disk
      const availableVideos = videos.filter((video) => {
        if (!video.downloadFilePath) return false;
        return fs.existsSync(video.downloadFilePath);
      });

      const remoteVideos: RemoteVideo[] = availableVideos.map((video) => {
        // Always use local URL - thumbnails will be downloaded on-demand if missing
        const hasThumbnailSource = video.thumbnailPath || video.thumbnailUrl;
        return {
          id: video.videoId,
          title: video.title,
          channelTitle: video.channelTitle,
          duration: video.durationSeconds ?? 0,
          fileSize: video.downloadFileSize ?? 0,
          hasTranscript: videosWithTranscripts.has(video.videoId),
          thumbnailUrl: hasThumbnailSource
            ? assetUrl(`/api/video/${video.videoId}/thumbnail`)
            : undefined,
        };
      });

      sendJson(res, { videos: remoteVideos });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting videos", error);
      sendError(res, "Failed to get videos");
    }
  };

  const handleVideoMeta = async (res: http.ServerResponse, videoId: string): Promise<void> => {
    try {
      const videos = await defaultDb
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.videoId, videoId))
        .limit(1);

      if (videos.length === 0) {
        sendError(res, "Video not found", 404);
        return;
      }

      const video = videos[0];

      // Get transcript if available
      const transcripts = await defaultDb
        .select()
        .from(videoTranscripts)
        .where(eq(videoTranscripts.videoId, videoId))
        .limit(1);

      let transcript: VideoMeta["transcript"];
      if (transcripts.length > 0) {
        const t = transcripts[0];
        let segments: TranscriptSegment[] = [];

        // Try segmentsJson first (if cached)
        if (t.segmentsJson) {
          segments = parseTranscriptSegments(t.segmentsJson);
          if (segments.length === 0) {
            logger.warn("[MobileSyncServer] Failed to parse segmentsJson", { videoId });
          }
        }

        // Fall back to parsing rawVtt if no cached segments
        if (segments.length === 0 && t.rawVtt) {
          try {
            segments = parseVttToSegments(t.rawVtt);
            logger.info("[MobileSyncServer] Parsed segments from rawVtt", {
              videoId,
              segmentCount: segments.length,
            });
          } catch (e) {
            logger.warn("[MobileSyncServer] Failed to parse rawVtt", { videoId, error: e });
          }
        }

        if (segments.length > 0) {
          transcript = {
            language: t.language ?? "en",
            segments,
          };
        }
      }

      const meta: VideoMeta = {
        id: video.videoId,
        title: video.title,
        channelTitle: video.channelTitle,
        duration: video.durationSeconds ?? 0,
        description: video.description ?? null,
        transcript,
      };

      sendJson(res, meta);
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting video meta", { videoId, error });
      sendError(res, "Failed to get video metadata");
    }
  };

  // GET /api/video/:id/transcripts - Return all transcripts for a video
  const handleVideoTranscripts = async (
    res: http.ServerResponse,
    videoId: string
  ): Promise<void> => {
    try {
      const transcripts = await defaultDb
        .select()
        .from(videoTranscripts)
        .where(eq(videoTranscripts.videoId, videoId));

      const result = transcripts
        .map((t) => {
          let segments: TranscriptSegment[] = [];

          // Parse from rawVtt (preferred)
          if (t.rawVtt) {
            try {
              segments = parseVttToSegments(t.rawVtt);
            } catch (e) {
              logger.warn("[MobileSyncServer] Failed to parse rawVtt for transcripts", {
                videoId,
                language: t.language,
                error: e,
              });
            }
          }

          // Fall back to segmentsJson
          if (segments.length === 0 && t.segmentsJson) {
            segments = parseTranscriptSegments(t.segmentsJson);
            if (segments.length === 0) {
              logger.warn("[MobileSyncServer] Failed to parse segmentsJson", { videoId });
            }
          }

          if (segments.length === 0) return null;

          return {
            language: t.language ?? "en",
            isAutoGenerated: t.isAutoGenerated ?? true,
            segments,
          };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);

      sendJson(res, { transcripts: result });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting video transcripts", { videoId, error });
      sendError(res, "Failed to get video transcripts");
    }
  };

  // POST /api/video/:id/transcript/download - Trigger transcript download via yt-dlp
  const handleTranscriptDownload = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    videoId: string
  ): Promise<void> => {
    try {
      // Parse optional body for language preference
      let lang: string | undefined;
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }
        if (body) {
          const parsed = transcriptDownloadBodySchema.parse(parseJsonUnknown(body));
          if (parsed.lang) lang = parsed.lang;
        }
      } catch {
        // Ignore body parsing errors, use default lang
      }

      logger.info("[MobileSyncServer] Transcript download requested", { videoId, lang });

      const result = await downloadTranscript(videoId, lang);

      if (result.success) {
        sendJson(res, {
          success: true,
          videoId,
          language: result.language,
          status: result.fromCache ? "exists" : "downloaded",
          message: result.fromCache
            ? "Transcript already available"
            : "Transcript downloaded successfully",
        });
      } else {
        sendJson(res, {
          success: false,
          videoId,
          message: result.message,
        });
      }
    } catch (error) {
      logger.error("[MobileSyncServer] Error handling transcript download", { videoId, error });
      sendError(res, "Failed to download transcript");
    }
  };

  const handleVideoFile = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    videoId: string
  ): Promise<void> => {
    try {
      const videos = await defaultDb
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.videoId, videoId))
        .limit(1);

      if (videos.length === 0 || !videos[0].downloadFilePath) {
        sendError(res, "Video not found", 404);
        return;
      }

      const filePath = videos[0].downloadFilePath;

      if (!fs.existsSync(filePath)) {
        logger.warn("[MobileSyncServer] Video file not found, queueing re-download", {
          videoId,
          filePath,
        });

        // Queue re-download using yt-dlp
        try {
          // Update video status to pending so it won't show as available
          await defaultDb
            .update(youtubeVideos)
            .set({
              downloadStatus: "pending",
              downloadFilePath: null,
              downloadFileSize: null,
            })
            .where(eq(youtubeVideos.videoId, videoId));

          const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const queueManager = getQueueManager(defaultDb);
          await queueManager.addToQueue([youtubeUrl]);
          logger.info("[MobileSyncServer] Queued video for re-download", { videoId });

          // Return 202 Accepted to indicate download is queued
          sendJson(
            res,
            {
              error: "Video file missing - download queued",
              status: "queued",
              videoId,
            },
            202
          );
        } catch (queueError) {
          logger.error("[MobileSyncServer] Failed to queue re-download", {
            videoId,
            error: queueError,
          });
          sendError(res, "Video file not found", 404);
        }
        return;
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === ".mp4"
          ? "video/mp4"
          : ext === ".webm"
            ? "video/webm"
            : ext === ".mkv"
              ? "video/x-matroska"
              : "application/octet-stream";

      // Handle range requests for video seeking
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        logger.debug("[MobileSyncServer] Range request", {
          videoId,
          start,
          end,
          chunkSize,
          fileSize,
        });

        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        });

        fileStream.pipe(res);

        fileStream.on("error", (err) => {
          logger.error("[MobileSyncServer] Stream error", { videoId, error: err });
          if (!res.headersSent) {
            res.writeHead(500);
          }
          res.end();
        });
      } else {
        // Full file response
        logger.debug("[MobileSyncServer] Full file request", { videoId, fileSize });

        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": contentType,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-cache",
        });

        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

        fileStream.on("error", (err) => {
          logger.error("[MobileSyncServer] Stream error", { videoId, error: err });
          if (!res.headersSent) {
            res.writeHead(500);
          }
          res.end();
        });
      }
    } catch (error) {
      logger.error("[MobileSyncServer] Error streaming video file", { videoId, error });
      sendError(res, "Failed to stream video");
    }
  };

  const handleVideoThumbnail = async (res: http.ServerResponse, videoId: string): Promise<void> => {
    try {
      const videos = await defaultDb
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.videoId, videoId))
        .limit(1);

      if (videos.length === 0) {
        sendError(res, "Video not found", 404);
        return;
      }

      const video = videos[0];
      let filePath = video.thumbnailPath;

      // If no local thumbnail or file doesn't exist, try to download from YouTube URL
      if (!filePath || !fs.existsSync(filePath)) {
        if (video.thumbnailUrl) {
          logger.info("[MobileSyncServer] Downloading video thumbnail on-demand", {
            videoId,
            url: video.thumbnailUrl,
          });

          const downloadedPath = await downloadImageToCache(video.thumbnailUrl, `video_${videoId}`);

          if (downloadedPath) {
            // Update database with the new path
            await defaultDb
              .update(youtubeVideos)
              .set({ thumbnailPath: downloadedPath })
              .where(eq(youtubeVideos.videoId, videoId));

            filePath = downloadedPath;
          }
        }
      }

      if (!filePath || !fs.existsSync(filePath)) {
        sendError(res, "Thumbnail not found", 404);
        return;
      }

      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : "application/octet-stream";

      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": contentType,
        "Cache-Control": "max-age=86400",
      });

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);

      fileStream.on("error", (err) => {
        logger.error("[MobileSyncServer] Thumbnail stream error", { videoId, error: err });
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    } catch (error) {
      logger.error("[MobileSyncServer] Error serving thumbnail", { videoId, error });
      sendError(res, "Failed to serve thumbnail");
    }
  };

  // Helper to convert video to RemoteVideoWithStatus
  const videoToRemoteVideoWithStatus = (
    video: typeof youtubeVideos.$inferSelect
  ): RemoteVideoWithStatus => {
    // Always use local URL - thumbnails will be downloaded on-demand if missing
    const hasThumbnailSource = video.thumbnailPath || video.thumbnailUrl;
    return {
      id: video.videoId,
      title: video.title,
      channelTitle: video.channelTitle,
      duration: video.durationSeconds ?? 0,
      thumbnailUrl: hasThumbnailSource
        ? assetUrl(`/api/video/${video.videoId}/thumbnail`)
        : null,
      downloadStatus:
        video.downloadStatus === "completed" ||
        video.downloadStatus === "downloading" ||
        video.downloadStatus === "queued" ||
        video.downloadStatus === "pending"
          ? video.downloadStatus
          : null,
      downloadProgress: video.downloadProgress ?? null,
      fileSize: video.downloadFileSize ?? null,
    };
  };

  // GET /api/channels - List all channels with downloaded video counts
  const handleApiChannels = async (res: http.ServerResponse): Promise<void> => {
    try {
      // Get all channels
      const channelList = await defaultDb.select().from(channels);

      // Count downloaded videos per channel
      const videoCounts = await defaultDb
        .select({
          channelId: youtubeVideos.channelId,
          count: count(),
        })
        .from(youtubeVideos)
        .where(eq(youtubeVideos.downloadStatus, "completed"))
        .groupBy(youtubeVideos.channelId);

      const countMap = new Map(videoCounts.map((vc) => [vc.channelId, vc.count]));

      const remoteChannels: RemoteChannel[] = channelList.map((c) => {
        // Always use local URL - thumbnails will be downloaded on-demand if missing
        const hasThumbnailSource = c.thumbnailPath || c.thumbnailUrl;
        return {
          channelId: c.channelId,
          channelTitle: c.channelTitle,
          thumbnailUrl: hasThumbnailSource
            ? assetUrl(`/api/channel/${c.channelId}/thumbnail`)
            : null,
          videoCount: countMap.get(c.channelId) ?? 0,
        };
      });

      // Sort by video count descending
      remoteChannels.sort((a, b) => b.videoCount - a.videoCount);

      sendJson(res, { channels: remoteChannels });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting channels", error);
      sendError(res, "Failed to get channels");
    }
  };

  // GET /api/subscriptions - List recent videos (round-robin across channels)
  const handleApiSubscriptions = async (res: http.ServerResponse): Promise<void> => {
    try {
      const limit = 200;
      const offset = 0;

      const rows = await defaultDb.all<{
        videoId: string;
        title: string;
        channelTitle: string;
        durationSeconds: number | null;
        thumbnailUrl: string | null;
        thumbnailPath: string | null;
        downloadStatus: string | null;
        downloadProgress: number | null;
        downloadFileSize: number | null;
      }>(sql`
        WITH ranked_videos AS (
          SELECT
            *,
            ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY created_at DESC) as rn
          FROM youtube_videos
          WHERE channel_id IS NOT NULL
        )
        SELECT
          video_id as videoId,
          title,
          channel_title as channelTitle,
          duration_seconds as durationSeconds,
          thumbnail_url as thumbnailUrl,
          thumbnail_path as thumbnailPath,
          download_status as downloadStatus,
          download_progress as downloadProgress,
          download_file_size as downloadFileSize
        FROM ranked_videos
        ORDER BY rn ASC, created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const videos: RemoteVideoWithStatus[] = rows.map((row) => {
        const hasThumbnailSource = row.thumbnailPath || row.thumbnailUrl;
        return {
          id: row.videoId,
          title: row.title,
          channelTitle: row.channelTitle,
          duration: row.durationSeconds ?? 0,
          thumbnailUrl: hasThumbnailSource
            ? assetUrl(`/api/video/${row.videoId}/thumbnail`)
            : null,
          downloadStatus:
            row.downloadStatus === "completed" ||
            row.downloadStatus === "downloading" ||
            row.downloadStatus === "queued" ||
            row.downloadStatus === "pending"
              ? row.downloadStatus
              : null,
          downloadProgress: row.downloadProgress ?? null,
          fileSize: row.downloadFileSize ?? null,
        };
      });

      sendJson(res, { videos });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting subscription videos", error);
      sendError(res, "Failed to get subscription videos");
    }
  };

  // GET /api/channel/:id/videos - Videos for a channel with download status
  const handleChannelVideos = async (
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> => {
    try {
      const videoList = await defaultDb
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.channelId, channelId));

      const videos: RemoteVideoWithStatus[] = videoList.map(videoToRemoteVideoWithStatus);

      // Sort: downloaded first, then by title
      videos.sort((a, b) => {
        if (a.downloadStatus === "completed" && b.downloadStatus !== "completed") return -1;
        if (a.downloadStatus !== "completed" && b.downloadStatus === "completed") return 1;
        return a.title.localeCompare(b.title);
      });

      sendJson(res, { videos });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting channel videos", { channelId, error });
      sendError(res, "Failed to get channel videos");
    }
  };

  // GET /api/subscription/:id/videos - Videos for a subscription channel
  const handleSubscriptionVideos = async (
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> => {
    try {
      const videoList = await defaultDb
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.channelId, channelId))
        .orderBy(desc(youtubeVideos.publishedAt), desc(youtubeVideos.createdAt));

      const videos: RemoteVideoWithStatus[] = videoList.map(videoToRemoteVideoWithStatus);

      sendJson(res, { videos });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting subscription videos", {
        channelId,
        error,
      });
      sendError(res, "Failed to get subscription videos");
    }
  };

  // GET /api/channel/:id/thumbnail - Serve channel thumbnail
  const handleChannelThumbnail = async (
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> => {
    try {
      const channelList = await defaultDb
        .select()
        .from(channels)
        .where(eq(channels.channelId, channelId))
        .limit(1);

      if (channelList.length === 0) {
        sendError(res, "Channel not found", 404);
        return;
      }

      const channel = channelList[0];
      let filePath = channel.thumbnailPath;

      // If no local thumbnail or file doesn't exist, try to download from YouTube URL
      if (!filePath || !fs.existsSync(filePath)) {
        if (channel.thumbnailUrl) {
          logger.info("[MobileSyncServer] Downloading channel thumbnail on-demand", {
            channelId,
            url: channel.thumbnailUrl,
          });

          const downloadedPath = await downloadImageToCache(
            channel.thumbnailUrl,
            `channel_${channelId}`
          );

          if (downloadedPath) {
            // Update database with the new path
            await defaultDb
              .update(channels)
              .set({ thumbnailPath: downloadedPath })
              .where(eq(channels.channelId, channelId));

            filePath = downloadedPath;
          }
        }
      }

      if (!filePath || !fs.existsSync(filePath)) {
        sendError(res, "Channel thumbnail not found", 404);
        return;
      }

      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : "application/octet-stream";

      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": contentType,
        "Cache-Control": "max-age=86400",
      });

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);

      fileStream.on("error", (err) => {
        logger.error("[MobileSyncServer] Channel thumbnail stream error", {
          channelId,
          error: err,
        });
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    } catch (error) {
      logger.error("[MobileSyncServer] Error serving channel thumbnail", { channelId, error });
      sendError(res, "Failed to serve channel thumbnail");
    }
  };

  // GET /api/playlists - List all playlists (channel + custom)
  const handleApiPlaylists = async (res: http.ServerResponse): Promise<void> => {
    try {
      // Get channel playlists
      const channelPlaylistList = await defaultDb.select().from(channelPlaylists);

      // Get custom playlists
      const customPlaylistList = await defaultDb.select().from(customPlaylists);

      // Get downloaded video IDs for counting
      const downloadedVideos = await defaultDb
        .select({ videoId: youtubeVideos.videoId })
        .from(youtubeVideos)
        .where(eq(youtubeVideos.downloadStatus, "completed"));
      const downloadedSet = new Set(downloadedVideos.map((v) => v.videoId));

      // Get playlist items for channel playlists
      const channelPlaylistItemList = await defaultDb.select().from(playlistItems);
      const channelPlaylistItemMap = new Map<string, string[]>();
      for (const item of channelPlaylistItemList) {
        const existing = channelPlaylistItemMap.get(item.playlistId) ?? [];
        existing.push(item.videoId);
        channelPlaylistItemMap.set(item.playlistId, existing);
      }

      // Get playlist items for custom playlists
      const customPlaylistItemList = await defaultDb.select().from(customPlaylistItems);
      const customPlaylistItemMap = new Map<string, string[]>();
      for (const item of customPlaylistItemList) {
        const existing = customPlaylistItemMap.get(item.playlistId) ?? [];
        existing.push(item.videoId);
        customPlaylistItemMap.set(item.playlistId, existing);
      }

      const playlistRows: Array<{ createdAt: number; playlist: RemotePlaylist }> = [];

      // Add channel playlists
      for (const p of channelPlaylistList) {
        const videoIds = channelPlaylistItemMap.get(p.playlistId) ?? [];
        const downloadedCount = videoIds.filter((id) => downloadedSet.has(id)).length;

        // Always use local URL - thumbnails will be downloaded on-demand if missing
        const hasThumbnailSource = p.thumbnailPath || p.thumbnailUrl;
        playlistRows.push({
          createdAt: p.createdAt ?? 0,
          playlist: {
            playlistId: p.playlistId,
            title: p.title,
            thumbnailUrl: hasThumbnailSource
              ? assetUrl(`/api/playlist/${p.playlistId}/thumbnail`)
              : null,
            itemCount: p.itemCount,
            channelId: p.channelId,
            type: "channel",
            downloadedCount,
          },
        });
      }

      // Add custom playlists
      for (const p of customPlaylistList) {
        const videoIds = customPlaylistItemMap.get(p.id) ?? [];
        const downloadedCount = videoIds.filter((id) => downloadedSet.has(id)).length;

        playlistRows.push({
          createdAt: p.createdAt ?? 0,
          playlist: {
            playlistId: p.id,
            title: p.name,
            thumbnailUrl: null, // Custom playlists don't have thumbnails
            itemCount: p.itemCount,
            channelId: null,
            type: "custom",
            downloadedCount,
          },
        });
      }

      // Sort by newest playlist first (latest created in desktop DB).
      const remotePlaylists = playlistRows
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((row) => row.playlist);

      sendJson(res, { playlists: remotePlaylists });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting playlists", error);
      sendError(res, "Failed to get playlists");
    }
  };

  // GET /api/mylists - List all custom lists
  const handleApiMyLists = async (res: http.ServerResponse): Promise<void> => {
    try {
      const favoriteList = await defaultDb
        .select()
        .from(favorites)
        .where(inArray(favorites.entityType, MY_LIST_FAVORITE_ENTITY_TYPES));
      const favoriteCustomIds = new Set(
        favoriteList
          .filter((fav) => fav.entityType === "custom_playlist")
          .map((fav) => fav.entityId)
      );
      const favoriteChannelIds = new Set(
        favoriteList
          .filter((fav) => fav.entityType === "channel_playlist")
          .map((fav) => fav.entityId)
      );

      const customPlaylistList = await defaultDb.select().from(customPlaylists);
      const channelPlaylistList = await defaultDb.select().from(channelPlaylists);

      const customPlaylistItemList = await defaultDb.select().from(customPlaylistItems);
      const channelPlaylistItemList = await defaultDb.select().from(playlistItems);
      const itemCountMap = new Map<string, number>();
      for (const item of customPlaylistItemList) {
        itemCountMap.set(item.playlistId, (itemCountMap.get(item.playlistId) ?? 0) + 1);
      }
      const channelItemCountMap = new Map<string, number>();
      for (const item of channelPlaylistItemList) {
        channelItemCountMap.set(item.playlistId, (channelItemCountMap.get(item.playlistId) ?? 0) + 1);
      }

      const remoteMyLists: RemoteMyList[] = [];

      for (const p of customPlaylistList) {
        remoteMyLists.push({
          id: p.id,
          name: p.name,
          itemCount: itemCountMap.get(p.id) ?? p.itemCount ?? 0,
          thumbnailUrl: null,
          sourceType: "custom_playlist",
          sourceId: p.id,
          isFavorite: favoriteCustomIds.has(p.id),
        });
      }

      for (const p of channelPlaylistList) {
        if (!favoriteChannelIds.has(p.playlistId)) {
          continue;
        }
        const hasThumbnailSource = p.thumbnailPath || p.thumbnailUrl;
        remoteMyLists.push({
          id: `fav_channel_playlist:${p.playlistId}`,
          name: p.title,
          itemCount: channelItemCountMap.get(p.playlistId) ?? p.itemCount ?? 0,
          thumbnailUrl: hasThumbnailSource
            ? assetUrl(`/api/playlist/${p.playlistId}/thumbnail`)
            : null,
          sourceType: "channel_playlist",
          sourceId: p.playlistId,
          isFavorite: true,
        });
      }

      remoteMyLists.sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite));

      sendJson(res, { mylists: remoteMyLists });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting my lists", error);
      sendError(res, "Failed to get my lists");
    }
  };

  const getChannelPlaylistItems = async (
    playlistId: string
  ): Promise<Array<typeof playlistItems.$inferSelect>> =>
    defaultDb
      .select()
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlistId))
      .orderBy(playlistItems.position);

  const hydrateChannelPlaylistIfNeeded = async (
    playlist: typeof channelPlaylists.$inferSelect
  ): Promise<void> => {
    const existingRequest = playlistHydrationRequests.get(playlist.playlistId);
    if (existingRequest) {
      await existingRequest;
      return;
    }

    const hydrationRequest = (async () => {
      const limit =
        typeof playlist.itemCount === "number" && playlist.itemCount > 0
          ? Math.min(playlist.itemCount, 500)
          : 500;

      logger.info("[MobileSyncServer] Hydrating channel playlist on demand", {
        playlistId: playlist.playlistId,
        playlistUrl: playlist.url,
        limit,
      });

      await getPlaylistDetailsForServer({
        playlistId: playlist.playlistId,
        playlistUrl: playlist.url ?? undefined,
        limit,
      });
    })();

    playlistHydrationRequests.set(playlist.playlistId, hydrationRequest);

    try {
      await hydrationRequest;
    } finally {
      playlistHydrationRequests.delete(playlist.playlistId);
    }
  };

  // GET /api/playlist/:id/videos - Videos in a playlist with download status
  const handlePlaylistVideos = async (
    res: http.ServerResponse,
    playlistId: string
  ): Promise<void> => {
    try {
      // First check if it's a channel playlist
      const channelPlaylist = await defaultDb
        .select()
        .from(channelPlaylists)
        .where(eq(channelPlaylists.playlistId, playlistId))
        .limit(1);

      if (channelPlaylist.length > 0) {
        // Get videos from channel playlist
        let items = await getChannelPlaylistItems(playlistId);

        if (items.length === 0) {
          try {
            await hydrateChannelPlaylistIfNeeded(channelPlaylist[0]);
            items = await getChannelPlaylistItems(playlistId);
          } catch (error) {
            logger.error("[MobileSyncServer] Failed to hydrate playlist details on demand", {
              playlistId,
              error,
            });
          }
        }

        const videoIds = items.map((i) => i.videoId);
        if (videoIds.length === 0) {
          sendJson(res, { videos: [] });
          return;
        }

        const videoList = await defaultDb
          .select()
          .from(youtubeVideos)
          .where(inArray(youtubeVideos.videoId, videoIds));

        // Create map for ordering
        const videoMap = new Map(videoList.map((v) => [v.videoId, v]));

        const videos: RemoteVideoWithStatus[] = videoIds
          .map((id) => videoMap.get(id))
          .filter((v): v is typeof youtubeVideos.$inferSelect => v !== undefined)
          .map(videoToRemoteVideoWithStatus);

        sendJson(res, { videos });
        return;
      }

      // Check if it's a custom playlist
      const customPlaylist = await defaultDb
        .select()
        .from(customPlaylists)
        .where(eq(customPlaylists.id, playlistId))
        .limit(1);

      if (customPlaylist.length > 0) {
        // Get videos from custom playlist
        const items = await defaultDb
          .select()
          .from(customPlaylistItems)
          .where(eq(customPlaylistItems.playlistId, playlistId))
          .orderBy(customPlaylistItems.position);

        const videoIds = items.map((i) => i.videoId);
        if (videoIds.length === 0) {
          sendJson(res, { videos: [] });
          return;
        }

        const videoList = await defaultDb
          .select()
          .from(youtubeVideos)
          .where(inArray(youtubeVideos.videoId, videoIds));

        // Create map for ordering
        const videoMap = new Map(videoList.map((v) => [v.videoId, v]));

        const videos: RemoteVideoWithStatus[] = videoIds
          .map((id) => videoMap.get(id))
          .filter((v): v is typeof youtubeVideos.$inferSelect => v !== undefined)
          .map(videoToRemoteVideoWithStatus);

        sendJson(res, { videos });
        return;
      }

      sendError(res, "Playlist not found", 404);
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting playlist videos", { playlistId, error });
      sendError(res, "Failed to get playlist videos");
    }
  };

  // GET /api/mylist/:id/videos - Videos in a custom list with download status
  const handleMyListVideos = async (res: http.ServerResponse, listId: string): Promise<void> => {
    try {
      const channelFavoritePrefix = "fav_channel_playlist:";
      if (listId.startsWith(channelFavoritePrefix)) {
        const channelPlaylistId = listId.slice(channelFavoritePrefix.length);
        const items = await defaultDb
          .select()
          .from(playlistItems)
          .where(eq(playlistItems.playlistId, channelPlaylistId))
          .orderBy(playlistItems.position);

        const videoIds = items.map((i) => i.videoId);
        if (videoIds.length === 0) {
          sendJson(res, { videos: [] });
          return;
        }

        const videoList = await defaultDb
          .select()
          .from(youtubeVideos)
          .where(inArray(youtubeVideos.videoId, videoIds));

        const videoMap = new Map(videoList.map((v) => [v.videoId, v]));
        const videos: RemoteVideoWithStatus[] = videoIds
          .map((id) => videoMap.get(id))
          .filter((v): v is typeof youtubeVideos.$inferSelect => v !== undefined)
          .map(videoToRemoteVideoWithStatus);

        sendJson(res, { videos });
        return;
      }

      const customPlaylist = await defaultDb
        .select()
        .from(customPlaylists)
        .where(eq(customPlaylists.id, listId))
        .limit(1);

      if (customPlaylist.length === 0) {
        sendError(res, "List not found", 404);
        return;
      }

      const items = await defaultDb
        .select()
        .from(customPlaylistItems)
        .where(eq(customPlaylistItems.playlistId, listId))
        .orderBy(customPlaylistItems.position);

      const videoIds = items.map((i) => i.videoId);
      if (videoIds.length === 0) {
        sendJson(res, { videos: [] });
        return;
      }

      const videoList = await defaultDb
        .select()
        .from(youtubeVideos)
        .where(inArray(youtubeVideos.videoId, videoIds));

      const videoMap = new Map(videoList.map((v) => [v.videoId, v]));

      const videos: RemoteVideoWithStatus[] = videoIds
        .map((id) => videoMap.get(id))
        .filter((v): v is typeof youtubeVideos.$inferSelect => v !== undefined)
        .map(videoToRemoteVideoWithStatus);

      sendJson(res, { videos });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting my list videos", { listId, error });
      sendError(res, "Failed to get my list videos");
    }
  };

  // GET /api/playlist/:id/thumbnail - Serve playlist thumbnail
  const handlePlaylistThumbnail = async (
    res: http.ServerResponse,
    playlistId: string
  ): Promise<void> => {
    try {
      const playlistList = await defaultDb
        .select()
        .from(channelPlaylists)
        .where(eq(channelPlaylists.playlistId, playlistId))
        .limit(1);

      if (playlistList.length === 0) {
        sendError(res, "Playlist not found", 404);
        return;
      }

      const playlist = playlistList[0];
      let filePath = playlist.thumbnailPath;

      // If no local thumbnail or file doesn't exist, try to download from YouTube URL
      if (!filePath || !fs.existsSync(filePath)) {
        if (playlist.thumbnailUrl) {
          logger.info("[MobileSyncServer] Downloading playlist thumbnail on-demand", {
            playlistId,
            url: playlist.thumbnailUrl,
          });

          const downloadedPath = await downloadImageToCache(
            playlist.thumbnailUrl,
            `playlist_${playlistId}`
          );

          if (downloadedPath) {
            // Update database with the new path
            await defaultDb
              .update(channelPlaylists)
              .set({ thumbnailPath: downloadedPath })
              .where(eq(channelPlaylists.playlistId, playlistId));

            filePath = downloadedPath;
          }
        }
      }

      if (!filePath || !fs.existsSync(filePath)) {
        sendError(res, "Playlist thumbnail not found", 404);
        return;
      }

      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : "application/octet-stream";

      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": contentType,
        "Cache-Control": "max-age=86400",
      });

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);

      fileStream.on("error", (err) => {
        logger.error("[MobileSyncServer] Playlist thumbnail stream error", {
          playlistId,
          error: err,
        });
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    } catch (error) {
      logger.error("[MobileSyncServer] Error serving playlist thumbnail", { playlistId, error });
      sendError(res, "Failed to serve playlist thumbnail");
    }
  };

  // POST /api/favorites - Add a favorite
  const handleAddFavorite = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      const parsed = addFavoriteBodySchema.parse(parseJsonUnknown(body));
      const { entityType, entityId } = parsed;

      if (!entityType || !entityId) {
        sendError(res, "entityType and entityId are required", 400);
        return;
      }

      // Check if already favorited
      const existing = await defaultDb
        .select()
        .from(favorites)
        .where(and(eq(favorites.entityType, entityType), eq(favorites.entityId, entityId)))
        .limit(1);

      if (existing.length > 0) {
        sendJson(res, { success: true, id: existing[0].id, message: "Already favorited" });
        return;
      }

      // Create new favorite
      const id = `fav_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await defaultDb.insert(favorites).values({
        id,
        entityType,
        entityId,
        createdAt: Date.now(),
      });

      logger.info("[MobileSyncServer] Added favorite", { entityType, entityId, id });
      sendJson(res, { success: true, id });
    } catch (error) {
      logger.error("[MobileSyncServer] Error adding favorite", error);
      sendError(res, "Failed to add favorite");
    }
  };

  // DELETE /api/favorites/:entityType/:entityId - Remove a favorite
  const handleRemoveFavorite = async (
    res: http.ServerResponse,
    entityType: string,
    entityId: string
  ): Promise<void> => {
    try {
      if (!isFavoriteEntityType(entityType)) {
        sendError(res, "Invalid entityType", 400);
        return;
      }

      await defaultDb
        .delete(favorites)
        .where(and(eq(favorites.entityType, entityType), eq(favorites.entityId, entityId)));

      logger.info("[MobileSyncServer] Removed favorite", { entityType, entityId });
      sendJson(res, { success: true });
    } catch (error) {
      logger.error("[MobileSyncServer] Error removing favorite", error);
      sendError(res, "Failed to remove favorite");
    }
  };

  // GET /api/favorites - User's favorites (videos + playlists)
  const handleApiFavorites = async (res: http.ServerResponse): Promise<void> => {
    try {
      const favoriteList = await defaultDb.select().from(favorites);

      const remoteFavorites: RemoteFavorite[] = [];

      for (const fav of favoriteList) {
        const remoteFav: RemoteFavorite = {
          id: fav.id,
          entityType: fav.entityType,
          entityId: fav.entityId,
        };

        if (fav.entityType === "video") {
          const videos = await defaultDb
            .select()
            .from(youtubeVideos)
            .where(eq(youtubeVideos.videoId, fav.entityId))
            .limit(1);

          if (videos.length > 0) {
            remoteFav.video = videoToRemoteVideoWithStatus(videos[0]);
          }
        } else if (fav.entityType === "channel_playlist") {
          const playlists = await defaultDb
            .select()
            .from(channelPlaylists)
            .where(eq(channelPlaylists.playlistId, fav.entityId))
            .limit(1);

          if (playlists.length > 0) {
            const p = playlists[0];
            // Get downloaded count
            const items = await defaultDb
              .select()
              .from(playlistItems)
              .where(eq(playlistItems.playlistId, p.playlistId));

            const videoIds = items.map((i) => i.videoId);
            let downloadedCount = 0;
            if (videoIds.length > 0) {
              const downloaded = await defaultDb
                .select({ videoId: youtubeVideos.videoId })
                .from(youtubeVideos)
                .where(
                  and(
                    inArray(youtubeVideos.videoId, videoIds),
                    eq(youtubeVideos.downloadStatus, "completed")
                  )
                );
              downloadedCount = downloaded.length;
            }

            remoteFav.playlist = {
              playlistId: p.playlistId,
              title: p.title,
              thumbnailUrl: p.thumbnailPath
                ? assetUrl(`/api/playlist/${p.playlistId}/thumbnail`)
                : p.thumbnailUrl,
              itemCount: p.itemCount,
              channelId: p.channelId,
              type: "channel",
              downloadedCount,
            };
          }
        } else if (fav.entityType === "custom_playlist") {
          const playlists = await defaultDb
            .select()
            .from(customPlaylists)
            .where(eq(customPlaylists.id, fav.entityId))
            .limit(1);

          if (playlists.length > 0) {
            const p = playlists[0];
            // Get downloaded count
            const items = await defaultDb
              .select()
              .from(customPlaylistItems)
              .where(eq(customPlaylistItems.playlistId, p.id));

            const videoIds = items.map((i) => i.videoId);
            let downloadedCount = 0;
            if (videoIds.length > 0) {
              const downloaded = await defaultDb
                .select({ videoId: youtubeVideos.videoId })
                .from(youtubeVideos)
                .where(
                  and(
                    inArray(youtubeVideos.videoId, videoIds),
                    eq(youtubeVideos.downloadStatus, "completed")
                  )
                );
              downloadedCount = downloaded.length;
            }

            remoteFav.playlist = {
              playlistId: p.id,
              title: p.name,
              thumbnailUrl: null,
              itemCount: p.itemCount,
              channelId: null,
              type: "custom",
              downloadedCount,
            };
          }
        }

        remoteFavorites.push(remoteFav);
      }

      sendJson(res, { favorites: remoteFavorites });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting favorites", error);
      sendError(res, "Failed to get favorites");
    }
  };

  // GET /api/download/status/:videoId - Check download progress on server
  const handleDownloadStatus = async (res: http.ServerResponse, videoId: string): Promise<void> => {
    try {
      const videos = await defaultDb
        .select()
        .from(youtubeVideos)
        .where(eq(youtubeVideos.videoId, videoId))
        .limit(1);

      if (videos.length === 0) {
        const payload: ServerDownloadStatus = {
          videoId,
          status: null,
          progress: null,
          error: null,
        };
        sendJson(res, payload);
        return;
      }

      const video = videos[0];
      const status: ServerDownloadStatus = {
        videoId,
        status:
          video.downloadStatus === "completed" ||
          video.downloadStatus === "downloading" ||
          video.downloadStatus === "queued" ||
          video.downloadStatus === "failed" ||
          video.downloadStatus === "pending"
            ? video.downloadStatus
            : null,
        progress: video.downloadProgress ?? null,
        error: video.lastErrorMessage ?? null,
      };

      sendJson(res, status);
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting download status", { videoId, error });
      sendError(res, "Failed to get download status");
    }
  };

  // POST /api/download/request - Request server to download a YouTube video
  const handleDownloadRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    try {
      // Read request body
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      const { videoId, url } = downloadRequestBodySchema.parse(parseJsonUnknown(body));

      if (!videoId && !url) {
        sendError(res, "videoId or url required", 400);
        return;
      }

      const queueManager = getQueueManager(defaultDb);

      const queueUrl = async (youtubeUrl: string): Promise<void> => {
        try {
          await queueManager.addToQueue([youtubeUrl], { priority: 1 });
        } catch (error) {
          if (error && typeof error === "object" && "skippedUrls" in error) {
            return;
          }
          throw error;
        }
      };

      if (videoId) {
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const videos = await defaultDb
          .select()
          .from(youtubeVideos)
          .where(eq(youtubeVideos.videoId, videoId))
          .limit(1);

        if (videos.length > 0) {
          const video = videos[0];
          const hasFile = !!video.downloadFilePath && fs.existsSync(video.downloadFilePath);

          if (hasFile) {
            if (video.downloadStatus !== "completed") {
              await defaultDb
                .update(youtubeVideos)
                .set({ downloadStatus: "completed", updatedAt: Date.now() })
                .where(eq(youtubeVideos.videoId, videoId));
            }
            sendJson(res, {
              success: true,
              videoId,
              status: "completed",
              message: "Video already downloaded",
            });
            return;
          }

          if (
            video.downloadStatus === "downloading" ||
            video.downloadStatus === "queued" ||
            video.downloadStatus === "pending"
          ) {
            sendJson(res, {
              success: true,
              videoId,
              status: video.downloadStatus,
              message: "Download already in progress",
            });
            return;
          }

          await queueUrl(youtubeUrl);
          sendJson(res, {
            success: true,
            videoId,
            status: "queued",
            message: "Download queued",
          });
          return;
        }

        await queueUrl(youtubeUrl);
        sendJson(res, {
          success: true,
          videoId,
          status: "queued",
          message: "Download queued",
        });
        return;
      }

      if (url) {
        await queueUrl(url);
        sendJson(res, {
          success: true,
          videoId: null,
          status: "queued",
          message: "Download queued",
        });
        return;
      }
    } catch (error) {
      logger.error("[MobileSyncServer] Error handling download request", error);
      sendError(res, "Failed to process download request");
    }
  };

  // === Flashcard & Word Sync Handlers ===

  // SM-2 spaced repetition algorithm (inlined from flashcards router)
  const calculateNextReview = (
    previousInterval: number,
    previousEaseFactor: number,
    grade: number
  ): { newInterval: number; newEaseFactor: number } => {
    let newInterval = 0;
    let newEaseFactor = previousEaseFactor;

    if (grade >= 3) {
      if (previousInterval === 0) {
        newInterval = 1;
      } else if (previousInterval === 1) {
        newInterval = 6;
      } else {
        newInterval = Math.round(previousInterval * previousEaseFactor);
      }
      newEaseFactor = previousEaseFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
      if (newEaseFactor < 1.3) newEaseFactor = 1.3;
    } else {
      newInterval = 1;
    }

    return { newInterval, newEaseFactor };
  };

  // GET /api/flashcards?due=true - List flashcards from desktop DB
  const handleApiFlashcards = async (res: http.ServerResponse, query: string): Promise<void> => {
    try {
      const params = new URLSearchParams(query);
      const dueOnly = params.get("due") === "true";

      let cards;
      if (dueOnly) {
        const now = new Date().toISOString();
        cards = await defaultDb
          .select()
          .from(flashcards)
          .where(lte(flashcards.nextReviewAt, now))
          .orderBy(asc(flashcards.nextReviewAt));
      } else {
        cards = await defaultDb.select().from(flashcards).orderBy(desc(flashcards.createdAt));
      }

      const result = cards.map((c) => ({
        id: c.id,
        videoId: c.videoId,
        frontContent: c.frontContent,
        backContent: c.backContent,
        contextText: c.contextText,
        cardType: c.cardType ?? "basic",
        tags: parseStringArray(c.tags),
        clozeContent: c.clozeContent,
        difficulty: c.difficulty ?? 0,
        nextReviewAt: c.nextReviewAt,
        reviewCount: c.reviewCount ?? 0,
        easeFactor: c.easeFactor ?? 250,
        interval: c.interval ?? 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));

      sendJson(res, { flashcards: result });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting flashcards", error);
      sendError(res, "Failed to get flashcards");
    }
  };

  // POST /api/flashcards/review - Review a flashcard (apply SM-2 SRS)
  const handleFlashcardReview = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      const { id, grade } = flashcardReviewBodySchema.parse(parseJsonUnknown(body));

      if (!id || grade === undefined || grade < 0 || grade > 5) {
        sendError(res, "id and grade (0-5) are required", 400);
        return;
      }

      const card = await defaultDb.select().from(flashcards).where(eq(flashcards.id, id)).limit(1);

      if (card.length === 0) {
        sendError(res, "Flashcard not found", 404);
        return;
      }

      const c = card[0];
      const currentEase = (c.easeFactor ?? 250) / 100;
      const currentInterval = c.interval ?? 0;

      const { newInterval, newEaseFactor } = calculateNextReview(
        currentInterval,
        currentEase,
        grade
      );

      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + newInterval);

      await defaultDb
        .update(flashcards)
        .set({
          interval: newInterval,
          easeFactor: Math.round(newEaseFactor * 100),
          nextReviewAt: nextDate.toISOString(),
          reviewCount: (c.reviewCount ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(flashcards.id, id));

      logger.info("[MobileSyncServer] Reviewed flashcard", {
        id,
        grade,
        nextReview: nextDate.toISOString(),
      });
      sendJson(res, { success: true, nextReview: nextDate.toISOString() });
    } catch (error) {
      logger.error("[MobileSyncServer] Error reviewing flashcard", error);
      sendError(res, "Failed to review flashcard");
    }
  };

  // GET /api/saved-words - List saved words with translations
  const handleApiSavedWords = async (res: http.ServerResponse): Promise<void> => {
    try {
      const words = await defaultDb
        .select({
          id: savedWords.id,
          notes: savedWords.notes,
          reviewCount: savedWords.reviewCount,
          lastReviewedAt: savedWords.lastReviewedAt,
          createdAt: savedWords.createdAt,
          sourceText: translationCache.sourceText,
          translatedText: translationCache.translatedText,
          sourceLang: translationCache.sourceLang,
          targetLang: translationCache.targetLang,
          translationId: translationCache.id,
        })
        .from(savedWords)
        .innerJoin(translationCache, eq(savedWords.translationId, translationCache.id))
        .orderBy(desc(savedWords.createdAt));

      sendJson(res, { words });
    } catch (error) {
      logger.error("[MobileSyncServer] Error getting saved words", error);
      sendError(res, "Failed to get saved words");
    }
  };

  // POST /api/translate - Translate text via Google Translate (with caching)
  const handleTranslate = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      const parsed = translateBodySchema.parse(parseJsonUnknown(body));

      const { text, targetLang, videoId, timestampSeconds, contextText } = parsed;

      if (!text || !targetLang) {
        sendError(res, "text and targetLang are required", 400);
        return;
      }

      const cleanText = text.trim();
      const sl = parsed.sourceLang || "auto";
      const tl = targetLang;

      // Check cache first
      const cached = await defaultDb
        .select()
        .from(translationCache)
        .where(
          and(
            eq(translationCache.sourceText, cleanText),
            eq(translationCache.sourceLang, sl),
            eq(translationCache.targetLang, tl)
          )
        )
        .limit(1);

      if (cached.length > 0) {
        const entry = cached[0];

        // Update query count
        await defaultDb
          .update(translationCache)
          .set({
            queryCount: (entry.queryCount || 0) + 1,
            lastQueriedAt: Date.now(),
            updatedAt: Date.now(),
          })
          .where(eq(translationCache.id, entry.id));

        // Save video context if provided
        if (videoId && timestampSeconds !== undefined) {
          try {
            await defaultDb
              .insert(translationContexts)
              .values({
                id: crypto.randomUUID(),
                translationId: entry.id,
                videoId,
                timestampSeconds: Math.floor(timestampSeconds),
                contextText: contextText || null,
                createdAt: Date.now(),
              })
              .onConflictDoNothing();
          } catch {
            // ignore context save errors
          }
        }

        sendJson(res, {
          success: true,
          translatedText: entry.translatedText,
          translationId: entry.id,
          detectedLang: entry.detectedLang || sl,
          fromCache: true,
        });
        return;
      }

      // Call Google Translate free endpoint
      const encodedText = encodeURIComponent(cleanText);
      const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodedText}`;

      const response = await fetch(translateUrl);
      if (!response.ok) {
        sendError(res, `Translation API returned ${response.status}`);
        return;
      }

      const rawData: unknown = await response.json();
      if (!Array.isArray(rawData) || !Array.isArray(rawData[0])) {
        sendError(res, "Invalid translation API response");
        return;
      }

      const firstElement: unknown = rawData[0];
      if (!Array.isArray(firstElement)) {
        sendError(res, "Translation data format unexpected");
        return;
      }

      const translatedText = firstElement
        .filter(
          (item: unknown): item is unknown[] => Array.isArray(item) && typeof item[0] === "string"
        )
        .map((item: unknown[]) => String(item[0]))
        .join("");

      const detectedLang = typeof rawData[2] === "string" ? rawData[2] : sl;

      // Cache the result
      let translationId = "";
      try {
        const cacheId = crypto.randomUUID();
        const now = Date.now();

        const [upserted] = await defaultDb
          .insert(translationCache)
          .values({
            id: cacheId,
            sourceText: cleanText,
            sourceLang: sl,
            targetLang: tl,
            translatedText,
            detectedLang,
            queryCount: 1,
            firstQueriedAt: now,
            lastQueriedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              translationCache.sourceText,
              translationCache.sourceLang,
              translationCache.targetLang,
            ],
            set: {
              queryCount: sql`${translationCache.queryCount} + 1`,
              lastQueriedAt: now,
              updatedAt: now,
            },
          })
          .returning();

        translationId = upserted.id;

        // Save video context if provided
        if (videoId && timestampSeconds !== undefined) {
          try {
            await defaultDb
              .insert(translationContexts)
              .values({
                id: crypto.randomUUID(),
                translationId,
                videoId,
                timestampSeconds: Math.floor(timestampSeconds),
                contextText: contextText || null,
                createdAt: now,
              })
              .onConflictDoNothing();
          } catch {
            // ignore context save errors
          }
        }
      } catch (cacheError) {
        logger.warn("[MobileSyncServer] Failed to cache translation", cacheError);
      }

      sendJson(res, {
        success: true,
        translatedText,
        translationId,
        detectedLang,
        fromCache: false,
      });
    } catch (error) {
      logger.error("[MobileSyncServer] Error translating text", error);
      sendError(res, "Failed to translate text");
    }
  };

  // POST /api/saved-words/save - Save a word to learning list
  const handleSaveWord = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      const { translationId, notes } = saveWordBodySchema.parse(parseJsonUnknown(body));

      if (!translationId) {
        sendError(res, "translationId is required", 400);
        return;
      }

      // Check if already saved
      const existing = await defaultDb
        .select()
        .from(savedWords)
        .where(eq(savedWords.translationId, translationId))
        .limit(1);

      if (existing.length > 0) {
        sendJson(res, { success: true, alreadySaved: true, id: existing[0].id });
        return;
      }

      const id = crypto.randomUUID();
      const now = Date.now();
      await defaultDb.insert(savedWords).values({
        id,
        translationId,
        notes: notes ?? null,
        reviewCount: 0,
        lastReviewedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      // Auto-create flashcard
      try {
        const translation = await defaultDb
          .select()
          .from(translationCache)
          .where(eq(translationCache.id, translationId))
          .limit(1);

        if (translation.length > 0) {
          const frontContent = translation[0].sourceText;
          const existingCard = await defaultDb
            .select()
            .from(flashcards)
            .where(eq(flashcards.frontContent, frontContent))
            .limit(1);

          if (existingCard.length === 0) {
            const backContent = `[${translation[0].translatedText}]`;
            const nowIso = new Date().toISOString();
            await defaultDb.insert(flashcards).values({
              id: crypto.randomUUID(),
              videoId: null,
              frontContent,
              backContent,
              contextText: null,
              audioUrl: null,
              timestampSeconds: null,
              difficulty: 0,
              reviewCount: 0,
              interval: 0,
              easeFactor: 250,
              nextReviewAt: nowIso,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
        }
      } catch (flashcardError) {
        logger.warn("[MobileSyncServer] Failed to auto-create flashcard", flashcardError);
      }

      logger.info("[MobileSyncServer] Saved word", { translationId, id });
      sendJson(res, { success: true, alreadySaved: false, id });
    } catch (error) {
      logger.error("[MobileSyncServer] Error saving word", error);
      sendError(res, "Failed to save word");
    }
  };

  const handleRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    const method = req.method;

    // Every route needs the pairing code; browser requests (with an Origin) are refused outright.
    const auth = authorizeSyncRequest(req, getMobileSyncPairingCode());
    if (!auth.ok) {
      logger.warn(`[MobileSyncServer] Rejected ${method} request`, {
        status: auth.status,
        ip: req.socket.remoteAddress,
        origin: req.headers.origin,
      });
      sendError(res, auth.status === 401 ? "Pairing required" : "Forbidden", auth.status);
      return;
    }
    const url = auth.url;

    if (method !== "GET" && method !== "POST" && method !== "DELETE") {
      sendError(res, "Method not allowed", 405);
      return;
    }

    // Track connected device
    trackDevice(req);

    logger.info(`[MobileSyncServer] ← ${method} ${url}`);

    // Route matching - support both /api/* and /* routes for compatibility
    // with both mobile app (uses /api/*) and P2P client (uses /*)
    if (url === "/api/info" || url === "/info") {
      await handleApiInfo(res);
      return;
    }

    if (url === "/api/videos" || url === "/videos") {
      await handleApiVideos(res);
      return;
    }

    // Match /api/video/:id/meta or /video/:id/meta
    const metaMatch = url.match(/^(?:\/api)?\/video\/([^/]+)\/meta$/);
    if (metaMatch) {
      await handleVideoMeta(res, metaMatch[1]);
      return;
    }

    // Match /api/video/:id/file or /video/:id/file
    const fileMatch = url.match(/^(?:\/api)?\/video\/([^/]+)\/file$/);
    if (fileMatch) {
      await handleVideoFile(req, res, fileMatch[1]);
      return;
    }

    // Match /api/video/:id/transcripts or /video/:id/transcripts
    const transcriptsMatch = url.match(/^(?:\/api)?\/video\/([^/]+)\/transcripts$/);
    if (transcriptsMatch && method === "GET") {
      await handleVideoTranscripts(res, transcriptsMatch[1]);
      return;
    }

    // Match /api/video/:id/transcript/download or /video/:id/transcript/download
    const transcriptDownloadMatch = url.match(/^(?:\/api)?\/video\/([^/]+)\/transcript\/download$/);
    if (transcriptDownloadMatch && method === "POST") {
      await handleTranscriptDownload(req, res, transcriptDownloadMatch[1]);
      return;
    }

    // Match /api/video/:id/thumbnail or /video/:id/thumbnail
    const thumbnailMatch = url.match(/^(?:\/api)?\/video\/([^/]+)\/thumbnail$/);
    if (thumbnailMatch) {
      await handleVideoThumbnail(res, thumbnailMatch[1]);
      return;
    }

    // === Sync API Routes ===

    // GET /api/channels
    if (url === "/api/channels" || url === "/channels") {
      await handleApiChannels(res);
      return;
    }

    // GET /api/subscriptions
    if (url === "/api/subscriptions" || url === "/subscriptions") {
      await handleApiSubscriptions(res);
      return;
    }

    // GET /api/channel/:id/videos
    const channelVideosMatch = url.match(/^(?:\/api)?\/channel\/([^/]+)\/videos$/);
    if (channelVideosMatch) {
      await handleChannelVideos(res, channelVideosMatch[1]);
      return;
    }

    // GET /api/subscription/:id/videos
    const subscriptionVideosMatch = url.match(/^(?:\/api)?\/subscription\/([^/]+)\/videos$/);
    if (subscriptionVideosMatch) {
      await handleSubscriptionVideos(res, subscriptionVideosMatch[1]);
      return;
    }

    // GET /api/channel/:id/thumbnail
    const channelThumbnailMatch = url.match(/^(?:\/api)?\/channel\/([^/]+)\/thumbnail$/);
    if (channelThumbnailMatch) {
      await handleChannelThumbnail(res, channelThumbnailMatch[1]);
      return;
    }

    // GET /api/playlists
    if (url === "/api/playlists" || url === "/playlists") {
      await handleApiPlaylists(res);
      return;
    }

    // GET /api/mylists
    if (url === "/api/mylists" || url === "/mylists") {
      await handleApiMyLists(res);
      return;
    }

    // GET /api/playlist/:id/videos
    const playlistVideosMatch = url.match(/^(?:\/api)?\/playlist\/([^/]+)\/videos$/);
    if (playlistVideosMatch) {
      await handlePlaylistVideos(res, playlistVideosMatch[1]);
      return;
    }

    // GET /api/mylist/:id/videos
    const myListVideosMatch = url.match(/^(?:\/api)?\/mylist\/([^/]+)\/videos$/);
    if (myListVideosMatch) {
      await handleMyListVideos(res, decodeURIComponent(myListVideosMatch[1]));
      return;
    }

    // GET /api/playlist/:id/thumbnail
    const playlistThumbnailMatch = url.match(/^(?:\/api)?\/playlist\/([^/]+)\/thumbnail$/);
    if (playlistThumbnailMatch) {
      await handlePlaylistThumbnail(res, playlistThumbnailMatch[1]);
      return;
    }

    // GET /api/favorites
    if ((url === "/api/favorites" || url === "/favorites") && method === "GET") {
      await handleApiFavorites(res);
      return;
    }

    // POST /api/favorites - Add favorite
    if ((url === "/api/favorites" || url === "/favorites") && method === "POST") {
      await handleAddFavorite(req, res);
      return;
    }

    // DELETE /api/favorites/:entityType/:entityId - Remove favorite
    const deleteFavoriteMatch = url.match(/^(?:\/api)?\/favorites\/([^/]+)\/([^/]+)$/);
    if (deleteFavoriteMatch && method === "DELETE") {
      await handleRemoveFavorite(
        res,
        decodeURIComponent(deleteFavoriteMatch[1]),
        decodeURIComponent(deleteFavoriteMatch[2])
      );
      return;
    }

    // GET /api/download/status/:videoId
    const downloadStatusMatch = url.match(/^(?:\/api)?\/download\/status\/([^/]+)$/);
    if (downloadStatusMatch) {
      await handleDownloadStatus(res, downloadStatusMatch[1]);
      return;
    }

    // POST /api/download/request
    if ((url === "/api/download/request" || url === "/download/request") && method === "POST") {
      await handleDownloadRequest(req, res);
      return;
    }

    // === Flashcard & Word Sync Routes ===

    // GET /api/flashcards
    const flashcardsUrlMatch = url.match(/^(?:\/api)?\/flashcards(\?.*)?$/);
    if (flashcardsUrlMatch && method === "GET") {
      await handleApiFlashcards(res, flashcardsUrlMatch[1]?.slice(1) || "");
      return;
    }

    // POST /api/flashcards/review
    if ((url === "/api/flashcards/review" || url === "/flashcards/review") && method === "POST") {
      await handleFlashcardReview(req, res);
      return;
    }

    // GET /api/saved-words
    if ((url === "/api/saved-words" || url === "/saved-words") && method === "GET") {
      await handleApiSavedWords(res);
      return;
    }

    // POST /api/translate
    if ((url === "/api/translate" || url === "/translate") && method === "POST") {
      await handleTranslate(req, res);
      return;
    }

    // POST /api/saved-words/save
    if ((url === "/api/saved-words/save" || url === "/saved-words/save") && method === "POST") {
      await handleSaveWord(req, res);
      return;
    }

    sendError(res, "Not found", 404);
  };

  const start = async (requestedPort?: number): Promise<number> => {
    if (server) {
      return port;
    }

    const targetPort = requestedPort ?? DEFAULT_PORT;

    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
          logger.error("[MobileSyncServer] Request handler error", err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal server error");
          }
        });
      });

      let didSettle = false;
      const cleanupFailedStart = (): void => {
        if (server) {
          server.removeAllListeners("error");
          if (server.listening) {
            server.close();
          }
        }
        server = null;
        port = 0;
      };

      server.on("error", (err) => {
        logger.error("[MobileSyncServer] Server error", err);
        if (didSettle) {
          return;
        }
        didSettle = true;
        cleanupFailedStart();
        reject(err);
      });

      // Listen on all interfaces (0.0.0.0) for LAN access
      logger.info(`[MobileSyncServer] Attempting to start on port ${targetPort}...`);
      server.listen(targetPort, "0.0.0.0", async () => {
        if (didSettle) {
          return;
        }
        didSettle = true;
        const address = server?.address();
        if (address && typeof address === "object") {
          port = address.port;
          const ip = getLocalIpAddress();
          logger.info(`[MobileSyncServer] ✓ HTTP server started`);
          logger.info(`[MobileSyncServer] URL: http://${ip ?? "0.0.0.0"}:${port}`);
          logger.info(`[MobileSyncServer] Local IP: ${ip}`);
          logger.info(`[MobileSyncServer] Port: ${port}`);
          registerPowerMonitorListeners();
          ensureKeepAwakeBlocker();

          // Publish mDNS service for discovery
          logger.info("[MobileSyncServer] Publishing mDNS service for discovery...");
          try {
            const videoCount = await getCompletedVideoCount();
            logger.info(`[MobileSyncServer] Found ${videoCount} completed videos to share`);
            getMdnsService().publish(port, videoCount);
            logger.info("[MobileSyncServer] ✓ mDNS service published");

            // Start scanning for mobile devices
            logger.info("[MobileSyncServer] Starting mDNS scanner for mobile devices...");
            getMdnsService().startScanning();
            logger.info("[MobileSyncServer] ✓ mDNS scanner started");
          } catch (error) {
            logger.error("[MobileSyncServer] ✗ Failed to publish mDNS service", error);
          }

          resolve(port);
        } else {
          logger.error("[MobileSyncServer] ✗ Failed to get server address");
          reject(new Error("Failed to get server address"));
        }
      });
    });
  };

  const stop = async (): Promise<void> => {
    // Stop mDNS scanner and unpublish service
    getMdnsService().stopScanning();
    getMdnsService().unpublish();
    clearResumeReannounceTimer();
    releaseKeepAwakeBlocker();

    if (!server) {
      return;
    }

    return new Promise((resolve) => {
      server?.close(() => {
        logger.info("[MobileSyncServer] Stopped");
        server = null;
        port = 0;
        resolve();
      });
      // close() only stops new connections; drop open keep-alive/streaming ones so disabling sync is immediate.
      server?.closeAllConnections();
    });
  };

  const getPort = (): number => port;

  const isRunning = (): boolean => server?.listening === true;

  const getConnectedDevices = (): ConnectedDevice[] => {
    cleanupStaleDevices();
    return Array.from(connectedDevices.values());
  };

  return {
    start,
    stop,
    getPort,
    isRunning,
    getConnectedDevices,
  };
};

// Singleton instance
let mobileSyncServerInstance: MobileSyncServer | null = null;

export const getMobileSyncServer = (): MobileSyncServer => {
  if (!mobileSyncServerInstance) {
    mobileSyncServerInstance = createMobileSyncServer();
  }
  return mobileSyncServerInstance;
};
