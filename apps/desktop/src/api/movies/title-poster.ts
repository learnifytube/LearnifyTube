import { eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { movies, series } from "@/api/db/schema";
import type { ShownTitle } from "./shown-on-devices";

/**
 * Gives a Movie or Series a poster the user chose, already copied into the
 * posters folder. `updatedAt` moves on, so Devices fetch it under a new URL.
 * Resolves the poster it replaced, for cleanup; null for a title that is gone.
 */
export const setTitlePoster = async (
  db: Database,
  title: ShownTitle,
  posterPath: string,
  now: number = Date.now()
): Promise<{ previous: string | null } | null> => {
  const table = title.kind === "movie" ? movies : series;
  const [row] = await db
    .select({ posterPath: table.posterPath })
    .from(table)
    .where(eq(table.id, title.id))
    .limit(1);
  if (!row) return null;
  await db.update(table).set({ posterPath, updatedAt: now }).where(eq(table.id, title.id));
  return { previous: row.posterPath };
};
