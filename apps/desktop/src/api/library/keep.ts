import type { Database } from "@/api/db";
import { logger } from "@/helpers/logger";
import { addToList } from "./add-to-list";

// The part of the download queue that keeping needs
export type KeepQueue = { addToQueue: (urls: string[]) => Promise<unknown> };

type KeepResult =
  | { success: true }
  | { success: false; reason: "failed" | "already-kept"; message: string };

// Keep Videos (fetch them into the Library), optionally adding them to a List as well.
// A Video already kept or on its way is not fetched again but still goes into the List.
export const keepVideos = async (
  db: Database,
  queue: KeepQueue,
  videoIds: string[],
  listId?: string
): Promise<KeepResult> => {
  const urls = videoIds.map((id) => `https://www.youtube.com/watch?v=${id}`);
  try {
    await queue.addToQueue(urls);
  } catch (error) {
    const isDuplicate = typeof error === "object" && error !== null && "skippedUrls" in error;
    if (!isDuplicate) {
      logger.error("[library] keep failed", error);
      return { success: false, reason: "failed", message: "Failed to keep Videos" };
    }
    // Every Video was already kept or on its way: only a List can still change
    const addedIds = "addedIds" in error && Array.isArray(error.addedIds) ? error.addedIds : [];
    if (addedIds.length === 0 && !listId) {
      return { success: false, reason: "already-kept", message: "Already kept" };
    }
  }
  if (listId) await addToList(db, listId, videoIds);
  return { success: true };
};
