import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { recordDeviceReport } from "../on-device/store";
import { loadAudiobookCatalog } from "./catalog";
import { devicesHoldingAudiobook, setAudiobookSentToDevices } from "./send-to-devices";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const addBook = (db: Db, id: string) =>
  db.insert(schema.audiobooks).values({
    id,
    title: id,
    sourceFolder: `/books/${id}`,
    createdAt: 1,
  });

const report = (
  deviceId: string,
  name: string,
  heldAudiobookIds?: string[]
): Parameters<typeof recordDeviceReport>[1] => ({
  deviceId,
  name,
  kind: "phone",
  offlineVideoIds: [],
  watch: [],
  ...(heldAudiobookIds && { heldAudiobookIds }),
});

const sentIds = async (db: Db): Promise<string[]> =>
  (await loadAudiobookCatalog(db, (p) => p)).audiobooks
    .filter((book) => book.sentToDevices)
    .map((book) => book.id);

describe("Send an Audiobook to Devices", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
    await addBook(db, "orwell");
    await addBook(db, "frankl");
  });

  it("sends the whole Audiobook to Devices and removes it again", async () => {
    expect(await setAudiobookSentToDevices(db, "orwell", true)).toBe(true);
    expect(await sentIds(db)).toEqual(["orwell"]);

    expect(await setAudiobookSentToDevices(db, "orwell", false)).toBe(true);
    expect(await sentIds(db)).toEqual([]);
  });

  it("says nothing changed for an unknown Audiobook or one already in that state", async () => {
    expect(await setAudiobookSentToDevices(db, "unknown", true)).toBe(false);
    expect(await setAudiobookSentToDevices(db, "frankl", false)).toBe(false);
  });

  it("shows which Devices hold an Audiobook, as each last reported", async () => {
    await recordDeviceReport(db, report("phone-1", "Pixel", ["orwell", "frankl"]), 5_000);
    await recordDeviceReport(db, report("phone-2", "Tablet", ["frankl"]), 6_000);
    await recordDeviceReport(db, report("tv-1", "Old phone"), 7_000);

    expect(await devicesHoldingAudiobook(db, "orwell")).toEqual([
      { id: "phone-1", name: "Pixel", kind: "phone", lastSeenAt: 5_000 },
    ]);
    expect((await devicesHoldingAudiobook(db, "frankl")).map((d) => d.name)).toEqual([
      "Tablet",
      "Pixel",
    ]);

    // A later report without the book means the Device no longer holds it.
    await recordDeviceReport(db, report("phone-1", "Pixel", ["frankl"]), 8_000);
    expect(await devicesHoldingAudiobook(db, "orwell")).toEqual([]);
  });
});
