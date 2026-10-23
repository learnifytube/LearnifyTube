/**
 * Where a List (including Favorites) or YouTube playlist picks up, for the
 * desktop and Devices alike (ADR-0006). Pure: Videos come in List order.
 * "Play from start" doesn't use it; it begins at the first Video.
 */

export type PickUpVideo = {
  id: string;
  watched: boolean;
  // The Video can't play here (file gone, not on this Device); it is skipped.
  missing?: boolean;
};

/**
 * The Current Video while it isn't watched; once it is, the next unwatched
 * Video after it, or the List from the top when none is left. With no Current
 * Video, or one that has left the List, the first unwatched Video.
 */
export const whereListPicksUp = <T extends PickUpVideo>(
  videos: readonly T[],
  currentVideoId: string | null,
) => {
  const playable = videos.filter((video) => !video.missing);
  const firstUnwatched = (from: readonly T[]) =>
    from.find((video) => !video.watched) ?? null;
  const index =
    currentVideoId === null
      ? -1
      : videos.findIndex((v) => v.id === currentVideoId);
  if (index < 0) return firstUnwatched(playable) ?? playable[0] ?? null;

  const current = videos[index];
  if (!current.watched && !current.missing) return current;
  const after = videos.slice(index + 1).filter((video) => !video.missing);
  return firstUnwatched(after) ?? playable[0] ?? null;
};
