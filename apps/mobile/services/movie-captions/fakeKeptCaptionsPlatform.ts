import type { KeptCaptionsPlatform } from "./createKeptCaptions";

/**
 * An in-memory Device and desktop for tests of kept Captions and their
 * callers: the desktop serves `served` Captions by id, and each kept file is
 * a `<titleId>/<captionId>` entry.
 */
export function createFakeKeptCaptionsPlatform({
  served = {} as Record<string, string>,
} = {}) {
  const files = new Map<string, string>();
  const fetched: string[] = [];
  const key = (titleId: string, captionId: string): string =>
    `${titleId}/${captionId}`;

  const platform: KeptCaptionsPlatform = {
    fetchCaption: async (serverUrl, captionId) => {
      fetched.push(`${serverUrl}/${captionId}`);
      const text = served[captionId];
      if (text === undefined) throw new Error("HTTP 404");
      return text;
    },
    list: async (titleId) =>
      [...files.keys()]
        .filter((name) => name.startsWith(`${titleId}/`))
        .map((name) => name.slice(titleId.length + 1)),
    write: async (titleId, captionId, text) => {
      files.set(key(titleId, captionId), text);
    },
    read: async (titleId, captionId) =>
      files.get(key(titleId, captionId)) ?? null,
    remove: async (titleId, captionId) => {
      files.delete(key(titleId, captionId));
    },
    removeAll: async (titleId) => {
      for (const name of [...files.keys()]) {
        if (name.startsWith(`${titleId}/`)) files.delete(name);
      }
    },
  };

  return {
    platform,
    /** Every Caption asked of the desktop, as `<serverUrl>/<captionId>`. */
    fetched: (): string[] => [...fetched],
    /** The kept files, as `<titleId>/<captionId>`. */
    files: (): string[] => [...files.keys()].sort(),
  };
}
