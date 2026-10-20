import { randomUUID } from "crypto";
import path from "path";
import { app, dialog } from "electron";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import { audiobooks, audiobookTracks } from "@/api/db/schema";
import {
  IMPORT_MODES,
  planImport,
  withTrackOrder,
  type FolderListing,
  type ImportMode,
  type ProposedTrack,
} from "@/api/audiobooks/import-plan";
import { scanFolder } from "@/api/audiobooks/scan-folder";
import { audiobookCoversDir } from "@/api/audiobooks/covers-dir";
import {
  COVER_IMAGE_EXTENSIONS,
  previewCover,
  removeAppCover,
  saveCover,
  saveCoverFromImage,
} from "@/api/audiobooks/covers";
import { planRescan } from "@/api/audiobooks/rescan-plan";
import { recordDesktopListening } from "@/api/audiobooks/listening";
import {
  audiobookListeningSchema,
  type AudiobookListening,
} from "../../../../../shared/mobile-sync-contract";
import {
  devicesHoldingAudiobook,
  setAudiobookSentToDevices,
} from "@/api/audiobooks/send-to-devices";

const importModeSchema = z.enum(IMPORT_MODES);

type PreviewBook = {
  folder: string;
  title: string;
  author: string | null;
  coverDataUrl: string | null;
  tracks: ProposedTrack[];
};

// The last folder listing previewed per picked folder, so confirming saves what was previewed.
const previewedListingsByFolder = new Map<string, FolderListing>();

const listingFor = async (folderPath: string): Promise<FolderListing> => {
  const cached = previewedListingsByFolder.get(folderPath);
  if (cached) return cached;
  const listing = await scanFolder(folderPath);
  previewedListingsByFolder.set(folderPath, listing);
  return listing;
};

