import * as fs from "fs";
import * as http from "http";
import { pipeline } from "stream";
import { logger } from "../helpers/logger";
import { parseByteRange, type ByteRange } from "./byte-range";

const streamFile = (res: http.ServerResponse, filePath: string, range?: ByteRange): void => {
  pipeline(fs.createReadStream(filePath, range), res, (err) => {
    if (!err || err.code === "ERR_STREAM_PREMATURE_CLOSE") return;
    logger.error("[MobileSyncServer] File stream error", { filePath, error: err });
  });
};

/**
 * Serves an already-confined file whole, or the byte range the request asks for
 * (206, or 416 for a range outside the file), so players can seek.
 */
export const serveFileWithRanges = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  realPath: string,
  contentType: string
): void => {
  const size = fs.statSync(realPath).size;
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  };
  const rangeHeader = req.headers.range;
  if (!rangeHeader) {
    res.writeHead(200, { ...headers, "Content-Length": size });
    streamFile(res, realPath);
    return;
  }
  const range = parseByteRange(rangeHeader, size);
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
  streamFile(res, realPath, range);
};

/** Serves an already-confined image whole, cached for a day. */
export const serveImage = (
  res: http.ServerResponse,
  realPath: string,
  contentType: string
): void => {
  res.writeHead(200, {
    "Content-Length": fs.statSync(realPath).size,
    "Content-Type": contentType,
    "Cache-Control": "max-age=86400",
  });
  streamFile(res, realPath);
};

export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
