import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { listMovieFilePaths } from "./catalog";
import {
  forgetSeries,
  getSeries,
  listSeries,
  recordEpisodePlayback,
  renameSeries,
  saveImportedSeries,
  setEpisodesWatched,
} from "./series-catalog";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const episode = (file: string, number: number, durationSeconds: number | null = 1200) => ({
  path: file,
  title: file.split("/").pop()?.replace(".mkv", "") ?? file,
  number,
  durationSeconds,
  videoCodec: "h264",
  audioCodec: "aac",
});

const importOffice = (db: Db) =>
  saveImportedSeries(
    db,
    "/shows/Office",
    {
      title: " The Office ",
      posterPath: "/userData/movie-posters/office.jpg",
      seasons: [
        {
          title: "Season 1",
          number: 1,
          episodes: [episode("S1/S01E01.mkv", 1), episode("S1/S01E02.mkv", 2)],
        },
        { title: "Season 2", number: 2, episodes: [episode("S2/S02E01.mkv", 1, null)] },
      ],
    },
    1000
  );

const outline = async (db: Db, id: string) =>
  (await getSeries(db, id))?.seasons.map((season) => [
    season.title,
    season.watchState,
    season.episodes.map((e) => [e.title, e.watchState]),
  ]);

const episodeIds = async (db: Db, id: string): Promise<string[]> =>
  (await getSeries(db, id))?.seasons.flatMap((s) => s.episodes.map((e) => e.id)) ?? [];

describe("Series catalog", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("saves an Import's Seasons and Episodes in the order the preview confirmed", async () => {
    const id = await importOffice(db);

    const series = await getSeries(db, id);
    expect(series).toMatchObject({
      id,
      title: "The Office",
      posterPath: "/userData/movie-posters/office.jpg",
      watchState: "unwatched",
    });
    expect(await outline(db, id)).toEqual([
      [
        "Season 1",
        "unwatched",
        [
          ["S01E01", "unwatched"],
          ["S01E02", "unwatched"],
        ],
      ],
      ["Season 2", "unwatched", [["S02E01", "unwatched"]]],
    ]);
    expect(series?.seasons[0].episodes[0]).toMatchObject({
      filePath: path.join("/shows/Office", "S1/S01E01.mkv"),
      number: 1,
      durationSeconds: 1200,
      missing: false,
    });
    expect((await listMovieFilePaths(db)).sort()).toEqual(
      ["S1/S01E01.mkv", "S1/S01E02.mkv", "S2/S02E01.mkv"].map((f) => path.join("/shows/Office", f))
    );
  });

  it("lists Series by title with how many Seasons and Episodes they have", async () => {
    const office = await importOffice(db);
    const cosmos = await saveImportedSeries(
      db,
      "/shows/Cosmos",
      {
        title: "Cosmos",
        posterPath: null,
        seasons: [{ title: "Season 1", number: 1, episodes: [episode("a.mkv", 1)] }],
      },
      1000
    );
    expect(await listSeries(db)).toEqual([
      {
        id: cosmos,
        title: "Cosmos",
        posterPath: null,
        seasonCount: 1,
        episodeCount: 1,
        watchState: "unwatched",
      },
      {
        id: office,
        title: "The Office",
        posterPath: "/userData/movie-posters/office.jpg",
        seasonCount: 2,
        episodeCount: 3,
        watchState: "unwatched",
      },
    ]);
  });

  it("picks up from the first Episode, then the one in progress, then the next unwatched", async () => {
    const id = await importOffice(db);
    const [e1, e2, e3] = await episodeIds(db, id);
    expect((await getSeries(db, id))?.nextUpEpisodeId).toBe(e1);

    await recordEpisodePlayback(db, { episodeId: e2, positionSeconds: 300.6 }, 2000);
    expect((await getSeries(db, id))?.nextUpEpisodeId).toBe(e2);
    expect((await getSeries(db, id))?.watchState).toBe("in-progress");

    await recordEpisodePlayback(db, { episodeId: e2, positionSeconds: 1100 }, 3000);
    expect(await outline(db, id)).toEqual([
      [
        "Season 1",
        "in-progress",
        [
          ["S01E01", "unwatched"],
          ["S01E02", "watched"],
        ],
      ],
      ["Season 2", "unwatched", [["S02E01", "unwatched"]]],
    ]);
    expect((await getSeries(db, id))?.nextUpEpisodeId).toBe(e1);

    // Unknown length is never watched, until the player learns it.
    await recordEpisodePlayback(db, { episodeId: e3, positionSeconds: 1500 }, 4000);
    expect((await getSeries(db, id))?.seasons[1].episodes[0].watchState).toBe("in-progress");
    await recordEpisodePlayback(
      db,
      { episodeId: e3, positionSeconds: 1500, durationSeconds: 1600 },
      5000
    );
    expect((await getSeries(db, id))?.seasons[1].episodes[0]).toMatchObject({
      watchState: "watched",
      durationSeconds: 1600,
    });
  });

  it("lets the user mark an Episode, a Season or the whole Series watched or unwatched", async () => {
    const id = await importOffice(db);
    const [e1, , e3] = await episodeIds(db, id);
    const seasonOne = (await getSeries(db, id))?.seasons[0].id ?? "";

    await setEpisodesWatched(db, { episodeId: e3 }, true, 2000);
    expect((await getSeries(db, id))?.seasons[1].watchState).toBe("watched");

    await setEpisodesWatched(db, { seasonId: seasonOne }, true, 3000);
    expect((await getSeries(db, id))?.watchState).toBe("watched");
    expect((await getSeries(db, id))?.nextUpEpisodeId).toBeNull();

    await setEpisodesWatched(db, { seriesId: id }, false, 4000);
    expect(await outline(db, id)).toEqual([
      [
        "Season 1",
        "unwatched",
        [
          ["S01E01", "unwatched"],
          ["S01E02", "unwatched"],
        ],
      ],
      ["Season 2", "unwatched", [["S02E01", "unwatched"]]],
    ]);
    expect((await getSeries(db, id))?.nextUpEpisodeId).toBe(e1);
  });

  it("lets the user rename a Series", async () => {
    const id = await importOffice(db);
    await renameSeries(db, id, "  Office  ");
    expect((await getSeries(db, id))?.title).toBe("Office");
  });

  it("forgets a Series without touching its files, handing back the poster to clean up", async () => {
    const id = await importOffice(db);
    expect(await forgetSeries(db, id)).toEqual({
      posterPath: "/userData/movie-posters/office.jpg",
    });
    expect(await listSeries(db)).toEqual([]);
    expect(await getSeries(db, id)).toBeNull();
    expect(await listMovieFilePaths(db)).toEqual([]);
    expect(await forgetSeries(db, id)).toBeNull();
  });
});