// Tells connected Devices to Mirror the sent Audiobooks now (over SSE).
const notifyDevices = async (): Promise<void> => {
  try {
    const { getMobileSyncServer } = await import("@/main/mobileSyncServer");
    getMobileSyncServer().broadcastAudiobooksChanged();
  } catch {
    // The sync server isn't running here; Devices pick it up at their next sync.
  }
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
      previewedListingsByFolder.delete(input.folderPath);
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
        // Track paths by book folder, in the order the user dragged them into.
        trackOrders: z.record(z.string(), z.array(z.string())).default({}),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const listing = await listingFor(input.folderPath);
      const coversDir = audiobookCoversDir(app.getPath("userData"));
      const ids: string[] = [];
      for (const planned of planImport(listing, input.mode).books) {
        const order = input.trackOrders[planned.folder];
        const book = order ? withTrackOrder(planned, order) : planned;
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
      previewedListingsByFolder.delete(input.folderPath);
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

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().trim().min(1).optional(),
        author: z.string().trim().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await (ctx.db ?? defaultDb)
        .update(audiobooks)
        .set({
          ...(input.title !== undefined && { title: input.title }),
          ...(input.author !== undefined && { author: input.author || null }),
          updatedAt: Date.now(),
        })
        .where(eq(audiobooks.id, input.id));
    }),

  // Lets the user pick an image as the cover; the image is copied, never moved.
  changeCover: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }): Promise<{ changed: boolean }> => {
      const db = ctx.db ?? defaultDb;
      const [book] = await db.select().from(audiobooks).where(eq(audiobooks.id, input.id));
      if (!book) return { changed: false };
      const selection = await dialog.showOpenDialog({
        title: "Choose a cover",
        defaultPath: book.sourceFolder,
        properties: ["openFile"],
        filters: [{ name: "Images", extensions: COVER_IMAGE_EXTENSIONS }],
      });
      const [imagePath] = selection.filePaths;
      if (selection.canceled || !imagePath) return { changed: false };
      const coversDir = audiobookCoversDir(app.getPath("userData"));
      const coverPath = await saveCoverFromImage(imagePath, coversDir, book.id);
      await db
        .update(audiobooks)
        .set({ coverPath, updatedAt: Date.now() })
        .where(eq(audiobooks.id, book.id));
      await removeAppCover(book.coverPath, coversDir);
      return { changed: true };
    }),

  removeCover: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const [book] = await db.select().from(audiobooks).where(eq(audiobooks.id, input.id));
      if (!book) return;
      await db
        .update(audiobooks)
        .set({ coverPath: null, updatedAt: Date.now() })
        .where(eq(audiobooks.id, book.id));
      await removeAppCover(book.coverPath, audiobookCoversDir(app.getPath("userData")));
    }),

  // Saves a new Track order. Tracks left out keep their relative order after the given ones.
  reorderTracks: publicProcedure
    .input(z.object({ id: z.string(), trackIds: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      const tracks = await db
        .select({ id: audiobookTracks.id })
        .from(audiobookTracks)
        .where(eq(audiobookTracks.audiobookId, input.id))
        .orderBy(asc(audiobookTracks.position));
      const known = new Set(tracks.map((track) => track.id));
      const given = input.trackIds.filter((id) => known.has(id));
      const order = [
        ...new Set(given),
        ...tracks.map((t) => t.id).filter((id) => !given.includes(id)),
      ];
      await db.transaction(async (tx) => {
        for (const [position, trackId] of order.entries()) {
          await tx.update(audiobookTracks).set({ position }).where(eq(audiobookTracks.id, trackId));
        }
        await tx
          .update(audiobooks)
          .set({ updatedAt: Date.now() })
          .where(eq(audiobooks.id, input.id));
      });
    }),

  // Looks at the folder again: new files join at the end, gone files show as missing.
  rescan: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const db = ctx.db ?? defaultDb;
    const [book] = await db.select().from(audiobooks).where(eq(audiobooks.id, input.id));
    if (!book) return { added: 0, missing: 0 };
    const tracks = await db
      .select()
      .from(audiobookTracks)
      .where(eq(audiobookTracks.audiobookId, book.id))
      .orderBy(asc(audiobookTracks.position));
    // A folder that is gone (e.g. an unplugged drive) makes every Track missing.
    const listing = await scanFolder(book.sourceFolder).catch(
      (): FolderListing => ({ name: path.basename(book.sourceFolder), files: [] })
    );
    const plan = planRescan(
      tracks.map((track) => ({
        id: track.id,
        path: path.relative(book.sourceFolder, track.filePath).split(path.sep).join("/"),
        missing: track.missing,
      })),
      listing
    );
    await db.transaction(async (tx) => {
      for (const [position, track] of plan.tracks.entries()) {
        if (track.kind === "existing") {
          await tx
            .update(audiobookTracks)
            .set({ position, missing: track.missing })
            .where(eq(audiobookTracks.id, track.id));
        } else {
          await tx.insert(audiobookTracks).values({
            id: randomUUID(),
            audiobookId: book.id,
            filePath: path.join(book.sourceFolder, track.path),
            position,
            durationSeconds:
              track.durationSeconds === null ? null : Math.round(track.durationSeconds),
          });
        }
      }
      await tx.update(audiobooks).set({ updatedAt: Date.now() }).where(eq(audiobooks.id, book.id));
    });
    // Devices holding a sent book fetch the Tracks it gained.
    if (book.sentToDevices) await notifyDevices();
    return {
      added: plan.tracks.filter((track) => track.kind === "new").length,
      missing: plan.tracks.filter((track) => track.kind === "existing" && track.missing).length,
    };
  }),

  // Removes the Audiobook from the app only. The user's audio files are never
  // deleted, moved or modified; only the app's own cover copy goes.
  forget: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const db = ctx.db ?? defaultDb;
    const [book] = await db.select().from(audiobooks).where(eq(audiobooks.id, input.id));
    if (!book) return;
    await db.transaction(async (tx) => {
      await tx.delete(audiobookTracks).where(eq(audiobookTracks.audiobookId, book.id));
      await tx.delete(audiobooks).where(eq(audiobooks.id, book.id));
    });
    await removeAppCover(book.coverPath, audiobookCoversDir(app.getPath("userData")));
    // Devices remove their mirrored copy of a forgotten sent book.
    if (book.sentToDevices) await notifyDevices();
  }),

  // Send to Devices / Remove from Devices, always the whole Audiobook.
  setSentToDevices: publicProcedure
    .input(z.object({ id: z.string(), sent: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const changed = await setAudiobookSentToDevices(ctx.db ?? defaultDb, input.id, input.sent);
      if (changed) await notifyDevices();
    }),

  // The desktop's own Listening position as it plays: kept by the same newest-wins
  // rule as a Device's. Meaningful moments are announced so open phones refresh;
  // periodic saves wait for the phone's next catalog refresh.
  recordListening: publicProcedure
    .input(
      z.object({
        // The contract's schema is zod 4; this router's zod is 3, so it can't nest directly.
        listening: z.custom<AudiobookListening>(
          (value) => audiobookListeningSchema.safeParse(value).success
        ),
        announce: z.boolean(),
      })
    )
    .mutation(({ input, ctx }) =>
      recordDesktopListening(ctx.db ?? defaultDb, input, () => void notifyDevices())
    ),

  devicesHolding: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input, ctx }) => devicesHoldingAudiobook(ctx.db ?? defaultDb, input.id)),
});
