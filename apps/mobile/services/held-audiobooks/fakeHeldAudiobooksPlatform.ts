import type {
  HeldAudiobooksPlatform,
  HeldBookRecord,
} from "./createHeldAudiobooks";

/** An in-memory phone and desktop for tests of Held Audiobooks. */
export function createFakeHeldAudiobooksPlatform({
  serverUrl = null as string | null,
  // Tracks the desktop can't serve right now.
  failingTrackIds = [] as string[],
  // Tracks whose fetch finishes only when releaseTrack() is called.
  gatedTrackIds = [] as string[],
  storedRecords = [] as HeldBookRecord[],
} = {}) {
  const conditions = { serverUrl, foreground: true };
  const conditionListeners = new Set<() => void>();
  const failing = new Set(failingTrackIds);
  const gated = new Set(gatedTrackIds);
  const gates = new Map<string, () => void>();
  const gateWaiters = new Map<string, (() => void)[]>();
  const files = new Set<string>();
  const fetched: string[] = [];
  const removed: string[] = [];
  let records: HeldBookRecord[] = JSON.parse(JSON.stringify(storedRecords));
  for (const record of records) {
    for (const uri of Object.values(record.trackUris)) files.add(uri);
  }

  const changeConditions = () => {
    for (const listener of conditionListeners) listener();
  };

  const platform: HeldAudiobooksPlatform = {
    getServerUrl: () => conditions.serverUrl,
    isForeground: () => conditions.foreground,
    onConditionsChange: (listener) => {
      conditionListeners.add(listener);
      return () => conditionListeners.delete(listener);
    },
    fetchTrack: async (fromUrl, bookId, trackId, signal) => {
      if (gated.has(trackId)) {
        await new Promise<void>((resolve, reject) => {
          gates.set(trackId, resolve);
          for (const waiter of gateWaiters.get(trackId) ?? []) waiter();
          gateWaiters.delete(trackId);
          signal.addEventListener("abort", () =>
            reject(new Error("Fetch cancelled")),
          );
        });
      }
      if (failing.has(trackId) || conditions.serverUrl !== fromUrl) {
        throw new Error("The desktop couldn't serve this Track");
      }
      const uri = `file://storage/${bookId}/${trackId}`;
      files.add(uri);
      fetched.push(`${bookId}/${trackId}`);
      return uri;
    },
    exists: async (uri) => files.has(uri),
    remove: async (uri) => {
      files.delete(uri);
      removed.push(uri);
    },
    loadRecords: async () => JSON.parse(JSON.stringify(records)),
    saveRecords: (next) => {
      records = JSON.parse(JSON.stringify(next));
    },
  };

  return {
    platform,
    /** Every Track fetched so far, as "bookId/trackId", in order. */
    fetched: () => fetched,
    /** Files on the phone now. */
    files: () => [...files],
    removed: () => removed,
    /** What the phone saved, as a fresh app start would load it. */
    storedRecords: () => records,
    setServerUrl: (url: string | null) => {
      conditions.serverUrl = url;
      changeConditions();
    },
    setForeground: (foreground: boolean) => {
      conditions.foreground = foreground;
      changeConditions();
    },
    healTrack: (trackId: string) => failing.delete(trackId),
    /** Resolves once a gated Track's fetch has begun and is held at the gate. */
    fetchStarted: (trackId: string) =>
      new Promise<void>((resolve) => {
        if (gates.has(trackId)) return resolve();
        gateWaiters.set(trackId, [
          ...(gateWaiters.get(trackId) ?? []),
          resolve,
        ]);
      }),
    releaseTrack: (trackId: string) => {
      gated.delete(trackId);
      gates.get(trackId)?.();
      gates.delete(trackId);
    },
    /** A file that went away without the app (e.g. a USB drive unplugged). */
    loseFile: (uri: string) => files.delete(uri),
  };
}
