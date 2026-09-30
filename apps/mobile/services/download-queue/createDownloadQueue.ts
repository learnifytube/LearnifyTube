import { useSyncExternalStore } from "react";
import type { DesktopFetch } from "../desktop-fetch/createDesktopFetch";
import type { OfflineCopy } from "../offline-copy/createOfflineCopy";
import type { Transcript, Video } from "../../types";

export type DownloadPhase =
  "waiting-for-desktop" | "queued" | "transferring" | "failed";

/** What a caller knows about a Video when asking for its Download. */
export type DownloadRequest = {
  id: string;
  title: string;
  channelTitle: string;
  duration: number;
  thumbnailUrl?: string | null;
};

export type Download = {
  videoId: string;
  title: string;
  channelTitle: string;
  duration: number;
  thumbnailUrl?: string;
  phase: DownloadPhase;
  /** Desktop fetch progress while waiting, transfer progress while transferring. */
  progress: number | null;
  error?: string;
  addedAt: number;
};

/** A Download as saved between app runs; older app versions saved other statuses. */
export type StoredDownload = Omit<Download, "phase" | "progress"> & {
  status: string;
};

export type DownloadQueuePlatform = {
  offlineCopy: OfflineCopy;
  getServerUrl: () => string | null;
  isForeground: () => boolean;
  /** Called when the desktop connection or the app's foreground state changes. */
  onConditionsChange: (listener: () => void) => () => void;
  desktopFetch: DesktopFetch;
  desktop: {
    /** Writes the Video's file to destUri; "missing" when the desktop lost it and is fetching it again. */
    transfer: (
      serverUrl: string,
      videoId: string,
      destUri: string,
      onProgress: (percent: number) => void,
      signal: AbortSignal,
    ) => Promise<"done" | "missing">;
    getDetails: (
      serverUrl: string,
      videoId: string,
    ) => Promise<{ description: string | null; transcripts: Transcript[] }>;
  };
  addToLibrary: (video: Video) => void;
  /** Stores the Video's thumbnail on the Device, so it shows in Offline mode. */
  storeThumbnail: (
    serverUrl: string,
    videoId: string,
    thumbnailUrl: string | undefined,
  ) => Promise<void>;
  loadQueue: () => Promise<StoredDownload[]>;
  saveQueue: (downloads: StoredDownload[]) => void;
};

const MAX_TRANSFERS = 2;
const RETRY_DELAYS_MS = [1000, 3000, 10_000];
const PROGRESS_INTERVAL_MS = 250;

// Transfers in flight when the app stopped start over; completed entries
// come from app versions that kept finished Downloads in the queue.
function restore(stored: StoredDownload): Download | null {
  const { status } = stored;
  if (status === "completed") return null;
  const phase: DownloadPhase =
    status === "failed" || status === "waiting-for-desktop" ? status : "queued";
  return {
    videoId: stored.videoId,
    title: stored.title,
    channelTitle: stored.channelTitle,
    duration: stored.duration,
    thumbnailUrl: stored.thumbnailUrl,
    phase,
    progress: null,
    error: phase === "failed" ? stored.error : undefined,
    addedAt: stored.addedAt,
  };
}

const toStored = ({
  phase,
  progress: _progress,
  ...rest
}: Download): StoredDownload => ({
  ...rest,
  status: phase,
});

