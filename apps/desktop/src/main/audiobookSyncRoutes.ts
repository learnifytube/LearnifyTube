import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { pipeline } from "stream";
import { logger } from "../helpers/logger";
import type { Database } from "../api/db";
import {
  findAudiobookCoverPath,
  findTrackFilePath,
  loadAudiobookCatalog,
} from "../api/audiobooks/catalog";
import { resolveAudiobookTrackFile, resolveWithinAllowed } from "./security/path-confinement";
import { getAllowedBaseDirs } from "./security/allowed-dirs";

type AudiobookSyncRoutesDeps = {
  db: Database;
  /** An absolute URL (with the pairing token) for a desktop path. */
  assetUrl: (pathname: string) => string;
  sendJson: (res: http.ServerResponse, data: unknown, statusCode?: number) => void;
  sendError: (res: http.ServerResponse, message: string, statusCode?: number) => void;
};

const COVER_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const streamFile = (
  res: http.ServerResponse,
  filePath: string,
  range?: { start: number; end: number }
): void => {
  pipeline(fs.createReadStream(filePath, range), res, (err) => {
    if (!err || err.code === "ERR_STREAM_PREMATURE_CLOSE") return;
    logger.error("[MobileSyncServer] Audiobook stream error", { filePath, error: err });
  });
};

// "bytes=start-end", "bytes=start-" or "bytes=-suffix"; null when unsatisfiable.
const parseRange = (header: string, size: number): { start: number; end: number } | null => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  const start = match[1] === "" ? Math.max(size - Number(match[2]), 0) : Number(match[1]);
  const end = match[1] === "" || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start <= end && start < size ? { start, end } : null;
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
}: AudiobookSyncRoutesDeps): {
  handle: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string,
    notFound: () => void
  ) => Promise<void>;
} => {
  const handleCatalog = async (res: http.ServerResponse): Promise<void> => {
    sendJson(
      res,
      await loadAudiobookCatalog(db, (id) => assetUrl(`/api/audiobook/${id}/cover`))
    );
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
    const size = fs.statSync(file.realPath).size;
    const headers = {
      "Accept-Ranges": "bytes",
      "Content-Type": file.contentType,
      "Cache-Control": "no-cache",
    };
    const rangeHeader = req.headers.range;
    if (!rangeHeader) {
      res.writeHead(200, { ...headers, "Content-Length": size });
      streamFile(res, file.realPath);
      return;
    }
    const range = parseRange(rangeHeader, size);
    if (!range) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Content-Length": range.end - range.start + 1,
    });
    streamFile(res, file.realPath, range);
  };

  const handleCover = async (res: http.ServerResponse, audiobookId: string): Promise<void> => {
    const coverPath = await findAudiobookCoverPath(db, audiobookId);
    const cover = coverPath ? resolveWithinAllowed(coverPath, getAllowedBaseDirs()) : null;
    if (!cover?.ok) {
      sendError(res, "Cover not found", 404);
      return;
    }
    res.writeHead(200, {
      "Content-Length": fs.statSync(cover.realPath).size,
      "Content-Type":
        COVER_CONTENT_TYPES[path.extname(cover.realPath).toLowerCase()] ??
        "application/octet-stream",
      "Cache-Control": "max-age=86400",
    });
    streamFile(res, cover.realPath);
  };

  const route = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string
  ): Promise<boolean> => {
    if (req.method !== "GET") return false;
    const pathname = url.split("?")[0];
    try {
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

  // Serves an Audiobook route, or calls notFound for any other URL.
  const handle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string,
    notFound: () => void
  ): Promise<void> => {
    if (!(await route(req, res, url))) notFound();
  };

  return { handle };
};
