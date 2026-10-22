import { eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { movies, series } from "@/api/db/schema";

// Shown on Devices (ADR-0005): a title switched off is left out of the Devices'
// catalog, so the Mirror releases it even when it was sent. Sent stays as it was,
// so switching it back on brings the title back as it was.

export type ShownTitle = { kind: "movie" | "series"; id: string };

/** Switches a Movie or Series on or off for Devices; true when that changed it. */
export const setShownOnDevices = async (
  db: Database,
  title: ShownTitle,
  shown: boolean
): Promise<boolean> => {
  const table = title.kind === "movie" ? movies : series;
  const [row] = await db
    .select({ shownOnDevices: table.shownOnDevices })
    .from(table)
    .where(eq(table.id, title.id))
    .limit(1);
  if (!row || row.shownOnDevices === shown) return false;
  await db.update(table).set({ shownOnDevices: shown }).where(eq(table.id, title.id));
  return true;
};
