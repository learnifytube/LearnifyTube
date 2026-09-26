import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import { logger } from "@/helpers/logger";
import { requireQueueManager } from "@/services/download-queue/queue-manager";
import { addToList } from "@/api/library/add-to-list";
import { loadLibraryVideos } from "@/api/library/library-videos";
import { loadNewFromSubscriptions } from "@/api/library/new-from-subscriptions";

export const libraryRouter = t.router({
  // Every Video in the Library (kept: fetched or on its way), with Watch state and Lists
  list: publicProcedure.query(({ ctx }) => loadLibraryVideos(ctx.db ?? defaultDb)),

  // Videos from Subscriptions the user has not kept yet, for Home's Keep row
  newFromSubscriptions: publicProcedure.query(({ ctx }) =>
    loadNewFromSubscriptions(ctx.db ?? defaultDb)
  ),

  // Keep Videos (fetch them into the Library), optionally adding them to a List as well.
  // A Video already kept or on its way is not fetched again but still goes into the List.
  keep: publicProcedure
    .input(z.object({ videoIds: z.array(z.string()).min(1), listId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const urls = input.videoIds.map((id) => `https://www.youtube.com/watch?v=${id}`);
      try {
        await requireQueueManager().addToQueue(urls);
      } catch (error) {
        const isDuplicate = typeof error === "object" && error !== null && "skippedUrls" in error;
        if (!isDuplicate) {
          logger.error("[library] keep failed", error);
          return { success: false as const, message: "Failed to keep Videos" };
        }
        // Every Video was already kept or on its way: only a List can still change
        const addedIds = "addedIds" in error && Array.isArray(error.addedIds) ? error.addedIds : [];
        if (addedIds.length === 0 && !input.listId) {
          return { success: false as const, message: "Already kept" };
        }
      }
      if (input.listId) await addToList(db, input.listId, input.videoIds);
      return { success: true as const };
    }),
});
