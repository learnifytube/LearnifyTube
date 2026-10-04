import type { ChildProcess } from "child_process";

/**
 * Status of a download in the queue
 */
type DownloadStatus =
  | "pending" // Initial state before queued
  | "queued" // Waiting in queue
  | "downloading" // Currently downloading
  | "paused" // Paused by user
  | "completed" // Successfully completed
  | "failed" // Failed with error
  | "cancelled"; // Cancelled by user

/**
 * Represents a download in the queue with all metadata
 */
export interface QueuedDownload {
  id: string;
  url: string;
  videoId: string | null;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  status: DownloadStatus;
  progress: number; // 0-100
  priority: number; // Higher = more important
  queuePosition: number | null;
  format: string | null;
  quality: string | null;
  filePath: string | null;
  fileSize: number | null;
  errorMessage: string | null;
  errorType: string | null;
  /** Stderr output history from yt-dlp for debugging failed downloads */
  errorDetails: string[] | null;
  isRetryable: boolean;
  retryCount: number;
  maxRetries: number;
  addedAt: number; // createdAt timestamp
  startedAt: number | null; // When download started
  pausedAt: number | null; // When paused
  completedAt: number | null; // When completed
  cancelledAt: number | null; // When cancelled
  updatedAt: number | null;
  // Download progress details
  downloadSpeed: string | null; // e.g., "1.2MiB/s"
  downloadedSize: string | null; // e.g., "45.3MiB"
  totalSize: string | null; // e.g., "100.0MiB"
  eta: string | null; // e.g., "00:15" or "01:23:45"
  // Fallback strategy state for automatic retries
  playerClientIndex: number; // Current position in player client chain (0 = default, 1 = android, etc.)
  fallbackAttempts: number; // Total fallback attempts made
  maxFallbackAttempts: number; // Maximum fallback attempts allowed (default: 10)
}

/**
 * Configuration for the download queue
 */
export interface QueueConfig {
  maxConcurrent: number; // Maximum simultaneous downloads (default: 3)
  maxRetries: number; // Maximum retry attempts (default: 3)
  retryDelay: number; // Delay between retries in ms (default: 5000)
  autoStart: boolean; // Auto-start queue when items added (default: true)
}

/**
 * Overall queue status with statistics
 */
export interface QueueStatus {
  queued: QueuedDownload[]; // Items waiting in queue
  downloading: QueuedDownload[]; // Currently downloading
  paused: QueuedDownload[]; // Paused downloads
  completed: QueuedDownload[]; // Recently completed
  failed: QueuedDownload[]; // Failed downloads
  stats: QueueStats;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  totalQueued: number;
  totalActive: number;
  totalPaused: number;
  totalCompleted: number;
  totalFailed: number;
  averageProgress: number; // Average progress of active downloads
}

/**
 * Internal worker state
 */
export interface WorkerState {
  downloadId: string;
  process: ChildProcess | null;
  startTime: number;
  lastProgressUpdate: number;
  lastKnownFilePath?: string;
  outputDir?: string;
  videoId?: string | null;
  /** Last error message captured from stderr (HTTP errors, format errors, etc.) */
  lastStderrError?: string;
  /** Collected stderr output for debugging */
  stderrBuffer?: string[];
  /** Set when the user paused or cancelled, so the process exit is not treated as a failure */
  stoppedByUser?: boolean;
}
