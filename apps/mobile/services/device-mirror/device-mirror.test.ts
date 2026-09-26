import type { OnDeviceSet } from "../../../shared/mobile-sync-contract";
import {
  createDeviceMirror,
  planMirror,
  type DeviceMirrorPlatform,
} from "./createDeviceMirror";

const SERVER = "http://desktop.local:53318";

const setVideo = (id: string): OnDeviceSet["videos"][number] => ({
  id,
  title: `Video ${id}`,
  channelTitle: "Channel",
  duration: 60,
  thumbnailUrl: null,
});

describe("planMirror", () => {
  it("Downloads every Video in the set that the Device does not hold", () => {
    const plan = planMirror({
      setIds: ["a", "b"],
      libraryIds: ["a"],
      queuedIds: [],
      mirroredIds: [],
    });
    expect(plan.download).toEqual(["b"]);
    expect(plan.remove).toEqual([]);
  });

  it("removes Videos the mirror brought that left the set", () => {
    const plan = planMirror({
      setIds: ["a"],
      libraryIds: ["a", "b"],
      queuedIds: [],
      mirroredIds: ["a", "b"],
    });
    expect(plan.remove).toEqual(["b"]);
    expect(plan.mirroredIds).toEqual(["a"]);
  });

  it("never removes Videos pulled on the Device itself", () => {
    const joined = planMirror({
      setIds: ["pulled"],
      libraryIds: ["pulled"],
      queuedIds: [],
      mirroredIds: [],
    });
    expect(joined.mirroredIds).toEqual([]);

    const left = planMirror({
      setIds: [],
      libraryIds: ["pulled"],
      queuedIds: [],
      mirroredIds: joined.mirroredIds,
    });
    expect(left.remove).toEqual([]);
  });

  it("does not take over a Download the user started on the Device", () => {
    const plan = planMirror({
      setIds: ["q"],
      libraryIds: [],
      queuedIds: ["q"],
      mirroredIds: [],
    });
    expect(plan.download).toEqual(["q"]);
    expect(plan.mirroredIds).toEqual([]);
  });
});

function createHarness({
  set = [] as string[] | null,
  library = [] as string[],
} = {}) {
  const state = {
    serverUrl: SERVER as string | null,
    libraryLoaded: true,
    set,
    library: new Set(library),
    queued: new Set<string>(),
    mirrored: [] as string[],
    requested: [] as string[],
    cancelled: [] as string[],
    reports: [] as unknown[],
  };
  const platform: DeviceMirrorPlatform = {
    getServerUrl: () => state.serverUrl,
    isForeground: () => true,
    isLibraryLoaded: () => state.libraryLoaded,
    onConditionsChange: () => () => {},
    desktop: {
      getOnDeviceSet: async () => (state.set ? state.set.map(setVideo) : null),
      report: async (_serverUrl, report) => {
        state.reports.push(report);
      },
    },
    device: { getId: async () => "device-1", name: "Pixel", kind: "phone" },
    getLibraryVideoIds: () => [...state.library],
    getQueuedVideoIds: () => [...state.queued],
    requestDownload: (video) => {
      state.requested.push(video.id);
      state.queued.add(video.id);
    },
    cancelDownload: (videoId) => {
      state.cancelled.push(videoId);
      state.queued.delete(videoId);
    },
    removeFromLibrary: (videoId) => {
      state.library.delete(videoId);
    },
    getWatchProgress: () => [
      { videoId: "a", lastPositionSeconds: 60, lastWatchedAt: 10 },
    ],
    loadMirroredIds: async () => state.mirrored,
    saveMirroredIds: async (ids) => {
      state.mirrored = ids;
    },
  };
  return { state, mirror: createDeviceMirror(platform) };
}

describe("device mirror", () => {
  it("Downloads the set, then removes what left it on the next connection", async () => {
    const { state, mirror } = createHarness({ set: ["a", "b"] });

    await mirror.syncNow();
    expect(state.requested).toEqual(["a", "b"]);

    // Both Downloads finish; then "b" leaves the set on the desktop.
    state.queued.clear();
    state.library = new Set(["a", "b"]);
    state.set = ["a"];
    await mirror.syncNow();

    expect([...state.library]).toEqual(["a"]);
  });

  it("cancels a Download that left the set before it finished", async () => {
    const { state, mirror } = createHarness({ set: ["a"] });
    await mirror.syncNow();
    state.set = [];
    await mirror.syncNow();
    expect(state.cancelled).toEqual(["a"]);
  });

  it("keeps a Video pulled on the Device when it leaves the set", async () => {
    const { state, mirror } = createHarness({
      set: ["pulled"],
      library: ["pulled"],
    });
    await mirror.syncNow();
    state.set = [];
    await mirror.syncNow();
    expect([...state.library]).toEqual(["pulled"]);
  });

  it("reports what the Device holds and its watch progress", async () => {
    const { state, mirror } = createHarness({ set: [], library: ["x"] });
    await mirror.syncNow();
    expect(state.reports).toEqual([
      {
        deviceId: "device-1",
        name: "Pixel",
        kind: "phone",
        offlineVideoIds: ["x"],
        watch: [{ videoId: "a", lastPositionSeconds: 60, lastWatchedAt: 10 }],
      },
    ]);
  });

  it("leaves the Device alone when the desktop is too old to serve the set", async () => {
    const { state, mirror } = createHarness({ set: null, library: ["x"] });
    state.mirrored = ["x"];
    await mirror.syncNow();
    expect([...state.library]).toEqual(["x"]);
    expect(state.reports).toEqual([]);
  });

  it("waits for the library to load, so it never claims Videos pulled on the Device", async () => {
    const { state, mirror } = createHarness({ set: ["pulled"] });
    state.libraryLoaded = false;
    await mirror.syncNow();
    expect(state.requested).toEqual([]);
    expect(state.mirrored).toEqual([]);
  });

  it("does nothing without a desktop", async () => {
    const { state, mirror } = createHarness({ set: ["a"] });
    state.serverUrl = null;
    await mirror.syncNow();
    expect(state.requested).toEqual([]);
  });
});
