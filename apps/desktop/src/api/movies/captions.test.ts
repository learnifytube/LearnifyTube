import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/api/db/schema";
import type { FolderListing } from "@/api/audiobooks/import-plan";
import { forgetMovie, saveImportedMovies } from "./catalog";
import {
  captionsByOwner,
  findCaptionForDevices,
  listCaptions,
  pairMovieCaptionsAgain,
} from "./captions";
import { loadMovieCatalog } from "./device-catalog";
import { forgetSeries, getSeries, saveImportedSeries } from "./series-catalog";
import { rescanSeries } from "./series-rescan";
import { setShownOnDevices } from "./shown-on-devices";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const assetUrl = (pathname: string): string => `http://desktop:53318${pathname}`;

const english = { path: "Up.en.srt", language: "en", label: "English" };
const french = { path: "Up.fr.vtt", language: "fr", label: "French" };

const importUp = async (db: Db): Promise<string> => {
  const [id] = await saveImportedMovies(db, "/films", [
    {
      path: "Up.mp4",
      title: "Up",
      posterPath: null,
      durationSeconds: 5760,
      videoCodec: "h264",
      audioCodec: "aac",
      captions: [english, french],
    },
  ]);
  return id;
};

const SHOW = "/shows/Office";
const episode = (file: string, number: number, captions: string[] = []) => ({
  path: file,
  title: path.basename(file, ".mkv"),
  number,
  durationSeconds: 1300,
  videoCodec: "h264",
  audioCodec: "aac",
  captions: captions.map((caption) => ({ path: caption, language: "en", label: "English" })),
});

const importOffice = (db: Db): Promise<string> =>
  saveImportedSeries(db, SHOW, {
    title: "The Office",
    posterPath: null,
    seasons: [
      {
        title: "Season 1",
        number: 1,
        episodes: [episode("S01E01.mkv", 1, ["S01E01.en.srt"]), episode("S01E02.mkv", 2)],
      },
    ],
  });

describe("Sidecar Captions", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("lists a Movie's Captions to Devices, in picker order, and finds each file by id", async () => {
    const id = await importUp(db);

    const [movie] = (await loadMovieCatalog(db, assetUrl)).movies;

    expect(movie.captions.map(({ language, label }) => [language, label])).toEqual([
      ["en", "English"],
      ["fr", "French"],
    ]);
    expect(await findCaptionForDevices(db, movie.captions[1].id)).toEqual({
      filePath: path.join("/films", "Up.fr.vtt"),
      folder: "/films",
    });
    expect(await listCaptions(db, { kind: "movie", id })).toEqual([
      { ...movie.captions[0], filePath: path.join("/films", "Up.en.srt") },
      { ...movie.captions[1], filePath: path.join("/films", "Up.fr.vtt") },
    ]);
  });

  it("lists each Episode's Captions, and finds them inside the Series folder", async () => {
    const seriesId = await importOffice(db);

    const [show] = (await loadMovieCatalog(db, assetUrl)).series;
    const [first, second] = show.seasons[0].episodes;

    expect(first.captions.map(({ language, label }) => [language, label])).toEqual([
      ["en", "English"],
    ]);
    expect(second.captions).toEqual([]);
    expect(await findCaptionForDevices(db, first.captions[0].id)).toEqual({
      filePath: path.join(SHOW, "S01E01.en.srt"),
      folder: SHOW,
    });
    const detail = await getSeries(db, seriesId);
    expect(
      await listCaptions(db, { kind: "episode", id: detail!.seasons[0].episodes[0].id })
    ).toHaveLength(1);
  });

  it("serves no Caption of a title that isn't Shown on Devices, or that is forgotten", async () => {
    const movieId = await importUp(db);
    const seriesId = await importOffice(db);
    const catalog = await loadMovieCatalog(db, assetUrl);
    const movieCaption = catalog.movies[0].captions[0].id;
    const episodeCaption = catalog.series[0].seasons[0].episodes[0].captions[0].id;

    await setShownOnDevices(db, { kind: "series", id: seriesId }, false);
    expect(await findCaptionForDevices(db, episodeCaption)).toBeNull();
    expect(await findCaptionForDevices(db, movieCaption)).not.toBeNull();

    await forgetMovie(db, movieId);
    expect(await findCaptionForDevices(db, movieCaption)).toBeNull();
    expect(await findCaptionForDevices(db, "nope")).toBeNull();
  });

  it("picks up sidecars a Rescan finds, and drops those that are gone", async () => {
    const seriesId = await importOffice(db);
    const listing: FolderListing = {
      name: "Office",
      files: [
        { path: "S01E01.mkv" },
        { path: "S01E02.mkv" },
        { path: "S01E02.de.srt" },
        { path: "S01E03.mkv" },
        { path: "S01E03.srt" },
      ],
    };

    await rescanSeries(db, seriesId, listing);

    const [show] = (await loadMovieCatalog(db, assetUrl)).series;
    expect(
      show.seasons[0].episodes.map((e) => [e.title, e.captions.map((caption) => caption.label)])
    ).toEqual([
      ["S01E01", []],
      ["S01E02", ["German"]],
      ["S01E03", ["Captions"]],
    ]);
  });

  it("keeps a Caption's id across a Rescan that still finds its file", async () => {
    const seriesId = await importOffice(db);
    const before = (await loadMovieCatalog(db, assetUrl)).series[0].seasons[0].episodes[0];

    await rescanSeries(db, seriesId, {
      name: "Office",
      files: [{ path: "S01E01.mkv" }, { path: "S01E01.en.srt" }, { path: "S01E02.mkv" }],
    });

    const after = (await loadMovieCatalog(db, assetUrl)).series[0].seasons[0].episodes[0];
    expect(after.captions).toEqual(before.captions);
  });

  it("pairs a Movie's sidecars again from the files now beside it", async () => {
    const id = await importUp(db);

    expect(await pairMovieCaptionsAgain(db, id, ["Up.mp4", "Up.en.srt", "Up.es.srt"])).toBe(true);
    expect((await listCaptions(db, { kind: "movie", id })).map((c) => c.label)).toEqual([
      "English",
      "Spanish",
    ]);
    expect(await pairMovieCaptionsAgain(db, id, ["Up.mp4", "Up.en.srt", "Up.es.srt"])).toBe(false);
    expect(await pairMovieCaptionsAgain(db, "nope", [])).toBe(false);
  });
  it("forgets a title's Captions with it, even on a connection that doesn't cascade", async () => {
    const movieId = await importUp(db);
    const seriesId = await importOffice(db);
    await db.run(sql`PRAGMA foreign_keys = OFF`);

    await forgetMovie(db, movieId);
    await forgetSeries(db, seriesId);

    expect((await captionsByOwner(db)).size).toBe(0);
  });
});
