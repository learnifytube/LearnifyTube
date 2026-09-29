import { useSyncExternalStore } from "react";
import { Buffer } from "buffer";

type Thumbnail = { mimeType: string; bytes: Uint8Array };

export type VideoThumbnailsPlatform = {
  /** Every stored thumbnail file. */
  list: () => { name: string; uri: string }[];
  /** Requests a thumbnail over the network; rejects on a failed response. */
  fetch: (url: string) => Promise<Thumbnail>;
  /** Writes a stored thumbnail file and returns its URI. */
  write: (name: string, bytes: Uint8Array) => string;
  delete: (uri: string) => void;
  desktopThumbnailUrl: (serverUrl: string, videoId: string) => string;
  /** Makes a desktop-relative asset URL absolute. */
  resolveUrl: (serverUrl: string, url: string) => string | null;
};

const FILE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

function decodeInline(url: string): Thumbnail | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  const [, mimeType = "image/jpeg", base64, data] = match;
  const bytes = base64
    ? Buffer.from(data, "base64")
    : Buffer.from(decodeURIComponent(data));
  return { mimeType, bytes: new Uint8Array(bytes) };
}

export function createVideoThumbnails(platform: VideoThumbnailsPlatform) {
  let uris: Map<string, string> | null = null;
  const listeners = new Set<() => void>();
  // Bumped by remove, so a store that was fetching then doesn't bring it back.
  const removals = new Map<string, number>();

  const ensureLoaded = () => {
    if (uris) return uris;
    uris = new Map();
    try {
      for (const { name, uri } of platform.list()) {
        uris.set(name.replace(/\.[^.]*$/, ""), uri);
      }
    } catch (error) {
      console.warn("[VideoThumbnails] Failed to list stored thumbnails", error);
    }
    return uris;
  };

  const getUri = (videoId: string) => ensureLoaded().get(videoId) ?? null;
  let lookup = (videoId: string) => getUri(videoId);

  const setUri = (videoId: string, uri: string | null) => {
    if (uri) ensureLoaded().set(videoId, uri);
    else ensureLoaded().delete(videoId);
    lookup = (id: string) => getUri(id);
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  // An inline thumbnail needs no request; the desktop's own endpoint works on
  // the local network when YouTube's doesn't.
  const read = async (
    serverUrl: string,
    videoId: string,
    thumbnailUrl: string | null | undefined,
  ) => {
    const given = thumbnailUrl?.trim()
      ? platform.resolveUrl(serverUrl, thumbnailUrl.trim())
      : null;
    const inline = given ? decodeInline(given) : null;
    if (inline) return inline;
    const sources = [platform.desktopThumbnailUrl(serverUrl, videoId)];
    if (given && /^https?:/i.test(given)) sources.push(given);
    let lastError: unknown;
    for (const url of sources) {
      try {
        return await platform.fetch(url);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };

  const store = async (
    serverUrl: string,
    videoId: string,
    thumbnailUrl: string | null | undefined,
  ) => {
    const removalsAtStart = removals.get(videoId) ?? 0;
    const { mimeType, bytes } = await read(serverUrl, videoId, thumbnailUrl);
    if ((removals.get(videoId) ?? 0) !== removalsAtStart) return;
    const extension = FILE_EXTENSION_BY_MIME_TYPE[mimeType] ?? "jpg";
    const previousUri = getUri(videoId);
    const uri = platform.write(`${videoId}.${extension}`, bytes);
    if (previousUri && previousUri !== uri) platform.delete(previousUri);
    setUri(videoId, uri);
  };

  const remove = (videoId: string) => {
    removals.set(videoId, (removals.get(videoId) ?? 0) + 1);
    const uri = getUri(videoId);
    if (!uri) return;
    try {
      platform.delete(uri);
    } catch (error) {
      console.warn("[VideoThumbnails] Failed to delete thumbnail", error);
    }
    setUri(videoId, null);
  };

  return {
    /** The Video's stored thumbnail file, or null when there is none. */
    getUri,
    /** A `getUri` for screens checking many Videos, re-rendering as thumbnails are stored or removed. */
    useLookup: () => useSyncExternalStore(subscribe, () => lookup),
    /**
     * Stores the Video's thumbnail on the Device, replacing any stored before:
     * an inline thumbnail as is, else the desktop's, else the Video's own URL.
     * Rejects, keeping the old one, when none can be read or written.
     */
    store,
    /** Deletes the Video's stored thumbnail, for Videos removed from the library. */
    remove,
  };
}

export type VideoThumbnails = ReturnType<typeof createVideoThumbnails>;
