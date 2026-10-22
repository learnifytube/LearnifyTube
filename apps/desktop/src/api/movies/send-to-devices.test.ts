import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import type { DeviceReport } from "../../../../shared/mobile-sync-contract";
import { recordDeviceReport } from "../on-device/store";
import type { FolderListing } from "@/api/audiobooks/import-plan";
import { saveImportedMovies } from "./catalog";
import { loadMovieCatalog } from "./device-catalog";
import {
  devicesHoldingMovie,
  devicesHoldingSeason,
  devicesHoldingTitles,
  setMovieSentToDevices,
  setSeasonSentToDevices,
} from "./send-to-devices";
import { getSeries, saveImportedSeries } from "./series-catalog";
import { rescanSeries } from "./series-rescan";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const importFilm = async (db: Db, file: string): Promise<string> => {
  const [id] = await saveImportedMovies(db, "/films", [
    {
      path: file,
      title: file,
      posterPath: null,
      durationSeconds: 6000,
      videoCodec: "h264",
      audioCodec: "aac",
    },
  ]);
  return id;
};

const report = (
  deviceId: string,
  name: string,
  held: Pick<DeviceReport, "heldMovieIds" | "heldEpisodeIds"> = {}
): DeviceReport => ({
  deviceId,
  name,
  kind: "phone",
  offlineVideoIds: [],
  watch: [],
  ...held,
});

const sentIds = async (db: Db): Promise<string[]> =>
  (await loadMovieCatalog(db, (p) => p)).movies
    .filter((movie) => movie.sentToDevices)
    .map((movie) => movie.id);

describe("Send a Movie to Devices", () => {
  let db: Db;
  let up: string;
  let alien: string;
  beforeEach(async () => {
    db = await createDb();
    up = await importFilm(db, "Up.mp4");
    alien = await importFilm(db, "Alien.mkv");
  });

  it("sends the Movie to Devices and removes it again", async () => {
    expect(await setMovieSentToDevices(db, up, true)).toBe(true);
    expect(await sentIds(db)).toEqual([up]);

    expect(await setMovieSentToDevices(db, up, false)).toBe(true);
    expect(await sentIds(db)).toEqual([]);
  });

  it("says nothing changed for an unknown Movie or one already in that state", async () => {
    expect(await setMovieSentToDevices(db, "unknown", true)).toBe(false);
    expect(await setMovieSentToDevices(db, alien, false)).toBe(false);
  });

  it("shows which Devices hold a Movie, as each last reported", async () => {
    await recordDeviceReport(db, report("phone-1", "Pixel", { heldMovieIds: [up, alien] }), 5_000);
    await recordDeviceReport(db, report("phone-2", "Tablet", { heldMovieIds: [alien] }), 6_000);
    // A Device older than Movies reports none.
    await recordDeviceReport(db, report("phone-3", "Old phone"), 7_000);

    expect(await devicesHoldingMovie(db, up)).toEqual([
      { id: "phone-1", name: "Pixel", kind: "phone", lastSeenAt: 5_000 },
    ]);
    expect((await devicesHoldingMovie(db, alien)).map((d) => d.name)).toEqual(["Tablet", "Pixel"]);

    // A later report without the Movie means the Device no longer holds it.
    await recordDeviceReport(db, report("phone-1", "Pixel", { heldMovieIds: [alien] }), 8_000);
    expect(await devicesHoldingMovie(db, up)).toEqual([]);
  });

  it("counts a Device as holding Episodes only when it holds every one of them", async () => {
    await recordDeviceReport(
      db,
      report("phone-1", "Pixel", { heldEpisodeIds: ["e1", "e2"] }),
      5_000
    );
    await recordDeviceReport(db, report("phone-2", "Tablet", { heldEpisodeIds: ["e1"] }), 6_000);

    expect((await devicesHoldingTitles(db, "episode", ["e1", "e2"])).map((d) => d.name)).toEqual([
      "Pixel",
    ]);
    // Movie and Episode ids are reported apart.
    expect(await devicesHoldingTitles(db, "movie", ["e1"])).toEqual([]);
    // Nothing to hold means no Device holds it.
    expect(await devicesHoldingTitles(db, "episode", [])).toEqual([]);
  });
});

const FOLDER = "/shows/Office";

const episode = (file: string, number: number) => ({
  path: file,
  title: path.basename(file, ".mkv"),
  number,
  durationSeconds: 1200,
  videoCodec: "h264",
  audioCodec: "aac",
});

