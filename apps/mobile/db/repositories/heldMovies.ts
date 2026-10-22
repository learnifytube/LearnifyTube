import { eq, isNotNull } from "drizzle-orm";
import { getDb, heldMovies } from "../index";
import type {
  HeldTitle,
  MovieHold,
  MovieHoldReason,
} from "../../services/held-movies/types";

const reasonsOf = (json: string): MovieHoldReason[] => {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter(
          (reason): reason is MovieHoldReason =>
            reason === "pulled" || reason === "mirrored",
        )
      : [];
  } catch {
    return [];
  }
};

export function getHeldMovies(): MovieHold[] {
  return getDb()
    .select()
    .from(heldMovies)
    .all()
    .map((row) => ({
      kind: row.kind,
      id: row.id,
      title: row.title,
      posterUrl: row.posterUrl,
      durationSeconds: row.durationSeconds,
      reasons: reasonsOf(row.reasonsJson),
      heldAt: row.heldAt,
    }));
}

/** Saves a hold, keeping its Offline copy record. */
export function saveHeldMovie(hold: MovieHold) {
  const values = {
    kind: hold.kind,
    title: hold.title,
    posterUrl: hold.posterUrl,
    durationSeconds:
      hold.durationSeconds === null ? null : Math.round(hold.durationSeconds),
    reasonsJson: JSON.stringify(hold.reasons),
    heldAt: hold.heldAt,
  };
  getDb()
    .insert(heldMovies)
    .values({ id: hold.id, ...values })
    .onConflictDoUpdate({ target: heldMovies.id, set: values })
    .run();
}

export function deleteHeldMovie(id: string) {
  getDb().delete(heldMovies).where(eq(heldMovies.id, id)).run();
}

/** Which file endpoint a held title's Download uses. */
export function heldMovieKind(id: string): HeldTitle["kind"] | null {
  const [row] = getDb()
    .select({ kind: heldMovies.kind })
    .from(heldMovies)
    .where(eq(heldMovies.id, id))
    .all();
  return row?.kind ?? null;
}

// The Offline copy records of Movies and Episodes, written only through
// updateHeldMovieLocalPath by their Offline copy module.
export function getMovieOfflineCopyRecords() {
  return getDb()
    .select({ videoId: heldMovies.id, uri: heldMovies.localPath })
    .from(heldMovies)
    .where(isNotNull(heldMovies.localPath))
    .all()
    .filter((row): row is { videoId: string; uri: string } => !!row.uri);
}

export function updateHeldMovieLocalPath(id: string, localPath: string | null) {
  getDb()
    .update(heldMovies)
    .set({ localPath })
    .where(eq(heldMovies.id, id))
    .run();
}
