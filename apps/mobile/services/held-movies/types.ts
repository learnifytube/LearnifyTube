import type { MovieKind } from "../../../shared/mobile-sync-contract";

/**
 * Why this Device holds a Movie or Episode: the user downloaded it to this
 * phone (`pulled`), or the Mirror brought it because the desktop sent it
 * (`mirrored`). The Mirror only ever drops its own reason (ADR-0001).
 */
export type MovieHoldReason = "pulled" | "mirrored";

/** A Movie or an Episode, as the Device shows it while it holds the file. */
export type HeldTitle = {
  kind: MovieKind;
  /** The desktop's Movie or Episode id (a UUID, so the two never collide). */
  id: string;
  title: string;
  posterUrl: string | null;
  durationSeconds: number | null;
};

export type MovieHold = HeldTitle & {
  reasons: MovieHoldReason[];
  heldAt: number;
};