const importOffice = async (db: Db) => {
  const id = await saveImportedSeries(db, FOLDER, {
    title: "The Office",
    posterPath: null,
    seasons: [
      {
        title: "Season 1",
        number: 1,
        episodes: [episode("Season 1/S01E01.mkv", 1), episode("Season 1/S01E02.mkv", 2)],
      },
      { title: "Season 2", number: 2, episodes: [episode("Season 2/S02E01.mkv", 1)] },
    ],
  });
  const found = await getSeries(db, id);
  if (!found) throw new Error("not saved");
  return found;
};

const listing = (...paths: string[]): FolderListing => ({
  name: "Office",
  files: paths.map((file) => ({ path: file, durationSeconds: 1200, videoCodec: "h264" })),
});

// What a Device sees: the sent Seasons' Episodes, by Season title.
const sentEpisodes = async (db: Db) =>
  (await loadMovieCatalog(db, (p) => p)).series.flatMap((show) =>
    show.seasons
      .filter((season) => season.sentToDevices)
      .map((season) => [season.title, season.episodes.map((e) => e.title)])
  );

describe("Send a Season to Devices", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("sends one Season, not the whole Series, and removes it again", async () => {
    const office = await importOffice(db);
    const [season1, season2] = office.seasons;

    expect(await setSeasonSentToDevices(db, season1.id, true)).toBe(true);
    expect(await sentEpisodes(db)).toEqual([["Season 1", ["S01E01", "S01E02"]]]);
    expect((await getSeries(db, office.id))?.seasons.map((s) => s.sentToDevices)).toEqual([
      true,
      false,
    ]);

    expect(await setSeasonSentToDevices(db, season2.id, true)).toBe(true);
    expect(await setSeasonSentToDevices(db, season1.id, false)).toBe(true);
    expect(await sentEpisodes(db)).toEqual([["Season 2", ["S02E01"]]]);
  });

  it("says nothing changed for an unknown Season or one already in that state", async () => {
    const office = await importOffice(db);
    expect(await setSeasonSentToDevices(db, "unknown", true)).toBe(false);
    expect(await setSeasonSentToDevices(db, office.seasons[0].id, false)).toBe(false);
  });

  it("sends the Episodes a Rescan finds in a sent Season too", async () => {
    const office = await importOffice(db);
    await setSeasonSentToDevices(db, office.seasons[0].id, true);

    await rescanSeries(
      db,
      office.id,
      listing(
        "Season 1/S01E01.mkv",
        "Season 1/S01E02.mkv",
        "Season 1/S01E03.mkv",
        "Season 2/S02E01.mkv",
        "Season 2/S02E02.mkv"
      )
    );

    // Season 2 gained an Episode too, but it wasn't sent.
    expect(await sentEpisodes(db)).toEqual([["Season 1", ["S01E01", "S01E02", "S01E03"]]]);
  });

  it("shows a Device as holding the Season once it holds every Episode that can play", async () => {
    const office = await importOffice(db);
    const season1 = office.seasons[0];
    const [e1, e2] = season1.episodes.map((e) => e.id);
    await recordDeviceReport(db, report("phone-1", "Pixel", { heldEpisodeIds: [e1, e2] }), 5_000);
    await recordDeviceReport(db, report("phone-2", "Tablet", { heldEpisodeIds: [e1] }), 6_000);

    expect((await devicesHoldingSeason(db, season1.id)).map((d) => d.name)).toEqual(["Pixel"]);

    // A missing Episode can't be Downloaded, so the Season is held without it.
    await rescanSeries(db, office.id, listing("Season 1/S01E01.mkv", "Season 2/S02E01.mkv"));
    expect((await devicesHoldingSeason(db, season1.id)).map((d) => d.name)).toEqual([
      "Tablet",
      "Pixel",
    ]);

    expect(await devicesHoldingSeason(db, "unknown")).toEqual([]);
  });

  it("no longer shows a Device as holding the Season once a Rescan adds an Episode it lacks", async () => {
    const office = await importOffice(db);
    const season1 = office.seasons[0];
    await recordDeviceReport(
      db,
      report("phone-1", "Pixel", { heldEpisodeIds: season1.episodes.map((e) => e.id) }),
      5_000
    );

    await rescanSeries(
      db,
      office.id,
      listing(
        "Season 1/S01E01.mkv",
        "Season 1/S01E02.mkv",
        "Season 1/S01E03.mkv",
        "Season 2/S02E01.mkv"
      )
    );

    expect(await devicesHoldingSeason(db, season1.id)).toEqual([]);
  });
});
