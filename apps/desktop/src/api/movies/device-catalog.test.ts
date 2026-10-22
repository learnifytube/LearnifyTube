import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/api/db/schema";
import { movieCatalogSchema } from "../../../../shared/mobile-sync-contract";
import { recordMoviePlayback, saveImportedMovies, setMovieWatched } from "./catalog";
import { findMovieFileForDevices, loadMovieCatalog } from "./device-catalog";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const assetUrl = (pathname: string): string => `http://desktop:53318${pathname}`;

const importFilms = (db: Db): Promise<string[]> =>
  saveImportedMovies(
    db,
    "/films",
    [
      {
        path: "Up (2009).mp4",
        title: "Up (2009)",
        posterPath: "/userData/movie-posters/up.jpg",
        durationSeconds: 5760,
        videoCodec: "h264",
        audioCodec: "aac",
      },
      {
        path: "Alien.1979.mkv",
        title: "Alien (1979)",
        posterPath: null,
        durationSeconds: null,
        videoCodec: "hevc",
        audioCodec: "ac3",
      },
    ],
    1000
  );

// Written as rows, with a sent Season and Shown on Devices set directly: their setters come with #56 and #58.
const addSeries = async (db: Db, shownOnDevices = true): Promise<void> => {
  await db.insert(schema.series).values({
    id: "office",
    title: "The Office",
    sourceFolder: "/shows/The Office",
    posterPath: "/userData/movie-posters/office.jpg",
    shownOnDevices,
    createdAt: 1000,
  });
  await db.insert(schema.seasons).values([
    { id: "s2", seriesId: "office", title: "Season 2", number: 2, position: 1 },
    {
      id: "s1",
      seriesId: "office",
      title: "Season 1",
      number: 1,
      position: 0,
      sentToDevices: true,
    },
  ]);
  const episode = { seriesId: "office", createdAt: 1000, durationSeconds: 1300 };
  await db.insert(schema.episodes).values([
    {
      ...episode,
      id: "e2",
      seasonId: "s1",
      title: "Diversity Day",
      number: 2,
      position: 1,
      filePath: "/shows/The Office/S01E02.mkv",
    },
    {
      ...episode,
      id: "e1",
      seasonId: "s1",
      title: "Pilot",
      number: 1,
      position: 0,
      filePath: "/shows/The Office/S01E01.mkv",
      positionSeconds: 400,
      watchUpdatedAt: 1500,
    },
    {
      ...episode,
      id: "e3",
      seasonId: "s2",
      title: "The Dundies",
      number: 1,
      position: 0,
      filePath: "/shows/The Office/S02E01.mkv",
      missing: true,
    },
  ]);
};

describe("Movie catalog for Devices", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("lists every Movie by title, with its poster, length and the desktop's Watch state", async () => {
    const [upId, alienId] = await importFilms(db);
    await recordMoviePlayback(db, { movieId: upId, positionSeconds: 600 }, 2000);

    const catalog = await loadMovieCatalog(db, assetUrl);

    expect(movieCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(catalog.movies).toEqual([
      {
        id: alienId,
        title: "Alien (1979)",
        posterUrl: null,
        durationSeconds: null,
        missing: false,
        captions: [],
        sentToDevices: false,
        watch: null,
      },
      {
        id: upId,
        title: "Up (2009)",
        posterUrl: `http://desktop:53318/api/movie/${upId}/poster?v=1000`,
        durationSeconds: 5760,
        missing: false,
        captions: [],
        sentToDevices: false,
        watch: { positionSeconds: 600, watched: false, updatedAt: 2000 },
      },
    ]);
  });

  it("says a Movie marked watched on the desktop is watched", async () => {
    const [upId] = await importFilms(db);
    await setMovieWatched(db, upId, true, 3000);

    const catalog = await loadMovieCatalog(db, assetUrl);

    expect(catalog.movies.find((m) => m.id === upId)?.watch).toEqual({
      positionSeconds: 0,
      watched: true,
      updatedAt: 3000,
    });
  });

  it("lists a Series with its Seasons and Episodes in order", async () => {
    await addSeries(db);

    const catalog = await loadMovieCatalog(db, assetUrl);

    expect(movieCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(catalog.series).toEqual([
      {
        id: "office",
        title: "The Office",
        posterUrl: "http://desktop:53318/api/series/office/poster?v=1000",
        seasons: [
          {
            id: "s1",
            title: "Season 1",
            number: 1,
            sentToDevices: true,
            episodes: [
              {
                id: "e1",
                title: "Pilot",
                number: 1,
                durationSeconds: 1300,
                missing: false,
                captions: [],
                watch: { positionSeconds: 400, watched: false, updatedAt: 1500 },
              },
              {
                id: "e2",
                title: "Diversity Day",
                number: 2,
                durationSeconds: 1300,
                missing: false,
                captions: [],
                watch: null,
              },
            ],
          },
          {
            id: "s2",
            title: "Season 2",
            number: 2,
            sentToDevices: false,
            episodes: [
              {
                id: "e3",
                title: "The Dundies",
                number: 1,
                durationSeconds: 1300,
                missing: true,
                captions: [],
                watch: null,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("leaves out titles that aren't Shown on Devices, and refuses their files", async () => {
    const [upId, alienId] = await importFilms(db);
    await db
      .update(schema.movies)
      .set({ shownOnDevices: false })
      .where(eq(schema.movies.id, alienId));
    await addSeries(db, false);

    const catalog = await loadMovieCatalog(db, assetUrl);

    expect(catalog.movies.map((m) => m.id)).toEqual([upId]);
    expect(catalog.series).toEqual([]);
    expect(await findMovieFileForDevices(db, "movie", alienId)).toBeNull();
    expect(await findMovieFileForDevices(db, "episode", "e1")).toBeNull();
  });

  it("finds the file of a title Shown on Devices by its id, with the folder it was imported from", async () => {
    const [upId] = await importFilms(db);
    await addSeries(db);

    expect(await findMovieFileForDevices(db, "movie", upId)).toEqual({
      filePath: path.join("/films", "Up (2009).mp4"),
      folder: "/films",
    });
    expect(await findMovieFileForDevices(db, "episode", "e2")).toEqual({
      filePath: "/shows/The Office/S01E02.mkv",
      folder: "/shows/The Office",
    });
    expect(await findMovieFileForDevices(db, "movie", "nope")).toBeNull();
    expect(await findMovieFileForDevices(db, "episode", upId)).toBeNull();
  });
});
