import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/api/db/schema";
import type { LatestVideo } from "@/lib/auto-keep";
import { PHONE_LIST_ID } from "@/lib/lists";
import {
  addToPhoneList,
  loadOnDeviceSetIds,
  recordDeviceReport,
  removeFromPhoneList,
  setListOnDevices,
} from "@/api/on-device/store";
import { addToList } from "./add-to-list";
import { recordWatchProgress, setWatched } from "./watch";
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

describe("Auto-keep: Remove from the List once watched", () => {
  let db: Db;
  let youtube: ReturnType<typeof createChannelListing>;
  const OTHER = "other-chan";
  const deps = () => ({ fetchLatest: youtube.fetchLatest, queue: createQueue(db) });
  const check = () => runAutoKeepChecks(db, deps());

  const listVideoIds = async () =>
    (await db.query.customPlaylistItems.findMany()).map((i) => i.videoId).sort();

  // Plays a Video to the given fraction of its 100 seconds on the desktop
  const playOnDesktop = (videoId: string, fraction: number) =>
    recordWatchProgress(db, { videoId, deltaSeconds: 5, positionSeconds: 100 * fraction });

  const reportFromDevice = (videoId: string, fraction: number) =>
    recordDeviceReport(
      db,
      {
        deviceId: "tv",
        name: "TV",
        kind: "tv",
        offlineVideoIds: [videoId],
        watch: [{ videoId, lastPositionSeconds: 100 * fraction, lastWatchedAt: Date.now() + 1 }],
      },
      Date.now()
    );

  // Auto-keep a new Video of the Channel into the target List
  const autoKeep = async (videoId: string) => {
    youtube.publish(videoId);
    await check();
    await db
      .update(schema.youtubeVideos)
      .set({ durationSeconds: 100 })
      .where(eq(schema.youtubeVideos.videoId, videoId));
  };

  beforeEach(async () => {
    db = await createDb();
    youtube = createChannelListing(db);
    for (const channelId of [CHANNEL, OTHER]) {
      await db.insert(schema.channels).values({
        id: channelId,
        channelId,
        channelTitle: channelId,
        createdAt: 1,
        subscribedAt: 1,
      });
    }
    await db.insert(schema.customPlaylists).values({ id: "list", name: "Commute", createdAt: 1 });
    await setListOnDevices(db, "list", true);
    await setAutoKeep(db, CHANNEL, { enabled: true, listId: "list", removeWatched: true });
  });

  it("is off by default", async () => {
    await setAutoKeep(db, OTHER, { enabled: true, listId: "list" });
    expect(await getAutoKeep(db, OTHER)).toMatchObject({ removeWatched: false });
    expect(await getAutoKeep(db, CHANNEL)).toMatchObject({ removeWatched: true });
  });

  it("removes an auto-kept Video from the List once ~90% played on the desktop", async () => {
    await autoKeep("new");

    await playOnDesktop("new", 0.5);
    expect(await listVideoIds()).toEqual(["new"]);

    await playOnDesktop("new", 0.9);
    expect(await listVideoIds()).toEqual([]);
    expect(await loadOnDeviceSetIds(db)).toEqual(new Set());
    const video = await db.query.youtubeVideos.findFirst({
      where: eq(schema.youtubeVideos.videoId, "new"),
    });
    expect(video?.keptAt).not.toBeNull();
    const stats = await db.query.videoWatchStats.findFirst();
    expect(stats?.watchedAt).not.toBeNull();
  });

  it("removes an auto-kept Video from the List when marked watched", async () => {
    await autoKeep("new");
    await setWatched(db, "new", true);
    expect(await listVideoIds()).toEqual([]);
  });

  it("removes an auto-kept Video from the List when a Device reports it watched", async () => {
    await autoKeep("new");

    await reportFromDevice("new", 0.95);

    expect(await listVideoIds()).toEqual([]);
    expect(await loadOnDeviceSetIds(db)).toEqual(new Set());
  });

  it("does not put the Video back when it is marked unwatched", async () => {
    await autoKeep("new");
    await setWatched(db, "new", true);
    await setWatched(db, "new", false);
    await check();
    expect(await listVideoIds()).toEqual([]);
  });

  it("leaves a Video the user added to the List by hand", async () => {
    await autoKeep("auto");
    youtube.publish("by-hand", { isShort: true }); // never auto-kept
    await youtube.fetchLatest(CHANNEL);
    await db
      .update(schema.youtubeVideos)
      .set({ durationSeconds: 100 })
      .where(eq(schema.youtubeVideos.videoId, "by-hand"));
    await addToList(db, "list", ["by-hand"]);

    await playOnDesktop("by-hand", 1);
    await playOnDesktop("auto", 1);

    expect(await listVideoIds()).toEqual(["by-hand"]);
  });

  it("leaves a Video the user put back into the List after removing it", async () => {
    await autoKeep("new");
    await db.delete(schema.customPlaylistItems);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await addToList(db, "list", ["new"]);

    await playOnDesktop("new", 1);

    expect(await listVideoIds()).toEqual(["new"]);
  });

  it("leaves a Video another Subscription auto-kept into the same List", async () => {
    await setAutoKeep(db, OTHER, { enabled: true, listId: "list" });
    youtube.publish("theirs");
    // Only the other Channel lists the new Video
    await runAutoKeepChecks(db, {
      ...deps(),
      fetchLatest: async (channelId) => (channelId === OTHER ? youtube.fetchLatest(OTHER) : []),
    });
    await db.update(schema.youtubeVideos).set({ durationSeconds: 100 });

    await playOnDesktop("theirs", 1);

    expect(await listVideoIds()).toEqual(["theirs"]);
  });

  it("changes nothing while the switch is off", async () => {
    await setAutoKeep(db, CHANNEL, { enabled: true, removeWatched: false });
    await autoKeep("new");

    await playOnDesktop("new", 1);
    await reportFromDevice("new", 1);

    expect(await listVideoIds()).toEqual(["new"]);
  });

  it("removes already-watched auto-kept Videos as soon as the switch goes on", async () => {
    await setAutoKeep(db, CHANNEL, { enabled: true, removeWatched: false });
    await autoKeep("new");
    await playOnDesktop("new", 1);
    expect(await listVideoIds()).toEqual(["new"]);

    await setAutoKeep(db, CHANNEL, { enabled: true, removeWatched: true });

    expect(await listVideoIds()).toEqual([]);
  });

  it("removes already-watched auto-kept Videos when Auto-keep goes back on", async () => {
    await autoKeep("new");
    await setAutoKeep(db, CHANNEL, { enabled: false, removeWatched: true });
    await playOnDesktop("new", 1);
    expect(await listVideoIds()).toEqual(["new"]);

    await setAutoKeep(db, CHANNEL, { enabled: true });

    expect(await listVideoIds()).toEqual([]);
  });

  it("removes from the Phone List as the target List too", async () => {
    await setAutoKeep(db, CHANNEL, { enabled: true, listId: PHONE_LIST_ID });
    await autoKeep("new");
    expect(await loadOnDeviceSetIds(db)).toEqual(new Set(["new"]));

    await playOnDesktop("new", 1);

    expect(await loadOnDeviceSetIds(db)).toEqual(new Set());
  });

  it("leaves the Phone List entry the user put back by hand", async () => {
    await setAutoKeep(db, CHANNEL, { enabled: true, listId: PHONE_LIST_ID });
    await autoKeep("new");
    await removeFromPhoneList(db, "new");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await addToPhoneList(db, "new");

    await playOnDesktop("new", 1);

    expect(await loadOnDeviceSetIds(db)).toEqual(new Set(["new"]));
  });
});
