import { randomUUID } from "crypto";
import { access } from "fs/promises";
import { app, dialog } from "electron";
import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb, { type Database } from "@/api/db";
import { removeAppCover } from "@/api/audiobooks/covers";
import {
  MOVIE_LAYOUTS,
  classifyFolder,
  planMovieImport,
  type MovieLayout,
  type PosterSource,
} from "@/api/movies/import-plan";
import {
  findMovie,
  forgetMovie,
  listMovies,
  markMissingMovies,
  recordMoviePlayback,
  renameMovie,
  saveImportedMovies,
  setMovieWatched,
  type ImportedMovie,
} from "@/api/movies/catalog";
import { previewPoster, savePoster } from "@/api/movies/posters";
import { moviePostersDir } from "@/api/movies/posters-dir";
import { movieFiles } from "@/main/security/movie-files";
import { planSeriesImport, suggestVideoLayout } from "@/api/movies/series-plan";
import { setShownOnDevices } from "@/api/movies/shown-on-devices";
import { notifyDevicesOfMovies } from "./notify-devices";
import { previewedListings } from "./previewed-listings";
import { seriesRouter } from "./series";

// The Movies section (ADR-0005): Import, list, play and mark Movies. The user's
// video files are only ever read where they are.

const layoutSchema = z.enum(MOVIE_LAYOUTS);

const posterSourceSchema: z.ZodType<PosterSource> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("embedded"), videoPath: z.string(), stream: z.number().int() }),
  z.object({ kind: z.literal("frame"), videoPath: z.string() }),
]);

const fileExists = (filePath: string): Promise<boolean> =>
  access(filePath).then(
    () => true,
    () => false
  );

// A Movie whose file is gone shows as missing, and plays again once it is back.
const checkMovieFiles = async (db: Database): Promise<void> => {
  if ((await markMissingMovies(db, fileExists)) > 0) await notifyDevicesOfMovies();
};

const posterFile = (poster: PosterSource): string =>
  poster.kind === "file" ? poster.path : poster.videoPath;

export const moviesRouter = t.router({
  pickFolder: publicProcedure.mutation(async (): Promise<string | null> => {
    const selection = await dialog.showOpenDialog({
      title: "Import Movies",
      properties: ["openDirectory"],
    });
    return selection.canceled ? null : (selection.filePaths[0] ?? null);
  }),

  // What kind of folder it is, and every layout it could be imported as, so the
  // preview can flip without rescanning. Posters come one by one from previewPoster.
  previewImport: publicProcedure
    .input(z.object({ folderPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const listing = await previewedListings.rescan(input.folderPath);
      const layouts = Object.fromEntries(
        MOVIE_LAYOUTS.map((layout) => [layout, planMovieImport(listing, layout).movies])
      ) as Record<MovieLayout, ReturnType<typeof planMovieImport>["movies"]>;
      return {
        folderPath: input.folderPath,
        folder: classifyFolder(listing),
        suggestedLayout: suggestVideoLayout(listing),
        plans: layouts,
        seriesPlan: planSeriesImport(listing),
      };
    }),

  // Only a poster from a file of the previewed folder is read.
  previewPoster: publicProcedure
    .input(
      z.object({
        folderPath: z.string().min(1),
        poster: posterSourceSchema,
        durationSeconds: z.number().nullable(),
      })
    )
    .query(async ({ input }) => {
      const listing = previewedListings.previewed(input.folderPath);
      const known = listing?.files.some((file) => file.path === posterFile(input.poster));
      if (!known) return null;
      return previewPoster(input.folderPath, input.poster, input.durationSeconds);
    }),

  // Saves the previewed Movies. Files are referenced in place, never copied.
  confirmImport: publicProcedure
    .input(
      z.object({
        folderPath: z.string().min(1),
        layout: layoutSchema,
        // Edited titles by video path.
        titles: z.record(z.string(), z.string()).default({}),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const listing = await previewedListings.listingFor(input.folderPath);
      const postersDir = moviePostersDir(app.getPath("userData"));
      const imported: ImportedMovie[] = [];
      for (const { poster, ...movie } of planMovieImport(listing, input.layout).movies) {
        const posterPath = await savePoster(
          input.folderPath,
          poster,
          movie.durationSeconds,
          postersDir,
          randomUUID()
        ).catch(() => null);
        const title = input.titles[movie.path]?.trim() || movie.title;
        imported.push({ ...movie, title, posterPath });
      }
      const ids = await saveImportedMovies(db, input.folderPath, imported);
      previewedListings.done(input.folderPath);
      movieFiles.tracksChanged();
      await notifyDevicesOfMovies();
      return { ids };
    }),

  series: seriesRouter,

  list: publicProcedure.query(async ({ ctx }) => {
    const db = ctx.db ?? defaultDb;
    await checkMovieFiles(db);
    return listMovies(db);
  }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    const db = ctx.db ?? defaultDb;
    await checkMovieFiles(db);
    return findMovie(db, input.id);
  }),

  rename: publicProcedure
    .input(z.object({ id: z.string(), title: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await renameMovie(ctx.db ?? defaultDb, input.id, input.title);
      await notifyDevicesOfMovies();
    }),

  // The desktop player's progress, saved now and then and when it pauses or closes.
  recordPlayback: publicProcedure
    .input(
      z.object({
        movieId: z.string(),
        positionSeconds: z.number().min(0),
        durationSeconds: z.number().positive().nullable().optional(),
      })
    )
    .mutation(({ input, ctx }) => recordMoviePlayback(ctx.db ?? defaultDb, input)),

  setWatched: publicProcedure
    .input(z.object({ id: z.string(), watched: z.boolean() }))
    .mutation(({ input, ctx }) => setMovieWatched(ctx.db ?? defaultDb, input.id, input.watched)),

  // Removes the Movie from the app only. The video file is never deleted, moved or
  // modified; only the app's own poster copy goes.
  forget: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const forgotten = await forgetMovie(ctx.db ?? defaultDb, input.id);
    if (!forgotten) return;
    movieFiles.tracksChanged();
    await notifyDevicesOfMovies();
    await removeAppCover(forgotten.posterPath, moviePostersDir(app.getPath("userData")));
  }),

  // Shown on Devices, for a Movie or a whole Series. Switched off, Devices no
  // longer list it or get its files, and their Mirror removes it.
  setShownOnDevices: publicProcedure
    .input(z.object({ kind: z.enum(["movie", "series"]), id: z.string(), shown: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const title = { kind: input.kind, id: input.id };
      const changed = await setShownOnDevices(ctx.db ?? defaultDb, title, input.shown);
      if (changed) await notifyDevicesOfMovies();
    }),
});
