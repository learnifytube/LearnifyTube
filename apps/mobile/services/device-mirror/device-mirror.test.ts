import {
  SYNC_SSE_EVENT_AUDIOBOOKS,
  SYNC_SSE_EVENT_CURRENT_VIDEOS,
  SYNC_SSE_EVENT_MOVIES,
  SYNC_SSE_EVENT_ON_DEVICE_SET,
  ON_DEVICE_SET_SYNC_PROTOCOL_VERSION,
  RESUME_SYNC_PROTOCOL_VERSION,
  type AudiobookTrackPosition,
  type CurrentVideo,
  type MovieCatalog,
  type MovieWatch,
  type OnDeviceSet,
  type SeriesLastEpisode,
} from "../../../shared/mobile-sync-contract";
import {
  createDeviceMirror,
  planMirror,
  type DeviceMirrorPlatform,
} from "./createDeviceMirror";

const SERVER = "http://desktop.local:53318";

// Lets a sync started by a pushed event finish.
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

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
  set = [] as string[],
  library = [] as string[],
} = {}) {
  const state = {
    serverUrl: SERVER as string | null,
    libraryLoaded: true,
    // The desktop's sync protocol version (GET /api/info).
    protocolVersion: RESUME_SYNC_PROTOCOL_VERSION,
    set,
    library: new Set(library),
    queued: new Set<string>(),
    mirrored: [] as string[],
    requested: [] as string[],
    cancelled: [] as string[],
    reports: [] as unknown[],
    thumbnails: new Set<string>(),
    thumbnailFailures: new Set<string>(),
    savedSet: null as string[] | null,
    audiobookMirrors: [] as string[],
    audiobookMirrorFails: false,
    heldAudiobookIds: [] as string[],
    movieWatch: [] as MovieWatch[],
    seriesLastEpisodes: [] as SeriesLastEpisode[],
    currentVideos: [] as CurrentVideo[],
    movieCatalogRefreshes: [] as string[],
    movieCatalogFails: false,
    // What the desktop serves as its Movie catalog; null for a desktop too old.
    movieCatalog: { movies: [], series: [] } as MovieCatalog | null,
    movieMirrors: [] as MovieCatalog[],
    movieMirrorFails: false,
    heldMovies: { movieIds: [] as string[], episodeIds: [] as string[] },
    trackPositions: [] as AudiobookTrackPosition[],
    // The desktops listened to for pushed sync events, and how to push one.
    listening: [] as string[],
    pushEvent: (_event: string) => {},
    reconnect: () => {},
    conditionsChanged: () => {},
  };
  const platform: DeviceMirrorPlatform = {
    getServerUrl: () => state.serverUrl,
    isForeground: () => true,
    isLibraryLoaded: () => state.libraryLoaded,
    onConditionsChange: (listener) => {
      const previous = state.conditionsChanged;
      state.conditionsChanged = () => {
        previous();
        listener();
      };
      return () => {};
    },
    desktop: {
      getProtocolVersion: async () => state.protocolVersion,
      getOnDeviceSet: async () => state.set.map(setVideo),
      report: async (_serverUrl, report) => {
        state.reports.push(report);
      },
      listen: (serverUrl, { onEvent, onReconnect }) => {
        state.listening.push(serverUrl);
        state.pushEvent = onEvent;
        state.reconnect = onReconnect;
        return () => {
          state.listening = state.listening.filter((url) => url !== serverUrl);
        };
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
    hasThumbnail: (videoId) => state.thumbnails.has(videoId),
    storeThumbnail: async (_serverUrl, video) => {
      if (state.thumbnailFailures.has(video.id)) {
        throw new Error("Thumbnail request failed with HTTP 500");
      }
      state.thumbnails.add(video.id);
    },
    getListening: () => [
      {
        audiobookId: "frankl",
        trackId: "cd3",
        seconds: 754,
        updatedAt: 20,
        finished: false,
      },
    ],
    getWatchProgress: () => [
      { videoId: "a", lastPositionSeconds: 60, lastWatchedAt: 10 },
    ],
    getMovieWatch: () => state.movieWatch,
    resume: {
      seriesLastEpisodes: () => state.seriesLastEpisodes,
      currentVideos: () => state.currentVideos,
      trackPositions: () => state.trackPositions,
    },
    loadMirroredIds: async () => state.mirrored,
    saveMirroredIds: async (ids) => {
      state.mirrored = ids;
    },
    saveOnDeviceSet: (videos) => {
      state.savedSet = videos.map((video) => video.id);
    },
    audiobooks: {
      mirror: async (serverUrl) => {
        if (state.audiobookMirrorFails)
          throw new Error("Catalog request failed");
        state.audiobookMirrors.push(serverUrl);
      },
      heldIds: async () => state.heldAudiobookIds,
    },
    movies: {
      refreshCatalog: async (serverUrl) => {
        if (state.movieCatalogFails) throw new Error("Catalog request failed");
        state.movieCatalogRefreshes.push(serverUrl);
        return state.movieCatalog;
      },
      mirror: async (_serverUrl, catalog) => {
        if (state.movieMirrorFails) throw new Error("Disk full");
        state.movieMirrors.push(catalog);
      },
      heldIds: () => state.heldMovies,
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

  it("remembers the On-device set, so the TV can show it in Offline mode", async () => {
    const { state, mirror } = createHarness({ set: ["a", "b"] });
    await mirror.syncNow();
    expect(state.savedSet).toEqual(["a", "b"]);

    state.set = ["b"];
    await mirror.syncNow();
    expect(state.savedSet).toEqual(["b"]);
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

  it("reports Movie and Episode watch progress made on the Device", async () => {
    const { state, mirror } = createHarness({ set: [] });
    state.movieWatch = [
      { kind: "movie", id: "up", lastPositionSeconds: 600, lastWatchedAt: 30 },
      { kind: "episode", id: "e1", lastPositionSeconds: 90, lastWatchedAt: 40 },
    ];
    await mirror.syncNow();
    expect(state.reports).toEqual([
      expect.objectContaining({ movieWatch: state.movieWatch }),
    ]);
  });

  it("reports what the Device holds, its watch progress and Listening positions", async () => {
    const { state, mirror } = createHarness({ set: [], library: ["x"] });
    state.heldAudiobookIds = ["orwell"];
    await mirror.syncNow();
    expect(state.reports).toEqual([
      {
        deviceId: "device-1",
        name: "Pixel",
        kind: "phone",
        offlineVideoIds: ["x"],
        watch: [{ videoId: "a", lastPositionSeconds: 60, lastWatchedAt: 10 }],
        listening: [
          {
            audiobookId: "frankl",
            trackId: "cd3",
            seconds: 754,
            updatedAt: 20,
            finished: false,
          },
        ],
        heldAudiobookIds: ["orwell"],
        trackPositions: [],
        movieWatch: [],
        heldMovieIds: [],
        heldEpisodeIds: [],
        seriesLastEpisodes: [],
        currentVideos: [],
      },
    ]);
  });

  it("sends each Series' last Episode kept in Offline mode in the next report", async () => {
    const { state, mirror } = createHarness({ set: [] });
    // Kept while no desktop was there: nothing went out.
    state.serverUrl = null;
    state.seriesLastEpisodes = [
      { seriesId: "office", episodeId: "s1e2", updatedAt: 40 },
    ];
    await mirror.syncNow();
    expect(state.reports).toEqual([]);

    state.serverUrl = SERVER;
    await mirror.syncNow();
    expect(state.reports).toEqual([
      expect.objectContaining({
        seriesLastEpisodes: [
          { seriesId: "office", episodeId: "s1e2", updatedAt: 40 },
        ],
      }),
    ]);
  });

  it("sends each Current Video kept in Offline mode in the next report", async () => {
    const { state, mirror } = createHarness({ set: [] });
    // Kept while no desktop was there: nothing went out.
    state.serverUrl = null;
    state.currentVideos = [
      {
        collectionKind: "list",
        collectionId: "course",
        videoId: "b",
        updatedAt: 50,
      },
    ];
    await mirror.syncNow();
    expect(state.reports).toEqual([]);

    state.serverUrl = SERVER;
    await mirror.syncNow();
    expect(state.reports).toEqual([
      expect.objectContaining({ currentVideos: state.currentVideos }),
    ]);
  });

  it("sends nothing new to a desktop older than resume", async () => {
    const { state, mirror } = createHarness({ set: [] });
    state.protocolVersion = RESUME_SYNC_PROTOCOL_VERSION - 1;
    state.seriesLastEpisodes = [
      { seriesId: "office", episodeId: "s1e2", updatedAt: 40 },
    ];
    state.currentVideos = [
      {
        collectionKind: "list",
        collectionId: "course",
        videoId: "b",
        updatedAt: 50,
      },
    ];
    state.trackPositions = [
      {
        audiobookId: "frankl",
        trackId: "cd2",
        seconds: 410,
        playedToEnd: false,
        updatedAt: 30,
      },
    ];
    await mirror.syncNow();
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]).not.toHaveProperty("seriesLastEpisodes");
    expect(state.reports[0]).not.toHaveProperty("currentVideos");
    expect(state.reports[0]).not.toHaveProperty("trackPositions");
  });

  it("sends Track positions kept in Offline mode in the next Device report", async () => {
    const { state, mirror } = createHarness({ set: [] });
    // Kept while no desktop was there: nothing went out.
    state.serverUrl = null;
    const kept: AudiobookTrackPosition = {
      audiobookId: "frankl",
      trackId: "cd2",
      seconds: 410,
      playedToEnd: false,
      updatedAt: 30,
    };
    state.trackPositions = [kept];
    await mirror.syncNow();
    expect(state.reports).toEqual([]);

    state.serverUrl = SERVER;
    await mirror.syncNow();
    expect(state.reports).toEqual([
      expect.objectContaining({ trackPositions: [kept] }),
    ]);
  });

  it("Mirrors the sent Audiobooks on every sync", async () => {
    const { state, mirror } = createHarness({ set: [] });
    await mirror.syncNow();
    expect(state.audiobookMirrors).toEqual([SERVER]);
  });

  it("still Mirrors Videos and reports when the Audiobook Mirror fails", async () => {
    const { state, mirror } = createHarness({ set: ["a"] });
    state.audiobookMirrorFails = true;
    await mirror.syncNow();
    expect(state.requested).toEqual(["a"]);
    expect(state.reports).toHaveLength(1);
  });

  it("refetches the Movie catalog on every sync", async () => {
    const { state, mirror } = createHarness({ set: [] });
    await mirror.syncNow();
    expect(state.movieCatalogRefreshes).toEqual([SERVER]);
  });

  it("still Mirrors Videos and reports when the Movie catalog fails", async () => {
    const { state, mirror } = createHarness({ set: ["a"] });
    state.movieCatalogFails = true;
    await mirror.syncNow();
    expect(state.requested).toEqual(["a"]);
    expect(state.reports).toHaveLength(1);
  });

  it("Mirrors the sent Movies from the catalog it just refetched", async () => {
    const { state, mirror } = createHarness({ set: [] });
    const served: MovieCatalog = { movies: [], series: [] };
    state.movieCatalog = served;
    await mirror.syncNow();
    expect(state.movieMirrors).toEqual([served]);
  });

  it("leaves the Movies it holds alone on a desktop too old to serve Movies", async () => {
    const { state, mirror } = createHarness({ set: [] });
    state.movieCatalog = null;
    await mirror.syncNow();
    expect(state.movieMirrors).toEqual([]);
    expect(state.reports).toHaveLength(1);
  });

  it("reports the Movies and Episodes it holds", async () => {
    const { state, mirror } = createHarness({ set: [] });
    state.heldMovies = { movieIds: ["up"], episodeIds: ["pilot"] };
    await mirror.syncNow();
    expect(state.reports).toEqual([
      expect.objectContaining({
        heldMovieIds: ["up"],
        heldEpisodeIds: ["pilot"],
      }),
    ]);
  });

  it("still Mirrors Videos and reports when the Movie Mirror fails", async () => {
    const { state, mirror } = createHarness({ set: ["a"] });
    state.movieMirrorFails = true;
    await mirror.syncNow();
    expect(state.requested).toEqual(["a"]);
    expect(state.reports).toHaveLength(1);
  });

  it("refetches the Movie catalog when the desktop pushes a Movies change", async () => {
    const { state, mirror } = createHarness({ set: [] });
    const stop = mirror.start();
    await flush();
    const before = state.movieCatalogRefreshes.length;

    state.pushEvent(SYNC_SSE_EVENT_MOVIES);
    await flush();

    expect(state.movieCatalogRefreshes).toHaveLength(before + 1);
    stop();
  });

  it("stores missing thumbnails for Videos in the set the Device already holds", async () => {
    const { state, mirror } = createHarness({
      set: ["held", "stored", "failing", "new"],
      library: ["held", "stored", "failing", "pulled"],
    });
    state.thumbnails.add("stored");
    state.thumbnailFailures.add("failing");

    await mirror.syncNow();

    expect([...state.thumbnails].sort()).toEqual(["held", "stored"]);
    expect(state.requested).toEqual(["new"]);
    expect(state.reports).toHaveLength(1);
  });

  it("leaves the Device alone when the desktop is too old to serve the set", async () => {
    const { state, mirror } = createHarness({ set: [], library: ["x"] });
    state.protocolVersion = ON_DEVICE_SET_SYNC_PROTOCOL_VERSION - 1;
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

  it("tells screens when the desktop pushes a Current Video change, without syncing", async () => {
    const { state, mirror } = createHarness({ set: ["a"] });
    const stop = mirror.start();
    await flush();
    state.requested = [];
    const told: string[] = [];
    const unsubscribe = mirror.onCurrentVideosChanged(() => told.push("now"));

    state.pushEvent(SYNC_SSE_EVENT_CURRENT_VIDEOS);
    await flush();
    expect(told).toEqual(["now"]);
    expect(state.requested).toEqual([]);

    unsubscribe();
    state.pushEvent(SYNC_SSE_EVENT_CURRENT_VIDEOS);
    expect(told).toEqual(["now"]);
    stop();
  });

  it("syncs when the desktop pushes an On-device set or Audiobooks change", async () => {
    const { state, mirror } = createHarness({ set: ["a"] });
    const stop = mirror.start();
    await flush();
    expect(state.listening).toEqual([SERVER]);
    state.requested = [];

    state.pushEvent(SYNC_SSE_EVENT_ON_DEVICE_SET);
    await flush();
    expect(state.requested).toEqual(["a"]);

    const mirrorsBefore = state.audiobookMirrors.length;
    state.pushEvent(SYNC_SSE_EVENT_AUDIOBOOKS);
    await flush();
    expect(state.audiobookMirrors).toHaveLength(mirrorsBefore + 1);

    const mirrorsAfter = state.audiobookMirrors.length;
    state.pushEvent("message");
    await flush();
    expect(state.audiobookMirrors).toHaveLength(mirrorsAfter);

    stop();
    expect(state.listening).toEqual([]);
  });

  it("syncs once more after the sync running when asked during it, however often", async () => {
    const { state, mirror } = createHarness({ set: ["a"] });

    const running = mirror.syncNow();
    const asked = [mirror.syncNow(), mirror.syncNow(), mirror.syncNow()];
    await Promise.all([running, ...asked]);

    expect(state.audiobookMirrors).toHaveLength(2);
    expect(state.reports).toHaveLength(2);
  });

  it("doesn't drop an Audiobooks change pushed while a sync is running", async () => {
    const { state, mirror } = createHarness({ set: ["a"] });
    const stop = mirror.start();
    const mirrorsBefore = state.audiobookMirrors.length;

    // start() began a sync that hasn't finished yet.
    state.pushEvent(SYNC_SSE_EVENT_AUDIOBOOKS);
    await flush();

    expect(state.audiobookMirrors).toHaveLength(mirrorsBefore + 2);
    stop();
  });

  it("syncs when the stream reconnects, for events pushed while it was down", async () => {
    const { state, mirror } = createHarness({ set: ["a"] });
    const stop = mirror.start();
    await flush();
    state.requested = [];

    state.reconnect();
    await flush();
    expect(state.requested).toEqual(["a"]);
    stop();
  });

  it("listens to the new desktop when the connection changes, and to none without one", () => {
    const { state, mirror } = createHarness({ set: [] });
    const stop = mirror.start();
    expect(state.listening).toEqual([SERVER]);

    state.serverUrl = "http://other.local:53318";
    state.conditionsChanged();
    expect(state.listening).toEqual(["http://other.local:53318"]);

    state.serverUrl = null;
    state.conditionsChanged();
    expect(state.listening).toEqual([]);
    stop();
  });
});
