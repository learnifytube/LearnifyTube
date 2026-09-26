import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { loadNewFromSubscriptions } from "./new-from-subscriptions";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const addChannel = (db: Db, channelId: string) =>
  db.insert(schema.channels).values({
    id: channelId,
    channelId,
    channelTitle: `Channel ${channelId}`,
    createdAt: 1,
  });

const addVideo = (
  db: Db,
  videoId: string,
  overrides: Partial<typeof schema.youtubeVideos.$inferInsert> = {}
) =>
  db.insert(schema.youtubeVideos).values({
    id: videoId,
    videoId,
    title: `Video ${videoId}`,
    channelId: "sub",
    channelTitle: "Channel sub",
    createdAt: 1,
    ...overrides,
  });

const ids = (videos: { videoId: string }[]) => videos.map((v) => v.videoId);

describe("loadNewFromSubscriptions", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
    await addChannel(db, "sub");
  });

  it("lists Videos from Subscriptions, newest published first", async () => {
    await addVideo(db, "older", { publishedAt: 100 });
    await addVideo(db, "newer", { publishedAt: 200 });

    expect(ids(await loadNewFromSubscriptions(db))).toEqual(["newer", "older"]);
  });

  it("leaves out Videos already kept, but offers a cancelled one again", async () => {
    await addVideo(db, "kept", { keptAt: 5, downloadStatus: "completed", publishedAt: 3 });
    await addVideo(db, "on-its-way", { keptAt: 5, downloadStatus: "queued", publishedAt: 2 });
    await addVideo(db, "cancelled", { keptAt: 5, downloadStatus: "cancelled", publishedAt: 1 });

    expect(ids(await loadNewFromSubscriptions(db))).toEqual(["cancelled"]);
  });

  it("leaves out Videos without a Channel", async () => {
    await addVideo(db, "no-channel", { channelId: null });
    await addVideo(db, "subscribed");

    expect(ids(await loadNewFromSubscriptions(db))).toEqual(["subscribed"]);
  });

  it("orders Videos without a publish date by when the app found them, after dated ones", async () => {
    await addVideo(db, "found-early", { createdAt: 10 });
    await addVideo(db, "dated", { publishedAt: 1 });
    await addVideo(db, "found-late", { createdAt: 20 });

    expect(ids(await loadNewFromSubscriptions(db))).toEqual(["dated", "found-late", "found-early"]);
  });

  it("returns at most the limit", async () => {
    for (const id of ["a", "b", "c"]) await addVideo(db, id);

    expect(await loadNewFromSubscriptions(db, 2)).toHaveLength(2);
  });
});
