import { randomUUID } from "crypto";
import { app, dialog } from "electron";
import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import type { FolderListing } from "@/api/audiobooks/import-plan";
import { scanFolder } from "@/api/audiobooks/scan-folder";
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
  recordMoviePlayback,
  renameMovie,
  saveImportedMovies,
  setMovieWatched,
  type ImportedMovie,
} from "@/api/movies/catalog";
import { previewPoster, savePoster } from "@/api/movies/posters";
import { moviePostersDir } from "@/api/movies/posters-dir";
import { movieFiles } from "@/main/security/movie-files";

// The Movies section (ADR-0005): Import, list, play and mark Movies. The user's
// video files are only ever read where they are.

const layoutSchema = z.enum(MOVIE_LAYOUTS);

const posterSourceSchema: z.ZodType<PosterSource> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("embedded"), videoPath: z.string(), stream: z.number().int() }),
  z.object({ kind: z.literal("frame"), videoPath: z.string() }),
]);

// The last folder listing previewed per picked folder, so confirming saves what was previewed.
const previewedListingsByFolder = new Map<string, FolderListing>();

const listingFor = async (folderPath: string): Promise<FolderListing> => {
  const cached = previewedListingsByFolder.get(folderPath);
  if (cached) return cached;
  const listing = await scanFolder(folderPath);
  previewedListingsByFolder.set(folderPath, listing);
  return listing;
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
      previewedListingsByFolder.delete(input.folderPath);
      const listing = await listingFor(input.folderPath);
      const layouts = Object.fromEntries(
        MOVIE_LAYOUTS.map((layout) => [layout, planMovieImport(listing, layout).movies])
      ) as Record<MovieLayout, ReturnType<typeof planMovieImport>["movies"]>;
      return {
        folderPath: input.folderPath,
        folder: classifyFolder(listing),
        suggestedLayout: planMovieImport(listing).suggestedLayout,
        plans: layouts,
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
      const listing = previewedListingsByFolder.get(input.folderPath);
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
      const listing = await listingFor(input.folderPath);
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
      previewedListingsByFolder.delete(input.folderPath);
      movieFiles.tracksChanged();
      return { ids };
    }),

  list: publicProcedure.query(({ ctx }) => listMovies(ctx.db ?? defaultDb)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input, ctx }) => findMovie(ctx.db ?? defaultDb, input.id)),

  rename: publicProcedure
    .input(z.object({ id: z.string(), title: z.string().trim().min(1) }))
    .mutation(({ input, ctx }) => renameMovie(ctx.db ?? defaultDb, input.id, input.title)),

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
    await removeAppCover(forgotten.posterPath, moviePostersDir(app.getPath("userData")));
  }),
});
