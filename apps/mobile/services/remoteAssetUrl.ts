/** Makes a desktop-relative (or advertised) asset URL one this Device can fetch. */
export function resolveRemoteAssetUrl(
  serverUrl: string | null,
  assetUrl?: string | null
): string | null {
  const trimmed = assetUrl?.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (serverUrl && /^https?:/i.test(trimmed)) {
      try {
        const asset = new URL(trimmed);
        const server = new URL(serverUrl);
        if (asset.pathname.startsWith("/api/")) {
          return `${server.origin}${asset.pathname}${asset.search}`;
        }
      } catch {
        // Keep the original URL when it isn't a valid absolute URL.
      }
    }
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (!serverUrl) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return `${serverUrl}${trimmed}`;
  }

  return `${serverUrl}/${trimmed}`;
}
