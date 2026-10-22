import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api";
import { desktopFetch } from "../desktop-fetch";
import { offlineCopy } from "../offline-copy";
import { videoThumbnails } from "../video-thumbnails";
import { useConnectionStore } from "../../stores/connection";
import { useLibraryStore } from "../../stores/library";
import {
  createDownloadQueue,
  type DownloadQueuePlatform,
  type StoredDownload,
} from "./createDownloadQueue";
import { transferFile } from "./transferFile";

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
  desktopFetch,
  desktop: {
    transfer: (serverUrl, videoId, destUri, onProgress, signal) =>
      transferFile(
        api.getVideoFileUrl(serverUrl, videoId),
        destUri,
        onProgress,
        signal,
      ),
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
  storeThumbnail: videoThumbnails.store,
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
