import * as FileSystemLegacy from "expo-file-system/legacy";
import {
  getOfflineCopyRecords,
  updateVideoLocalPath,
} from "../../db/repositories/videos";
import { getVideoStorageLocation } from "../storage-location";
import {
  createOfflineCopy,
  type OfflineCopyPlatform,
} from "./createOfflineCopy";

const saf = FileSystemLegacy.StorageAccessFramework;
const isContentUri = (uri: string) => uri.startsWith("content://");
const joinUri = (base: string, name: string) =>
  `${base.replace(/\/+$/, "")}/${name}`;

const platform: OfflineCopyPlatform = {
  documentsDir: () => {
    const documentDirectory = FileSystemLegacy.documentDirectory;
    if (!documentDirectory)
      throw new Error("Document directory is not available");
    return documentDirectory.replace(/\/+$/, "");
  },
  getStorageLocation: getVideoStorageLocation,
  loadRecords: getOfflineCopyRecords,
  writeRecord: updateVideoLocalPath,
  exists: async (uri) => {
    try {
      const info = await FileSystemLegacy.getInfoAsync(uri);
      return info.exists && !info.isDirectory;
    } catch {
      return false;
    }
  },
  list: async (dirUri) => {
    if (isContentUri(dirUri)) return saf.readDirectoryAsync(dirUri);
    const names = await FileSystemLegacy.readDirectoryAsync(dirUri);
    return names.map((name) => joinUri(dirUri, name));
  },
  ensureDir: async (parentUri, name) => {
    if (isContentUri(parentUri)) {
      const children = await saf.readDirectoryAsync(parentUri);
      const existing = children.find((uri) =>
        decodeURIComponent(uri).endsWith(`/${name}`),
      );
      return existing ?? saf.makeDirectoryAsync(parentUri, name);
    }
    const dirUri = joinUri(parentUri, name);
    const info = await FileSystemLegacy.getInfoAsync(dirUri);
    if (!info.exists) {
      await FileSystemLegacy.makeDirectoryAsync(dirUri, {
        intermediates: true,
      });
    }
    return dirUri;
  },
  createFile: async (dirUri, videoId) =>
    isContentUri(dirUri)
      ? saf.createFileAsync(dirUri, videoId, "video/mp4")
      : joinUri(dirUri, `${videoId}.mp4`),
  copy: (from, to) => FileSystemLegacy.copyAsync({ from, to }),
  move: (from, to) => FileSystemLegacy.moveAsync({ from, to }),
  remove: (uri) => FileSystemLegacy.deleteAsync(uri, { idempotent: true }),
};

export const offlineCopy = createOfflineCopy(platform);
