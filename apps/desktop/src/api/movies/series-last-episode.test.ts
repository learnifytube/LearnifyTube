import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import type {
  DeviceReport,
  SeriesLastEpisode,
} from "../../../../shared/mobile-sync-contract";
import { recordDeviceReport } from "@/api/on-device/store";
import {
  getSeries,
  recordEpisodePlayback,
  recordEpisodeStarted,
  setEpisodesWatched,
} from "./series-catalog";
import { loadMovieCatalog } from "./device-catalog";

// A Series remembers the Episode last played (ADR-0006), on the desktop and
// from Device reports, newest wins.

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

// The Office: Season 1 (s1e1..s1e5) and Season 2 (s2e1, s2e2), each 1000s long.
const importOffice = async (db: Db): Promise<void> => {
  await db
    .insert(schema.series)
    .values({ id: "office", title: "The Office", sourceFolder: "/series", createdAt: 1000 });
  await db.insert(schema.seasons).values([
    { id: "s1", seriesId: "office", title: "Season 1", position: 0 },
    { id: "s2", seriesId: "office", title: "Season 2", position: 1 },
  ]);
  const episodes = [
    ...[1, 2, 3, 4, 5].map((n) => ({ seasonId: "s1", id: `s1e${n}`, position: n - 1 })),
    ...[1, 2].map((n) => ({ seasonId: "s2", id: `s2e${n}`, position: n - 1 })),
  ];
  await db.insert(schema.episodes).values(
    episodes.map((episode) => ({
      ...episode,
      seriesId: "office",
      title: episode.id,
      filePath: `/series/${episode.id}.mkv`,
      durationSeconds: 1000,
      createdAt: 1000,
    }))
  );
};

const report = (seriesLastEpisodes?: SeriesLastEpisode[]): DeviceReport => ({
  deviceId: "pixel",
  name: "Pixel",
  kind: "phone",
  offlineVideoIds: [],
  watch: [],
  seriesLastEpisodes,
});

const nextUp = async (db: Db) => (await getSeries(db, "office"))?.nextUpEpisodeId;

const lastEpisodeOnDevices = async (db: Db) =>
  (await loadMovieCatalog(db, (p) => p)).series.find((s) => s.id === "office")?.lastEpisode;

const play = async (db: Db, episodeId: string, positionSeconds: number, now: number) => {
  await recordEpisodeStarted(db, episodeId, now);
  await recordEpisodePlayback(db, { episodeId, positionSeconds }, now);
};

describe("a Series' last Episode on the desktop", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
    await importOffice(db);
  });

  it("starts the first Episode before any was played", async () => {
    expect(await nextUp(db)).toBe("s1e1");
    expect(await lastEpisodeOnDevices(db)).toBeNull();
  });

  it("resumes the Episode gone back to last, not the later one in progress", async () => {
    await play(db, "s1e2", 200, 2000);
    await play(db, "s1e5", 500, 3000);
    await play(db, "s1e2", 500, 4000);

    expect(await nextUp(db)).toBe("s1e2");
    expect(await lastEpisodeOnDevices(db)).toEqual({ episodeId: "s1e2", updatedAt: 4000 });
  });

  it("starts the next unwatched Episode once the last one is finished", async () => {
    await play(db, "s1e5", 950, 3000);

    expect(await nextUp(db)).toBe("s2e1");
  });

  it("forgets the last Episode when the whole Series is marked unwatched", async () => {
    await play(db, "s1e3", 500, 3000);

    await setEpisodesWatched(db, { seriesId: "office" }, false, 4000);

    expect(await nextUp(db)).toBe("s1e1");
    expect(await lastEpisodeOnDevices(db)).toEqual({ episodeId: null, updatedAt: 4000 });
  });

  it("forgets the last Episode when its Season is marked unwatched", async () => {
    await setEpisodesWatched(db, { seasonId: "s1" }, true, 2000);
    await play(db, "s2e2", 500, 3000);

    await setEpisodesWatched(db, { seasonId: "s2" }, false, 4000);

    expect(await nextUp(db)).toBe("s2e1");
    expect(await lastEpisodeOnDevices(db)).toEqual({ episodeId: null, updatedAt: 4000 });
  });

  it("keeps the last Episode when another Season is marked unwatched", async () => {
    await play(db, "s2e2", 500, 3000);

    await setEpisodesWatched(db, { seasonId: "s1" }, false, 4000);

    expect(await nextUp(db)).toBe("s2e2");
    expect(await lastEpisodeOnDevices(db)).toEqual({ episodeId: "s2e2", updatedAt: 3000 });
  });
});

describe("a Series' last Episode from Device reports", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
    await importOffice(db);
  });

  it("takes the newest last Episode whichever arrives first", async () => {
    await recordDeviceReport(
      db,
      report([{ seriesId: "office", episodeId: "s1e4", updatedAt: 5000 }]),
      9000
    );
    await recordDeviceReport(
      db,
      report([{ seriesId: "office", episodeId: "s1e2", updatedAt: 4000 }]),
      9500
    );
    expect(await lastEpisodeOnDevices(db)).toEqual({ episodeId: "s1e4", updatedAt: 5000 });
    expect(await nextUp(db)).toBe("s1e4");

    await recordDeviceReport(
      db,
      report([{ seriesId: "office", episodeId: "s2e1", updatedAt: 6000 }]),
      9800
    );
    expect(await lastEpisodeOnDevices(db)).toEqual({ episodeId: "s2e1", updatedAt: 6000 });
  });

  it("is newer than an Episode the desktop started earlier", async () => {
    await recordEpisodeStarted(db, "s1e3", 3000);

    await recordDeviceReport(
      db,
      report([{ seriesId: "office", episodeId: "s1e4", updatedAt: 5000 }]),
      9000
    );

    expect(await nextUp(db)).toBe("s1e4");
  });

  it("loses to a desktop mark made after it", async () => {
    await recordEpisodeStarted(db, "s1e3", 3000);
    await setEpisodesWatched(db, { seriesId: "office" }, false, 6000);

    await recordDeviceReport(
      db,
      report([{ seriesId: "office", episodeId: "s1e4", updatedAt: 5000 }]),
      9000
    );

    expect(await lastEpisodeOnDevices(db)).toEqual({ episodeId: null, updatedAt: 6000 });
    expect(await nextUp(db)).toBe("s1e1");
  });

  it("ignores unknown Series and Episodes of another Series", async () => {
    await recordDeviceReport(
      db,
      report([
        { seriesId: "other", episodeId: "s1e2", updatedAt: 5000 },
        { seriesId: "office", episodeId: "elsewhere", updatedAt: 5000 },
      ]),
      9000
    );

    expect(await lastEpisodeOnDevices(db)).toBeNull();
  });

  it("accepts reports from Devices older than resume", async () => {
    await recordEpisodeStarted(db, "s1e3", 3000);

    await recordDeviceReport(db, report(), 9000);

    expect(await lastEpisodeOnDevices(db)).toEqual({ episodeId: "s1e3", updatedAt: 3000 });
  });
});
