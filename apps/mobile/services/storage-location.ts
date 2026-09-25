import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as FileSystemLegacy from "expo-file-system/legacy";

const STORAGE_KEY = "learnify.videoStorage.v1";
const USB_LABEL_HINTS = ["usb", "drive", "external", "storage"];
const ANDROID_STORAGE_ROOT = "file:///storage";
const APP_USB_FOLDER = "LearnifyTube/videos";

export type VideoStorageLocation = {
  kind: "internal" | "saf" | "file";
  directoryUri: string | null;
  label: string;
};

export const INTERNAL_VIDEO_STORAGE: VideoStorageLocation = {
  kind: "internal",
  directoryUri: null,
  label: "Internal app storage",
};

function getStorageAccessFramework() {
  return FileSystemLegacy.StorageAccessFramework;
}

function looksLikeUsbUri(uri: string): boolean {
  const lower = decodeURIComponent(uri).toLowerCase();
  return USB_LABEL_HINTS.some((hint) => lower.includes(hint));
}

function labelForDirectoryUri(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const tail = decoded.split(/[/:]+/).filter(Boolean).pop();
  const suffix = tail ? `: ${tail}` : "";
  return `${looksLikeUsbUri(uri) ? "USB/external" : "Custom"} folder${suffix}`;
}

function isExternalStorageName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower !== "emulated" && lower !== "self" && lower !== "sdcard";
}

function joinUri(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

const changeListeners = new Set<() => void>();

export function subscribeToVideoStorageLocation(listener: () => void) {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notifyLocationChanged() {
  for (const listener of changeListeners) listener();
}

async function saveLocation(location: VideoStorageLocation): Promise<VideoStorageLocation> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(location));
  notifyLocationChanged();
  return location;
}

export async function getVideoStorageLocation(): Promise<VideoStorageLocation> {
  if (Platform.OS !== "android") return INTERNAL_VIDEO_STORAGE;

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return INTERNAL_VIDEO_STORAGE;

    const parsed = JSON.parse(raw) as Partial<VideoStorageLocation>;
    if (
      (parsed.kind === "saf" || parsed.kind === "file") &&
      typeof parsed.directoryUri === "string"
    ) {
      return {
        kind: parsed.kind,
        directoryUri: parsed.directoryUri,
        label: parsed.label || labelForDirectoryUri(parsed.directoryUri),
      };
    }
  } catch {
    // Fall through to internal storage if the saved setting is invalid.
  }

  return INTERNAL_VIDEO_STORAGE;
}

export async function setInternalVideoStorage(): Promise<VideoStorageLocation> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  notifyLocationChanged();
  return INTERNAL_VIDEO_STORAGE;
}

export async function selectVideoStorageDirectory(): Promise<VideoStorageLocation | null> {
  if (Platform.OS !== "android") {
    throw new Error("Custom video storage is only available on Android.");
  }

  const saf = getStorageAccessFramework();
  if (!saf?.requestDirectoryPermissionsAsync) {
    return selectDetectedUsbStorageDirectory();
  }

  try {
    const result = await saf.requestDirectoryPermissionsAsync();
    if (!result.granted || !result.directoryUri) return null;

    return saveLocation({
      kind: "saf",
      directoryUri: result.directoryUri,
      label: labelForDirectoryUri(result.directoryUri),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("No Activity") ||
      message.includes("ActivityNotFound") ||
      message.includes("No app") ||
      message.includes("can do this")
    ) {
      return selectDetectedUsbStorageDirectory();
    }
    throw error;
  }
}

export async function selectDetectedUsbStorageDirectory(): Promise<VideoStorageLocation> {
  if (Platform.OS !== "android") {
    throw new Error("USB storage is only available on Android.");
  }

  let entries: string[];
  try {
    entries = await FileSystemLegacy.readDirectoryAsync(ANDROID_STORAGE_ROOT);
  } catch {
    throw new Error(
      "This Android TV has no folder picker and external storage is not readable yet. Insert a USB drive, then allow file access for LearnifyTube in Android Settings."
    );
  }

  const externalNames = entries.filter(isExternalStorageName);
  for (const name of externalNames) {
    const videosDir = joinUri(joinUri(ANDROID_STORAGE_ROOT, name), APP_USB_FOLDER);
    try {
      await FileSystemLegacy.makeDirectoryAsync(videosDir, { intermediates: true });
      const testFile = joinUri(videosDir, ".learnify-write-test");
      await FileSystemLegacy.writeAsStringAsync(testFile, "ok");
      await FileSystemLegacy.deleteAsync(testFile, { idempotent: true });
      return saveLocation({
        kind: "file",
        directoryUri: videosDir,
        label: `USB drive: ${name}`,
      });
    } catch {
      // Try the next mounted storage volume.
    }
  }

  throw new Error(
    "No writable USB drive found. Make sure the USB drive is connected and Android grants file access to LearnifyTube."
  );
}
