import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import { requireQueueManager } from "@/services/download-queue/queue-manager";
import { keepVideos } from "@/api/library/keep";
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
    .mutation(({ input, ctx }) =>
      keepVideos(ctx.db ?? defaultDb, requireQueueManager(), input.videoIds, input.listId)
    ),
});
