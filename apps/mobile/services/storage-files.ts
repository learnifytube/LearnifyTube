import * as FileSystemLegacy from "expo-file-system/legacy";

// File helpers for a Storage location, shared by the Offline copy module and
// Held Audiobooks. A picked folder is a `content://` (SAF) tree, which only
// expo-file-system/legacy can write, so these use it for every location.

const saf = FileSystemLegacy.StorageAccessFramework;

export const isContentUri = (uri: string) => uri.startsWith("content://");

export const joinUri = (base: string, name: string) =>
  `${base.replace(/\/+$/, "")}/${name}`;

/** The app's documents directory, without a trailing slash. */
export const documentsDir = () => {
  const documentDirectory = FileSystemLegacy.documentDirectory;
  if (!documentDirectory)
    throw new Error("Document directory is not available");
  return documentDirectory.replace(/\/+$/, "");
};

/** The `name` folder inside `parentUri` (a SAF tree or a file:// path), made if missing. */
export const ensureDir = async (parentUri: string, name: string) => {
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
    await FileSystemLegacy.makeDirectoryAsync(dirUri, { intermediates: true });
  }
  return dirUri;
};

/** Whether a file (not a folder) is there and reachable now. */
export const fileExists = async (uri: string) => {
  try {
    const info = await FileSystemLegacy.getInfoAsync(uri);
    return info.exists && !info.isDirectory;
  } catch {
    return false;
  }
};

export const removeFile = (uri: string) =>
  FileSystemLegacy.deleteAsync(uri, { idempotent: true });
