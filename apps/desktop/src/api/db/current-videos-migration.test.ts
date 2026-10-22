import fs from "fs";
import os from "os";
import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/api/db/schema";
import { loadCurrentVideo } from "@/api/collections/current-video";

const migrationsFolder = path.join(__dirname, "../../../drizzle");

// A copy of the migrations folder that stops just before the Current Video migration
// (found by name, so it survives renumbering).
const migrationsBeforeCurrentVideos = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
  fs.cpSync(migrationsFolder, dir, { recursive: true });
  const journalPath = path.join(dir, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((e) => e.tag.endsWith("_current_videos"));
  journal.entries = journal.entries.slice(0, cut);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
};

it("turns each List's and YouTube playlist's slot into the Video that was in it", async () => {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsBeforeCurrentVideos() });
  for (const id of ["v1", "v2", "v3"]) {
    await client.execute(
      `INSERT INTO youtube_videos (id, video_id, title, channel_title, created_at)
       VALUES ('${id}', '${id}', '${id}', 'C', 1)`
    );
  }
  await client.batch([
    // A List in slot 1 whose positions have gaps: slot 1 is the second Video in order.
    `INSERT INTO custom_playlists (id, name, current_video_index, created_at, updated_at)
     VALUES ('list', 'L', 1, 1, 50)`,
    `INSERT INTO custom_playlist_items (id, playlist_id, video_id, position, added_at, created_at)
     VALUES ('i1', 'list', 'v3', 10, 1, 1), ('i2', 'list', 'v1', 20, 1, 1)`,
    // A List whose slot is past its end.
    `INSERT INTO custom_playlists (id, name, current_video_index, created_at)
     VALUES ('short', 'S', 5, 1)`,
    `INSERT INTO custom_playlist_items (id, playlist_id, video_id, position, added_at, created_at)
     VALUES ('i3', 'short', 'v1', 0, 1, 1)`,
    `INSERT INTO channel_playlists (id, playlist_id, title, current_video_index, created_at)
     VALUES ('p', 'PL1', 'P', 2, 1)`,
    `INSERT INTO playlist_items (id, playlist_id, video_id, position, created_at)
     VALUES ('j1', 'PL1', 'v1', 0, 1), ('j2', 'PL1', 'v2', 1, 1), ('j3', 'PL1', 'v3', 2, 1)`,
  ]);

  await migrate(db, { migrationsFolder });

  expect(await loadCurrentVideo(db, { kind: "list", id: "list" })).toMatchObject({
    videoId: "v1",
  });
  expect(await loadCurrentVideo(db, { kind: "list", id: "short" })).toBeNull();
  expect(await loadCurrentVideo(db, { kind: "youtube_playlist", id: "PL1" })).toMatchObject({
    videoId: "v3",
  });
});
