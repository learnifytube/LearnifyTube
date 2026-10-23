import {
  ON_DEVICE_SET_SYNC_PROTOCOL_VERSION,
  RESUME_SYNC_PROTOCOL_VERSION,
  SYNC_SSE_EVENT_AUDIOBOOKS,
  SYNC_SSE_EVENT_MOVIES,
  SYNC_SSE_EVENT_ON_DEVICE_SET,
  type DeviceReport,
  type MovieCatalog,
  type OnDeviceSet,
} from "../../../shared/mobile-sync-contract";

type SetVideo = OnDeviceSet["videos"][number];

export type DeviceMirrorPlatform = {
  getServerUrl: () => string | null;
  isForeground: () => boolean;
  /** False until the library has loaded, when every Video would look missing. */
  isLibraryLoaded: () => boolean;
  /** Called when the desktop connection or the app's foreground state changes. */
  onConditionsChange: (listener: () => void) => () => void;
  desktop: {
    /** The desktop's sync protocol version; what the Device sends depends on it. */
    getProtocolVersion: (serverUrl: string) => Promise<number>;
    /** The On-device set (desktops from ON_DEVICE_SET_SYNC_PROTOCOL_VERSION on). */
    getOnDeviceSet: (serverUrl: string) => Promise<SetVideo[]>;
    report: (serverUrl: string, report: DeviceReport) => Promise<void>;
    /**
     * Listens to the desktop's pushed sync events, and says when the stream
     * comes back after dropping; returns a function that stops.
     */
    listen: (
      serverUrl: string,
      handlers: { onEvent: (event: string) => void; onReconnect: () => void },
    ) => () => void;
  };
  device: {
    getId: () => Promise<string>;
    name: string;
    kind: DeviceReport["kind"];
  };
  /** Videos with a finished Download (an Offline copy) on this Device. */
  getLibraryVideoIds: () => string[];
  /** Videos with an unfinished Download. */
  getQueuedVideoIds: () => string[];
  requestDownload: (video: SetVideo) => void;
  cancelDownload: (videoId: string) => void;
  removeFromLibrary: (videoId: string) => void;
  hasThumbnail: (videoId: string) => boolean;
  /** Stores the Video's thumbnail on the Device, so it shows in Offline mode. */
  storeThumbnail: (serverUrl: string, video: SetVideo) => Promise<void>;
  getWatchProgress: () => DeviceReport["watch"];
  /** Listening positions kept on this Device. */
  getListening: () => NonNullable<DeviceReport["listening"]>;
  /** Where this Device stopped in each Movie and Episode it played. */
  getMovieWatch: () => NonNullable<DeviceReport["movieWatch"]>;
  /**
   * Where this Device's collections and files resume (ADR-0006), kept also in
   * Offline mode; reported only to a desktop that shares them.
   */
  resume: {
    seriesLastEpisodes: () => NonNullable<DeviceReport["seriesLastEpisodes"]>;
    /** The Current Video of each List and YouTube playlist, as kept on this Device. */
    currentVideos: () => NonNullable<DeviceReport["currentVideos"]>;
  };
  loadMirroredIds: () => Promise<string[]>;
  saveMirroredIds: (videoIds: string[]) => Promise<void>;
  /** Keeps the latest On-device set, which the TV shows as "Sent to this TV" in Offline mode too. */
  saveOnDeviceSet: (videos: SetVideo[]) => void;
  /** The Audiobook Mirror (`createAudiobookMirror`); a TV holds no Audiobooks. */
  audiobooks: {
    mirror: (serverUrl: string) => Promise<void>;
    /** Audiobooks wholly on this Device. */
    heldIds: () => Promise<string[]>;
  };
  movies: {
    /**
     * Refetches the desktop's Movie catalog into the Catalog snapshot, so a
     * title switched off Shown on Devices leaves the Device at once.
     */
    refreshCatalog: (serverUrl: string) => Promise<MovieCatalog | null>;
    /** The Movie Mirror (`createMovieMirror`), planned from the catalog just refetched. */
    mirror: (serverUrl: string, catalog: MovieCatalog) => Promise<void>;
    /** Movies and Episodes with an Offline copy on this Device. */
    heldIds: () => { movieIds: string[]; episodeIds: string[] };
  };
};

const SYNC_INTERVAL_MS = 2 * 60_000;
const SYNC_EVENTS = new Set([
  SYNC_SSE_EVENT_ON_DEVICE_SET,
  SYNC_SSE_EVENT_AUDIOBOOKS,
  SYNC_SSE_EVENT_MOVIES,
]);

/**
 * What the Device does to mirror the On-device set. Only Videos the mirror brought
 * (mirroredIds) are ever removed; Videos pulled on the Device itself are left alone.
 */
export function planMirror(input: {
  setIds: string[];
  libraryIds: string[];
  queuedIds: string[];
  mirroredIds: string[];
}) {
  const set = new Set(input.setIds);
  const library = new Set(input.libraryIds);
  const queued = new Set(input.queuedIds);
  const missing = input.setIds.filter((id) => !library.has(id));
  return {
    // Asking again is harmless: it does nothing for a Download on its way and retries a failed one.
    download: missing,
    remove: input.mirroredIds.filter((id) => !set.has(id)),
    mirroredIds: [
      ...new Set([
        ...input.mirroredIds.filter((id) => set.has(id)),
        ...missing.filter((id) => !queued.has(id)),
      ]),
    ],
  };
}

/**
 * The Device report's resume fields (ADR-0006): none for a desktop older than
 * resume, which would only drop them.
 */
