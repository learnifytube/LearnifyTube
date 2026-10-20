import type { Audiobook } from "../../../shared/mobile-sync-contract";
import type { HeldAudiobooks } from "../held-audiobooks/createHeldAudiobooks";
import { planAudiobookMirror } from "./planAudiobookMirror";

export type AudiobookMirrorDeps = {
  /** The desktop's Audiobooks, or null when the desktop is too old to serve them. */
  loadCatalog: (serverUrl: string) => Promise<Audiobook[] | null>;
  held: Pick<HeldAudiobooks, "hold" | "release" | "allHolds">;
  /** Keeps the catalog for the Home rows, so they show the desktop's newest Listening positions. */
  keepCatalog: (serverUrl: string, catalog: Audiobook[]) => void;
};

/**
 * Mirrors the Audiobooks sent to Devices onto this phone, whole: holds every
 * sent book for the Mirror and releases the Mirror's hold on books no longer
 * sent (or forgotten on the desktop). Books the user pulled stay.
 */
export function createAudiobookMirror({
  loadCatalog,
  held,
  keepCatalog,
}: AudiobookMirrorDeps) {
  const mirror = async (serverUrl: string) => {
    const catalog = await loadCatalog(serverUrl);
    if (!catalog) return;
    keepCatalog(serverUrl, catalog);
    const holds = await held.allHolds();
    const plan = planAudiobookMirror({
      sentIds: catalog
        .filter((book) => book.sentToDevices)
        .map((book) => book.id),
      holds: [...holds].map(([id, hold]) => ({ id, reasons: hold.reasons })),
    });
    const byId = new Map(catalog.map((book) => [book.id, book]));
    for (const id of plan.hold) {
      const book = byId.get(id);
      if (book) held.hold(book, "mirrored");
    }
    for (const id of plan.release) await held.release(id, "mirrored");
  };

  /** Audiobooks wholly on this phone, for the Device report. */
  const heldIds = async () =>
    [...(await held.allHolds())]
      .filter(([, hold]) => hold.complete)
      .map(([id]) => id);

  return { mirror, heldIds };
}
