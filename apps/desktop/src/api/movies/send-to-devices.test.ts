import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import type { DeviceReport } from "../../../../shared/mobile-sync-contract";
import { recordDeviceReport } from "../on-device/store";
import { saveImportedMovies } from "./catalog";
import { loadMovieCatalog } from "./device-catalog";
import { devicesHoldingMovie, devicesHoldingTitles, setMovieSentToDevices } from "./send-to-devices";

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
    expect((await devicesHoldingMovie(db, alien)).map((d) => d.name)).toEqual([
      "Tablet",
      "Pixel",
    ]);

    // A later report without the Movie means the Device no longer holds it.
    await recordDeviceReport(db, report("phone-1", "Pixel", { heldMovieIds: [alien] }), 8_000);
    expect(await devicesHoldingMovie(db, up)).toEqual([]);
  });

  it("counts a Device as holding Episodes only when it holds every one of them", async () => {
    await recordDeviceReport(db, report("phone-1", "Pixel", { heldEpisodeIds: ["e1", "e2"] }), 5_000);
    await recordDeviceReport(db, report("phone-2", "Tablet", { heldEpisodeIds: ["e1"] }), 6_000);

    expect(
      (await devicesHoldingTitles(db, "episode", ["e1", "e2"])).map((d) => d.name)
    ).toEqual(["Pixel"]);
    // Movie and Episode ids are reported apart.
    expect(await devicesHoldingTitles(db, "movie", ["e1"])).toEqual([]);
    // Nothing to hold means no Device holds it.
    expect(await devicesHoldingTitles(db, "episode", [])).toEqual([]);
  });
});
