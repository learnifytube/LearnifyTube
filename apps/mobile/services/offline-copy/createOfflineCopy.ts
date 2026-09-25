import { useSyncExternalStore } from "react";

export type StorageLocation = {
  kind: "internal" | "saf" | "file";
  directoryUri: string | null;
};

/**
 * Everything the Offline copy module needs from the device. URIs are either
 * `file://` (internal storage, USB folders) or `content://` (picked folders).
 */
export type OfflineCopyPlatform = {
  /** Current app documents directory, without a trailing slash. */
  documentsDir: () => string;
  getStorageLocation: () => Promise<StorageLocation>;
  loadRecords: () => Array<{ videoId: string; uri: string }>;
  writeRecord: (videoId: string, uri: string) => void;
  exists: (uri: string) => Promise<boolean>;
  /** URIs of a directory's direct children. Throws if unreachable. */
  list: (dirUri: string) => Promise<string[]>;
  /** Finds or creates a child directory and returns its URI. */
  ensureDir: (parentUri: string, name: string) => Promise<string>;
  /** Returns the URI a new `<videoId>.mp4` in the directory should be written to. */
  createFile: (dirUri: string, videoId: string) => Promise<string>;
  copy: (from: string, to: string) => Promise<void>;
  move: (from: string, to: string) => Promise<void>;
  remove: (uri: string) => Promise<void>;
};

const VIDEOS_DIR = "videos";

function videoIdOf(uri: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    decoded = uri;
  }
  const name = decoded.slice(decoded.lastIndexOf("/") + 1);
  // Picked folders name a second file with the same name "<id> (1).mp4".
  return /^(.+?)(?: \(\d+\))?\.mp4$/.exec(name)?.[1] ?? null;
}

// Picked folders are content:// and USB folders live under /storage; anything
// else was written to the app container, whose path changes across installs.
function isInternalUri(uri: string) {
  return !uri.startsWith("content://") && !uri.startsWith("file:///storage/");
}

function splitUri(uri: string) {
  const trimmed = uri.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return { parent: trimmed.slice(0, index), name: trimmed.slice(index + 1) };
}

