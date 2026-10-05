import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import {
  listSubscriptions,
  loadSubscriptionVideos,
  setSubscribed,
} from "@/api/library/subscriptions";

export const subscriptionsRouter = t.router({
  // The Channels the user subscribed to
  list: publicProcedure.query(({ ctx }) => listSubscriptions(ctx.db ?? defaultDb)),

  // Videos from Subscriptions, balanced across Channels, for the Subscriptions page
  videos: publicProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).optional(),
          offset: z.number().min(0).optional(),
        })
        .optional()
    )
    .query(({ input, ctx }) => loadSubscriptionVideos(ctx.db ?? defaultDb, input)),

  set: publicProcedure
    .input(z.object({ channelId: z.string(), subscribed: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const found = await setSubscribed(ctx.db ?? defaultDb, input.channelId, input.subscribed);
      return found
        ? { success: true as const }
        : { success: false as const, message: "Channel not found" };
    }),
});
