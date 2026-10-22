import fs from "fs";
import os from "os";
import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { loadAudiobookCatalog } from "./catalog";

const migrationsFolder = path.join(__dirname, "../../../drizzle");

// A copy of the migrations folder that stops just before Track positions.
const migrationsBeforeTrackPositions = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
  fs.cpSync(migrationsFolder, dir, { recursive: true });
  const journalPath = path.join(dir, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((e) => e.tag.endsWith("_track_positions"));
  journal.entries = journal.entries.slice(0, cut);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
};

const assetUrl = (pathname: string): string => `http://desktop${pathname}`;

describe("Moving existing Listening positions over to Track positions", () => {
  const upgrade = async (book: string) => {
    const client = createClient({ url: ":memory:" });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsBeforeTrackPositions() });
    await client.execute(book);
    await client.executeMultiple(`
      INSERT INTO audiobook_tracks (id, audiobook_id, file_path, position, duration_seconds) VALUES
        ('t1', 'b', '/b/1.mp3', 0, 600),
        ('t2', 'b', '/b/2.mp3', 1, 700),
        ('t3', 'b', '/b/3.mp3', 2, 800),
        ('t4', 'b', '/b/4.mp3', 3, 900);
    `);
    await migrate(db, { migrationsFolder });
    const [catalogBook] = (await loadAudiobookCatalog(db, assetUrl)).audiobooks;
    return catalogBook;
  };

  it("gives the Listening position's Track the book's seconds and marks the Tracks before it played to their end", async () => {
    const book = await upgrade(`
      INSERT INTO audiobooks (id, title, source_folder, created_at, listening_track_id, listening_seconds, listening_updated_at)
      VALUES ('b', 'B', '/b', 1, 't3', 754, 5000)
    `);

    expect(book.tracks.map((track) => track.trackPosition)).toEqual([
      { seconds: 600, playedToEnd: true, updatedAt: 5000 },
      { seconds: 700, playedToEnd: true, updatedAt: 5000 },
      { seconds: 754, playedToEnd: false, updatedAt: 5000 },
      null,
    ]);
    expect(book.listeningPosition).toEqual({ trackId: "t3", seconds: 754, updatedAt: 5000 });
  });

  it("marks the last Track played to its end too when the book was finished", async () => {
    const book = await upgrade(`
      INSERT INTO audiobooks (id, title, source_folder, created_at, listening_track_id, listening_seconds, listening_updated_at, finished)
      VALUES ('b', 'B', '/b', 1, 't4', 900, 5000, 1)
    `);

    expect(book.tracks.map((track) => track.trackPosition?.playedToEnd)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("leaves every Track not started in a book never played", async () => {
    const book = await upgrade(`
      INSERT INTO audiobooks (id, title, source_folder, created_at) VALUES ('b', 'B', '/b', 1)
    `);

    expect(book.tracks.map((track) => track.trackPosition)).toEqual([null, null, null, null]);
    expect(book.listeningPosition).toBeNull();
  });
});
