import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/api/db/schema";
import type { LatestVideo } from "@/lib/auto-keep";
import { PHONE_LIST_ID } from "@/lib/lists";
import { loadOnDeviceSetIds, setListOnDevices } from "@/api/on-device/store";
import { getAutoKeep, runAutoKeepChecks, setAutoKeep, takeAutoKeepBaseline } from "./auto-keep";
import { loadNewFromSubscriptions } from "./new-from-subscriptions";
import { setSubscribed } from "./subscriptions";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const CHANNEL = "chan";
const LATER = () => Date.now() + 60_000;

// A fake YouTube: the Channel's listing, which (like the real fetch) stores each Video it lists
const createChannelListing = (db: Db) => {
  const listing: LatestVideo[] = [];
  let failing = false;
  const fetchLatest = jest.fn(async (channelId: string) => {
    if (failing) throw new Error("offline");
    for (const v of listing) {
      await db
        .insert(schema.youtubeVideos)
        .values({
          id: v.videoId,
          videoId: v.videoId,
          title: `Video ${v.videoId}`,
          channelId,
          channelTitle: "Channel",
          publishedAt: v.publishedAt,
          createdAt: Date.now(),
        })
        .onConflictDoNothing();
    }
    return [...listing];
  });
  return {
    fetchLatest,
    publish: (videoId: string, overrides: Partial<LatestVideo> = {}) =>
      listing.unshift({
        videoId,
        publishedAt: LATER(),
        isShort: false,
        liveStatus: null,
        ...overrides,
      }),
    setFailing: (value: boolean) => (failing = value),
  };
};

// A fake download queue that, like the real one, skips Videos already fetched
const createQueue = (db: Db) => ({
  addToQueue: jest.fn(async (urls: string[]) => {
    const ids = urls.map((url) => new URL(url).searchParams.get("v") ?? "");
    const rows = await db.query.youtubeVideos.findMany({
      where: inArray(schema.youtubeVideos.videoId, ids),
    });
    const done = new Set(
      rows.filter((r) => r.downloadStatus === "completed").map((r) => r.videoId)
    );
    const added = ids.filter((id) => !done.has(id));
    for (const id of added) {
      await db
        .update(schema.youtubeVideos)
        .set({ downloadStatus: "queued", keptAt: Date.now() })
        .where(eq(schema.youtubeVideos.videoId, id));
    }
    if (done.size > 0)
      throw Object.assign(new Error("dup"), { skippedUrls: [...done], addedIds: added });
    return added;
  }),
});

const queuedIds = (queue: ReturnType<typeof createQueue>) =>
  queue.addToQueue.mock.calls.flatMap(([urls]) =>
    urls.map((url) => new URL(url).searchParams.get("v"))
  );

