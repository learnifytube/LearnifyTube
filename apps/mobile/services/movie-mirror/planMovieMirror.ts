import type { MovieCatalog } from "../../../shared/mobile-sync-contract";
import type { HeldTitle, MovieHoldReason } from "../held-movies/types";

/** A Movie or Episode the desktop sent to Devices. */
export type SentTitle = HeldTitle & {
  /** Its file was gone at the desktop's last Rescan: nothing to Download. */
  missing: boolean;
};

/**
 * Everything the desktop sent, one entry per file: each sent Movie. Episodes
 * of sent Seasons join here, so the plan stays per file.
 */
export function sentTitles(catalog: MovieCatalog): SentTitle[] {
  return catalog.movies
    .filter((movie) => movie.sentToDevices)
    .map((movie) => ({
      kind: "movie",
      id: movie.id,
      title: movie.title,
      posterUrl: movie.posterUrl,
      durationSeconds: movie.durationSeconds,
      missing: movie.missing,
    }));
}

/**
 * What the Device does to Mirror the sent Movies and Episodes. `holds` are the
 * titles it holds or is Downloading, with why. Only the Mirror's own reason is
 * ever released, so a title the user downloaded is never removed (ADR-0001).
 * A title left out of the catalog (forgotten, or no longer Shown on Devices)
 * counts as no longer sent.
 */
export function planMovieMirror(input: {
  sent: { id: string; missing: boolean }[];
  holds: { id: string; reasons: MovieHoldReason[] }[];
}) {
  const sent = new Set(input.sent.map((title) => title.id));
  const reasons = new Map(input.holds.map((hold) => [hold.id, hold.reasons]));
  const mirrored = (id: string) =>
    reasons.get(id)?.includes("mirrored") ?? false;
  return {
    // Asking again is harmless: it does nothing for a Download on its way or a
    // copy already here, and retries a failed one. A title the user downloaded
    // stays theirs. A missing file keeps whatever copy the Device has.
    download: input.sent
      .filter((title) => !title.missing)
      .filter((title) => !reasons.has(title.id) || mirrored(title.id))
      .map((title) => title.id),
    release: input.holds
      .filter((hold) => hold.reasons.includes("mirrored") && !sent.has(hold.id))
      .map((hold) => hold.id),
  };
}
