/**
 * Where a Series picks up, for the desktop and Devices alike (ADR-0005). Pure:
 * Episodes come in Series order (Season by Season, then Episode order).
 */

export type NextUpEpisode = {
  id: string;
  // The file is gone, so it can't play; it is skipped.
  missing?: boolean;
  watchState: "unwatched" | "in-progress" | "watched";
};

const playable = <T extends NextUpEpisode>(episodes: readonly T[]): T[] =>
  episodes.filter((episode) => !episode.missing);

const notWatched = <T extends NextUpEpisode>(
  episodes: readonly T[],
): T | null =>
  playable(episodes).find((episode) => episode.watchState !== "watched") ??
  null;

/**
 * Where a Series picks up (ADR-0006): the last Episode played, unless it is
 * watched or missing; else the next Episode after it that isn't watched and can
 * play; else (none played, or none left after it) the first such Episode. Null
 * once every Episode that can play is watched.
 */
export const nextUpEpisode = <T extends NextUpEpisode>(
  episodes: readonly T[],
  lastEpisodeId: string | null,
): T | null => {
  const index =
    lastEpisodeId === null
      ? -1
      : episodes.findIndex((e) => e.id === lastEpisodeId);
  return (
    (index < 0 ? null : notWatched(episodes.slice(index))) ??
    notWatched(episodes)
  );
};

/** The Episode that autoplays when `episodeId` ends: the next one in order that can play. */
export const episodeAfter = <T extends NextUpEpisode>(
  episodes: readonly T[],
  episodeId: string,
): T | null => {
  const index = episodes.findIndex((episode) => episode.id === episodeId);
  if (index < 0) return null;
  return playable(episodes.slice(index + 1))[0] ?? null;
};
