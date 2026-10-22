import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { loadMovieCatalog } from "./device-catalog";
import { getSeries, saveImportedSeries } from "./series-catalog";
import { moveSeriesEpisode, moveSeriesSeason } from "./series-order";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const episode = (file: string, number: number) => ({
  path: file,
  title: path.basename(file, ".mkv"),
  number,
  durationSeconds: 1200,
  videoCodec: "h264",
  audioCodec: "aac",
});

const importOffice = (db: Db): Promise<string> =>
  saveImportedSeries(db, "/series/Office", {
    title: "The Office",
    posterPath: null,
    seasons: [
      {
        title: "Season 1",
        number: 1,
        episodes: [episode("S01E01.mkv", 1), episode("S01E02.mkv", 2), episode("S01E03.mkv", 3)],
      },
      { title: "Season 2", number: 2, episodes: [episode("S02E01.mkv", 1)] },
    ],
  });

const outline = async (db: Db, id: string) =>
  (await getSeries(db, id))?.seasons.map((season) => [
    season.title,
    season.episodes.map((e) => e.title),
  ]);

const deviceOutline = async (db: Db) =>
  (await loadMovieCatalog(db, (p) => p)).series[0].seasons.map((season) => [
    season.title,
    season.episodes.map((e) => e.title),
  ]);

const idOf = async (db: Db, seriesId: string, title: string): Promise<string> => {
  const episodes = (await getSeries(db, seriesId))?.seasons.flatMap((s) => s.episodes) ?? [];
  return episodes.find((e) => e.title === title)?.id ?? "";
};

describe("Series order after saving", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("moves an Episode up or down within its Season, and Devices see the new order", async () => {
    const id = await importOffice(db);

    expect(await moveSeriesEpisode(db, await idOf(db, id, "S01E03"), -1)).toBe(true);
    expect(await moveSeriesEpisode(db, await idOf(db, id, "S01E01"), 1)).toBe(true);

    const expected = [
      ["Season 1", ["S01E03", "S01E01", "S01E02"]],
      ["Season 2", ["S02E01"]],
    ];
    expect(await outline(db, id)).toEqual(expected);
    expect(await deviceOutline(db)).toEqual(expected);
  });

  it("keeps an Episode in its Season at either end", async () => {
    const id = await importOffice(db);

    expect(await moveSeriesEpisode(db, await idOf(db, id, "S01E03"), 1)).toBe(false);
    expect(await moveSeriesEpisode(db, await idOf(db, id, "S02E01"), -1)).toBe(false);

    expect(await outline(db, id)).toEqual([
      ["Season 1", ["S01E01", "S01E02", "S01E03"]],
      ["Season 2", ["S02E01"]],
    ]);
  });

  it("moves a Season up or down, and Devices see the new order", async () => {
    const id = await importOffice(db);
    const [, seasonTwo] = (await getSeries(db, id))?.seasons ?? [];

    expect(await moveSeriesSeason(db, seasonTwo.id, -1)).toBe(true);
    expect(await moveSeriesSeason(db, seasonTwo.id, -1)).toBe(false);

    const expected = [
      ["Season 2", ["S02E01"]],
      ["Season 1", ["S01E01", "S01E02", "S01E03"]],
    ];
    expect(await outline(db, id)).toEqual(expected);
    expect(await deviceOutline(db)).toEqual(expected);
  });

  it("does nothing for an Episode or Season that is gone", async () => {
    expect(await moveSeriesEpisode(db, "gone", 1)).toBe(false);
    expect(await moveSeriesSeason(db, "gone", 1)).toBe(false);
  });
});
