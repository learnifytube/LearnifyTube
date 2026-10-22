import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { findMovie, saveImportedMovies } from "./catalog";
import { loadMovieCatalog } from "./device-catalog";
import { getSeries, saveImportedSeries } from "./series-catalog";
import { setTitlePoster } from "./title-poster";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

const POSTERS = "/userData/movie-posters";

describe("Choosing a poster after saving", () => {
  it("gives a Movie the chosen poster, and Devices fetch it under a new URL", async () => {
    const db = await createDb();
    const [id] = await saveImportedMovies(
      db,
      "/films",
      [
        {
          path: "Up.mp4",
          title: "Up",
          posterPath: `${POSTERS}/up.jpg`,
          durationSeconds: 5760,
          videoCodec: "h264",
          audioCodec: "aac",
        },
      ],
      1000
    );

    const result = await setTitlePoster(db, { kind: "movie", id }, `${POSTERS}/up-2000.png`, 2000);

    expect(result).toEqual({ previous: `${POSTERS}/up.jpg` });
    expect((await findMovie(db, id))?.posterPath).toBe(`${POSTERS}/up-2000.png`);
    expect((await loadMovieCatalog(db, (p) => p)).movies[0].posterUrl).toBe(
      `/api/movie/${id}/poster?v=2000`
    );
  });

  it("gives a Series without a poster the chosen one", async () => {
    const db = await createDb();
    const id = await saveImportedSeries(db, "/series/Office", {
      title: "The Office",
      posterPath: null,
      seasons: [],
    });

    const result = await setTitlePoster(db, { kind: "series", id }, `${POSTERS}/office.jpg`, 3000);

    expect(result).toEqual({ previous: null });
    expect((await getSeries(db, id))?.posterPath).toBe(`${POSTERS}/office.jpg`);
    expect((await loadMovieCatalog(db, (p) => p)).series[0].posterUrl).toBe(
      `/api/series/${id}/poster?v=3000`
    );
  });

  it("does nothing for a title that is gone", async () => {
    const db = await createDb();

    expect(await setTitlePoster(db, { kind: "movie", id: "gone" }, `${POSTERS}/x.jpg`)).toBeNull();
  });
});
