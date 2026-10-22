import type {
  Caption,
  MovieCatalog,
} from "../../../shared/mobile-sync-contract";
import type { HeldMovies } from "../held-movies/createHeldMovies";
import type { KeptCaptions } from "../movie-captions/createKeptCaptions";
import { planMovieMirror, sentTitles } from "./planMovieMirror";

export type MovieMirrorDeps = {
  held: Pick<HeldMovies, "hold" | "release" | "holds" | "heldIds">;
  /** Where each held title's Captions are kept for Offline mode. */
  captions: Pick<KeptCaptions, "keep">;
};

/** Every Movie's and Episode's Captions in the catalog, by title id. */
function captionsById(catalog: MovieCatalog): Map<string, Caption[]> {
  const episodes = catalog.series.flatMap((series) =>
    series.seasons.flatMap((season) => season.episodes),
  );
  return new Map(
    [...catalog.movies, ...episodes].map((title) => [title.id, title.captions]),
  );
}

/**
 * Mirrors the Movies (and Seasons' Episodes) sent to Devices onto this Device:
 * holds every sent title for the Mirror, so the Download queue fetches it, and
 * lets go of what it brought once it is no longer sent or no longer listed.
 * Titles the user downloaded stay. Every held title keeps its Captions here,
 * so they show in Offline mode too.
 */
export function createMovieMirror({ held, captions }: MovieMirrorDeps) {
  /** Plans from the catalog the Device mirror just fetched from the desktop. */
  const mirror = async (serverUrl: string, catalog: MovieCatalog) => {
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

    // Each title with an Offline copy here, sent or downloaded by the user,
    // keeps the Captions the desktop pairs with it now.
    const paired = captionsById(catalog);
    const { movieIds, episodeIds } = held.heldIds();
    for (const id of [...movieIds, ...episodeIds]) {
      const titleCaptions = paired.get(id);
      if (!titleCaptions) continue;
      await captions.keep(
        serverUrl,
        id,
        titleCaptions.map((caption) => caption.id),
      );
    }
  };

  return {
    mirror,
    /** The Movies and Episodes with an Offline copy here, for the Device report. */
    heldIds: () => held.heldIds(),
  };
}
