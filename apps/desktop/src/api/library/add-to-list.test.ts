import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { loadLibraryVideos } from "./library-videos";
import { FAVORITES_LIST_ID, PHONE_LIST_ID } from "@/lib/lists";
import { addToList } from "./add-to-list";

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
    keptAt: 1,
    downloadStatus: "queued",
    createdAt: 1,
  });

const createList = (db: Db, id: string) =>
  db.insert(schema.customPlaylists).values({ id, name: `List ${id}`, createdAt: 1 });

const listIdsOf = async (db: Db, videoId: string) =>
  (await loadLibraryVideos(db)).videos.find((v) => v.videoId === videoId)?.listIds;

describe("addToList", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
    for (const id of ["a", "b"]) await addVideo(db, id);
    await createList(db, "mine");
  });

  it("adds Videos to a user-made List", async () => {
    await addToList(db, "mine", ["a", "b"]);

    expect(await listIdsOf(db, "a")).toEqual(["mine"]);
    expect(await listIdsOf(db, "b")).toEqual(["mine"]);
  });

  it("leaves a Video already in the List where it is", async () => {
    await addToList(db, "mine", ["a"]);
    await addToList(db, "mine", ["a", "b"]);

    const items = await db.select().from(schema.customPlaylistItems);
    expect(items.map((i) => i.videoId).sort()).toEqual(["a", "b"]);
    const [list] = await db.select().from(schema.customPlaylists);
    expect(list.itemCount).toBe(2);
  });

  it("adds Videos to Favorites, keeping ones already there", async () => {
    await addToList(db, FAVORITES_LIST_ID, ["a"]);
    await addToList(db, FAVORITES_LIST_ID, ["a", "b"]);

    expect(await listIdsOf(db, "a")).toEqual([FAVORITES_LIST_ID]);
    expect(await listIdsOf(db, "b")).toEqual([FAVORITES_LIST_ID]);
  });

  it("adds Videos to the Phone List, keeping ones already there", async () => {
    await addToList(db, PHONE_LIST_ID, ["a"]);
    await addToList(db, PHONE_LIST_ID, ["a", "b"]);

    expect(await listIdsOf(db, "a")).toEqual([PHONE_LIST_ID]);
    expect(await listIdsOf(db, "b")).toEqual([PHONE_LIST_ID]);
  });

  it("skips a Video the app does not know", async () => {
    await addToList(db, "mine", ["a", "unknown"]);

    expect(await listIdsOf(db, "a")).toEqual(["mine"]);
  });
});
