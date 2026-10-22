/**
 * Where a Series picks up, for the desktop and Devices alike (ADR-0005). Pure:
 * Episodes come in Series order (Season by Season, then Episode order).
 */

export type NextUpEpisode = {
  id: string;
  // The file is gone, so it can't play; it is skipped.
  missing?: boolean;
  watchState: "unwatched" | "in-progress" | "watched";
  // When its Watch progress last changed, to pick between Episodes in progress.
  watchUpdatedAt?: number | null;
};

const playable = <T extends NextUpEpisode>(episodes: readonly T[]): T[] =>
  episodes.filter((episode) => !episode.missing);

/**
 * The Episode in progress (the one that changed last, if several), else the
 * first unwatched Episode, skipping missing ones; null once all are watched.
 */
export const nextUpEpisode = <T extends NextUpEpisode>(episodes: readonly T[]): T | null => {
  const candidates = playable(episodes);
  const inProgress = candidates
    .filter((episode) => episode.watchState === "in-progress")
    .reduce<T | null>(
      (latest, episode) =>
        !latest || (episode.watchUpdatedAt ?? 0) > (latest.watchUpdatedAt ?? 0) ? episode : latest,
      null
    );
  return inProgress ?? candidates.find((episode) => episode.watchState === "unwatched") ?? null;
};

/** The Episode that autoplays when `episodeId` ends: the next one in order that can play. */
export const episodeAfter = <T extends NextUpEpisode>(
  episodes: readonly T[],
  episodeId: string
): T | null => {
  const index = episodes.findIndex((episode) => episode.id === episodeId);
  if (index < 0) return null;
  return playable(episodes.slice(index + 1))[0] ?? null;
};
