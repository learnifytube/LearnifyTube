import type { HeldMoviesPlatform } from "./createHeldMovies";
import type { MovieHold } from "./types";

/**
 * An in-memory Device for tests of Held Movies and its callers: a Download
 * queue that finishes when the test says, and Offline copies by id.
 */
export function createFakeHeldMoviesPlatform({
  stored = [] as MovieHold[],
  copies = [] as string[],
} = {}) {
  const records = new Map(stored.map((hold) => [hold.id, hold]));
  const files = new Set(copies);
  const queued = new Set<string>();
  const requested: string[] = [];
  const listeners = new Set<() => void>();
  let clock = 1_000;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const platform: HeldMoviesPlatform = {
    now: () => clock++,
    loadHolds: () => [...records.values()],
    saveHold: (hold) => {
      records.set(hold.id, hold);
    },
    deleteHold: (id) => {
      records.delete(id);
    },
    downloads: {
      request: (title) => {
        requested.push(title.id);
        if (!files.has(title.id)) queued.add(title.id);
      },
      cancel: (id) => {
        queued.delete(id);
      },
    },
    offlineCopy: {
      getUri: (id) => (files.has(id) ? `file:///movies/${id}.mp4` : null),
      remove: async (id) => {
        files.delete(id);
        notify();
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };

  return {
    platform,
    /** Every Download asked for, in order (asking again included). */
    requested: () => [...requested],
    /** Downloads asked for and not yet finished or cancelled. */
    queued: () => [...queued],
    /** Finishes a queued Download: its Offline copy now exists. */
    finishDownload: (id: string) => {
      if (!queued.delete(id)) throw new Error(`${id} isn't Downloading`);
      files.add(id);
      notify();
    },
    copies: () => [...files],
    stored: () => [...records.values()],
  };
}
