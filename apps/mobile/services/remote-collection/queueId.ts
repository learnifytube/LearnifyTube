import type { BrowseCachePlaylistKind } from "../../db/repositories/playlists";

/** The desktop endpoints a List or YouTube playlist loads from. */
export type RemoteCollectionKind = Extract<
  BrowseCachePlaylistKind,
  "playlist" | "mylist"
>;

/**
 * The Play queue id of a collection a screen plays: `playlist-<id>`,
 * `mylist-<id>`, `channel-<id>`. TV History and the Current Video store key by it.
 */
export const collectionQueueId = (kind: BrowseCachePlaylistKind, id: string) =>
  `${kind}-${id}`;

/** The desktop List or YouTube playlist a Play queue id names, or null for any other queue. */
export const remoteCollectionOfQueueId = (queueId: string) => {
  const match = /^(playlist|mylist)-(.+)$/.exec(queueId);
  return match
    ? { kind: match[1] as RemoteCollectionKind, id: match[2] }
    : null;
};
