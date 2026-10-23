import * as http from "http";
import * as path from "path";
import { logger } from "../helpers/logger";
import type { Database } from "../api/db";
import {
  findAudiobookCoverPath,
  findTrackFilePath,
  loadAudiobookCatalog,
} from "../api/audiobooks/catalog";
import { announceIfSent, recordListening } from "../api/audiobooks/listening";
import { recordTrackPosition } from "../api/audiobooks/track-positions";
import {
  audiobookListeningSchema,
  audiobookTrackPositionSchema,
} from "../../../shared/mobile-sync-contract";
import { resolveAudiobookTrackFile, resolveWithinAllowed } from "./security/path-confinement";
import { getAllowedBaseDirs } from "./security/allowed-dirs";
import { IMAGE_CONTENT_TYPES, serveFileWithRanges, serveImage } from "./serve-file";

type AudiobookSyncRoutesDeps = {
  db: Database;
  /** An absolute URL (with the pairing token) for a desktop path. */
  assetUrl: (pathname: string) => string;
  sendJson: (res: http.ServerResponse, data: unknown, statusCode?: number) => void;
  sendError: (res: http.ServerResponse, message: string, statusCode?: number) => void;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  /** Tells connected Devices to refetch the sent Audiobooks (SSE). */
  announceAudiobooksChanged: () => void;
};

/**
 * The sync routes for Audiobooks: the catalog, each Track's file (by Track id,
 * with Range support for seeking) and covers.
 */
export const createAudiobookSyncRoutes = ({
  db,
  assetUrl,
  sendJson,
  sendError,
  readBody,
  announceAudiobooksChanged,
}: AudiobookSyncRoutesDeps): {
  /** Serves an Audiobook route; false when the URL isn't one. */
  route: (req: http.IncomingMessage, res: http.ServerResponse, url: string) => Promise<boolean>;
} => {
  const handleCatalog = async (res: http.ServerResponse): Promise<void> => {
    sendJson(res, await loadAudiobookCatalog(db, assetUrl));
  };

  const handleTrackFile = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    trackId: string
  ): Promise<void> => {
    const file = await resolveAudiobookTrackFile(trackId, (id) => findTrackFilePath(db, id));
    if (!file.ok) {
      logger.warn("[MobileSyncServer] Refused Audiobook Track file", { trackId, ...file });
      sendError(res, "Track not found", 404);
      return;
    }
    serveFileWithRanges(req, res, file.realPath, file.contentType);
  };

  const handleCover = async (res: http.ServerResponse, audiobookId: string): Promise<void> => {
    const coverPath = await findAudiobookCoverPath(db, audiobookId);
    const cover = coverPath ? resolveWithinAllowed(coverPath, getAllowedBaseDirs()) : null;
    if (!cover?.ok) {
      sendError(res, "Cover not found", 404);
      return;
    }
    serveImage(
      res,
      cover.realPath,
      IMAGE_CONTENT_TYPES[path.extname(cover.realPath).toLowerCase()] ?? "application/octet-stream"
    );
  };

  // A Device's Listening position while it plays; the newest one is kept.
  const handleListening = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    audiobookId: string
  ): Promise<void> => {
    const body: unknown = JSON.parse(await readBody(req));
    const parsed = audiobookListeningSchema.safeParse(body);
    if (!parsed.success || parsed.data.audiobookId !== audiobookId) {
      sendError(res, "Invalid Listening position", 400);
      return;
    }
    await recordListening(db, parsed.data);
    sendJson(res, { success: true });
  };

  // A Device's Track position while it plays (resume, v5): the newest one is kept,
  // and the other Devices refetch the catalog so they resume the Track there too.
  const handleTrackPosition = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    audiobookId: string
  ): Promise<void> => {
    const body: unknown = JSON.parse(await readBody(req));
    const parsed = audiobookTrackPositionSchema.safeParse(body);
    if (!parsed.success || parsed.data.audiobookId !== audiobookId) {
      sendError(res, "Invalid Track position", 400);
      return;
    }
    if (await recordTrackPosition(db, parsed.data)) {
      await announceIfSent(db, audiobookId, announceAudiobooksChanged);
    }
    sendJson(res, { success: true });
  };

  const postRoute = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> => {
    const listeningMatch = pathname.match(/^\/api\/audiobook\/([^/]+)\/listening$/);
    if (listeningMatch) {
      await handleListening(req, res, decodeURIComponent(listeningMatch[1]));
      return true;
    }
    const trackPositionMatch = pathname.match(/^\/api\/audiobook\/([^/]+)\/track-position$/);
    if (trackPositionMatch) {
      await handleTrackPosition(req, res, decodeURIComponent(trackPositionMatch[1]));
      return true;
    }
    return false;
  };

  const route = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string
  ): Promise<boolean> => {
    if (req.method !== "GET" && req.method !== "POST") return false;
    const pathname = url.split("?")[0];
    try {
      if (req.method === "POST") return await postRoute(req, res, pathname);
      if (pathname === "/api/audiobooks") {
        await handleCatalog(res);
        return true;
      }
      const trackMatch = pathname.match(/^\/api\/audiobook-track\/([^/]+)\/file$/);
      if (trackMatch) {
        await handleTrackFile(req, res, decodeURIComponent(trackMatch[1]));
        return true;
      }
      const coverMatch = pathname.match(/^\/api\/audiobook\/([^/]+)\/cover$/);
      if (coverMatch) {
        await handleCover(res, decodeURIComponent(coverMatch[1]));
        return true;
      }
    } catch (error) {
      logger.error("[MobileSyncServer] Audiobook route failed", { url, error });
      if (!res.headersSent) sendError(res, "Failed to serve Audiobooks");
      return true;
    }
    return false;
  };

  return { route };
};
