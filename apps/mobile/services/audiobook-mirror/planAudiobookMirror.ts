import type { HoldReason } from "../held-audiobooks/createHeldAudiobooks";

/**
 * What the phone does to Mirror the sent Audiobooks, whole books only.
 * `holds` are the books the phone holds or is fetching, with why it holds them.
 * Only the Mirror's own reason is ever released, so a book the user pulled by
 * playing it is never removed (ADR-0001).
 */
export function planAudiobookMirror(input: {
  sentIds: string[];
  holds: { id: string; reasons: HoldReason[] }[];
}) {
  const sent = new Set(input.sentIds);
  const reasons = new Map(input.holds.map((hold) => [hold.id, hold.reasons]));
  const mirrored = (id: string) =>
    reasons.get(id)?.includes("mirrored") ?? false;
  return {
    // Holding again is harmless: it keeps fetching whatever Tracks are still missing.
    // A book already held for the user stays theirs, as with Videos.
    hold: input.sentIds.filter((id) => !reasons.has(id) || mirrored(id)),
    release: input.holds
      .filter((hold) => hold.reasons.includes("mirrored") && !sent.has(hold.id))
      .map((hold) => hold.id),
  };
}
