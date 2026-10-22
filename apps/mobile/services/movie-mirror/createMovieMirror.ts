import type { MovieCatalog } from "../../../shared/mobile-sync-contract";
import type { HeldMovies } from "../held-movies/createHeldMovies";
import { planMovieMirror, sentTitles } from "./planMovieMirror";

export type MovieMirrorDeps = {
  held: Pick<HeldMovies, "hold" | "release" | "holds" | "heldIds">;
};

/**
 * Mirrors the Movies (and Seasons' Episodes) sent to Devices onto this Device:
 * holds every sent title for the Mirror, so the Download queue fetches it, and
 * lets go of what it brought once it is no longer sent or no longer listed.
 * Titles the user downloaded stay.
 */
export function createMovieMirror({ held }: MovieMirrorDeps) {
  /** Plans from the catalog the Device mirror just fetched from the desktop. */
  const mirror = async (catalog: MovieCatalog) => {
    const sent = sentTitles(catalog);
    const plan = planMovieMirror({
      sent,
      holds: held.holds().map(({ id, reasons }) => ({ id, reasons })),
    });
    const byId = new Map(sent.map((title) => [title.id, title]));
    for (const id of plan.download) {
      const title = byId.get(id);
      if (!title) continue;
      const { missing: _missing, ...shown } = title;
      held.hold(shown, "mirrored");
    }
    for (const id of plan.release) await held.release(id, "mirrored");
  };

  return {
    mirror,
    /** The Movies and Episodes with an Offline copy here, for the Device report. */
    heldIds: () => held.heldIds(),
  };
}
