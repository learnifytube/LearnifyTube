import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import {
  findMovie,
  forgetMovie,
  listMovieFilePaths,
  listMovies,
  markMissingMovies,
  recordMoviePlayback,
  renameMovie,
  saveImportedMovies,
  setMovieWatched,
} from "./catalog";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const importFilms = (db: Db) =>
  saveImportedMovies(
    db,
    "/films",
    [
      {
        path: "Up (2009).mp4",
        title: "Up (2009)",
        posterPath: "/userData/movie-posters/up.jpg",
        durationSeconds: 5760.4,
        videoCodec: "h264",
        audioCodec: "aac",
      },
      {
        path: "Alien (1979)/Alien.1979.mkv",
        title: "Alien (1979)",
        posterPath: null,
        durationSeconds: null,
        videoCodec: "hevc",
        audioCodec: "ac3",
      },
    ],
    1000
  );

describe("Movie catalog", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("is empty when nothing was imported", async () => {
    expect(await listMovies(db)).toEqual([]);
  });

  it("lists imported Movies by title, unwatched, with their files where they are", async () => {
    const [upId, alienId] = await importFilms(db);

    expect(await listMovies(db)).toEqual([
      {
        id: alienId,
        title: "Alien (1979)",
        posterPath: null,
        durationSeconds: null,
        missing: false,
        positionSeconds: null,
        shownOnDevices: true,
        watchState: "unwatched",
      },
      {
        id: upId,
        title: "Up (2009)",
        posterPath: "/userData/movie-posters/up.jpg",
        durationSeconds: 5760,
        missing: false,
        positionSeconds: null,
        shownOnDevices: true,
        watchState: "unwatched",
      },
    ]);
    expect(await findMovie(db, alienId)).toMatchObject({
      sourceFolder: "/films",
      filePath: path.join("/films", "Alien (1979)/Alien.1979.mkv"),
      videoCodec: "hevc",
      audioCodec: "ac3",
      shownOnDevices: true,
      sentToDevices: false,
    });
    expect((await listMovieFilePaths(db)).sort()).toEqual([
      path.join("/films", "Alien (1979)/Alien.1979.mkv"),
      path.join("/films", "Up (2009).mp4"),
    ]);
  });

  it("lets the user rename a Movie", async () => {
    const [upId] = await importFilms(db);
    await renameMovie(db, upId, "  Up  ");
    expect((await findMovie(db, upId))?.title).toBe("Up");
  });

  it("resumes where playback stopped, and is watched at about 90%", async () => {
    const [upId] = await importFilms(db);

    await recordMoviePlayback(db, { movieId: upId, positionSeconds: 600.7 }, 2000);
    expect((await listMovies(db)).find((m) => m.id === upId)).toMatchObject({
      positionSeconds: 600,
      watchState: "in-progress",
    });

    await recordMoviePlayback(db, { movieId: upId, positionSeconds: 5200 }, 3000);
    expect(await findMovie(db, upId)).toMatchObject({
      positionSeconds: 5200,
      watchedAt: 3000,
      watchUpdatedAt: 3000,
    });

    // Watching it again from the start keeps it watched.
    await recordMoviePlayback(db, { movieId: upId, positionSeconds: 30 }, 4000);
    expect(await findMovie(db, upId)).toMatchObject({ positionSeconds: 30, watchedAt: 3000 });
  });

  it("is never watched while its length is unknown, until the player learns it", async () => {
    const [, alienId] = await importFilms(db);

    await recordMoviePlayback(db, { movieId: alienId, positionSeconds: 7000 }, 2000);
    expect((await findMovie(db, alienId))?.watchedAt).toBeNull();

    await recordMoviePlayback(
      db,
      { movieId: alienId, positionSeconds: 7000, durationSeconds: 7020 },
      3000
    );
    expect(await findMovie(db, alienId)).toMatchObject({ watchedAt: 3000, durationSeconds: 7020 });
  });

  it("lets the user mark a Movie watched, and unwatched from the start again", async () => {
    const [upId] = await importFilms(db);
    await recordMoviePlayback(db, { movieId: upId, positionSeconds: 600 }, 2000);

    await setMovieWatched(db, upId, true, 3000);
    expect((await listMovies(db)).find((m) => m.id === upId)?.watchState).toBe("watched");

    await setMovieWatched(db, upId, false, 4000);
    expect(await findMovie(db, upId)).toMatchObject({
      watchedAt: null,
      positionSeconds: 0,
      watchUpdatedAt: 4000,
    });
    expect((await listMovies(db)).find((m) => m.id === upId)?.watchState).toBe("unwatched");
  });

  it("forgets a Movie without touching its file, handing back the poster to clean up", async () => {
    const [upId, alienId] = await importFilms(db);

    expect(await forgetMovie(db, upId)).toEqual({
      posterPath: "/userData/movie-posters/up.jpg",
    });
    expect((await listMovies(db)).map((m) => m.id)).toEqual([alienId]);
    expect(await forgetMovie(db, upId)).toBeNull();
  });

  it("shows a Movie whose file is gone as missing, keeping its Watch state until the file is back", async () => {
    const [up, alien] = await importFilms(db);
    await recordMoviePlayback(db, { movieId: up, positionSeconds: 1200 }, 2000);
    const upFile = path.join("/films", "Up (2009).mp4");
    const present = new Set([path.join("/films", "Alien (1979)/Alien.1979.mkv")]);
    const exists = (filePath: string): Promise<boolean> => Promise.resolve(present.has(filePath));

    expect(await markMissingMovies(db, exists)).toBe(1);
    expect(await findMovie(db, up)).toMatchObject({ missing: true, positionSeconds: 1200 });
    expect(await findMovie(db, alien)).toMatchObject({ missing: false });
    expect(await markMissingMovies(db, exists)).toBe(0);

    present.add(upFile);
    expect(await markMissingMovies(db, exists)).toBe(1);
    expect((await listMovies(db)).find((movie) => movie.id === up)).toMatchObject({
      missing: false,
      watchState: "in-progress",
    });
  });
});
