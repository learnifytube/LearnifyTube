import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { logger } from "../helpers/logger";
import { resolveWithinAllowed } from "./security/path-confinement";
import { getAllowedBaseDirs } from "./security/allowed-dirs";

/**
 * Simple HTTP server for streaming local video files to the renderer.
 * This avoids Chromium demuxer issues with custom protocols.
 */

type MediaServer = {
  start: () => Promise<number>;
  stop: () => Promise<void>;
  getMediaUrl: (filePath: string) => string;
  getPort: () => number;
};

const createMediaServer = (): MediaServer => {
  let server: http.Server | null = null;
  let port = 0;

  const handleRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    const url = req.url;
    if (!url) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    // Extract file path from URL (format: /media?path=<encoded-path>)
    const urlObj = new URL(url, "http://localhost");
    const filePath = urlObj.searchParams.get("path");

    if (!filePath) {
      res.writeHead(400);
      res.end("Missing path parameter");
      return;
    }

    // Decode and confine to allowed download/cache directories.
    const decodedPath = decodeURIComponent(filePath);
    const confinement = resolveWithinAllowed(decodedPath, getAllowedBaseDirs());
    if (!confinement.ok) {
      const statusCode = confinement.reason === "not-found" ? 404 : 403;
      logger.warn(`[MediaServer] Request rejected`, {
        decodedPath,
        reason: confinement.reason,
        statusCode,
      });
      res.writeHead(statusCode);
      res.end(statusCode === 404 ? "File not found" : "Access denied");
      return;
    }
    const resolvedPath = confinement.realPath;

    // Check read permissions
    try {
      fs.accessSync(resolvedPath, fs.constants.R_OK);
    } catch (err) {
      logger.error(`[MediaServer] Access denied: ${resolvedPath}`, err);
      res.writeHead(403);
      res.end("Access denied");
      return;
    }

    // Get file stats
    const stat = fs.statSync(resolvedPath);
    const fileSize = stat.size;

    // Determine content type
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType =
      ext === ".mp4"
        ? "video/mp4"
        : ext === ".webm"
          ? "video/webm"
          : ext === ".mkv"
            ? "video/x-matroska"
            : ext === ".mp3"
              ? "audio/mpeg"
              : "application/octet-stream";

    // Handle range requests (crucial for video seeking)
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      logger.debug(`[MediaServer] Range request: ${start}-${end}/${fileSize} for ${resolvedPath}`);

      const fileStream = fs.createReadStream(resolvedPath, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      });

      fileStream.pipe(res);

      fileStream.on("error", (err) => {
        logger.error(`[MediaServer] Stream error: ${resolvedPath}`, err);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    } else {
      // Full file response
      logger.debug(`[MediaServer] Full file request: ${resolvedPath} (${fileSize} bytes)`);

      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      });

      const fileStream = fs.createReadStream(resolvedPath);
      fileStream.pipe(res);

      fileStream.on("error", (err) => {
        logger.error(`[MediaServer] Stream error: ${resolvedPath}`, err);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    }
  };

  const start = async (): Promise<number> => {
    if (server) {
      return port;
    }

    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
          logger.error("[MediaServer] Request handler error", err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal server error");
          }
        });
      });

      server.on("error", (err) => {
        logger.error("[MediaServer] Server error", err);
        reject(err);
      });

      // Listen on localhost only (random available port)
      server.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        if (address && typeof address === "object") {
          port = address.port;
          logger.info(`[MediaServer] Started on http://127.0.0.1:${port}`);
          resolve(port);
        } else {
          reject(new Error("Failed to get server address"));
        }
      });
    });
  };

  const getMediaUrl = (filePath: string): string => {
    if (!port) {
      throw new Error("Media server not started");
    }
    const encodedPath = encodeURIComponent(filePath);
    return `http://127.0.0.1:${port}/media?path=${encodedPath}`;
  };

  const stop = async (): Promise<void> => {
    if (!server) {
      return;
    }

    return new Promise((resolve) => {
      server?.close(() => {
        logger.info("[MediaServer] Stopped");
        server = null;
        port = 0;
        resolve();
      });
    });
  };

  const getPort = (): number => port;

  return {
    start,
    stop,
    getMediaUrl,
    getPort,
  };
};

// Singleton instance
let mediaServerInstance: MediaServer | null = null;

export const getMediaServer = (): MediaServer => {
  if (!mediaServerInstance) {
    mediaServerInstance = createMediaServer();
  }
  return mediaServerInstance;
};
