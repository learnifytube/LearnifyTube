import * as FileSystemLegacy from "expo-file-system/legacy";
import { api } from "./api";
import { offlineCopy } from "./offline-copy";

// Custom AbortError for React Native (DOMException doesn't exist)
class AbortError extends Error {
  name = "AbortError";
  constructor(message = "Download cancelled") {
    super(message);
  }
}

const log = (message: string, data?: unknown) => {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  if (data) {
    console.log(`[${timestamp}] [Downloader] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [Downloader] ${message}`);
  }
};

export interface DownloadProgress {
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
}

/**
 * Download a Video to a temporary file. The caller hands the file to
 * `offlineCopy.adopt`; on failure or cancel the partial file is discarded.
 */
export async function downloadVideo(
  serverUrl: string,
  videoId: string,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal
) {
  const tempUri = await offlineCopy.tempFileUri(videoId);
  const videoUrl = api.getVideoFileUrl(serverUrl, videoId);

  log(`Starting download: ${videoUrl}`);

  // Signal that download is starting
  onProgress({ progress: 0, bytesDownloaded: 0, totalBytes: 0 });

  // Check if already aborted
  if (signal?.aborted) {
    throw new AbortError();
  }

  try {
    // Use legacy FileSystem API for downloading with progress
    const downloadResumable = FileSystemLegacy.createDownloadResumable(
      videoUrl,
      tempUri,
      {},
      (downloadProgress) => {
        const progress = Math.round(
          (downloadProgress.totalBytesWritten /
            downloadProgress.totalBytesExpectedToWrite) *
            100
        );
        onProgress({
          progress,
          bytesDownloaded: downloadProgress.totalBytesWritten,
          totalBytes: downloadProgress.totalBytesExpectedToWrite,
        });
      }
    );

    // Set up abort handler
    let abortHandler: (() => void) | undefined;
    if (signal) {
      abortHandler = () => {
        log(`Download aborted: ${videoId}`);
        downloadResumable.pauseAsync().catch(() => {
          // Ignore pause errors during abort
        });
      };
      signal.addEventListener("abort", abortHandler);
    }

    try {
      const result = await downloadResumable.downloadAsync();

      // Check if aborted during download
      if (signal?.aborted) {
        throw new AbortError();
      }

      if (!result || result.status !== 200) {
        // 202 means desktop is re-downloading the file
        if (result?.status === 202) {
          throw new Error(
            "Video file missing on desktop - download queued. Please try again later."
          );
        }
        throw new Error(
          `Download failed: ${result?.status || "unknown error"}`
        );
      }

      log(`Download complete: ${videoId}`);
      onProgress({
        progress: 100,
        bytesDownloaded: result.headers?.["content-length"]
          ? parseInt(result.headers["content-length"])
          : 0,
        totalBytes: result.headers?.["content-length"]
          ? parseInt(result.headers["content-length"])
          : 0,
      });

      // Fetch video metadata and all transcripts in parallel
      const [meta, transcripts] = await Promise.all([
        api.getVideoMeta(serverUrl, videoId),
        api.getVideoTranscripts(serverUrl, videoId),
      ]);
      log(
        `Metadata fetched for: ${videoId}, transcripts: ${transcripts.length} languages`
      );
      // Debug: log transcript details
      for (const t of transcripts) {
        log(`  Transcript: lang=${t.language}, segments=${t.segments?.length ?? 0}`);
      }
      if (meta.transcript) {
        log(
          `  Meta transcript: lang=${meta.transcript.language}, segments=${meta.transcript.segments?.length ?? 0}`
        );
      }

      if (signal?.aborted) {
        throw new AbortError();
      }

      return { tempUri, meta, transcripts };
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  } catch (error) {
    await offlineCopy.discardTemp(videoId).catch(() => {
      // Ignore cleanup errors
    });
    log(`Download error:`, error);
    throw error;
  }
}
