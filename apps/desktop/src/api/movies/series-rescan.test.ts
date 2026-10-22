import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/api/db/schema";
import type { FolderListing } from "@/api/audiobooks/import-plan";
import { listMovieFilePaths } from "./catalog";
import { loadMovieCatalog } from "./device-catalog";
import { getSeries, recordEpisodePlayback, saveImportedSeries } from "./series-catalog";
import { rescanSeries } from "./series-rescan";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const FOLDER = "/shows/Office";
const S01E01 = "Season 1/S01E01.mkv";
const S01E02 = "Season 1/S01E02.mkv";

const episode = (file: string, number: number) => ({
  path: file,
  title: path.basename(file, ".mkv"),
  number,
  durationSeconds: 1200,
  videoCodec: "h264",
  audioCodec: "aac",
});

const importOffice = (db: Db): Promise<string> =>
  saveImportedSeries(
    db,
    FOLDER,
    {
      title: "The Office",
      posterPath: null,
      seasons: [
        { title: "Season 1", number: 1, episodes: [episode(S01E01, 1), episode(S01E02, 2)] },
      ],
    },
    1000
  );

const listing = (...paths: string[]): FolderListing => ({
  name: "Office",
  files: paths.map((file) => ({ path: file, durationSeconds: 1300.4, videoCodec: "hevc" })),
});

const outline = async (db: Db, id: string) =>
  (await getSeries(db, id))?.seasons.map((season) => [
    season.title,
    season.episodes.map((e) => (e.missing ? `${e.title} (missing)` : e.title)),
  ]);

describe("Series Rescan", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("adds new Episodes and Seasons in order, and makes their files playable", async () => {
    const id = await importOffice(db);

    const result = await rescanSeries(
      db,
      id,
      listing(S01E01, S01E02, "Season 1/S01E03.mkv", "Season 2/S02E01.mkv"),
      2000
    );

    expect(result).toMatchObject({ added: 2, missing: 0, filesChanged: true });
    expect(await outline(db, id)).toEqual([
      ["Season 1", ["S01E01", "S01E02", "S01E03"]],
      ["Season 2", ["S02E01"]],
    ]);
    expect((await getSeries(db, id))?.seasons[0].episodes[2]).toMatchObject({
      filePath: path.join(FOLDER, "Season 1/S01E03.mkv"),
      number: 3,
      durationSeconds: 1300,
      watchState: "unwatched",
    });
    expect(await listMovieFilePaths(db)).toContain(path.join(FOLDER, "Season 2/S02E01.mkv"));
  });

  it("keeps a missing Episode's Watch state, skips it for next-up, and restores it when the file is back", async () => {
    const id = await importOffice(db);
    const [e1, e2] = (await getSeries(db, id))?.seasons[0].episodes.map((e) => e.id) ?? [];
    await recordEpisodePlayback(db, { episodeId: e2, positionSeconds: 600 }, 1500);
    expect((await getSeries(db, id))?.nextUpEpisodeId).toBe(e2);

    expect(await rescanSeries(db, id, listing(S01E01), 2000)).toMatchObject({
      added: 0,
      missing: 1,
      filesChanged: false,
    });
    expect(await outline(db, id)).toEqual([["Season 1", ["S01E01", "S01E02 (missing)"]]]);
    expect((await getSeries(db, id))?.nextUpEpisodeId).toBe(e1);
    const onDevices = await loadMovieCatalog(db, (pathname) => pathname);
    expect(onDevices.series[0].seasons[0].episodes.map((e) => e.missing)).toEqual([false, true]);

    await rescanSeries(db, id, listing(S01E01, S01E02), 3000);
    expect((await getSeries(db, id))?.seasons[0].episodes[1]).toMatchObject({
      missing: false,
      positionSeconds: 600,
      watchState: "in-progress",
    });
    expect((await getSeries(db, id))?.nextUpEpisodeId).toBe(e2);
  });

  it("tells which Seasons gained Episodes, so a Season sent to Devices can send them", async () => {
    const id = await importOffice(db);
    const seasonOne = (await getSeries(db, id))?.seasons[0].id;

    const result = await rescanSeries(
      db,
      id,
      listing(S01E01, S01E02, "Season 1/S01E03.mkv", "Season 2/S02E01.mkv"),
      2000
    );

    const seasonTwo = (await getSeries(db, id))?.seasons[1].id;
    expect(result?.seasonsWithNewEpisodes).toEqual([seasonOne, seasonTwo]);
    expect((await rescanSeries(db, id, listing(S01E01), 3000))?.seasonsWithNewEpisodes).toEqual([]);
  });

  it("does nothing for a Series that was forgotten", async () => {
    expect(await rescanSeries(db, "gone", listing(S01E01))).toBeNull();
  });
  it("changes nothing when a write fails part way", async () => {
    const id = await importOffice(db);
    await db.run(
      sql`CREATE TRIGGER fail_episodes BEFORE INSERT ON episodes BEGIN SELECT RAISE(ABORT, 'disk full'); END`
    );

    await expect(
      rescanSeries(db, id, listing(S01E02, "Season 1/S01E03.mkv"), 2000)
    ).rejects.toThrow();

    expect(await outline(db, id)).toEqual([["Season 1", ["S01E01", "S01E02"]]]);
  });
});
