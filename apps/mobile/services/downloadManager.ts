import { useDownloadStore, type DownloadItem } from "../stores/downloads";
import { useLibraryStore } from "../stores/library";
import { useConnectionStore } from "../stores/connection";
import { downloadVideo } from "./downloader";
import { offlineCopy } from "./offline-copy";

const log = (message: string, data?: unknown) => {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  if (data) {
    console.log(`[${timestamp}] [DownloadManager] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [DownloadManager] ${message}`);
  }
};

const MAX_CONCURRENT = 2;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 10000]; // Exponential backoff
const PROGRESS_THROTTLE_MS = 250;

class DownloadManager {
  private activeControllers = new Map<string, AbortController>();
  private retryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private lastProgressUpdate = new Map<string, number>();
  private isProcessing = false;

  processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const store = useDownloadStore.getState();
      const activeDownloads = store.getActiveDownloads();
      const queuedDownloads = store.getQueuedDownloads();

      // Start downloads up to the concurrent limit
      const slotsAvailable = MAX_CONCURRENT - activeDownloads.length;
      if (slotsAvailable <= 0 || queuedDownloads.length === 0) {
        return;
      }

      // Sort by addedAt to process oldest first
      const toStart = queuedDownloads
        .sort((a, b) => a.addedAt - b.addedAt)
        .slice(0, slotsAvailable);

      for (const item of toStart) {
        this.executeDownload(item);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeDownload(item: DownloadItem) {
    const serverUrl = useConnectionStore.getState().serverUrl;
    if (!serverUrl) {
      log(`No server URL, cannot download ${item.videoId}`);
      useDownloadStore.getState().markFailed(item.videoId, "Not connected to server");
      return;
    }

    // Create abort controller for this download
    const controller = new AbortController();
    this.activeControllers.set(item.videoId, controller);

    const downloadStore = useDownloadStore.getState();
    const libraryStore = useLibraryStore.getState();

    // Mark as downloading
    downloadStore.markDownloading(item.videoId);

    log(`Starting download: ${item.title}`);

    try {
      const { tempUri, meta, transcripts } = await downloadVideo(
        serverUrl,
        item.videoId,
        (progress) => {
          this.throttledProgressUpdate(item.videoId, progress);
        },
        controller.signal
      );

      // Add/update video in library with all transcripts; the row must
      // exist before adopt records the Offline copy on it.
      libraryStore.addVideo({
        id: item.videoId,
        title: item.title,
        channelTitle: item.channelTitle,
        duration: item.duration,
        thumbnailUrl: item.thumbnailUrl,
        description: meta.description ?? null,
        // Use transcripts from dedicated endpoint, fallback to meta
        transcripts:
          transcripts.length > 0
            ? transcripts
            : meta.transcripts ?? (meta.transcript ? [meta.transcript] : []),
        transcript: meta.transcript,
      });
      if (controller.signal.aborted) {
        await offlineCopy.discardTemp(item.videoId).catch(() => {});
        throw new Error("Download aborted");
      }
      await offlineCopy.adopt(item.videoId, tempUri);
      useLibraryStore.getState().loadVideos();

      // Download complete
      this.activeControllers.delete(item.videoId);
      this.lastProgressUpdate.delete(item.videoId);
      useDownloadStore.getState().markCompleted(item.videoId);

      log(
        `Download complete: ${item.title} (${transcripts.length} transcripts)`
      );

      // Process next in queue
      this.processQueue();
    } catch (error) {
      this.activeControllers.delete(item.videoId);
      this.lastProgressUpdate.delete(item.videoId);

      // Check for abort error (DOMException doesn't exist in React Native)
      const isAbortError =
        controller.signal.aborted ||
        (error instanceof Error &&
          (error.name === "AbortError" || error.message.includes("aborted")));
      if (isAbortError) {
        log(`Download cancelled: ${item.title}`);
        // Already removed from queue by cancel()
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log(`Download failed: ${item.title}`, errorMessage);

      // Check if we should retry
      const retryCount = useDownloadStore.getState().incrementRetry(item.videoId);
      if (retryCount <= MAX_RETRIES) {
        this.scheduleRetry(item.videoId, retryCount);
      } else {
        useDownloadStore.getState().markFailed(item.videoId, errorMessage);
        // Process next in queue
        this.processQueue();
      }
    }
  }

  private throttledProgressUpdate(
    videoId: string,
    progress: { progress: number; bytesDownloaded: number; totalBytes: number }
  ) {
    const now = Date.now();
    const lastUpdate = this.lastProgressUpdate.get(videoId) ?? 0;

    if (now - lastUpdate < PROGRESS_THROTTLE_MS && progress.progress < 100) {
      return;
    }

    this.lastProgressUpdate.set(videoId, now);
    useDownloadStore.getState().updateDownload(videoId, {
      progress: progress.progress,
      bytesDownloaded: progress.bytesDownloaded,
      totalBytes: progress.totalBytes,
    });
  }

  private scheduleRetry(videoId: string, retryCount: number) {
    const delay = RETRY_DELAYS[retryCount - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
    log(`Scheduling retry ${retryCount}/${MAX_RETRIES} for ${videoId} in ${delay}ms`);

    // Clear any existing retry timeout
    const existingTimeout = this.retryTimeouts.get(videoId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Mark as queued again (will be picked up by processQueue)
    useDownloadStore.getState().retryDownload(videoId);

    const timeout = setTimeout(() => {
      this.retryTimeouts.delete(videoId);
      this.processQueue();
    }, delay);

    this.retryTimeouts.set(videoId, timeout);
  }

  cancel(videoId: string) {
    log(`Cancelling download: ${videoId}`);

    // Abort the active download if running
    const controller = this.activeControllers.get(videoId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(videoId);
    }

    // Clear any pending retry
    const timeout = this.retryTimeouts.get(videoId);
    if (timeout) {
      clearTimeout(timeout);
      this.retryTimeouts.delete(videoId);
    }

    // Remove from queue
    useDownloadStore.getState().cancelDownload(videoId);

    // An active download discards its own partial file once it stops;
    // otherwise clean up anything a failed attempt left behind.
    if (!controller) {
      offlineCopy.discardTemp(videoId).catch(() => {
        // Ignore cleanup errors
      });
    }

    // Process next in queue
    this.processQueue();
  }

  cancelAll() {
    log("Cancelling all downloads");

    // Abort all active downloads
    for (const [videoId, controller] of this.activeControllers) {
      log(`Aborting download: ${videoId}`);
      controller.abort();
    }
    this.activeControllers.clear();

    // Clear all retry timeouts
    for (const timeout of this.retryTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.retryTimeouts.clear();

    // Clear the queue (keep completed)
    const store = useDownloadStore.getState();
    const toRemove = store.queue.filter((d) => d.status !== "completed");
    for (const item of toRemove) {
      store.cancelDownload(item.videoId);
    }
  }

  retry(videoId: string) {
    log(`Manual retry: ${videoId}`);
    useDownloadStore.getState().retryDownload(videoId);
    this.processQueue();
  }

  getActiveCount() {
    return this.activeControllers.size;
  }

  isDownloading(videoId: string) {
    return this.activeControllers.has(videoId);
  }
}

// Singleton instance
export const downloadManager = new DownloadManager();
