import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { audiobookCatalogSchema } from "../../../../shared/mobile-sync-contract";
import {
  findAudiobookCoverPath,
  findTrackFilePath,
  isTrackFilePath,
  loadAudiobookCatalog,
} from "./catalog";

const createDb = async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
};

type Db = Awaited<ReturnType<typeof createDb>>;

const coverUrl = (pathname: string): string => `http://desktop${pathname}`;

const addFrankl = async (db: Db): Promise<void> => {
  await db.insert(schema.audiobooks).values({
    id: "frankl",
    title: "Man's Search for Meaning",
    author: "Viktor Frankl",
    sourceFolder: "/books/Frankl",
    coverPath: "/userData/audiobook-covers/frankl.jpg",
    createdAt: 1,
    updatedAt: 5,
  });
  // Inserted out of order: the catalog follows the Track order, not insertion.
  await db.insert(schema.audiobookTracks).values([
    {
      id: "t3",
      audiobookId: "frankl",
      filePath: "/books/Frankl/CD 3/Track 1.mp3",
      position: 2,
      durationSeconds: null,
      missing: true,
    },
    {
      id: "t1",
      audiobookId: "frankl",
      filePath: "/books/Frankl/CD 1/Track 01.mp3",
      position: 0,
      durationSeconds: 300,
    },
    {
      id: "t2",
      audiobookId: "frankl",
      filePath: "/books/Frankl/CD 1/Track 02.mp3",
      position: 1,
      durationSeconds: 240,
    },
  ]);
};

describe("Audiobook catalog", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb();
  });

  it("is empty when nothing was imported", async () => {
    expect(await loadAudiobookCatalog(db, coverUrl)).toEqual({ audiobooks: [] });
  });

  it("lists each Audiobook with its Tracks in Track order, as the contract describes", async () => {
    await addFrankl(db);

    const catalog = await loadAudiobookCatalog(db, coverUrl);

    expect(audiobookCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(catalog.audiobooks).toEqual([
      {
        id: "frankl",
        title: "Man's Search for Meaning",
        author: "Viktor Frankl",
        // Versioned, so a changed cover isn't shown from a Device's image cache.
        coverUrl: "http://desktop/api/audiobook/frankl/cover?v=5",
        tracks: [
          { id: "t1", title: "Track 01", durationSeconds: 300, missing: false },
          { id: "t2", title: "Track 02", durationSeconds: 240, missing: false },
          { id: "t3", title: "Track 1", durationSeconds: null, missing: true },
        ],
        listeningPosition: null,
        finished: false,
        sentToDevices: false,
      },
    ]);
  });

  it("gives a placeholder cover and the Listening position when there is one", async () => {
    await db.insert(schema.audiobooks).values({
      id: "orwell",
      title: "1984",
      sourceFolder: "/books/Orwell",
      listeningTrackId: "o1",
      listeningSeconds: 42,
      listeningUpdatedAt: 1000,
      createdAt: 1,
    });
    await db
      .insert(schema.audiobookTracks)
      .values({ id: "o1", audiobookId: "orwell", filePath: "/books/Orwell/1984.mp3", position: 0 });

    const [book] = (await loadAudiobookCatalog(db, coverUrl)).audiobooks;

    expect(book.coverUrl).toBeNull();
    expect(book.author).toBeNull();
    expect(book.listeningPosition).toEqual({ trackId: "o1", seconds: 42, updatedAt: 1000 });
  });

  it("finds a Track's file and an Audiobook's cover by id only", async () => {
    await addFrankl(db);

    expect(await findTrackFilePath(db, "t2")).toBe("/books/Frankl/CD 1/Track 02.mp3");
    expect(await findTrackFilePath(db, "/books/Frankl/CD 1/Track 02.mp3")).toBeNull();
    expect(await findAudiobookCoverPath(db, "frankl")).toBe(
      "/userData/audiobook-covers/frankl.jpg"
    );
    expect(await findAudiobookCoverPath(db, "nope")).toBeNull();
  });

  it("tells a Track's file from any other file", async () => {
    await addFrankl(db);

    expect(await isTrackFilePath(db, "/books/Frankl/CD 1/Track 02.mp3")).toBe(true);
    expect(await isTrackFilePath(db, "/books/Frankl/CD 1/cover.jpg")).toBe(false);
    expect(await isTrackFilePath(db, "t2")).toBe(false);
  });
});
