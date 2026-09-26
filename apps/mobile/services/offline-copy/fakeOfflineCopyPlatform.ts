import type { OfflineCopyPlatform, StorageLocation } from "./createOfflineCopy";

const INTERNAL: StorageLocation = { kind: "internal", directoryUri: null };

/** An in-memory device for tests of the Offline copy module and its callers. */
export function createFakeOfflineCopyPlatform({
  documentsDir = "file:///container-a/Documents",
  location = INTERNAL,
  records = {} as Record<string, string>,
} = {}) {
  const files = new Set<string>();
  const contents = new Map<string, Uint8Array>();
  const unmounted = new Set<string>();
  const state = {
    documentsDir,
    location,
    records: { ...records },
    failCopies: false,
  };

  const isMounted = (uri: string) =>
    ![...unmounted].some((prefix) => uri.startsWith(prefix));

  const platform: OfflineCopyPlatform = {
    documentsDir: () => state.documentsDir,
    getStorageLocation: async () => state.location,
    loadRecords: () =>
      Object.entries(state.records).map(([videoId, uri]) => ({ videoId, uri })),
    writeRecord: (videoId, uri) => {
      if (uri) state.records[videoId] = uri;
      else delete state.records[videoId];
    },
    exists: async (uri) => isMounted(uri) && files.has(uri),
    list: async (dirUri) => {
      if (!isMounted(dirUri)) throw new Error(`Not mounted: ${dirUri}`);
      return [...files].filter(
        (uri) =>
          uri.startsWith(`${dirUri}/`) &&
          !uri.slice(dirUri.length + 1).includes("/"),
      );
    },
    ensureDir: async (parentUri, name) => {
      if (!isMounted(parentUri)) throw new Error(`Not mounted: ${parentUri}`);
      return `${parentUri}/${name}`;
    },
    createFile: async (dirUri, videoId) => {
      // Like Android's document provider, never overwrite: pick a new name.
      let uri = `${dirUri}/${videoId}.mp4`;
      for (let n = 1; files.has(uri); n++)
        uri = `${dirUri}/${videoId} (${n}).mp4`;
      files.add(uri);
      return uri;
    },
    copy: async (from, to) => {
      if (state.failCopies) throw new Error("Disk full");
      if (!files.has(from)) throw new Error(`Missing ${from}`);
      files.add(to);
      const bytes = contents.get(from);
      if (bytes) contents.set(to, bytes);
    },
    move: async (from, to) => {
      if (!files.has(from)) throw new Error(`Missing ${from}`);
      files.delete(from);
      files.add(to);
      const bytes = contents.get(from);
      if (bytes) {
        contents.set(to, bytes);
        contents.delete(from);
      }
    },
    remove: async (uri) => {
      files.delete(uri);
      contents.delete(uri);
    },
    readBytes: async (uri) => {
      if (!isMounted(uri) || !files.has(uri)) throw new Error(`Missing ${uri}`);
      return contents.get(uri) ?? new Uint8Array();
    },
  };

  return {
    platform,
    state,
    files,
    write: (uri: string, bytes?: Uint8Array) => {
      files.add(uri);
      if (bytes) contents.set(uri, bytes);
    },
    unmount: (prefix: string) => unmounted.add(prefix),
    remount: (prefix: string) => unmounted.delete(prefix),
  };
}
