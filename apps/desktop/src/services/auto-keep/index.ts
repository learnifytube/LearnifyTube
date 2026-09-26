import fs from "fs";
import type { Database } from "@/api/db";
import { runAutoKeepChecks, type AutoKeepDeps } from "@/api/library/auto-keep";
import { fetchChannelLatest } from "@/api/utils/ytdlp-utils/channel-latest";
import { getYtDlpBinaryPath } from "@/api/utils/ytdlp-utils/paths";
import { requireQueueManager } from "@/services/download-queue/queue-manager";
import { createAutoKeepScheduler } from "./scheduler";

// How many of a Channel's latest Videos each check looks at
const CHECK_LISTING_SIZE = 15;

// Auto-keep's link to YouTube and the download queue. Needs the queue to be initialized.
export const autoKeepDeps = (db: Database): AutoKeepDeps => ({
  fetchLatest: async (channelId) => {
    const binPath = getYtDlpBinaryPath();
    if (!fs.existsSync(binPath)) throw new Error("yt-dlp is not installed");
    return fetchChannelLatest(db, binPath, channelId, CHECK_LISTING_SIZE);
  },
  queue: requireQueueManager(),
});

// Check every Subscription with Auto-keep on now and every 6 hours while the app runs.
export const startAutoKeep = (db: Database): void => {
  const deps = autoKeepDeps(db);
  createAutoKeepScheduler(() => runAutoKeepChecks(db, deps)).start();
};
