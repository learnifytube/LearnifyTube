import { randomUUID } from "crypto";
import { app } from "electron";
import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import { removeAppCover } from "@/api/audiobooks/covers";
import { planSeriesImport, reorderSeries } from "@/api/movies/series-plan";
import {
  forgetSeries,
  getSeries,
  listSeries,
  recordEpisodePlayback,
  renameSeries,
  saveImportedSeries,
  setEpisodesWatched,
} from "@/api/movies/series-catalog";
import { savePoster } from "@/api/movies/posters";
import { moviePostersDir } from "@/api/movies/posters-dir";
import { movieFiles } from "@/main/security/movie-files";
import { broadcastMoviesChanged } from "./notify-devices";
import { previewedListings } from "./previewed-listings";

// Series in the Movies section (ADR-0005): Import, list, play and mark Episodes.
// The user's video files are only ever read where they are.

const targetSchema = z.union([
  z.object({ episodeId: z.string() }),
  z.object({ seasonId: z.string() }),
  z.object({ seriesId: z.string() }),
]);

export const seriesRouter = t.router({
  // Saves the previewed Series in the order the user corrected it to.
  confirmImport: publicProcedure
    .input(
      z.object({
        folderPath: z.string().min(1),
        title: z.string().optional(),
        // Seasons by plan key, each with its Episodes' paths, in order.
        order: z.array(z.object({ key: z.string(), episodes: z.array(z.string()) })),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const listing = await previewedListings.listingFor(input.folderPath);
      const plan = reorderSeries(planSeriesImport(listing), input.order);
      if (plan.seasons.length === 0) return { id: null };
      const posterPath = await savePoster(
        input.folderPath,
        plan.poster,
        plan.seasons[0].episodes[0]?.durationSeconds ?? null,
        moviePostersDir(app.getPath("userData")),
        randomUUID()
      ).catch(() => null);
      const id = await saveImportedSeries(db, input.folderPath, {
        title: input.title?.trim() || plan.title,
        posterPath,
        seasons: plan.seasons,
      });
      previewedListings.done(input.folderPath);
      movieFiles.tracksChanged();
      await broadcastMoviesChanged();
      return { id };
    }),

  list: publicProcedure.query(({ ctx }) => listSeries(ctx.db ?? defaultDb)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input, ctx }) => getSeries(ctx.db ?? defaultDb, input.id)),

  rename: publicProcedure
    .input(z.object({ id: z.string(), title: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await renameSeries(ctx.db ?? defaultDb, input.id, input.title);
      await broadcastMoviesChanged();
    }),

  // The desktop player's progress on an Episode.
  recordPlayback: publicProcedure
    .input(
      z.object({
        episodeId: z.string(),
        positionSeconds: z.number().min(0),
        durationSeconds: z.number().positive().nullable().optional(),
      })
    )
    .mutation(({ input, ctx }) => recordEpisodePlayback(ctx.db ?? defaultDb, input)),

  // Marks one Episode, a Season or the whole Series.
  setWatched: publicProcedure
    .input(z.object({ target: targetSchema, watched: z.boolean() }))
    .mutation(({ input, ctx }) =>
      setEpisodesWatched(ctx.db ?? defaultDb, input.target, input.watched)
    ),

  // Removes the Series from the app only; its files are never touched.
  forget: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const forgotten = await forgetSeries(ctx.db ?? defaultDb, input.id);
    if (!forgotten) return;
    movieFiles.tracksChanged();
    await broadcastMoviesChanged();
    await removeAppCover(forgotten.posterPath, moviePostersDir(app.getPath("userData")));
  }),
});
