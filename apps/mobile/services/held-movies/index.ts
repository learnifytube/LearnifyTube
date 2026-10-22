import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api";
import { movieOfflineCopy } from "../offline-copy";
import {
  createDownloadQueue,
  type StoredDownload,
} from "../download-queue/createDownloadQueue";
import { transferFile } from "../download-queue/transferFile";
import { useConnectionStore } from "../../stores/connection";
import {
  deleteHeldMovie,
  getHeldMovies,
  heldMovieKind,
  saveHeldMovie,
} from "../../db/repositories/heldMovies";
import { createHeldMovies } from "./createHeldMovies";

const QUEUE_KEY = "learnify-movie-downloads";

/**
 * The Movies' and Episodes' own Download queue: a second instance beside the
 * Videos' (ADR-0005), so they stay out of the Video library. Their files are
 * on the desktop already, so there is no Desktop fetch to wait for.
 */
export const movieDownloadQueue = createDownloadQueue({
  offlineCopy: movieOfflineCopy,
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
  desktopFetch: null,
  desktop: {
    transfer: (serverUrl, id, destUri, onProgress, signal) =>
      transferFile(
        heldMovieKind(id) === "episode"
          ? api.getEpisodeFileUrl(serverUrl, id)
          : api.getMovieFileUrl(serverUrl, id),
        destUri,
        onProgress,
        signal,
      ),
    getDetails: async () => ({ description: null, transcripts: [] }),
  },
  // What the Device shows of a held title is kept on its hold.
  addToLibrary: () => {},
  storeThumbnail: async () => {},
  loadQueue: async () => {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as StoredDownload[]) : [];
  },
  saveQueue: (downloads) => {
    AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(downloads)).catch(
      (error) => {
        console.warn("[MovieDownloads] Failed to save Downloads", error);
      },
    );
  },
});

export const heldMovies = createHeldMovies({
  now: Date.now,
  loadHolds: getHeldMovies,
  saveHold: saveHeldMovie,
  deleteHold: deleteHeldMovie,
  downloads: {
    request: (title) =>
      movieDownloadQueue.request({
        id: title.id,
        title: title.title,
        channelTitle: "",
        duration: title.durationSeconds ?? 0,
        thumbnailUrl: null,
      }),
    cancel: (id) => {
      if (movieDownloadQueue.getDownload(id)) movieDownloadQueue.cancel(id);
    },
  },
  offlineCopy: movieOfflineCopy,
});

export type { HeldTitle, MovieHold, MovieHoldReason } from "./types";
