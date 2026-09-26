import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/api/db";
import { autoKeepConsidered, channels, customPlaylists } from "@/api/db/schema";
import { logger } from "@/helpers/logger";
import { selectAutoKeep, type LatestVideo } from "@/lib/auto-keep";
import { BUILT_IN_LIST_NAMES } from "@/lib/lists";
import { keepVideos, type KeepQueue } from "./keep";

export type AutoKeepDeps = {
  // The Channel's latest Videos, fresh from YouTube; each one is stored as the app learns of it
  fetchLatest: (channelId: string) => Promise<LatestVideo[]>;
  queue: KeepQueue;
};

// Columns describeAutoKeep needs; select them with a left join of customPlaylists on the List id
export const autoKeepColumns = {
  channelId: channels.channelId,
  since: channels.autoKeepSince,
  listId: channels.autoKeepListId,
  customListName: customPlaylists.name,
  checkedAt: channels.autoKeepCheckedAt,
  checkFailed: channels.autoKeepCheckFailed,
};

type AutoKeepRow = {
  since: number | null;
  listId: string | null;
  customListName: string | null;
  checkedAt: number | null;
  checkFailed: boolean | null;
};

// A Subscription's Auto-keep as the user sees it. A target List that no longer exists is
// reported as deleted; Auto-keep then keeps into the Library only.
export type AutoKeepStatus = {
  enabled: boolean;
  listId: string | null;
  listName: string | null;
  listDeleted: boolean;
  lastCheckedAt: number | null;
  lastCheckFailed: boolean;
};

export const describeAutoKeep = (row: AutoKeepRow): AutoKeepStatus => {
  const listName = row.listId
    ? (BUILT_IN_LIST_NAMES[row.listId] ?? row.customListName ?? null)
    : null;
  return {
    enabled: row.since !== null,
    listId: row.listId,
    listName,
    listDeleted: row.listId !== null && listName === null,
    lastCheckedAt: row.checkedAt,
    lastCheckFailed: row.checkFailed ?? false,
  };
};

// Channels with their Auto-keep settings, the target List's name joined in
const loadAutoKeepRows = (
  db: Database,
  where: SQL | undefined
): Promise<(AutoKeepRow & { channelId: string })[]> =>
  db
    .select(autoKeepColumns)
    .from(channels)
    .leftJoin(customPlaylists, eq(customPlaylists.id, channels.autoKeepListId))
    .where(where);

export const getAutoKeep = async (
  db: Database,
  channelId: string
): Promise<AutoKeepStatus | null> => {
  const [row] = await loadAutoKeepRows(db, eq(channels.channelId, channelId));
  return row ? describeAutoKeep(row) : null;
};

// Switch Auto-keep on or off for a Subscription, or change its target List (null: Library
// only; left out: unchanged). Switching on records when, and remembers every Video of the
// Channel the app already knows as considered, so none of them is ever auto-kept; follow it
// with takeAutoKeepBaseline to do the same for what YouTube lists right now.
export const setAutoKeep = async (
  db: Database,
  channelId: string,
  { enabled, listId }: { enabled: boolean; listId?: string | null },
  now = Date.now()
): Promise<"not-subscribed" | "switched-on" | "saved"> => {
  const subscription = and(eq(channels.channelId, channelId), isNotNull(channels.subscribedAt));
  const [current] = await db
    .select({ since: channels.autoKeepSince })
    .from(channels)
    .where(subscription);
  if (!current) return "not-subscribed";

  const switchingOn = enabled && current.since === null;
  if (switchingOn) {
    await db.run(sql`
      INSERT OR IGNORE INTO auto_keep_considered (channel_id, video_id, considered_at)
      SELECT ${channelId}, video_id, ${now} FROM youtube_videos WHERE channel_id = ${channelId}
    `);
  }
  await db
    .update(channels)
    .set({
      autoKeepSince: enabled ? (current.since ?? now) : null,
      ...(listId !== undefined && { autoKeepListId: listId }),
      updatedAt: now,
    })
    .where(subscription);
  return switchingOn ? "switched-on" : "saved";
};

// One Auto-keep check of a Subscription: fetch the Channel's latest Videos and keep the new
// ones through the Keep path, into the target List unless it was deleted. A failed check is
// recorded and simply retried next time. A baseline check keeps nothing and only remembers
// what is listed.
const checkSubscription = async (
  db: Database,
  channelId: string,
  deps: AutoKeepDeps,
  { baseline = false } = {}
): Promise<void> => {
  const [row] = await loadAutoKeepRows(
    db,
    and(eq(channels.channelId, channelId), isNotNull(channels.subscribedAt))
  );
  if (!row || row.since === null) return;
  const { listId, listDeleted } = describeAutoKeep(row);

  const recordCheck = async (failed: boolean): Promise<void> => {
    await db
      .update(channels)
      .set({ autoKeepCheckedAt: Date.now(), autoKeepCheckFailed: failed })
      .where(eq(channels.channelId, channelId));
  };

  try {
    const videos = await deps.fetchLatest(channelId);
    const considered = await db
      .select({ videoId: autoKeepConsidered.videoId })
      .from(autoKeepConsidered)
      .where(eq(autoKeepConsidered.channelId, channelId));
    const { keep, markConsidered } = selectAutoKeep({
      videos,
      since: baseline ? Infinity : row.since,
      considered: new Set(considered.map((r) => r.videoId)),
    });

    if (keep.length > 0) {
      const targetListId = listId !== null && !listDeleted ? listId : undefined;
      const result = await keepVideos(db, deps.queue, keep, targetListId);
      if (!result.success && result.reason === "failed") throw new Error(result.message);
    }
    if (markConsidered.length > 0) {
      const now = Date.now();
      await db
        .insert(autoKeepConsidered)
        .values(markConsidered.map((videoId) => ({ channelId, videoId, consideredAt: now })))
        .onConflictDoNothing();
    }
    logger.info("[auto-keep] Checked Subscription", { channelId, baseline, kept: keep.length });
    await recordCheck(false);
  } catch (error) {
    logger.warn("[auto-keep] Check failed", { channelId, error: String(error) });
    await recordCheck(true);
  }
};

// Right after switching Auto-keep on: remember every Video YouTube lists for the Channel now,
// so none that came out before the switch is kept, however its approximate date reads.
export const takeAutoKeepBaseline = (
  db: Database,
  channelId: string,
  deps: AutoKeepDeps
): Promise<void> => checkSubscription(db, channelId, deps, { baseline: true });

// Check every Subscription with Auto-keep on, one after another.
export const runAutoKeepChecks = async (db: Database, deps: AutoKeepDeps): Promise<void> => {
  const rows = await loadAutoKeepRows(
    db,
    and(isNotNull(channels.subscribedAt), isNotNull(channels.autoKeepSince))
  );
  for (const row of rows) await checkSubscription(db, row.channelId, deps);
};
