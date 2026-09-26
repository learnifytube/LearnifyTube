import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { api } from "../api";
import { offlineCopy } from "../offline-copy";
import { useConnectionStore } from "../../stores/connection";
import { useLibraryStore } from "../../stores/library";
import {
  createDownloadQueue,
  type DownloadQueuePlatform,
  type StoredDownload,
} from "./createDownloadQueue";

// Written in the shape the old persisted Zustand store used, so Downloads
// queued before this module existed are picked up.
const STORAGE_KEY = "learnify-downloads";

const platform: DownloadQueuePlatform = {
  offlineCopy,
  getServerUrl: () => useConnectionStore.getState().serverUrl,
  isForeground: () => AppState.currentState === "active",
  onConditionsChange: (listener) => {
    const appStateSubscription = AppState.addEventListener("change", listener);
    const unsubscribeConnection = useConnectionStore.subscribe(
      (state, previous) => {
        if (state.serverUrl !== previous.serverUrl) listener();
      },
    );
    return () => {
      appStateSubscription.remove();
      unsubscribeConnection();
    };
  },
  desktop: {
    requestVideo: async (serverUrl, videoId) => {
      const response = await api.requestServerDownload(serverUrl, { videoId });
      if (!response.success && !response.status) {
        throw new Error(response.message || "The desktop refused the Download");
      }
      return response.status === "completed" ? "ready" : "fetching";
    },
    getFetchStatus: async (serverUrl, videoId) => {
      const status = await api.getServerDownloadStatus(serverUrl, videoId);
      if (status.status === "completed") return { state: "ready" };
      if (status.status === "failed")
        return { state: "failed", error: status.error };
      return { state: "fetching", progress: status.progress };
    },
    transfer: async (serverUrl, videoId, destUri, onProgress, signal) => {
      const transfer = FileSystemLegacy.createDownloadResumable(
        api.getVideoFileUrl(serverUrl, videoId),
        destUri,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (totalBytesExpectedToWrite > 0) {
            onProgress(
              Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100),
            );
          }
        },
      );
      const abort = () => {
        transfer.pauseAsync().catch(() => {});
      };
      signal.addEventListener("abort", abort);
      try {
        const result = await transfer.downloadAsync();
        if (signal.aborted) throw new Error("Download cancelled");
        // 202: the desktop lost the file and is fetching it again.
        if (result?.status === 202) return "missing";
        if (!result || result.status !== 200) {
          throw new Error(
            `Download failed: ${result?.status ?? "unknown error"}`,
          );
        }
        return "done";
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
    getDetails: async (serverUrl, videoId) => {
      const [meta, transcripts] = await Promise.all([
        api.getVideoMeta(serverUrl, videoId),
        api.getVideoTranscripts(serverUrl, videoId),
      ]);
      return {
        description: meta.description ?? null,
        transcripts:
          transcripts.length > 0
            ? transcripts
            : (meta.transcripts ?? (meta.transcript ? [meta.transcript] : [])),
      };
    },
  },
  addToLibrary: (video) => useLibraryStore.getState().addVideo(video),
  loadQueue: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: { state?: { queue?: StoredDownload[] } } = JSON.parse(raw);
    return parsed.state?.queue ?? [];
  },
  saveQueue: (downloads) => {
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { queue: downloads }, version: 0 }),
    ).catch((error) => {
      console.warn("[DownloadQueue] Failed to save Downloads", error);
    });
  },
};

export const downloadQueue = createDownloadQueue(platform);
export type {
  Download,
  DownloadPhase,
  DownloadRequest,
} from "./createDownloadQueue";
