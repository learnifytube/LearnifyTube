import { desc, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { movies, syncDevices } from "@/api/db/schema";

// Sending to Devices (ADR-0005): a Movie goes whole, a Series one Season at a
// time. Devices Mirror what was sent and report the Movies and Episodes they hold.

export type TitleDevice = {
  id: string;
  name: string;
  kind: (typeof syncDevices.$inferSelect)["kind"];
  lastSeenAt: number;
};

/**
 * Sends the Movie to Devices, or removes it from them; Devices Mirror it at
 * their next sync. Returns whether anything changed.
 */
export const setMovieSentToDevices = async (
  db: Database,
  movieId: string,
  sent: boolean
): Promise<boolean> => {
  const [movie] = await db
    .select({ sentToDevices: movies.sentToDevices })
    .from(movies)
    .where(eq(movies.id, movieId));
  if (!movie || movie.sentToDevices === sent) return false;
  // updated_at is left alone: it versions the poster URL.
  await db.update(movies).set({ sentToDevices: sent }).where(eq(movies.id, movieId));
  return true;
};

const heldIdsOf = (json: string): string[] => {
  const held: unknown = JSON.parse(json);
  return Array.isArray(held) ? held.filter((id): id is string => typeof id === "string") : [];
};

/**
 * The Devices that last reported an Offline copy of every one of these Movies
 * or Episodes (a Season's Episodes, say), most recently seen first.
 */
export const devicesHoldingTitles = async (
  db: Database,
  kind: "movie" | "episode",
  ids: string[]
): Promise<TitleDevice[]> => {
  if (ids.length === 0) return [];
  const devices = await db.select().from(syncDevices).orderBy(desc(syncDevices.lastSeenAt));
  return devices
    .filter((device) => {
      const held = new Set(
        heldIdsOf(kind === "movie" ? device.heldMovieIdsJson : device.heldEpisodeIdsJson)
      );
      return ids.every((id) => held.has(id));
    })
    .map((device) => ({
      id: device.id,
      name: device.name,
      kind: device.kind,
      lastSeenAt: device.lastSeenAt,
    }));
};

/** The Devices that last reported holding the Movie, most recently seen first. */
export const devicesHoldingMovie = (db: Database, movieId: string): Promise<TitleDevice[]> =>
  devicesHoldingTitles(db, "movie", [movieId]);