export function createDownloadQueue(platform: DownloadQueuePlatform) {
  let downloads: Download[] = [];
  const listeners = new Set<() => void>();
  // Downloads with work in flight: a desktop wait or a transfer.
  const running = new Map<string, AbortController>();
  // Downloads whose running work is a desktop wait, stopped when the queue can't run.
  const desktopWaits = new Set<string>();
  const retries = new Map<string, { count: number; at: number }>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const find = (videoId: string) =>
    downloads.find((download) => download.videoId === videoId) ?? null;

  const save = () => platform.saveQueue(downloads.map(toStored));

  const update = (videoId: string, changes: Partial<Download>) => {
    downloads = downloads.map((download) =>
      download.videoId === videoId ? { ...download, ...changes } : download,
    );
    // Progress alone isn't worth a write; it restarts from zero anyway.
    if ("phase" in changes) save();
    notify();
  };

  const drop = (videoId: string) => {
    downloads = downloads.filter((download) => download.videoId !== videoId);
    save();
    notify();
  };

  const canRun = () =>
    platform.getServerUrl() !== null && platform.isForeground();

  // Returns without a phase change when the app leaves the foreground or the
  // desktop disconnects; the Download waits again once it can run.
  const waitForDesktop = async (
    download: Download,
    serverUrl: string,
    signal: AbortSignal,
  ) => {
    const { videoId } = download;
    desktopWaits.add(videoId);
    try {
      await platform.desktopFetch.waitUntilFetched(serverUrl, videoId, {
        signal,
        onProgress: (progress) => update(videoId, { progress }),
      });
      if (signal.aborted) return;
      update(videoId, { phase: "queued", progress: null });
    } catch (error) {
      if (signal.aborted) return;
      update(videoId, {
        phase: "failed",
        progress: null,
        error:
          error instanceof Error
            ? error.message
            : "The desktop couldn't fetch this Video",
      });
    } finally {
      desktopWaits.delete(videoId);
    }
  };

  const failTransfer = async (videoId: string, error: unknown) => {
    await platform.offlineCopy.discardTemp(videoId).catch(() => {});
    const count = (retries.get(videoId)?.count ?? 0) + 1;
    const delay = RETRY_DELAYS_MS[count - 1];
    if (delay === undefined) {
      retries.delete(videoId);
      update(videoId, {
        phase: "failed",
        progress: null,
        error: error instanceof Error ? error.message : "Download failed",
      });
      return;
    }
    retries.set(videoId, { count, at: Date.now() + delay });
    update(videoId, { phase: "queued", progress: null });
    setTimeout(pump, delay);
  };

  const transfer = async (
    download: Download,
    serverUrl: string,
    signal: AbortSignal,
  ) => {
    try {
      await transferOnce(download, serverUrl, signal);
      retries.delete(download.videoId);
    } catch (error) {
      if (signal.aborted) {
        await platform.offlineCopy
          .discardTemp(download.videoId)
          .catch(() => {});
        return;
      }
      await failTransfer(download.videoId, error);
    }
  };

  const transferOnce = async (
    download: Download,
    serverUrl: string,
    signal: AbortSignal,
  ) => {
    const { videoId } = download;
    update(videoId, { phase: "transferring", progress: 0 });
    const tempUri = await platform.offlineCopy.tempFileUri(videoId);
    let lastProgressAt = -Infinity;
    const onProgress = (progress: number) => {
      const now = Date.now();
      if (now - lastProgressAt < PROGRESS_INTERVAL_MS && progress < 100) return;
      lastProgressAt = now;
      update(videoId, { progress });
    };
    const result = await platform.desktop.transfer(
      serverUrl,
      videoId,
      tempUri,
      onProgress,
      signal,
    );
    if (result === "missing") {
      await platform.offlineCopy.discardTemp(videoId).catch(() => {});
      update(videoId, { phase: "waiting-for-desktop", progress: null });
      return;
    }
    const details = await platform.desktop.getDetails(serverUrl, videoId);
    if (signal.aborted) throw new Error("Download cancelled");
    // The library row must exist before adopt records the Offline copy on it.
    platform.addToLibrary({
      id: videoId,
      title: download.title,
      channelTitle: download.channelTitle,
      duration: download.duration,
      thumbnailUrl: download.thumbnailUrl,
      description: details.description,
      transcripts: details.transcripts,
    });
    await platform.offlineCopy.adopt(videoId, tempUri);
    drop(videoId);
    // The Offline copy plays without it; screens fall back to the desktop URL.
    platform
      .storeThumbnail(serverUrl, videoId, download.thumbnailUrl)
      .catch((error) => {
        console.warn("[DownloadQueue] Failed to store thumbnail", error);
      });
  };

  const run = (
    download: Download,
    work: (serverUrl: string, signal: AbortSignal) => Promise<void>,
  ) => {
    const serverUrl = platform.getServerUrl();
    if (!serverUrl) return;
    const controller = new AbortController();
    running.set(download.videoId, controller);
    work(serverUrl, controller.signal)
      .catch(() => {})
      .finally(() => {
        running.delete(download.videoId);
        pump();
      });
  };

  function pump() {
    if (!canRun()) return;
    for (const download of downloads) {
      if (running.has(download.videoId)) continue;
      if (download.phase === "waiting-for-desktop") {
        run(download, (serverUrl, signal) =>
          waitForDesktop(download, serverUrl, signal),
        );
      }
    }
    const transferring = downloads.filter(
      (d) => d.phase === "transferring",
    ).length;
    const queued = downloads
      .filter(
        (d) =>
          d.phase === "queued" &&
          !running.has(d.videoId) &&
          (retries.get(d.videoId)?.at ?? 0) <= Date.now(),
      )
      .sort((a, b) => a.addedAt - b.addedAt)
      .slice(0, Math.max(0, MAX_TRANSFERS - transferring));
    for (const download of queued) {
      run(download, (serverUrl, signal) =>
        transfer(download, serverUrl, signal),
      );
    }
  }

  const onConditionsChange = () => {
    if (!canRun()) {
      for (const videoId of desktopWaits) running.get(videoId)?.abort();
    }
    pump();
  };

  const start = () => {
    const unsubscribe = platform.onConditionsChange(onConditionsChange);
    platform
      .loadQueue()
      .then((stored) => {
        const restored = stored
          .map(restore)
          .filter((download): download is Download => download !== null)
          .filter((download) => !find(download.videoId));
        downloads = [...restored, ...downloads];
        save();
        notify();
      })
      .catch((error) => {
        console.warn(
          "[DownloadQueue] Failed to restore saved Downloads",
          error,
        );
      })
      .finally(pump);
    return unsubscribe;
  };

  const request = (video: DownloadRequest) => {
    if (platform.offlineCopy.getUri(video.id)) return;
    const existing = find(video.id);
    if (existing?.phase === "failed") {
      retries.delete(video.id);
      update(video.id, { phase: "waiting-for-desktop", error: undefined });
      pump();
      return;
    }
    if (existing) return;
    downloads = [
      ...downloads,
      {
        videoId: video.id,
        title: video.title,
        channelTitle: video.channelTitle,
        duration: video.duration,
        thumbnailUrl: video.thumbnailUrl ?? undefined,
        phase: "waiting-for-desktop",
        progress: null,
        addedAt: Date.now(),
      },
    ];
    save();
    notify();
    pump();
  };

  const cancel = (videoId: string) => {
    const controller = running.get(videoId);
    controller?.abort();
    retries.delete(videoId);
    drop(videoId);
    // A running transfer discards its own partial file once it stops.
    if (!controller) platform.offlineCopy.discardTemp(videoId).catch(() => {});
    pump();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const waitUntilReady = (videoId: string, signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      const check = () => {
        const uri = platform.offlineCopy.getUri(videoId);
        const download = find(videoId);
        if (uri) finish(() => resolve(uri));
        else if (!download)
          finish(() => reject(new Error("Download cancelled")));
        else if (download.phase === "failed")
          finish(() => reject(new Error(download.error ?? "Download failed")));
      };
      const onAbort = () => finish(() => reject(new Error("Wait aborted")));
      const finish = (settle: () => void) => {
        listeners.delete(check);
        signal?.removeEventListener("abort", onAbort);
        settle();
      };
      if (signal?.aborted) return onAbort();
      listeners.add(check);
      signal?.addEventListener("abort", onAbort);
      check();
    });

  return {
    /** Begins running the Download queue whenever the desktop is connected and the app is in the foreground. */
    start,
    /** Asks for a Video's Offline copy. Does nothing if it exists or is already on its way; retries a failed Download. */
    request,
    /** The Video's unfinished Download, or null when there is none. */
    getDownload: find,
    /** Stops and forgets a Video's Download, discarding any partial file. */
    cancel,
    /**
     * Resolves with the Offline copy's URI once the Video's Download finishes;
     * rejects if it fails or is cancelled. Aborting stops the wait, not the Download.
     */
    waitUntilReady,
    /** Same answer as `getDownload`, re-rendering as the Download changes. */
    useDownload: (videoId: string) =>
      useSyncExternalStore(subscribe, () => find(videoId)),
    /** Every unfinished Download, oldest request first. */
    getQueue: () => downloads,
    /** Same answer as `getQueue`, re-rendering as Downloads change. */
    useQueue: () => useSyncExternalStore(subscribe, () => downloads),
  };
}
