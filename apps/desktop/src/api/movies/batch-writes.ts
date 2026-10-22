import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "@/api/db";

// One Movie operation's writes, applied all or none. A batch runs BEGIN/COMMIT on
// the connection it was given; libsql's `transaction()` instead hands the work to
// a fresh connection (a new, empty database for `:memory:`).

export type Write = BatchItem<"sqlite">;

/** Applies the writes in order, in one transaction; nothing when there are none. */
export const applyWrites = async (db: Database, writes: Write[]): Promise<void> => {
  const [first, ...rest] = writes;
  if (!first) return;
  await db.batch([first, ...rest]);
};
