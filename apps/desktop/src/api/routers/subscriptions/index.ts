import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import {
  listSubscriptions,
  loadSubscriptionVideos,
  setSubscribed,
} from "@/api/library/subscriptions";
import { getAutoKeep, setAutoKeep, takeAutoKeepBaseline } from "@/api/library/auto-keep";
import { autoKeepDeps } from "@/services/auto-keep";

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

  // A Subscription's Auto-keep: on or off, target List, last check
  autoKeep: publicProcedure
    .input(z.object({ channelId: z.string() }))
    .query(({ input, ctx }) => getAutoKeep(ctx.db ?? defaultDb, input.channelId)),

  // Switch Auto-keep on or off, or pick its target List (null: Library only). Switching on
  // takes the baseline straight away, so it waits for YouTube.
  setAutoKeep: publicProcedure
    .input(
      z.object({
        channelId: z.string(),
        enabled: z.boolean(),
        listId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { channelId, ...settings } = input;
      const db = ctx.db ?? defaultDb;
      const outcome = await setAutoKeep(db, channelId, settings);
      if (outcome === "not-subscribed") {
        return { success: false as const, message: "Subscribe to the Channel first" };
      }
      if (outcome === "switched-on") await takeAutoKeepBaseline(db, channelId, autoKeepDeps(db));
      return { success: true as const };
    }),
});
