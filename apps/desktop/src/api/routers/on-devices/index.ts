import fs from "fs";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { publicProcedure, t } from "@/api/trpc";
import defaultDb from "@/api/db";
import { onDeviceLists, phoneListItems, youtubeVideos } from "@/api/db/schema";
import { computeOnDeviceSet, videosLeaving } from "@/api/on-device/on-device-set";
import {
  addToPhoneList,
  getDeviceStatuses,
  loadOnDeviceSet,
  loadOnDeviceSetInput,
  removeFromPhoneList,
  setListOnDevices,
} from "@/api/on-device/store";

export const onDevicesRouter = t.router({
  // The On-device set with its total size, for the Devices page
  getSet: publicProcedure.query(async ({ ctx }) => {
    const rows = await loadOnDeviceSet(ctx.db ?? defaultDb);
    // Older Downloads never recorded a size, so read it from the file.
    const videos = await Promise.all(
      rows.map(async (video) => {
        if (video.downloadFileSize || !video.downloadFilePath) return video;
        const stats = await fs.promises.stat(video.downloadFilePath).catch(() => null);
        return { ...video, downloadFileSize: stats?.size ?? null };
      })
    );
    return {
      videos,
      totalBytes: videos.reduce((sum, v) => sum + (v.downloadFileSize ?? 0), 0),
    };
  }),

  getDevices: publicProcedure.query(({ ctx }) => getDeviceStatuses(ctx.db ?? defaultDb)),

  listSwitchedOn: publicProcedure.query(async ({ ctx }) => {
    const rows = await (ctx.db ?? defaultDb).select().from(onDeviceLists);
    return rows.map((row) => row.listId);
  }),

  // How many Videos would leave every Device if this List were switched off
  countLeavingIfSwitchedOff: publicProcedure
    .input(z.object({ listId: z.string() }))
    .query(async ({ input, ctx }) => {
      const setInput = await loadOnDeviceSetInput(ctx.db ?? defaultDb);
      const after = computeOnDeviceSet({
        ...setInput,
        switchedOnListIds: setInput.switchedOnListIds.filter((id) => id !== input.listId),
      });
      return videosLeaving(computeOnDeviceSet(setInput), after).length;
    }),

  setListOnDevices: publicProcedure
    .input(z.object({ listId: z.string(), on: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await setListOnDevices(ctx.db ?? defaultDb, input.listId, input.on);
      return { success: true };
    }),

  listPhoneList: publicProcedure.query(({ ctx }) =>
    (ctx.db ?? defaultDb)
      .select({
        videoId: youtubeVideos.videoId,
        title: youtubeVideos.title,
        channelTitle: youtubeVideos.channelTitle,
        durationSeconds: youtubeVideos.durationSeconds,
        thumbnailUrl: youtubeVideos.thumbnailUrl,
        thumbnailPath: youtubeVideos.thumbnailPath,
        addedAt: phoneListItems.addedAt,
      })
      .from(phoneListItems)
      .innerJoin(youtubeVideos, eq(youtubeVideos.videoId, phoneListItems.videoId))
      .orderBy(desc(phoneListItems.addedAt))
  ),

  setOnPhoneList: publicProcedure
    .input(z.object({ videoId: z.string(), on: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      await (input.on ? addToPhoneList(db, input.videoId) : removeFromPhoneList(db, input.videoId));
      return { success: true };
    }),
});