export function createOfflineCopy(platform: OfflineCopyPlatform) {
  // Saved record per Video, and the current answer (null when unreachable).
  const savedUris = new Map<string, string>();
  const currentUris = new Map<string, string | null>();
  const adoptGenerations = new Map<string, number>();
  const listeners = new Set<() => void>();
  let loaded = false;
  let scanQueue = Promise.resolve();

  const internalDir = () => `${platform.documentsDir()}/${VIDEOS_DIR}`;
  const internalUri = (videoId: string) => `${internalDir()}/${videoId}.mp4`;
  const tempUriFor = (videoId: string) =>
    `${internalDir()}/${videoId}.mp4.download`;

  // Internal copies are resolved by Video ID, never from the saved path.
  const resolveRecord = (videoId: string, uri: string) =>
    isInternalUri(uri) ? internalUri(videoId) : uri;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const ensureLoaded = () => {
    if (loaded) return;
    for (const { videoId, uri } of platform.loadRecords()) {
      savedUris.set(videoId, uri);
      currentUris.set(videoId, resolveRecord(videoId, uri));
    }
    loaded = true;
  };

  const record = (videoId: string, uri: string) => {
    if (savedUris.get(videoId) === uri) return;
    savedUris.set(videoId, uri);
    platform.writeRecord(videoId, uri);
  };

  const getUri = (videoId: string) => {
    try {
      ensureLoaded();
    } catch (error) {
      console.warn("[OfflineCopy] Failed to load saved records", error);
    }
    return currentUris.get(videoId) ?? null;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const locationVideosDir = async (location: StorageLocation) => {
    if (location.kind === "saf" && location.directoryUri) {
      return platform.ensureDir(location.directoryUri, VIDEOS_DIR);
    }
    if (location.kind === "file" && location.directoryUri) {
      const { parent, name } = splitUri(location.directoryUri);
      return platform.ensureDir(parent, name);
    }
    return platform.ensureDir(platform.documentsDir(), VIDEOS_DIR);
  };

  const listCopies = async (dirUri: string) => {
    const found = new Map<string, string>();
    for (const uri of await platform.list(dirUri)) {
      const videoId = videoIdOf(uri);
      if (videoId) found.set(videoId, uri);
    }
    return found;
  };

  const runScan = async () => {
    ensureLoaded();
    const generationsAtStart = new Map(adoptGenerations);
    const location = await platform.getStorageLocation();

    const internal = await listCopies(internalDir()).catch(
      () => new Map<string, string>(),
    );
    const inLocation =
      location.kind === "internal"
        ? internal
        : await locationVideosDir(location)
            .then(listCopies)
            .catch(() => new Map<string, string>());
    const listed = new Set([...internal.values(), ...inLocation.values()]);

    const isReachable = async (uri: string) =>
      listed.has(uri) || platform.exists(uri);

    const videoIds = new Set([
      ...savedUris.keys(),
      ...internal.keys(),
      ...inLocation.keys(),
    ]);
    const next = new Map<string, string | null>();
    for (const videoId of videoIds) {
      const saved = savedUris.get(videoId);
      const savedUri = saved ? resolveRecord(videoId, saved) : null;
      if (savedUri && (await isReachable(savedUri))) {
        next.set(videoId, savedUri);
        continue;
      }
      next.set(
        videoId,
        inLocation.get(videoId) ?? internal.get(videoId) ?? null,
      );
    }

    let changed = false;
    for (const [videoId, uri] of next) {
      // An adopt that finished during this scan has the newer answer.
      if (adoptGenerations.get(videoId) !== generationsAtStart.get(videoId))
        continue;
      if (uri) record(videoId, uri);
      if (currentUris.get(videoId) !== uri) {
        currentUris.set(videoId, uri);
        changed = true;
      }
    }
    if (changed) notify();
  };

  const scan = () => {
    scanQueue = scanQueue.then(runScan).catch((error) => {
      console.warn("[OfflineCopy] Scan failed", error);
    });
    return scanQueue;
  };

  const tempFileUri = async (videoId: string) => {
    await platform.ensureDir(platform.documentsDir(), VIDEOS_DIR);
    return tempUriFor(videoId);
  };

  const discardTemp = async (videoId: string) => {
    await platform.remove(tempUriFor(videoId));
  };

  // Puts the new copy in place before removing an old one in the same folder,
  // so a failed copy leaves the existing Offline copy untouched.
  const place = async (videoId: string, tempUri: string) => {
    const location = await platform.getStorageLocation();
    const dirUri = await locationVideosDir(location);
    const dest = `${dirUri}/${videoId}.mp4`;

    if (location.kind === "internal") {
      if (dest !== tempUri) {
        await platform.remove(dest);
        await platform.move(tempUri, dest);
      }
      return dest;
    }

    if (location.kind === "file") {
      const staging = `${dest}.download`;
      try {
        await platform.copy(tempUri, staging);
        await platform.remove(dest);
        await platform.move(staging, dest);
      } catch (error) {
        await platform.remove(staging).catch(() => {});
        throw error;
      }
      await platform.remove(tempUri);
      return dest;
    }

    const existing = (await listCopies(dirUri)).get(videoId);
    const created = await platform.createFile(dirUri, videoId);
    try {
      await platform.copy(tempUri, created);
    } catch (error) {
      await platform.remove(created).catch(() => {});
      throw error;
    }
    if (existing && existing !== created) {
      await platform.remove(existing).catch(() => {});
    }
    await platform.remove(tempUri);
    return created;
  };

  const adopt = async (videoId: string, tempUri: string) => {
    ensureLoaded();

    let dest: string;
    try {
      dest = await place(videoId, tempUri);
    } catch (error) {
      await platform.remove(tempUri).catch(() => {});
      throw error;
    }

    const saved = savedUris.get(videoId);
    const previous = [
      currentUris.get(videoId),
      saved ? resolveRecord(videoId, saved) : null,
    ];
    for (const uri of new Set(previous)) {
      if (uri && uri !== dest && uri !== tempUri) {
        await platform.remove(uri).catch(() => {});
      }
    }
    adoptGenerations.set(videoId, (adoptGenerations.get(videoId) ?? 0) + 1);
    record(videoId, dest);
    currentUris.set(videoId, dest);
    notify();
    return dest;
  };

  return {
    /** The playable URI of a Video's Offline copy, or null. */
    getUri,
    /** Same answer as `getUri`, re-rendering when the Offline copy appears or disappears. */
    useUri: (videoId: string) =>
      useSyncExternalStore(subscribe, () => getUri(videoId)),
    /** Moves a finished temp file into the current Storage location, replacing any existing copy. */
    adopt,
    /** Where a Download should write its partial file before calling `adopt`. */
    tempFileUri,
    /** Deletes a failed or cancelled Download's partial file. */
    discardTemp,
    /** Re-checks internal storage and the current Storage location. */
    scan,
  };
}

export type OfflineCopy = ReturnType<typeof createOfflineCopy>;
