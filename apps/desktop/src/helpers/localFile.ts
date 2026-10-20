const normalizeLocalPath = (inputPath: string | null | undefined): string => {
  if (!inputPath) return "";

  let normalized = inputPath.replace(/\\/g, "/");

  if (normalized.startsWith("file://")) {
    normalized = normalized.replace(/^file:\/\//, "");
  }

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  return normalized;
};

export const toLocalFileUrl = (inputPath: string | null | undefined): string => {
  const normalized = normalizeLocalPath(inputPath);
  if (!normalized) return "";
  // encodeURI leaves `#` and `?` alone, which would cut the path short as a
  // fragment or query; main decodes the whole path with decodeURIComponent.
  const encoded = encodeURI(normalized).replace(/#/g, "%23").replace(/\?/g, "%3F");
  return `local-file://${encoded}`;
};
