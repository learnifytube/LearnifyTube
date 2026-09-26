import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/api/db/schema";
import {
  addToPhoneList,
  getDeviceStatuses,
  loadOnDeviceSet,
  recordDeviceReport,
  setListOnDevices,
} from "./store";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const addVideo = (db: Db, videoId: string, durationSeconds = 100) =>
  db.insert(schema.youtubeVideos).values({
    id: videoId,
    videoId,
    title: `Video ${videoId}`,
    channelTitle: "Channel",
    durationSeconds,
    downloadStatus: "completed",
    keptAt: 1,
    createdAt: 1,
  });

const addList = async (db: Db, listId: string, videoIds: string[]) => {
  await db.insert(schema.customPlaylists).values({ id: listId, name: listId, createdAt: 1 });
  await db.insert(schema.customPlaylistItems).values(
    videoIds.map((videoId, position) => ({
      id: `${listId}-${videoId}`,
      playlistId: listId,
      videoId,
      position,
      addedAt: 1,
      createdAt: 1,
    }))
  );
};

describe("On-device store", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
    for (const id of ["a", "b", "c", "d"]) await addVideo(db, id);
  });

  it("holds switched-on Lists, Favorites and the Phone List", async () => {
    await addList(db, "trip", ["a", "b"]);
    await addList(db, "later", ["c"]);
    await db.insert(schema.favorites).values({
      id: "f1",
      entityType: "video",
      entityId: "d",
      createdAt: 1,
    });

    await setListOnDevices(db, "trip", true);
    await setListOnDevices(db, "favorites", true);
    await addToPhoneList(db, "c");

    const set = await loadOnDeviceSet(db);
    expect(set.map((v) => v.id).sort()).toEqual(["a", "b", "c", "d"]);

    await setListOnDevices(db, "trip", false);
    expect((await loadOnDeviceSet(db)).map((v) => v.id).sort()).toEqual(["c", "d"]);
  });

  it("records what a Device holds and counts present and missing Videos", async () => {
    await addList(db, "trip", ["a", "b"]);
    await setListOnDevices(db, "trip", true);

    await recordDeviceReport(
      db,
      { deviceId: "tv-1", name: "Living room", kind: "tv", offlineVideoIds: ["a", "x"], watch: [] },
      5_000
    );

    expect(await getDeviceStatuses(db)).toEqual([
      { id: "tv-1", name: "Living room", kind: "tv", lastSeenAt: 5_000, present: 1, missing: 1 },
    ]);
  });

  it("brings Watch state back from a Device", async () => {
    await recordDeviceReport(
      db,
      {
        deviceId: "tv-1",
        name: "TV",
        kind: "tv",
        offlineVideoIds: [],
        watch: [
          { videoId: "a", lastPositionSeconds: 100, lastWatchedAt: 4_000 },
          { videoId: "unknown", lastPositionSeconds: 5, lastWatchedAt: 4_000 },
        ],
      },
      5_000
    );

    const [stats] = await db
      .select()
      .from(schema.videoWatchStats)
      .where(eq(schema.videoWatchStats.videoId, "a"));
    expect(stats.watchedAt).toBe(4_000);
    expect(stats.lastPositionSeconds).toBe(100);
    expect(await db.select().from(schema.videoWatchStats)).toHaveLength(1);
  });
});
