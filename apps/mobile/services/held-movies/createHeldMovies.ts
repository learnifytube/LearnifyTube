import { useSyncExternalStore } from "react";
import type { HeldTitle, MovieHold, MovieHoldReason } from "./types";

export type HeldMoviesPlatform = {
  now: () => number;
  /** The holds saved on this Device; read once, on first use. */
  loadHolds: () => MovieHold[];
  saveHold: (hold: MovieHold) => void;
  deleteHold: (id: string) => void;
  /** The Movies' Download queue. */
  downloads: {
    /** Does nothing when the Offline copy exists or is on its way; retries a failed one. */
    request: (title: HeldTitle) => void;
    cancel: (id: string) => void;
  };
  /** The Captions kept with each held title (`createKeptCaptions`). */
  captions: { forget: (id: string) => Promise<void> };
  /** The Movies' Offline copies. */
  offlineCopy: {
    getUri: (id: string) => string | null;
    remove: (id: string) => Promise<void>;
    subscribe: (listener: () => void) => () => void;
  };
};

/**
 * The Movies and Episodes this Device holds an Offline copy of, or is
 * Downloading, with why (ADR-0005). Playing never adds one: a Download comes
 * only from the Mirror or the user's "Download to this phone".
 */
export function createHeldMovies(platform: HeldMoviesPlatform) {
  let holds: Map<string, MovieHold> | null = null;
  let snapshot: MovieHold[] = [];
  const listeners = new Set<() => void>();

  const sorted = () =>
    [...loaded().values()].sort((a, b) => b.heldAt - a.heldAt);

  const notify = () => {
    snapshot = sorted();
    for (const listener of listeners) listener();
  };

  function loaded() {
    if (!holds) {
      holds = new Map(platform.loadHolds().map((hold) => [hold.id, hold]));
      snapshot = [...holds.values()].sort((a, b) => b.heldAt - a.heldAt);
    }
    return holds;
  }

  const getHold = (id: string) => loaded().get(id) ?? null;

  /** Holds the title for `reason` and asks for its Download. */
  const hold = (title: HeldTitle, reason: MovieHoldReason) => {
    const existing = getHold(title.id);
    const next: MovieHold = {
      ...title,
      reasons: existing?.reasons.includes(reason)
        ? existing.reasons
        : [...(existing?.reasons ?? []), reason],
      heldAt: existing?.heldAt ?? platform.now(),
    };
    loaded().set(title.id, next);
    platform.saveHold(next);
    notify();
    platform.downloads.request(title);
  };

  /** Remove from this phone: the Device's file goes, whoever brought it. */
  const remove = async (id: string) => {
    if (loaded().delete(id)) {
      platform.deleteHold(id);
      notify();
    }
    platform.downloads.cancel(id);
    await platform.offlineCopy.remove(id);
    await platform.captions.forget(id);
  };

  /** Drops one reason; the file goes only when no reason is left. */
  const release = async (id: string, reason: MovieHoldReason) => {
    const existing = getHold(id);
    if (!existing?.reasons.includes(reason)) return;
    const reasons = existing.reasons.filter((r) => r !== reason);
    if (reasons.length === 0) return remove(id);
    const next = { ...existing, reasons };
    loaded().set(id, next);
    platform.saveHold(next);
    notify();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const unsubscribeCopies = platform.offlineCopy.subscribe(listener);
    return () => {
      listeners.delete(listener);
      unsubscribeCopies();
    };
  };

  const holdsNow = () => {
    loaded();
    return snapshot;
  };

  return {
    /** "Download to this phone": the Mirror never removes it. */
    pull: (title: HeldTitle) => hold(title, "pulled"),
    hold,
    release,
    remove,
    getHold,
    /** Every hold, newest first, whether its Offline copy has arrived or not. */
    holds: holdsNow,
    /** Same answer as `holds`, re-rendering when a hold or an Offline copy changes. */
    useHolds: () => useSyncExternalStore(subscribe, holdsNow),
    /** Calls the listener when a hold or an Offline copy changes. */
    subscribe,
    /** The Movies and Episodes whose Offline copy is on this Device, for the Device report. */
    heldIds: () => {
      const here = holdsNow().filter(
        (held) => platform.offlineCopy.getUri(held.id) !== null,
      );
      return {
        movieIds: here.filter((h) => h.kind === "movie").map((h) => h.id),
        episodeIds: here.filter((h) => h.kind === "episode").map((h) => h.id),
      };
    },
  };
}

export type HeldMovies = ReturnType<typeof createHeldMovies>;
