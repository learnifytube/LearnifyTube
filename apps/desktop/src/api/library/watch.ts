import { eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { videoWatchStats, youtubeVideos } from "@/api/db/schema";
import { isPlayedEnough } from "@/lib/watch-state";
import { removeWatchedAutoKept } from "./auto-keep-lists";

// Record desktop playback: accumulated seconds and where it stopped. The Video becomes
// watched once about 90% has played.
export const recordWatchProgress = async (
  db: Database,
  input: { videoId: string; deltaSeconds: number; positionSeconds?: number }
): Promise<void> => {
  const now = Date.now();
  const [prev] = await db
    .select()
    .from(videoWatchStats)
    .where(eq(videoWatchStats.videoId, input.videoId))
    .limit(1);

  const [video] = await db
    .select({ durationSeconds: youtubeVideos.durationSeconds })
    .from(youtubeVideos)
    .where(eq(youtubeVideos.videoId, input.videoId))
    .limit(1);
  const playedEnough =
    input.positionSeconds !== undefined &&
    isPlayedEnough(input.positionSeconds, video?.durationSeconds ?? null);

  if (!prev) {
    await db.insert(videoWatchStats).values({
      id: crypto.randomUUID(),
      videoId: input.videoId,
      totalWatchSeconds: Math.floor(input.deltaSeconds),
      lastPositionSeconds: Math.floor(input.positionSeconds ?? 0),
      lastWatchedAt: now,
      watchedAt: playedEnough ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(videoWatchStats)
      .set({
        totalWatchSeconds: Math.max(
          0,
          (prev.totalWatchSeconds ?? 0) + Math.floor(input.deltaSeconds)
        ),
        lastPositionSeconds: Math.floor(input.positionSeconds ?? prev.lastPositionSeconds ?? 0),
        lastWatchedAt: now,
        watchedAt: prev.watchedAt ?? (playedEnough ? now : null),
        updatedAt: now,
      })
      .where(eq(videoWatchStats.videoId, input.videoId));
  }
  if (playedEnough && !prev?.watchedAt) {
    await removeWatchedAutoKept(db, { videoIds: [input.videoId] });
  }
};

// Mark a Video watched, or back to unwatched (which also forgets where playback stopped)
export const setWatched = async (
  db: Database,
  videoId: string,
  watched: boolean
): Promise<void> => {
  const now = Date.now();
  const changes = watched
    ? { watchedAt: now, updatedAt: now }
    : { watchedAt: null, lastPositionSeconds: 0, updatedAt: now };
  await db
    .insert(videoWatchStats)
    .values({ id: crypto.randomUUID(), videoId, createdAt: now, ...changes })
    .onConflictDoUpdate({ target: videoWatchStats.videoId, set: changes });
  if (watched) await removeWatchedAutoKept(db, { videoIds: [videoId] });
};
