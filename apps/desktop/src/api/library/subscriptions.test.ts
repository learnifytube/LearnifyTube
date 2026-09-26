import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { listSubscriptions, loadSubscriptionVideos, setSubscribed } from "./subscriptions";
import { loadNewFromSubscriptions } from "./new-from-subscriptions";
import { setAutoKeep } from "./auto-keep";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const addChannel = (db: Db, channelId: string, subscribedAt: number | null = null) =>
  db.insert(schema.channels).values({
    id: channelId,
    channelId,
    channelTitle: `Channel ${channelId}`,
    createdAt: 1,
    subscribedAt,
  });

const addVideo = (
  db: Db,
  videoId: string,
  channelId: string,
  overrides: Partial<typeof schema.youtubeVideos.$inferInsert> = {}
) =>
  db.insert(schema.youtubeVideos).values({
    id: videoId,
    videoId,
    title: `Video ${videoId}`,
    channelId,
    channelTitle: `Channel ${channelId}`,
    createdAt: 1,
    ...overrides,
  });

const ids = (videos: { videoId: string }[]) => videos.map((v) => v.videoId);

describe("Subscriptions", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  describe("setSubscribed", () => {
    it("subscribing a visited Channel brings its new Videos in", async () => {
      await addChannel(db, "visited");
      await addVideo(db, "v1", "visited");
      expect(await loadNewFromSubscriptions(db)).toEqual([]);

      expect(await setSubscribed(db, "visited", true)).toBe(true);

      expect(ids(await loadNewFromSubscriptions(db))).toEqual(["v1"]);
      expect(ids(await loadSubscriptionVideos(db))).toEqual(["v1"]);
    });

    it("unsubscribing takes new Videos out but leaves kept ones in the Library", async () => {
      await addChannel(db, "sub", 1);
      await addVideo(db, "new", "sub");
      await addVideo(db, "kept", "sub", { keptAt: 5, downloadStatus: "completed" });

      await setSubscribed(db, "sub", false);

      expect(await loadNewFromSubscriptions(db)).toEqual([]);
      expect(await loadSubscriptionVideos(db)).toEqual([]);
      const kept = await db.query.youtubeVideos.findFirst({
        where: (v, { eq }) => eq(v.videoId, "kept"),
      });
      expect(kept).toMatchObject({ keptAt: 5, downloadStatus: "completed", channelId: "sub" });
    });

    it("keeps the original date when subscribing again", async () => {
      await addChannel(db, "sub", 42);

      await setSubscribed(db, "sub", true);

      const channel = await db.query.channels.findFirst();
      expect(channel?.subscribedAt).toBe(42);
    });

    it("reports a Channel the app does not know", async () => {
      expect(await setSubscribed(db, "missing", true)).toBe(false);
    });
  });

  describe("listSubscriptions", () => {
    it("lists only subscribed Channels, by title", async () => {
      await db.insert(schema.channels).values([
        { id: "b", channelId: "b", channelTitle: "beta", createdAt: 1, subscribedAt: 1 },
        { id: "a", channelId: "a", channelTitle: "Alpha", createdAt: 1, subscribedAt: 1 },
        { id: "v", channelId: "v", channelTitle: "Visited", createdAt: 1 },
      ]);

      const subscriptions = await listSubscriptions(db);

      expect(subscriptions.map((s) => s.channelId)).toEqual(["a", "b"]);
    });

    it("shows each Subscription's Auto-keep and its target List", async () => {
      await addChannel(db, "off", 1);
      await addChannel(db, "on", 1);
      await addChannel(db, "orphaned", 1);
      await db.insert(schema.customPlaylists).values({ id: "list", name: "Commute", createdAt: 1 });
      await setAutoKeep(db, "on", { enabled: true, listId: "list" });
      await setAutoKeep(db, "orphaned", { enabled: true, listId: "gone" });

      const autoKeep = Object.fromEntries(
        (await listSubscriptions(db)).map((s) => [s.channelId, s.autoKeep])
      );

      expect(autoKeep.off).toMatchObject({ enabled: false, listName: null });
      expect(autoKeep.on).toMatchObject({ enabled: true, listName: "Commute", listDeleted: false });
      expect(autoKeep.orphaned).toMatchObject({ enabled: true, listDeleted: true });
    });
  });

  describe("loadSubscriptionVideos", () => {
    it("takes Videos from each Subscription in turn, newest found first", async () => {
      await addChannel(db, "a", 1);
      await addChannel(db, "b", 1);
      await addVideo(db, "a-old", "a", { createdAt: 1 });
      await addVideo(db, "a-new", "a", { createdAt: 3 });
      await addVideo(db, "b-only", "b", { createdAt: 2 });

      expect(ids(await loadSubscriptionVideos(db))).toEqual(["a-new", "b-only", "a-old"]);
    });

    it("leaves out Videos from a Channel that is not a Subscription", async () => {
      await addChannel(db, "sub", 1);
      await addChannel(db, "visited");
      await addVideo(db, "from-sub", "sub");
      await addVideo(db, "from-visited", "visited");

      expect(ids(await loadSubscriptionVideos(db))).toEqual(["from-sub"]);
    });

    it("pages with limit and offset", async () => {
      await addChannel(db, "sub", 1);
      for (const [i, id] of ["c", "b", "a"].entries()) {
        await addVideo(db, id, "sub", { createdAt: 10 - i });
      }

      expect(ids(await loadSubscriptionVideos(db, { limit: 2, offset: 1 }))).toEqual(["b", "a"]);
    });
  });
});
