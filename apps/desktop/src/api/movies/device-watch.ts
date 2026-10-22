import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/api/db";
import { episodes, movies } from "@/api/db/schema";
import type { MovieWatch } from "../../../../shared/mobile-sync-contract";
import { playedOnDevice } from "./watch-progress";
import { applyWrites, type Write } from "./batch-writes";

/** Takes the Movie and Episode progress of a Device report into the desktop's Watch state. */
export const recordDeviceMovieWatch = async (
  db: Database,
  entries: MovieWatch[],
  now: number
): Promise<void> => {
  const writes: Write[] = [];
  for (const kind of ["movie", "episode"] as const) {
    const table = kind === "movie" ? movies : episodes;
    const reported = entries.filter((entry) => entry.kind === kind);
    if (reported.length === 0) continue;
    const rows = await db
      .select()
      .from(table)
      .where(
        inArray(
          table.id,
          reported.map((entry) => entry.id)
        )
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const entry of reported) {
      // Only titles the desktop knows; a Device can hold titles from another desktop.
      const row = byId.get(entry.id);
      if (!row) continue;
      const progress = playedOnDevice(row, entry, row.durationSeconds, now);
      if (!progress) continue;
      writes.push(db.update(table).set(progress).where(eq(table.id, entry.id)));
      byId.set(entry.id, { ...row, ...progress });
    }
  }
  await applyWrites(db, writes);
};
