import { asc, eq } from "drizzle-orm";
import type { Database } from "@/api/db";
import { episodes, seasons } from "@/api/db/schema";
import { applyWrites } from "./batch-writes";
import { moveEpisode, moveSeason } from "./series-plan";

// Correcting a saved Series' order with the Import preview's moves (ADR-0005).
// Only positions change: an Episode stays in its Season, and Watch state, sent
// state and files are left as they are. Devices list Seasons and Episodes by position.

/** Moves an Episode one place up or down within its Season; true when it moved. */
export const moveSeriesEpisode = async (
  db: Database,
  episodeId: string,
  by: -1 | 1
): Promise<boolean> => {
  const [moved] = await db
    .select({ seasonId: episodes.seasonId })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);
  if (!moved) return false;
  const rows = await db
    .select({ id: episodes.id, position: episodes.position })
    .from(episodes)
    .where(eq(episodes.seasonId, moved.seasonId))
    .orderBy(asc(episodes.position));
  // One Season only, so the move never carries the Episode into another.
  const [season] = moveEpisode(
    [{ key: moved.seasonId, episodes: rows.map((row) => row.id) }],
    episodeId,
    by
  );
  return renumber(db, rows, season.episodes, "episode");
};

/** Moves a Season one place up or down in its Series; true when it moved. */
export const moveSeriesSeason = async (
  db: Database,
  seasonId: string,
  by: -1 | 1
): Promise<boolean> => {
  const [moved] = await db
    .select({ seriesId: seasons.seriesId })
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1);
  if (!moved) return false;
  const rows = await db
    .select({ id: seasons.id, position: seasons.position })
    .from(seasons)
    .where(eq(seasons.seriesId, moved.seriesId))
    .orderBy(asc(seasons.position));
  const order = moveSeason(
    rows.map((row) => ({ key: row.id, episodes: [] })),
    seasonId,
    by
  );
  return renumber(
    db,
    rows,
    order.map((season) => season.key),
    "season"
  );
};

// Gives each row its place in `order` as its position, all or none.
const renumber = async (
  db: Database,
  rows: { id: string; position: number }[],
  order: string[],
  kind: "episode" | "season"
): Promise<boolean> => {
  const table = kind === "episode" ? episodes : seasons;
  const current = new Map(rows.map((row) => [row.id, row.position]));
  const writes = order
    .map((id, position) => ({ id, position }))
    .filter(({ id, position }) => current.get(id) !== position)
    .map(({ id, position }) => db.update(table).set({ position }).where(eq(table.id, id)));
  await applyWrites(db, writes);
  return writes.length > 0;
};
