import * as http from "http";
import { logger } from "../helpers/logger";
import type { Database } from "../api/db";
import { recordCurrentVideo } from "../api/collections/current-video";
import {
  COLLECTION_CURRENT_VIDEO_PATH,
  currentVideoSchema,
} from "../../../shared/mobile-sync-contract";

type CollectionSyncRoutesDeps = {
  db: Database;
  sendJson: (res: http.ServerResponse, data: unknown, statusCode?: number) => void;
  sendError: (res: http.ServerResponse, message: string, statusCode?: number) => void;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  /** Tells connected Devices a Current Video changed (SSE). */
  announceCurrentVideosChanged: () => void;
};

/**
 * POST /api/collection/current-video: a Device started a Video in a List or
 * YouTube playlist while connected. The newest Current Video is kept (ADR-0006)
 * and the other Devices are told, so a screen showing that collection resumes there.
 */
export const createCollectionSyncRoutes = ({
  db,
  sendJson,
  sendError,
  readBody,
  announceCurrentVideosChanged,
}: CollectionSyncRoutesDeps): {
  /** Serves the route; false when the request isn't it. */
  route: (req: http.IncomingMessage, res: http.ServerResponse, url: string) => Promise<boolean>;
} => {
  const route = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string
  ): Promise<boolean> => {
    if (req.method !== "POST" || url !== COLLECTION_CURRENT_VIDEO_PATH) return false;
    try {
      const body: unknown = JSON.parse(await readBody(req));
      const parsed = currentVideoSchema.safeParse(body);
      if (!parsed.success) {
        sendError(res, "Invalid Current Video", 400);
        return true;
      }
      const kept = await recordCurrentVideo(db, parsed.data);
      if (kept) announceCurrentVideosChanged();
      sendJson(res, { success: true, kept });
    } catch (error) {
      logger.error("[MobileSyncServer] Error recording Current Video", error);
      sendError(res, "Failed to record Current Video");
    }
    return true;
  };

  return { route };
};
