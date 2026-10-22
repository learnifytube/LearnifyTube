import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import { recordVideoStarted, whereCollectionPicksUp } from "@/api/collections/current-video";

// The Current Video of Lists, Favorites and YouTube playlists (ADR-0006).
export const collectionsRouter = t.router({
  // A Video started in the player; from a collection, it becomes that collection's Current Video.
  videoStarted: publicProcedure
    .input(z.object({ videoId: z.string(), collectionId: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      await recordVideoStarted(ctx.db ?? defaultDb, input, Date.now());
    }),

  // The Video that Resume plays, and its place in the collection; null when it has none.
  pickUp: publicProcedure
    .input(z.object({ kind: z.enum(["list", "favorites", "youtube_playlist"]), id: z.string() }))
    .query(async ({ input, ctx }) => whereCollectionPicksUp(ctx.db ?? defaultDb, input)),
});
