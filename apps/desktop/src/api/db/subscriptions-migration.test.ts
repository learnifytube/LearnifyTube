import fs from "fs";
import os from "os";
import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const migrationsFolder = path.join(__dirname, "../../../drizzle");

// A copy of the migrations folder that stops just before the given migration
const migrationsBefore = (tag: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
  fs.cpSync(migrationsFolder, dir, { recursive: true });
  const journalPath = path.join(dir, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((e) => e.tag === tag);
  journal.entries = journal.entries.slice(0, cut);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
};

it("makes every Channel that existed before Subscriptions became explicit a Subscription", async () => {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: migrationsBefore("0015_subscriptions") });
  await client.execute(
    "INSERT INTO channels (id, channel_id, channel_title, created_at) VALUES ('c', 'c', 'C', 7)"
  );

  await migrate(db, { migrationsFolder });

  const { rows } = await client.execute("SELECT subscribed_at FROM channels");
  expect(rows).toEqual([expect.objectContaining({ subscribed_at: 7 })]);
});