describe("Auto-keep", () => {
  let db: Db;
  let youtube: ReturnType<typeof createChannelListing>;
  let queue: ReturnType<typeof createQueue>;
  const deps = () => ({ fetchLatest: youtube.fetchLatest, queue });
  const check = () => runAutoKeepChecks(db, deps());

  beforeEach(async () => {
    db = await createDb();
    youtube = createChannelListing(db);
    queue = createQueue(db);
    await db.insert(schema.channels).values({
      id: CHANNEL,
      channelId: CHANNEL,
      channelTitle: "Channel",
      createdAt: 1,
      subscribedAt: 1,
    });
  });

  it("keeps none of a Channel's existing Videos when switched on", async () => {
    for (let i = 0; i < 10; i++) youtube.publish(`old${i}`, { publishedAt: i + 1 });
    await youtube.fetchLatest(CHANNEL); // the Channel page loaded them earlier
    youtube.publish("undated", { publishedAt: null });

    await setAutoKeep(db, CHANNEL, { enabled: true });
    await check();

    expect(queue.addToQueue).not.toHaveBeenCalled();
  });

  it("does not keep a Video the app knew before switching on, even if it looks new", async () => {
    youtube.publish("seen-on-page");
    await youtube.fetchLatest(CHANNEL);

    await setAutoKeep(db, CHANNEL, { enabled: true });
    await check();

    expect(queue.addToQueue).not.toHaveBeenCalled();
  });

  it("does not keep a Video listed when switched on, even if it looks new", async () => {
    youtube.publish("just-before");
    await setAutoKeep(db, CHANNEL, { enabled: true });
    await takeAutoKeepBaseline(db, CHANNEL, deps());

    youtube.publish("just-after");
    await check();

    expect(queuedIds(queue)).toEqual(["just-after"]);
  });

  it("keeps a Video published after switching on into the target List and the On-device set", async () => {
    await db.insert(schema.customPlaylists).values({ id: "list", name: "Commute", createdAt: 1 });
    await setListOnDevices(db, "list", true);
    await setAutoKeep(db, CHANNEL, { enabled: true, listId: "list" });

    youtube.publish("new");
    await check();

    expect(queuedIds(queue)).toEqual(["new"]);
    const items = await db.query.customPlaylistItems.findMany();
    expect(items.map((i) => i.videoId)).toEqual(["new"]);
    expect(await loadOnDeviceSetIds(db)).toEqual(new Set(["new"]));
  });

  it("keeps the newest 5 of 8 new Videos and leaves the rest in New from Subscriptions", async () => {
    await setAutoKeep(db, CHANNEL, { enabled: true });
    const base = LATER();
    for (let i = 0; i < 8; i++) youtube.publish(`v${i}`, { publishedAt: base + i });

    await check();
    await check();

    expect(queuedIds(queue)).toEqual(["v7", "v6", "v5", "v4", "v3"]);
    const waiting = await loadNewFromSubscriptions(db);
    expect(waiting.map((v) => v.videoId).sort()).toEqual(["v0", "v1", "v2"]);
  });

  it("never keeps Shorts or streams that have not aired", async () => {
    await setAutoKeep(db, CHANNEL, { enabled: true });
    youtube.publish("short", { isShort: true });
    youtube.publish("upcoming", { liveStatus: "is_upcoming" });

    await check();

    expect(queue.addToQueue).not.toHaveBeenCalled();
  });

  it("does not keep again a Video the user removed from the Library", async () => {
    await setAutoKeep(db, CHANNEL, { enabled: true });
    youtube.publish("new");
    await check();
    await db
      .update(schema.youtubeVideos)
      .set({ keptAt: null, downloadStatus: null })
      .where(eq(schema.youtubeVideos.videoId, "new"));

    await check();

    expect(queuedIds(queue)).toEqual(["new"]);
  });

  it("does not fetch again a Video kept by hand, but still adds it to the List", async () => {
    await setAutoKeep(db, CHANNEL, { enabled: true, listId: PHONE_LIST_ID });
    youtube.publish("by-hand");
    await youtube.fetchLatest(CHANNEL);
    await db
      .update(schema.youtubeVideos)
      .set({ downloadStatus: "completed", keptAt: 1 })
      .where(eq(schema.youtubeVideos.videoId, "by-hand"));

    await check();

    const video = await db.query.youtubeVideos.findFirst();
    expect(video?.downloadStatus).toBe("completed");
    expect(await loadOnDeviceSetIds(db)).toEqual(new Set(["by-hand"]));
  });

  it("carries on into the Library only once the target List is deleted", async () => {
    await db.insert(schema.customPlaylists).values({ id: "list", name: "Commute", createdAt: 1 });
    await setAutoKeep(db, CHANNEL, { enabled: true, listId: "list" });
    await db.delete(schema.customPlaylists).where(eq(schema.customPlaylists.id, "list"));

    youtube.publish("new");
    await check();

    expect(queuedIds(queue)).toEqual(["new"]);
    expect(await db.query.customPlaylistItems.findMany()).toEqual([]);
    expect(await getAutoKeep(db, CHANNEL)).toMatchObject({
      enabled: true,
      listDeleted: true,
      lastCheckFailed: false,
    });
  });

  it("records a failed check and retries at the next one", async () => {
    await setAutoKeep(db, CHANNEL, { enabled: true });
    youtube.publish("new");
    youtube.setFailing(true);

    await check();
    expect(await getAutoKeep(db, CHANNEL)).toMatchObject({ lastCheckFailed: true });
    expect(queue.addToQueue).not.toHaveBeenCalled();

    youtube.setFailing(false);
    await check();
    expect(await getAutoKeep(db, CHANNEL)).toMatchObject({ lastCheckFailed: false });
    expect(queuedIds(queue)).toEqual(["new"]);
  });

  it("stops checking once switched off or unsubscribed, leaving kept Videos alone", async () => {
    await setAutoKeep(db, CHANNEL, { enabled: true, listId: PHONE_LIST_ID });
    youtube.publish("new");
    await check();

    await setAutoKeep(db, CHANNEL, { enabled: false });
    await check();
    await setAutoKeep(db, CHANNEL, { enabled: true });
    await setSubscribed(db, CHANNEL, false);
    await check();

    expect(youtube.fetchLatest).toHaveBeenCalledTimes(1);
    expect(await getAutoKeep(db, CHANNEL)).toMatchObject({ enabled: false });
    expect(await loadOnDeviceSetIds(db)).toEqual(new Set(["new"]));
  });

  it("tells when a change switched Auto-keep on", async () => {
    expect(await setAutoKeep(db, CHANNEL, { enabled: true })).toBe("switched-on");
    expect(await setAutoKeep(db, CHANNEL, { enabled: true, listId: PHONE_LIST_ID })).toBe("saved");
  });

  it("cannot be switched on for a Channel that is not a Subscription", async () => {
    await setSubscribed(db, CHANNEL, false);
    expect(await setAutoKeep(db, CHANNEL, { enabled: true })).toBe("not-subscribed");
  });
});
