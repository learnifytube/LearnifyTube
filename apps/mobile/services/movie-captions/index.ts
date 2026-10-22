import * as FileSystemLegacy from "expo-file-system/legacy";
import { api } from "../api";
import { documentsDir, ensureDir, joinUri, removeFile } from "../storage-files";
import { createCaptionCues } from "./createCaptionCues";
import { createKeptCaptions } from "./createKeptCaptions";

export { nextCaption } from "./captionChoice";

const CAPTIONS_DIR = "movie-captions";
const SUFFIX = ".vtt";

// In the app's own storage, a folder per held title: a few KB each, so they
// stay put when the Storage location changes or a USB drive is unplugged.
const titleDir = (titleId: string): string =>
  joinUri(joinUri(documentsDir(), CAPTIONS_DIR), titleId);
const captionUri = (titleId: string, captionId: string): string =>
  joinUri(titleDir(titleId), `${captionId}${SUFFIX}`);

/** The Captions of the Movies and Episodes held on this Device. */
export const keptCaptions = createKeptCaptions({
  fetchCaption: (serverUrl, captionId) => api.getCaption(serverUrl, captionId),
  list: async (titleId) => {
    const dir = titleDir(titleId);
    const info = await FileSystemLegacy.getInfoAsync(dir);
    if (!info.exists) return [];
    const names = await FileSystemLegacy.readDirectoryAsync(dir);
    return names
      .filter((name) => name.endsWith(SUFFIX))
      .map((name) => name.slice(0, -SUFFIX.length));
  },
  write: async (titleId, captionId, text) => {
    await ensureDir(joinUri(documentsDir(), CAPTIONS_DIR), titleId);
    await FileSystemLegacy.writeAsStringAsync(
      captionUri(titleId, captionId),
      text,
    );
  },
  read: async (titleId, captionId) => {
    const uri = captionUri(titleId, captionId);
    const info = await FileSystemLegacy.getInfoAsync(uri);
    return info.exists ? FileSystemLegacy.readAsStringAsync(uri) : null;
  },
  remove: (titleId, captionId) => removeFile(captionUri(titleId, captionId)),
  removeAll: (titleId) => removeFile(titleDir(titleId)),
});

export const captionCues = createCaptionCues({
  readKept: keptCaptions.read,
  getCaption: (serverUrl, captionId) => api.getCaption(serverUrl, captionId),
});
