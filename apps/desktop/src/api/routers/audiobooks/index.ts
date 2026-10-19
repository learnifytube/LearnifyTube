import { randomUUID } from "crypto";
import path from "path";
import { app, dialog } from "electron";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import { audiobooks, audiobookTracks } from "@/api/db/schema";
import {
  planImport,
  type FolderListing,
  type ImportMode,
  type ProposedTrack,
} from "@/api/audiobooks/import-plan";
import { scanFolder } from "@/api/audiobooks/scan-folder";
import { audiobookCoversDir } from "@/api/audiobooks/covers-dir";
import { previewCover, saveCover } from "@/api/audiobooks/covers";

const importModeSchema = z.enum(["one-book", "each-subfolder"]);

type PreviewBook = {
  folder: string;
  title: string;
  author: string | null;
  coverDataUrl: string | null;
  tracks: ProposedTrack[];
};

// The last folder listing per picked folder, so confirming saves what was previewed.
const listings = new Map<string, FolderListing>();

const listingFor = async (folderPath: string): Promise<FolderListing> => {
  const cached = listings.get(folderPath);
  if (cached) return cached;
  const listing = await scanFolder(folderPath);
  listings.set(folderPath, listing);
  return listing;
};

export const audiobooksRouter = t.router({
  pickFolder: publicProcedure.mutation(async (): Promise<string | null> => {
    const selection = await dialog.showOpenDialog({
      title: "Import Audiobooks",
      properties: ["openDirectory"],
    });
    return selection.canceled ? null : (selection.filePaths[0] ?? null);
  }),

  // Both ways the folder could be imported, so the preview can flip without rescanning.
  previewImport: publicProcedure
    .input(z.object({ folderPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      listings.delete(input.folderPath);
      const listing = await listingFor(input.folderPath);
      const covers = new Map<string, Promise<string | null>>();
      const toPreview = (mode: ImportMode): Promise<PreviewBook[]> =>
        Promise.all(
          planImport(listing, mode).books.map(async (book) => {
            const key = JSON.stringify(book.cover);
            if (!covers.has(key)) covers.set(key, previewCover(input.folderPath, book.cover));
            return {
              folder: book.folder,
              title: book.title,
              author: book.author,
              coverDataUrl: await covers.get(key)!,
              tracks: book.tracks,
            };
          })
        );
      return {
        folderPath: input.folderPath,
        suggestedMode: planImport(listing).suggestedMode,
        plans: {
          "one-book": await toPreview("one-book"),
          "each-subfolder": await toPreview("each-subfolder"),
        },
      };
    }),

  // Saves the previewed Audiobooks. Files are referenced in place, never copied.
  confirmImport: publicProcedure
    .input(
      z.object({
        folderPath: z.string().min(1),
        mode: importModeSchema,
        titles: z.record(z.string(), z.string()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const listing = await listingFor(input.folderPath);
      const coversDir = audiobookCoversDir(app.getPath("userData"));
      const ids: string[] = [];
      for (const book of planImport(listing, input.mode).books) {
        const id = randomUUID();
        const now = Date.now();
        const coverPath = await saveCover(input.folderPath, book.cover, coversDir, id).catch(
          () => null
        );
        await db.transaction(async (tx) => {
          await tx.insert(audiobooks).values({
            id,
            title: input.titles[book.folder]?.trim() || book.title,
            author: book.author,
            sourceFolder: path.join(input.folderPath, book.folder),
            coverPath,
            createdAt: now,
            updatedAt: now,
          });
          await tx.insert(audiobookTracks).values(
            book.tracks.map((track, position) => ({
              id: randomUUID(),
              audiobookId: id,
              filePath: path.join(input.folderPath, track.path),
              position,
              durationSeconds:
                track.durationSeconds === null ? null : Math.round(track.durationSeconds),
            }))
          );
        });
        ids.push(id);
      }
      listings.delete(input.folderPath);
      return { ids };
    }),

  list: publicProcedure.query(({ ctx }) =>
    (ctx.db ?? defaultDb)
      .select({
        id: audiobooks.id,
        title: audiobooks.title,
        author: audiobooks.author,
        coverPath: audiobooks.coverPath,
        trackCount: sql<number>`count(${audiobookTracks.id})`,
        durationSeconds: sql<number>`coalesce(sum(${audiobookTracks.durationSeconds}), 0)`,
      })
      .from(audiobooks)
      .leftJoin(audiobookTracks, eq(audiobookTracks.audiobookId, audiobooks.id))
      .groupBy(audiobooks.id)
      .orderBy(asc(audiobooks.title))
  ),

  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    const db = ctx.db ?? defaultDb;
    const [book] = await db.select().from(audiobooks).where(eq(audiobooks.id, input.id));
    if (!book) return null;
    const tracks = await db
      .select()
      .from(audiobookTracks)
      .where(eq(audiobookTracks.audiobookId, input.id))
      .orderBy(asc(audiobookTracks.position));
    return { ...book, tracks };
  }),
});
