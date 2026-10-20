import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { loadAudiobookCatalog } from "./catalog";
import { recordDesktopListening, recordListening } from "./listening";
import { recordDeviceReport } from "../on-device/store";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  await db.insert(schema.audiobooks).values({
    id: "frankl",
    title: "Man's Search for Meaning",
    sourceFolder: "/books/Frankl",
    coverPath: "/covers/frankl.jpg",
    createdAt: 1,
    updatedAt: 5,
  });
  await db.insert(schema.audiobookTracks).values([
    { id: "cd1", audiobookId: "frankl", filePath: "/books/Frankl/CD 1.mp3", position: 0 },
    { id: "cd3", audiobookId: "frankl", filePath: "/books/Frankl/CD 3.mp3", position: 1 },
  ]);
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const assetUrl = (pathname: string): string => `http://desktop${pathname}`;

const frankl = async (db: Db) => (await loadAudiobookCatalog(db, assetUrl)).audiobooks[0];

const listening = (overrides = {}) => ({
  audiobookId: "frankl",
  trackId: "cd3",
  seconds: 754.6,
  updatedAt: 1_000,
  finished: false,
  ...overrides,
});

describe("Recording a Listening position", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("keeps the first position reported for an Audiobook", async () => {
    await recordListening(db, listening());

    expect(await frankl(db)).toMatchObject({
      listeningPosition: { trackId: "cd3", seconds: 754, updatedAt: 1_000 },
      finished: false,
    });
  });

  it("keeps the newest of two positions, whatever order they arrive in", async () => {
    await recordListening(db, listening({ trackId: "cd3", updatedAt: 2_000 }));
    await recordListening(db, listening({ trackId: "cd1", seconds: 10, updatedAt: 1_000 }));

    expect((await frankl(db)).listeningPosition).toEqual({
      trackId: "cd3",
      seconds: 754,
      updatedAt: 2_000,
    });

    await recordListening(db, listening({ trackId: "cd1", seconds: 10, updatedAt: 3_000 }));
    expect((await frankl(db)).listeningPosition).toEqual({
      trackId: "cd1",
      seconds: 10,
      updatedAt: 3_000,
    });
  });

  it("marks the Audiobook finished, and not finished once it is started over", async () => {
    await recordListening(db, listening({ finished: true, updatedAt: 1_000 }));
    expect((await frankl(db)).finished).toBe(true);

    await recordListening(db, listening({ trackId: "cd1", seconds: 0, updatedAt: 2_000 }));
    expect((await frankl(db)).finished).toBe(false);
  });

  it("leaves the cover URL alone, so Devices keep their cached cover", async () => {
    const before = (await frankl(db)).coverUrl;
    await recordListening(db, listening());
    expect((await frankl(db)).coverUrl).toBe(before);
  });

  it("takes Listening positions from a Device report", async () => {
    await recordDeviceReport(
      db,
      {
        deviceId: "phone-1",
        name: "Pixel",
        kind: "phone",
        offlineVideoIds: [],
        watch: [],
        listening: [listening({ updatedAt: 4_000 })],
      },
      5_000
    );

    expect((await frankl(db)).listeningPosition).toEqual({
      trackId: "cd3",
      seconds: 754,
      updatedAt: 4_000,
    });
  });

  it("ignores positions in unknown Audiobooks or in Tracks of another book", async () => {
    await recordListening(db, listening({ audiobookId: "orwell" }));
    await recordListening(db, listening({ trackId: "not-a-frankl-track" }));

    expect((await frankl(db)).listeningPosition).toBeNull();
  });
});

describe("Recording the desktop's own Listening position", () => {
  let db: Db;
  let announced: number;
  const announce = () => {
    announced += 1;
  };
  beforeEach(async () => {
    db = await createDb();
    await db.update(schema.audiobooks).set({ sentToDevices: true });
    announced = 0;
  });

  it("tells Devices the Audiobooks changed when a meaningful position is kept", async () => {
    await recordDesktopListening(db, { listening: listening(), announce: true }, announce);

    expect((await frankl(db)).listeningPosition).toEqual({
      trackId: "cd3",
      seconds: 754,
      updatedAt: 1_000,
    });
    expect(announced).toBe(1);
  });

  it("keeps the position of a book not sent to Devices quietly", async () => {
    await db.update(schema.audiobooks).set({ sentToDevices: false });

    await recordDesktopListening(db, { listening: listening(), announce: true }, announce);

    expect((await frankl(db)).listeningPosition?.updatedAt).toBe(1_000);
    expect(announced).toBe(0);
  });

  it("keeps a periodic position quietly", async () => {
    await recordDesktopListening(db, { listening: listening(), announce: false }, announce);

    expect((await frankl(db)).listeningPosition?.updatedAt).toBe(1_000);
    expect(announced).toBe(0);
  });

  it("announces nothing when a newer position is already kept", async () => {
    await recordListening(db, listening({ updatedAt: 2_000 }));

    await recordDesktopListening(
      db,
      { listening: listening({ trackId: "cd1", updatedAt: 1_000 }), announce: true },
      announce
    );

    expect((await frankl(db)).listeningPosition).toMatchObject({
      trackId: "cd3",
      updatedAt: 2_000,
    });
    expect(announced).toBe(0);
  });
});
