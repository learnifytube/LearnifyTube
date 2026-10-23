import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/api/db/schema";
import { recordDeviceReport } from "@/api/on-device/store";
import { loadCollection, recordVideoStarted, whereCollectionPicksUp } from "./current-video";
import type {
  CollectionRef,
  CurrentVideo,
  DeviceReport,
} from "../../../../shared/mobile-sync-contract";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const addVideo = (db: Db, videoId: string) =>
  db.insert(schema.youtubeVideos).values({
    id: videoId,
    videoId,
    title: `Video ${videoId}`,
    channelTitle: "Channel",
    durationSeconds: 100,
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

const addYouTubePlaylist = async (db: Db, playlistId: string, videoIds: string[]) => {
  await db
    .insert(schema.channelPlaylists)
    .values({ id: playlistId, playlistId, title: playlistId, createdAt: 1 });
  await db.insert(schema.playlistItems).values(
    videoIds.map((videoId, position) => ({
      id: `${playlistId}-${videoId}`,
      playlistId,
      videoId,
      position,
      createdAt: 1,
    }))
  );
};

const addFavorites = (db: Db, videoIds: string[]) =>
  db.insert(schema.favorites).values(
    videoIds.map((videoId, i) => ({
      id: `fav-${videoId}`,
      entityType: "video" as const,
      entityId: videoId,
      // Favorites list newest first.
      createdAt: 100 - i,
    }))
  );

const markWatched = (db: Db, videoId: string) =>
  db.insert(schema.videoWatchStats).values({ id: videoId, videoId, watchedAt: 5, createdAt: 1 });

const report = (currentVideos?: CurrentVideo[]): DeviceReport => ({
  deviceId: "phone-1",
  name: "Pixel",
  kind: "phone",
  offlineVideoIds: [],
  watch: [],
  ...(currentVideos ? { currentVideos } : {}),
});

const trip: CollectionRef = { kind: "list", id: "trip" };

const current = (videoId: string, updatedAt: number, ref: CollectionRef = trip): CurrentVideo => ({
  collectionKind: ref.kind,
  collectionId: ref.id,
  videoId,
  updatedAt,
});

const currentVideoId = async (db: Db, ref: CollectionRef = trip) =>
  (await loadCollection(db, ref))?.currentVideo?.videoId ?? null;

const resume = async (db: Db, ref: CollectionRef = trip) =>
  (await whereCollectionPicksUp(db, ref))?.videoId ?? null;

describe("A collection's Current Video", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
    for (const id of ["a", "b", "c", "d"]) await addVideo(db, id);
    await addList(db, "trip", ["a", "b", "c"]);
  });

  it("serves the collection's Videos in order with no Current Video before any is set", async () => {
    expect(await loadCollection(db, trip)).toMatchObject({
      videos: [{ videoId: "a" }, { videoId: "b" }, { videoId: "c" }],
      currentVideo: null,
    });
  });

  it("serves which of its Videos are watched on the desktop", async () => {
    await markWatched(db, "b");
    expect((await loadCollection(db, trip))?.watchedVideoIds).toEqual(new Set(["b"]));
  });

  it("keeps the newest Current Video from Device reports, in either arrival order", async () => {
    await recordDeviceReport(db, report([current("c", 2_000)]), 1);
    await recordDeviceReport(db, report([current("b", 1_000)]), 2);
    expect(await currentVideoId(db)).toBe("c");

    const other = await createDb();
    for (const id of ["a", "b", "c"]) await addVideo(other, id);
    await addList(other, "trip", ["a", "b", "c"]);
    await recordDeviceReport(other, report([current("b", 1_000)]), 1);
    await recordDeviceReport(other, report([current("c", 2_000)]), 2);
    expect(await currentVideoId(other)).toBe("c");
  });

  it("loses an older Device report to a newer start on the desktop", async () => {
    await recordVideoStarted(db, { videoId: "b", collectionId: "trip" }, 5_000);
    await recordDeviceReport(db, report([current("c", 4_000)]), 6_000);
    expect(await currentVideoId(db)).toBe("b");
  });

  it("accepts reports from Devices that don't send Current Videos", async () => {
    await recordDeviceReport(db, report(), 1);
    expect(await currentVideoId(db)).toBeNull();
  });

  it("ignores Current Videos of collections the desktop doesn't have", async () => {
    await recordDeviceReport(db, report([current("a", 1, { kind: "list", id: "elsewhere" })]), 1);
    expect(await loadCollection(db, { kind: "list", id: "elsewhere" })).toBeNull();
  });

  it("moves when a Video starts from that List, and not when it starts from the Library", async () => {
    await recordVideoStarted(db, { videoId: "b", collectionId: "trip" }, 1_000);
    await recordVideoStarted(db, { videoId: "c", collectionId: null }, 2_000);
    expect(await currentVideoId(db)).toBe("b");
  });

  it("doesn't change what Resume plays when the List is reordered", async () => {
    await recordVideoStarted(db, { videoId: "b", collectionId: "trip" }, 1_000);
    await db
      .update(schema.customPlaylistItems)
      .set({ position: 9 })
      .where(eq(schema.customPlaylistItems.videoId, "b"));
    expect(await resume(db)).toBe("b");
  });

  it("resumes the first unwatched Video once the Current Video is removed from the List", async () => {
    await markWatched(db, "a");
    await recordVideoStarted(db, { videoId: "c", collectionId: "trip" }, 1_000);
    await db
      .delete(schema.customPlaylistItems)
      .where(
        and(
          eq(schema.customPlaylistItems.playlistId, "trip"),
          eq(schema.customPlaylistItems.videoId, "c")
        )
      );
    expect(await resume(db)).toBe("b");
  });

  it("moves on past a Current Video the desktop can no longer play", async () => {
    // "x" is still a Favorite, but its Video is gone from the desktop.
    const favs: CollectionRef = { kind: "favorites", id: "favorites" };
    await addFavorites(db, ["d", "x", "a"]);
    await recordVideoStarted(db, { videoId: "x", collectionId: "favorites" }, 1_000);
    expect(await whereCollectionPicksUp(db, favs)).toEqual({ videoId: "a", index: 1 });
  });

  it("moves on past a watched Current Video", async () => {
    await recordVideoStarted(db, { videoId: "a", collectionId: "trip" }, 1_000);
    await markWatched(db, "a");
    expect(await resume(db)).toBe("b");
  });

  it("works the same for Favorites", async () => {
    const favs: CollectionRef = { kind: "favorites", id: "favorites" };
    await addFavorites(db, ["d", "a"]);
    await recordVideoStarted(db, { videoId: "a", collectionId: "favorites" }, 1_000);
    expect(await loadCollection(db, favs)).toMatchObject({
      videos: [{ videoId: "d" }, { videoId: "a" }],
      currentVideo: { videoId: "a" },
    });
    await recordDeviceReport(db, report([current("d", 2_000, favs)]), 1);
    expect(await resume(db, favs)).toBe("d");
  });

  it("works the same for YouTube playlists", async () => {
    const course: CollectionRef = { kind: "youtube_playlist", id: "PL1" };
    await addYouTubePlaylist(db, "PL1", ["c", "d"]);
    await recordVideoStarted(db, { videoId: "d", collectionId: "PL1" }, 1_000);
    expect(await resume(db, course)).toBe("d");
    await recordDeviceReport(db, report([current("c", 2_000, course)]), 1);
    expect(await currentVideoId(db, course)).toBe("c");
  });
});
