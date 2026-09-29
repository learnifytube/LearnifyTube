import { Buffer } from "buffer";

const inflightThumbnailRequests = new Map<string, Promise<string | null>>();

function isExpectedMissingThumbnail(remoteUrl: string, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("HTTP 404") &&
    /\/api\/(?:video|playlist|channel)\/[^/]+\/thumbnail(?:$|\?)/i.test(remoteUrl)
  );
}

function getMimeTypeFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".png")) return "image/png";
    if (pathname.endsWith(".webp")) return "image/webp";
    if (pathname.endsWith(".gif")) return "image/gif";
    if (pathname.endsWith(".bmp")) return "image/bmp";
    if (pathname.endsWith(".svg")) return "image/svg+xml";
    if (pathname.endsWith(".avif")) return "image/avif";
  } catch {
    // Fall back to JPEG below.
  }

  return "image/jpeg";
}

export async function fetchThumbnail(remoteUrl: string) {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Thumbnail request failed with HTTP ${response.status}`);
  }

  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    getMimeTypeFromUrl(remoteUrl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { mimeType, bytes };
}

async function cacheThumbnailInternal(remoteUrl: string): Promise<string | null> {
  const { mimeType, bytes } = await fetchThumbnail(remoteUrl);
  const base64 = Buffer.from(bytes).toString("base64");

  return `data:${mimeType};base64,${base64}`;
}

export async function cacheThumbnail(
  remoteUrl: string | null | undefined,
  cacheKey: string
): Promise<string | null> {
  const trimmedUrl = remoteUrl?.trim();
  if (!trimmedUrl) {
    return null;
  }

  const inflightKey = `${cacheKey}:${trimmedUrl}`;
  const existingPromise = inflightThumbnailRequests.get(inflightKey);
  if (existingPromise) {
    return existingPromise;
  }

  const requestPromise = cacheThumbnailInternal(trimmedUrl)
    .catch((error) => {
      if (!isExpectedMissingThumbnail(trimmedUrl, error)) {
        console.warn("[ThumbnailCache] Failed to cache thumbnail", {
          cacheKey,
          remoteUrl: trimmedUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    })
    .finally(() => {
      inflightThumbnailRequests.delete(inflightKey);
    });

  inflightThumbnailRequests.set(inflightKey, requestPromise);
  return requestPromise;
}

