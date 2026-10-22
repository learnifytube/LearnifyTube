import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import type { DeviceReport, MovieWatch } from "../../../../shared/mobile-sync-contract";
import { recordDeviceReport } from "@/api/on-device/store";
import { saveImportedMovies, setMovieWatched } from "./catalog";
import { loadMovieCatalog } from "./device-catalog";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const importUp = async (db: Db): Promise<string> => {
  const [id] = await saveImportedMovies(
    db,
    "/films",
    [
      {
        path: "Up.mp4",
        title: "Up",
        posterPath: null,
        durationSeconds: 6000,
        videoCodec: "h264",
        audioCodec: "aac",
      },
    ],
    1000
  );
  return id;
};

const addEpisode = async (db: Db): Promise<void> => {
  await db.insert(schema.series).values({
    id: "office",
    title: "The Office",
    sourceFolder: "/shows",
    createdAt: 1000,
  });
  await db
    .insert(schema.seasons)
    .values({ id: "s1", seriesId: "office", title: "Season 1", position: 0 });
  await db.insert(schema.episodes).values({
    id: "e1",
    seriesId: "office",
    seasonId: "s1",
    title: "Pilot",
    filePath: "/shows/S01E01.mkv",
    position: 0,
    durationSeconds: 1000,
    createdAt: 1000,
  });
};

const report = (movieWatch?: MovieWatch[]): DeviceReport => ({
  deviceId: "pixel",
  name: "Pixel",
  kind: "phone",
  offlineVideoIds: [],
  watch: [],
  movieWatch,
});

const watchOf = async (db: Db, id: string) => {
  const catalog = await loadMovieCatalog(db, (p) => p);
  return (
    catalog.movies.find((m) => m.id === id)?.watch ??
    catalog.series
      .flatMap((s) => s.seasons.flatMap((season) => season.episodes))
      .find((e) => e.id === id)?.watch ??
    null
  );
};

describe("Movie watch from Device reports", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("takes where a Device stopped in a Movie as the desktop's Watch state", async () => {
    const upId = await importUp(db);

    await recordDeviceReport(
      db,
      report([{ kind: "movie", id: upId, lastPositionSeconds: 1200.6, lastWatchedAt: 5000 }]),
      9000
    );

    expect(await watchOf(db, upId)).toEqual({
      positionSeconds: 1200,
      watched: false,
      updatedAt: 9000,
    });
  });

  it("makes a Movie watched once a Device played about 90% of it", async () => {
    const upId = await importUp(db);

    await recordDeviceReport(
      db,
      report([{ kind: "movie", id: upId, lastPositionSeconds: 5500, lastWatchedAt: 5000 }]),
      9000
    );

    expect((await watchOf(db, upId))?.watched).toBe(true);
  });

  it("keeps a desktop mark made after the Device last played", async () => {
    const upId = await importUp(db);
    await setMovieWatched(db, upId, true, 6000);

    await recordDeviceReport(
      db,
      report([{ kind: "movie", id: upId, lastPositionSeconds: 300, lastWatchedAt: 5000 }]),
      9000
    );

    expect(await watchOf(db, upId)).toEqual({ positionSeconds: 0, watched: true, updatedAt: 6000 });
  });

  it("does not take the same Device progress again after the desktop played on", async () => {
    const upId = await importUp(db);
    const entry: MovieWatch = {
      kind: "movie",
      id: upId,
      lastPositionSeconds: 300,
      lastWatchedAt: 5000,
    };
    await recordDeviceReport(db, report([entry]), 9000);
    await setMovieWatched(db, upId, false, 9500);

    await recordDeviceReport(db, report([entry]), 10_000);

    expect(await watchOf(db, upId)).toEqual({
      positionSeconds: 0,
      watched: false,
      updatedAt: 9500,
    });
  });

  it("takes Episode progress too", async () => {
    await addEpisode(db);

    await recordDeviceReport(
      db,
      report([{ kind: "episode", id: "e1", lastPositionSeconds: 950, lastWatchedAt: 5000 }]),
      9000
    );

    expect(await watchOf(db, "e1")).toEqual({
      positionSeconds: 950,
      watched: true,
      updatedAt: 9000,
    });
  });

  it("ignores titles the desktop doesn't know, and reports from Devices older than Movies", async () => {
    const upId = await importUp(db);

    await recordDeviceReport(
      db,
      report([{ kind: "episode", id: upId, lastPositionSeconds: 100, lastWatchedAt: 5000 }]),
      9000
    );
    await recordDeviceReport(db, report(undefined), 9000);

    expect(await watchOf(db, upId)).toBeNull();
  });
});
