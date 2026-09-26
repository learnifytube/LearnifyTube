import type {
  DeviceReport,
  OnDeviceSet,
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
    /** The On-device set, or null when the desktop is too old to serve one. */
    getOnDeviceSet: (serverUrl: string) => Promise<SetVideo[] | null>;
    report: (serverUrl: string, report: DeviceReport) => Promise<void>;
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
  getWatchProgress: () => DeviceReport["watch"];
  loadMirroredIds: () => Promise<string[]>;
  saveMirroredIds: (videoIds: string[]) => Promise<void>;
};

const SYNC_INTERVAL_MS = 2 * 60_000;

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

export function createDeviceMirror(platform: DeviceMirrorPlatform) {
  let syncing: Promise<void> | null = null;

  const sync = async () => {
    const serverUrl = platform.getServerUrl();
    if (!serverUrl || !platform.isLibraryLoaded()) return;
    const setVideos = await platform.desktop.getOnDeviceSet(serverUrl);
    if (!setVideos) return;

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

    await platform.desktop.report(serverUrl, {
      deviceId: await platform.device.getId(),
      name: platform.device.name,
      kind: platform.device.kind,
      offlineVideoIds: platform.getLibraryVideoIds(),
      watch: platform.getWatchProgress(),
    });
  };

  /** Mirrors the On-device set now; a call during a sync waits for that sync. */
  const syncNow = () => {
    syncing ??= sync()
      .catch((error) => {
        console.warn("[DeviceMirror] Sync failed", error);
      })
      .finally(() => {
        syncing = null;
      });
    return syncing;
  };

  const syncIfConnected = () => {
    if (platform.getServerUrl() && platform.isForeground()) void syncNow();
  };

  /** Mirrors whenever the desktop connects or the app returns to the foreground, and every few minutes. */
  const start = () => {
    const unsubscribe = platform.onConditionsChange(syncIfConnected);
    const interval = setInterval(syncIfConnected, SYNC_INTERVAL_MS);
    syncIfConnected();
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  };

  return { start, syncNow };
}
