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

// Where a Track's fetch lands until it is whole: the app's own storage, which
// the legacy resumable download can append to (a picked folder can't).
const partialUri = async (trackId: string) =>
  joinUri(
    await ensureDir(documentsDir(), AUDIOBOOKS_DIR),
    `${trackId}.download`,
  );

// Fetches url into fileUri, carrying on from the bytes a cut-short fetch left
// there (a Range request for the rest). Aborting, or the desktop dropping,
// keeps those bytes for the next fetch; an error answer deletes them, and a
// desktop that won't resume (200 or 416) gets the whole file fetched again.
const downloadInto = async (
  url: string,
  fileUri: string,
  signal: AbortSignal,
): Promise<void> => {
  const partial = await FileSystemLegacy.getInfoAsync(fileUri);
  // On Android the resume data is the byte count already in the file.
  const resumeFrom =
    partial.exists && partial.size > 0 ? String(partial.size) : undefined;
  const transfer = FileSystemLegacy.createDownloadResumable(
    url,
    fileUri,
    {},
    undefined,
    resumeFrom,
  );
  const pause = () => {
    transfer.pauseAsync().catch(() => {});
  };
  signal.addEventListener("abort", pause);
  try {
    const result = await transfer.downloadAsync();
    if (signal.aborted || !result) throw new Error("Fetch cancelled");
    if (result.status === (resumeFrom ? 206 : 200)) return;
    // The answer's body went into the file: what is there is no good now.
    await remove(fileUri);
    if (resumeFrom && (result.status === 200 || result.status === 416)) {
      return downloadInto(url, fileUri, signal);
    }
    throw new Error(`Track fetch failed: ${result.status}`);
  } finally {
    signal.removeEventListener("abort", pause);
  }
};

const platform: HeldAudiobooksPlatform = {
  getServerUrl: () => useConnectionStore.getState().serverUrl,
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
    const tempUri = await partialUri(trackId);
    await downloadInto(
      api.getAudiobookTrackFileUrl(serverUrl, trackId),
      tempUri,
      signal,
    );
    try {
      return await place(bookId, trackId, tempUri);
    } catch (error) {
      await remove(tempUri).catch(() => {});
      throw error;
    }
  },
  exists: fileExists,
  discardPartial: async (trackId) => remove(await partialUri(trackId)),
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
