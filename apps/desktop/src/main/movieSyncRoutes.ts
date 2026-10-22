import * as http from "http";
import * as path from "path";
import { logger } from "../helpers/logger";
import type { Database } from "../api/db";
import {
  findMovieFileForDevices,
  findPosterForDevices,
  loadMovieCatalog,
  type MovieKind,
} from "../api/movies/device-catalog";
import { resolveMovieFile, resolveWithinAllowed } from "./security/path-confinement";
import { getAllowedBaseDirs } from "./security/allowed-dirs";
import { IMAGE_CONTENT_TYPES, serveFileWithRanges, serveImage } from "./serve-file";

type MovieSyncRoutesDeps = {
  db: Database;
  /** An absolute URL (with the pairing token) for a desktop path. */
  assetUrl: (pathname: string) => string;
  sendJson: (res: http.ServerResponse, data: unknown, statusCode?: number) => void;
  sendError: (res: http.ServerResponse, message: string, statusCode?: number) => void;
};

/**
 * The sync routes for Movies and Series (ADR-0005): the catalog, each Movie's
 * and Episode's file (by id, with Range support for seeking) and posters. A
 * title that isn't Shown on Devices is neither listed nor served.
 */
export const createMovieSyncRoutes = ({
  db,
  assetUrl,
  sendJson,
  sendError,
}: MovieSyncRoutesDeps): {
  /** Serves a Movie route; false when the URL isn't one. */
  route: (req: http.IncomingMessage, res: http.ServerResponse, url: string) => Promise<boolean>;
} => {
  const handleFile = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    kind: MovieKind,
    id: string
  ): Promise<void> => {
    const file = await resolveMovieFile(id, (titleId) =>
      findMovieFileForDevices(db, kind, titleId)
    );
    if (!file.ok) {
      logger.warn("[MobileSyncServer] Refused Movie file", { kind, id, ...file });
      sendError(res, "Not found", 404);
      return;
    }
    serveFileWithRanges(req, res, file.realPath, file.contentType);
  };

  const handlePoster = async (
    res: http.ServerResponse,
    kind: "movie" | "series",
    id: string
  ): Promise<void> => {
    const posterPath = await findPosterForDevices(db, kind, id);
    const poster = posterPath ? resolveWithinAllowed(posterPath, getAllowedBaseDirs()) : null;
    if (!poster?.ok) {
      sendError(res, "Poster not found", 404);
      return;
    }
    serveImage(
      res,
      poster.realPath,
      IMAGE_CONTENT_TYPES[path.extname(poster.realPath).toLowerCase()] ?? "application/octet-stream"
    );
  };

  const route = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string
  ): Promise<boolean> => {
    if (req.method !== "GET") return false;
    const pathname = url.split("?")[0];
    try {
      if (pathname === "/api/movies") {
        sendJson(res, await loadMovieCatalog(db, assetUrl));
        return true;
      }
      const fileMatch = pathname.match(/^\/api\/(movie|episode)\/([^/]+)\/file$/);
      if (fileMatch) {
        await handleFile(req, res, fileMatch[1] as MovieKind, decodeURIComponent(fileMatch[2]));
        return true;
      }
      const posterMatch = pathname.match(/^\/api\/(movie|series)\/([^/]+)\/poster$/);
      if (posterMatch) {
        await handlePoster(
          res,
          posterMatch[1] as "movie" | "series",
          decodeURIComponent(posterMatch[2])
        );
        return true;
      }
    } catch (error) {
      logger.error("[MobileSyncServer] Movie route failed", { url, error });
      if (!res.headersSent) sendError(res, "Failed to serve Movies");
      return true;
    }
    return false;
  };

  return { route };
};
