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
  const conditions = { serverUrl };
  const conditionListeners = new Set<() => void>();
  const failing = new Set(failingTrackIds);
  const gated = new Set(gatedTrackIds);
  const gates = new Map<string, () => void>();
  const gateWaiters = new Map<string, (() => void)[]>();
  const files = new Set<string>();
  const fetched: string[] = [];
  const removed: string[] = [];
  // Tracks a fetch was cut short on, with what it left on the phone.
  const partials = new Set<string>();
  const resumed: string[] = [];
  let coversFetched = 0;
  let records: HeldBookRecord[] = JSON.parse(JSON.stringify(storedRecords));
  for (const record of records) {
    for (const uri of Object.values(record.trackUris)) files.add(uri);
    if (record.cover) files.add(record.cover.uri);
  }

  const changeConditions = () => {
    for (const listener of conditionListeners) listener();
  };

  const platform: HeldAudiobooksPlatform = {
    getServerUrl: () => conditions.serverUrl,
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
          signal.addEventListener("abort", () => {
            partials.add(trackId);
            reject(new Error("Fetch cancelled"));
          });
        });
      }
      if (partials.delete(trackId)) resumed.push(trackId);
      if (failing.has(trackId) || conditions.serverUrl !== fromUrl) {
        throw new Error("The desktop couldn't serve this Track");
      }
      const uri = `file://storage/${bookId}/${trackId}`;
      files.add(uri);
      fetched.push(`${bookId}/${trackId}`);
      return uri;
    },
    fetchCover: async (fromUrl, bookId) => {
      if (conditions.serverUrl !== fromUrl) {
        throw new Error("The desktop couldn't serve this cover");
      }
      coversFetched += 1;
      const uri = `file://covers/${bookId}-${coversFetched}`;
      files.add(uri);
      return uri;
    },
    exists: async (uri) => files.has(uri),
    discardPartial: async (trackId) => {
      partials.delete(trackId);
    },
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
    /** Tracks whose cut-short fetch left part of the file on the phone. */
    partials: () => [...partials],
    /** Tracks fetched on from where a cut-short fetch stopped, in order. */
    resumed: () => resumed,
    /** What the phone saved, as a fresh app start would load it. */
    storedRecords: () => records,
    setServerUrl: (url: string | null) => {
      conditions.serverUrl = url;
      changeConditions();
    },
    /** The app goes to the background (the screen turns off). */
    goToBackground: () => {
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
