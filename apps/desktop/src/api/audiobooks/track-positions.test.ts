import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import type { DeviceReport } from "../../../../shared/mobile-sync-contract";
import { loadAudiobookCatalog } from "./catalog";
import { recordListening, startBookOver } from "./listening";
import { recordTrackPosition } from "./track-positions";
import { recordDeviceReport } from "../on-device/store";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  await db.insert(schema.audiobooks).values({
    id: "frankl",
    title: "Man's Search for Meaning",
    sourceFolder: "/books/Frankl",
    createdAt: 1,
  });
  await db.insert(schema.audiobookTracks).values([
    { id: "t1", audiobookId: "frankl", filePath: "/books/Frankl/1.mp3", position: 0 },
    { id: "t2", audiobookId: "frankl", filePath: "/books/Frankl/2.mp3", position: 1 },
    { id: "t7", audiobookId: "frankl", filePath: "/books/Frankl/7.mp3", position: 2 },
  ]);
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const assetUrl = (pathname: string): string => `http://desktop${pathname}`;

const frankl = async (db: Db) => (await loadAudiobookCatalog(db, assetUrl)).audiobooks[0];

const positionOf = async (db: Db, trackId: string) =>
  (await frankl(db)).tracks.find((track) => track.id === trackId)?.trackPosition;

const report = (overrides: Partial<DeviceReport> = {}): DeviceReport => ({
  deviceId: "phone-1",
  name: "Pixel",
  kind: "phone",
  offlineVideoIds: [],
  watch: [],
  ...overrides,
});

const position = (overrides = {}) => ({
  audiobookId: "frankl",
  trackId: "t2",
  seconds: 2400,
  playedToEnd: false,
  updatedAt: 1_000,
  ...overrides,
});

describe("Track positions", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("takes Track positions from a Device report", async () => {
    await recordDeviceReport(
      db,
      report({ trackPositions: [position(), position({ trackId: "t1", playedToEnd: true })] }),
      5_000
    );

    expect(await positionOf(db, "t2")).toEqual({
      seconds: 2400,
      playedToEnd: false,
      updatedAt: 1_000,
    });
    expect((await positionOf(db, "t1"))?.playedToEnd).toBe(true);
    expect(await positionOf(db, "t7")).toBeNull();
  });

  it("keeps the newest Track position, whatever order reports arrive in", async () => {
    await recordTrackPosition(db, position({ seconds: 2400, updatedAt: 2_000 }));
    await recordTrackPosition(db, position({ seconds: 60, updatedAt: 1_000 }));
    expect((await positionOf(db, "t2"))?.seconds).toBe(2400);

    await recordTrackPosition(db, position({ seconds: 2500, updatedAt: 3_000 }));
    expect((await positionOf(db, "t2"))?.seconds).toBe(2500);
  });

  it("keeps each Track's own place when the listener jumps between Tracks", async () => {
    await recordTrackPosition(db, position({ trackId: "t2", seconds: 2400, updatedAt: 1_000 }));
    await recordListening(db, {
      audiobookId: "frankl",
      trackId: "t7",
      seconds: 0,
      finished: false,
      updatedAt: 2_000,
    });

    expect((await positionOf(db, "t2"))?.seconds).toBe(2400);
    expect(await positionOf(db, "t7")).toEqual({
      seconds: 0,
      playedToEnd: false,
      updatedAt: 2_000,
    });
  });

  it("takes the Track position of an older Device's Listening position", async () => {
    await recordDeviceReport(
      db,
      report({
        listening: [
          {
            audiobookId: "frankl",
            trackId: "t2",
            seconds: 754.6,
            finished: false,
            updatedAt: 1_000,
          },
        ],
      }),
      5_000
    );

    expect(await positionOf(db, "t2")).toEqual({
      seconds: 754,
      playedToEnd: false,
      updatedAt: 1_000,
    });
  });

  it("gives older Devices the Listening position at its Track's own, newer time", async () => {
    await recordListening(db, {
      audiobookId: "frankl",
      trackId: "t2",
      seconds: 10,
      finished: false,
      updatedAt: 1_000,
    });
    await recordTrackPosition(db, position({ trackId: "t2", seconds: 2400, updatedAt: 2_000 }));

    expect((await frankl(db)).listeningPosition).toEqual({
      trackId: "t2",
      seconds: 2400,
      updatedAt: 2_000,
    });
  });

  it("ignores positions in unknown Audiobooks or in Tracks of another book", async () => {
    await recordTrackPosition(db, position({ audiobookId: "orwell" }));
    await recordTrackPosition(db, position({ trackId: "not-a-frankl-track" }));

    expect((await frankl(db)).tracks.map((track) => track.trackPosition)).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe("Starting a book over on the desktop", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
    await recordTrackPosition(db, position({ trackId: "t1", playedToEnd: true, updatedAt: 1_000 }));
    await recordTrackPosition(db, position({ trackId: "t2", seconds: 2400, updatedAt: 1_000 }));
    await recordListening(db, {
      audiobookId: "frankl",
      trackId: "t2",
      seconds: 2400,
      finished: false,
      updatedAt: 1_000,
    });
  });

  it("clears every Track position and starts the Listening position at the first Track", async () => {
    await startBookOver(db, "frankl", 2_000);

    const book = await frankl(db);
    expect(book.tracks.map((track) => track.trackPosition && track.trackPosition.seconds)).toEqual([
      0, 0, 0,
    ]);
    expect(book.tracks.some((track) => track.trackPosition?.playedToEnd)).toBe(false);
    expect(book.listeningPosition).toEqual({ trackId: "t1", seconds: 0, updatedAt: 2_000 });
    expect(book.finished).toBe(false);
  });

  it("isn't undone by an older Device report", async () => {
    await startBookOver(db, "frankl", 2_000);

    await recordDeviceReport(
      db,
      report({
        trackPositions: [position({ trackId: "t2", seconds: 2400, updatedAt: 1_500 })],
        listening: [
          {
            audiobookId: "frankl",
            trackId: "t2",
            seconds: 2400,
            finished: false,
            updatedAt: 1_500,
          },
        ],
      }),
      5_000
    );

    const book = await frankl(db);
    expect((await positionOf(db, "t2"))?.seconds).toBe(0);
    expect(book.listeningPosition).toEqual({ trackId: "t1", seconds: 0, updatedAt: 2_000 });
  });

  it("gives way to a Device report made after it", async () => {
    await startBookOver(db, "frankl", 2_000);

    await recordDeviceReport(
      db,
      report({ trackPositions: [position({ trackId: "t1", seconds: 30, updatedAt: 3_000 })] }),
      5_000
    );

    expect((await positionOf(db, "t1"))?.seconds).toBe(30);
  });
});
