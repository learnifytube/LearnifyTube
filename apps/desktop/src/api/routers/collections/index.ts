import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import { recordVideoStarted, whereCollectionPicksUp } from "@/api/collections/current-video";
import {
  collectionKindSchema,
  type CollectionKind,
} from "../../../../../shared/mobile-sync-contract";

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
    .input(
      z.object({
        // The contract's schema is zod 4; this router's zod is 3, so it can't nest directly.
        kind: z.custom<CollectionKind>((value) => collectionKindSchema.safeParse(value).success),
        id: z.string(),
      })
    )
    .query(async ({ input, ctx }) => whereCollectionPicksUp(ctx.db ?? defaultDb, input)),
});