function resumeReport(
  platform: DeviceMirrorPlatform,
  desktopVersion: number,
): Partial<DeviceReport> {
  if (desktopVersion < RESUME_SYNC_PROTOCOL_VERSION) return {};
  return {
    seriesLastEpisodes: platform.resume.seriesLastEpisodes(),
    currentVideos: platform.resume.currentVideos(),
  };
}

export function createDeviceMirror(platform: DeviceMirrorPlatform) {
  let syncing: Promise<void> | null = null;
  // The one sync queued to run after the sync in flight.
  let followUp: Promise<void> | null = null;

  const sync = async () => {
    const serverUrl = platform.getServerUrl();
    if (!serverUrl || !platform.isLibraryLoaded()) return;
    const desktopVersion = await platform.desktop.getProtocolVersion(serverUrl);
    // Too old to serve the set: the Device is left alone.
    if (desktopVersion < ON_DEVICE_SET_SYNC_PROTOCOL_VERSION) return;
    const setVideos = await platform.desktop.getOnDeviceSet(serverUrl);
    platform.saveOnDeviceSet(setVideos);

    const libraryIds = platform.getLibraryVideoIds();
    const queuedIds = platform.getQueuedVideoIds();
    const plan = planMirror({
      setIds: setVideos.map((video) => video.id),
      libraryIds,
      queuedIds,
      mirroredIds: await platform.loadMirroredIds(),
    });

    const byId = new Map(setVideos.map((video) => [video.id, video]));
    for (const videoId of plan.download) {
      const video = byId.get(videoId);
      if (video) platform.requestDownload(video);
    }
    for (const videoId of plan.remove) {
      if (queuedIds.includes(videoId)) platform.cancelDownload(videoId);
      if (libraryIds.includes(videoId)) platform.removeFromLibrary(videoId);
    }
    await platform.saveMirroredIds(plan.mirroredIds);

    // A failing Audiobook Mirror never holds up the Videos' report.
    await platform.audiobooks.mirror(serverUrl).catch((error) => {
      console.warn("[DeviceMirror] Audiobook Mirror failed", error);
    });
    // Null on a desktop too old to serve Movies: what the Device holds stays.
    const movieCatalog = await platform.movies
      .refreshCatalog(serverUrl)
      .catch((error) => {
        console.warn("[DeviceMirror] Movie catalog failed", error);
        return null;
      });
    if (movieCatalog) {
      await platform.movies.mirror(serverUrl, movieCatalog).catch((error) => {
        console.warn("[DeviceMirror] Movie Mirror failed", error);
      });
    }
    const heldMovies = platform.movies.heldIds();

    await platform.desktop.report(serverUrl, {
      deviceId: await platform.device.getId(),
      name: platform.device.name,
      kind: platform.device.kind,
      offlineVideoIds: platform.getLibraryVideoIds(),
      watch: platform.getWatchProgress(),
      listening: platform.getListening(),
      heldAudiobookIds: await platform.audiobooks.heldIds(),
      movieWatch: platform.getMovieWatch(),
      heldMovieIds: heldMovies.movieIds,
      heldEpisodeIds: heldMovies.episodeIds,
      ...resumeReport(platform, desktopVersion),
    });

    // Videos held from before thumbnails were stored with Offline copies;
    // one at a time, so a large library doesn't flood the desktop.
    const held = new Set(platform.getLibraryVideoIds());
    for (const video of setVideos) {
      if (!held.has(video.id) || platform.hasThumbnail(video.id)) continue;
      await platform.storeThumbnail(serverUrl, video).catch((error) => {
        console.warn("[DeviceMirror] Failed to store thumbnail", error);
      });
    }
  };

  const runSync = () =>
    sync()
      .catch((error) => {
        console.warn("[DeviceMirror] Sync failed", error);
      })
      .finally(() => {
        syncing = null;
      });

  /**
   * Mirrors the On-device set now. A call during a sync queues one more sync
   * after it (however many calls arrive), since what changed may have been read
   * already, and waits for that one.
   */
  const syncNow = () => {
    if (!syncing) {
      syncing = runSync();
      return syncing;
    }
    followUp ??= syncing.then(() => {
      followUp = null;
      syncing ??= runSync();
      return syncing;
    });
    return followUp;
  };

  const syncIfConnected = () => {
    if (platform.getServerUrl() && platform.isForeground()) void syncNow();
  };

  /** Mirrors whenever the desktop connects or the app returns to the foreground, and every few minutes. */
  const start = () => {
    const unsubscribe = platform.onConditionsChange(syncIfConnected);
    const interval = setInterval(syncIfConnected, SYNC_INTERVAL_MS);
    syncIfConnected();

    // The desktop pushes a sync event when the On-device set, the sent
    // Audiobooks or the Movies change (ADR-0003), while connected and in the
    // foreground.
    let stopListening: (() => void) | null = null;
    let listeningTo: string | null = null;

    const followConnection = () => {
      const serverUrl = platform.isForeground()
        ? platform.getServerUrl()
        : null;
      if (serverUrl === listeningTo) return;
      stopListening?.();
      stopListening = null;
      listeningTo = serverUrl;
      if (!serverUrl) return;
      stopListening = platform.desktop.listen(serverUrl, {
        onEvent: (event) => {
          if (SYNC_EVENTS.has(event)) void syncNow();
        },
        // Events pushed while the stream was down are lost.
        onReconnect: () => void syncNow(),
      });
    };

    const unsubscribeListen = platform.onConditionsChange(followConnection);
    followConnection();

    return () => {
      unsubscribe();
      unsubscribeListen();
      clearInterval(interval);
      stopListening?.();
    };
  };

  return { start, syncNow };
}
