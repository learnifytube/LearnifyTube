import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { api } from "../api";
import { getVideoStorageLocation } from "../storage-location";
import {
  documentsDir,
  ensureDir,
  fileExists,
  isContentUri,
  joinUri,
  removeFile as remove,
} from "../storage-files";
import { useConnectionStore } from "../../stores/connection";
import {
  createHeldAudiobooks,
  type HeldAudiobooksPlatform,
  type HeldBookRecord,
} from "./createHeldAudiobooks";

const STORAGE_KEY = "learnify-held-audiobooks";
const AUDIOBOOKS_DIR = "audiobooks";

const saf = FileSystemLegacy.StorageAccessFramework;
const parentUri = (uri: string) => {
  const trimmed = uri.replace(/\/+$/, "");
  return trimmed.slice(0, trimmed.lastIndexOf("/"));
};

// Books go in an `audiobooks` folder of the Storage location, one folder per
// book: beside the `videos` folder in a picked or USB folder, never inside it,
// so the Offline copy scans don't see them.
const bookDir = async (bookId: string) => {
  const location = await getVideoStorageLocation();
  if (location.kind === "saf" && location.directoryUri) {
    return ensureDir(
      await ensureDir(location.directoryUri, AUDIOBOOKS_DIR),
      bookId,
    );
  }
  if (location.kind === "file" && location.directoryUri) {
    return ensureDir(
      await ensureDir(parentUri(location.directoryUri), AUDIOBOOKS_DIR),
      bookId,
    );
  }
  return ensureDir(await ensureDir(documentsDir(), AUDIOBOOKS_DIR), bookId);
};

// Moves a finished temp file into the book's folder; returns its URI.
const place = async (bookId: string, trackId: string, tempUri: string) => {
  const dir = await bookDir(bookId);
  if (isContentUri(dir)) {
    const existing = (await saf.readDirectoryAsync(dir)).find((uri) =>
      decodeURIComponent(uri).endsWith(`/${trackId}`),
    );
    if (existing) await remove(existing);
    const created = await saf.createFileAsync(
      dir,
      trackId,
      "application/octet-stream",
    );
    try {
      await FileSystemLegacy.copyAsync({ from: tempUri, to: created });
    } catch (error) {
      await remove(created).catch(() => {});
      throw error;
    }
    await remove(tempUri);
    return created;
  }
  const dest = joinUri(dir, trackId);
  await remove(dest);
  await FileSystemLegacy.moveAsync({ from: tempUri, to: dest });
  return dest;
};

const platform: HeldAudiobooksPlatform = {
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
  fetchTrack: async (serverUrl, bookId, trackId, signal) => {
    const tempDir = await ensureDir(documentsDir(), AUDIOBOOKS_DIR);
    const tempUri = joinUri(tempDir, `${trackId}.download`);
    const transfer = FileSystemLegacy.createDownloadResumable(
      api.getAudiobookTrackFileUrl(serverUrl, trackId),
      tempUri,
    );
    const abort = () => {
      transfer.pauseAsync().catch(() => {});
    };
    signal.addEventListener("abort", abort);
    try {
      const result = await transfer.downloadAsync();
      if (signal.aborted) throw new Error("Fetch cancelled");
      if (!result || result.status !== 200) {
        throw new Error(`Track fetch failed: ${result?.status ?? "unknown"}`);
      }
      return await place(bookId, trackId, tempUri);
    } catch (error) {
      await remove(tempUri).catch(() => {});
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  },
  exists: fileExists,
  remove,
  loadRecords: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: { books?: HeldBookRecord[] } = JSON.parse(raw);
    return parsed.books ?? [];
  },
  saveRecords: (books) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ books })).catch(
      (error) => {
        console.warn("[HeldAudiobooks] Failed to save held books", error);
      },
    );
  },
};

export const heldAudiobooks = createHeldAudiobooks(platform);
export type {
  Hold,
  HoldReason,
  HeldAudiobooks,
  HeldBookRecord,
} from "./createHeldAudiobooks";
