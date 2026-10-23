/**
 * The collections that remember a Current Video (ADR-0006); Channels don't.
 * One list for the sync contract and the desktop's storage.
 */
export const COLLECTION_KINDS = [
  "list",
  "favorites",
  "youtube_playlist",
] as const;
