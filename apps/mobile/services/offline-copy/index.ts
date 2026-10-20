import { File } from "expo-file-system";
import * as FileSystemLegacy from "expo-file-system/legacy";
import {
  getOfflineCopyRecords,
  updateVideoLocalPath,
} from "../../db/repositories/videos";
import { getVideoStorageLocation } from "../storage-location";
import {
  documentsDir,
  ensureDir,
  fileExists,
  isContentUri,
  joinUri,
  removeFile,
} from "../storage-files";
import {
  createOfflineCopy,
  type OfflineCopyPlatform,
} from "./createOfflineCopy";

const saf = FileSystemLegacy.StorageAccessFramework;

const platform: OfflineCopyPlatform = {
  documentsDir,
  getStorageLocation: getVideoStorageLocation,
  loadRecords: getOfflineCopyRecords,
  writeRecord: updateVideoLocalPath,
  exists: fileExists,
  list: async (dirUri) => {
    if (isContentUri(dirUri)) return saf.readDirectoryAsync(dirUri);
    const names = await FileSystemLegacy.readDirectoryAsync(dirUri);
    return names.map((name) => joinUri(dirUri, name));
  },
  ensureDir,
  createFile: async (dirUri, videoId) =>
    isContentUri(dirUri)
      ? saf.createFileAsync(dirUri, videoId, "video/mp4")
      : joinUri(dirUri, `${videoId}.mp4`),
  copy: (from, to) => FileSystemLegacy.copyAsync({ from, to }),
  move: (from, to) => FileSystemLegacy.moveAsync({ from, to }),
  remove: removeFile,
  readBytes: async (uri) => {
    // file:// (internal + USB): SDK 54 File API.
    if (!isContentUri(uri)) return new File(uri).bytes();
    // content:// (picked folder): copy to a temp file so we avoid Base64
    // expansion, then read with File.
    const tempUri = `${platform.documentsDir()}/videos/.read-${Date.now()}.mp4`;
    await FileSystemLegacy.copyAsync({ from: uri, to: tempUri });
    try {
      return await new File(tempUri).bytes();
    } finally {
      await FileSystemLegacy.deleteAsync(tempUri, { idempotent: true });
    }
  },
};

export const offlineCopy = createOfflineCopy(platform);
export type { OfflineCopy } from "./createOfflineCopy";
