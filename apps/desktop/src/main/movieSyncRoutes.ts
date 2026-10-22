import * as http from "http";
import * as path from "path";
import { logger } from "../helpers/logger";
import type { Database } from "../api/db";
import { seriesLastEpisodeSchema, type MovieKind } from "../../../shared/mobile-sync-contract";
import { recordDeviceLastEpisodes } from "../api/movies/device-watch";
import {
  findMovieFileForDevices,
  findPosterForDevices,
  loadMovieCatalog,
} from "../api/movies/device-catalog";
import { findCaptionForDevices } from "../api/movies/captions";
import { readCaptionAsWebVtt } from "../api/movies/caption-file";
import {
  resolveCaptionFile,
  resolveMovieFile,
  resolveWithinAllowed,
} from "./security/path-confinement";
import { getAllowedBaseDirs } from "./security/allowed-dirs";
import { IMAGE_CONTENT_TYPES, serveFileWithRanges, serveImage } from "./serve-file";

type MovieSyncRoutesDeps = {
  db: Database;
  /** An absolute URL (with the pairing token) for a desktop path. */
  assetUrl: (pathname: string) => string;
  sendJson: (res: http.ServerResponse, data: unknown, statusCode?: number) => void;
  sendError: (res: http.ServerResponse, message: string, statusCode?: number) => void;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  /** Tells Devices to refetch the Movie catalog. */
  announceMoviesChanged: () => void;
};

/**
 * The sync routes for Movies and Series (ADR-0005): the catalog, each Movie's
 * and Episode's file (by id, with Range support for seeking), Captions and posters. A
 * title that isn't Shown on Devices is neither listed nor served. A Device posts
 * a Series' last Episode live as it starts an Episode (ADR-0006).
 */
export const createMovieSyncRoutes = ({
  db,
  assetUrl,
  sendJson,
  sendError,
  readBody,
  announceMoviesChanged,
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

  // Every Caption goes out as WebVTT, whether its file is .srt or .vtt.
  const handleCaption = async (res: http.ServerResponse, id: string): Promise<void> => {
    const file = await resolveCaptionFile(id, (captionId) => findCaptionForDevices(db, captionId));
    if (!file.ok) {
      logger.warn("[MobileSyncServer] Refused Caption file", { id, ...file });
      sendError(res, "Not found", 404);
      return;
    }
    const vtt = await readCaptionAsWebVtt(file.realPath);
    res.writeHead(200, { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(vtt);
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

  // A Device started an Episode: the newest last Episode is kept, and the other
  // Devices refetch the catalog so they resume it too.
  const handleLastEpisode = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    seriesId: string
  ): Promise<void> => {
    const body: unknown = JSON.parse(await readBody(req));
    const parsed = seriesLastEpisodeSchema.safeParse(body);
    if (!parsed.success || parsed.data.seriesId !== seriesId) {
      sendError(res, "Invalid last Episode", 400);
      return;
    }
    if (await recordDeviceLastEpisodes(db, [parsed.data])) announceMoviesChanged();
    sendJson(res, { success: true });
  };

  const postRoute = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> => {
    const lastEpisodeMatch = pathname.match(/^\/api\/series\/([^/]+)\/last-episode$/);
    if (!lastEpisodeMatch) return false;
    await handleLastEpisode(req, res, decodeURIComponent(lastEpisodeMatch[1]));
    return true;
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
      if (pathname === "/api/movies") {
        sendJson(res, await loadMovieCatalog(db, assetUrl));
        return true;
      }
      const fileMatch = pathname.match(/^\/api\/(movie|episode)\/([^/]+)\/file$/);
      if (fileMatch) {
        await handleFile(req, res, fileMatch[1] as MovieKind, decodeURIComponent(fileMatch[2]));
        return true;
      }
      const captionMatch = pathname.match(/^\/api\/caption\/([^/]+)$/);
      if (captionMatch) {
        await handleCaption(res, decodeURIComponent(captionMatch[1]));
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
