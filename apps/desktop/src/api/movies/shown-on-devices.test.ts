import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { findMovie, saveImportedMovies } from "./catalog";
import { findMovieFileForDevices, findPosterForDevices, loadMovieCatalog } from "./device-catalog";
import { getSeries, listSeries, saveImportedSeries } from "./series-catalog";
import { setShownOnDevices } from "./shown-on-devices";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const assetUrl = (pathname: string): string => `http://desktop:53318${pathname}`;

const importUp = async (db: Db): Promise<string> => {
  const [id] = await saveImportedMovies(db, "/films", [
    {
      path: "Up (2009).mp4",
      title: "Up (2009)",
      posterPath: "/userData/movie-posters/up.jpg",
      durationSeconds: 5760,
      videoCodec: "h264",
      audioCodec: "aac",
    },
  ]);
  return id;
};

const importOffice = (db: Db): Promise<string> =>
  saveImportedSeries(db, "/shows/The Office", {
    title: "The Office",
    posterPath: "/userData/movie-posters/office.jpg",
    seasons: [
      {
        title: "Season 1",
        number: 1,
        episodes: [
          {
            path: "S01E01.mkv",
            title: "Pilot",
            number: 1,
            durationSeconds: 1300,
            videoCodec: "h264",
            audioCodec: "aac",
          },
        ],
      },
    ],
  });

describe("Shown on Devices", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("is on for every imported Movie and Series", async () => {
    const upId = await importUp(db);
    const officeId = await importOffice(db);

    expect((await findMovie(db, upId))?.shownOnDevices).toBe(true);
    expect((await getSeries(db, officeId))?.shownOnDevices).toBe(true);
    expect((await listSeries(db)).map((show) => show.shownOnDevices)).toEqual([true]);
    const catalog = await loadMovieCatalog(db, assetUrl);
    expect(catalog.movies.map((movie) => movie.id)).toEqual([upId]);
    expect(catalog.series.map((show) => show.id)).toEqual([officeId]);
  });

  it("switched off, leaves the title out of the Devices' catalog and refuses its files", async () => {
    const upId = await importUp(db);
    const officeId = await importOffice(db);
    const episodeId = (await getSeries(db, officeId))?.seasons[0].episodes[0].id ?? "";

    expect(await setShownOnDevices(db, { kind: "movie", id: upId }, false)).toBe(true);
    expect(await setShownOnDevices(db, { kind: "series", id: officeId }, false)).toBe(true);

    expect(await loadMovieCatalog(db, assetUrl)).toEqual({ movies: [], series: [] });
    expect(await findMovieFileForDevices(db, "movie", upId)).toBeNull();
    expect(await findMovieFileForDevices(db, "episode", episodeId)).toBeNull();
    expect(await findPosterForDevices(db, "movie", upId)).toBeNull();
    expect(await findPosterForDevices(db, "series", officeId)).toBeNull();
  });

  // The Mirror releases what the catalog no longer lists, so a sent title goes too.
  it("leaves a sent title out too, so the Mirror removes it from Devices", async () => {
    const upId = await importUp(db);
    const officeId = await importOffice(db);
    await db.update(schema.movies).set({ sentToDevices: true });
    await db.update(schema.seasons).set({ sentToDevices: true });

    await setShownOnDevices(db, { kind: "movie", id: upId }, false);
    await setShownOnDevices(db, { kind: "series", id: officeId }, false);

    expect(await loadMovieCatalog(db, assetUrl)).toEqual({ movies: [], series: [] });
  });

  it("switched back on, lists the title again as it was", async () => {
    const upId = await importUp(db);
    await db.update(schema.movies).set({ sentToDevices: true });
    await setShownOnDevices(db, { kind: "movie", id: upId }, false);

    await setShownOnDevices(db, { kind: "movie", id: upId }, true);

    const catalog = await loadMovieCatalog(db, assetUrl);
    expect(catalog.movies).toEqual([expect.objectContaining({ id: upId, sentToDevices: true })]);
    expect((await findMovie(db, upId))?.shownOnDevices).toBe(true);
  });

  it("says nothing changed for an unknown title or one already so", async () => {
    const upId = await importUp(db);

    expect(await setShownOnDevices(db, { kind: "movie", id: upId }, true)).toBe(false);
    expect(await setShownOnDevices(db, { kind: "movie", id: "nope" }, false)).toBe(false);
    expect(await setShownOnDevices(db, { kind: "series", id: "nope" }, false)).toBe(false);
  });
});
