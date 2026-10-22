// Rescan planner for a Series: compares its Seasons and Episodes with a fresh
// listing of its folder. Pure, like the Audiobook rescan plan; reading the disk
// happens elsewhere.

import type { FolderListing } from "@/api/audiobooks/import-plan";
import { planSeriesImport, type ProposedEpisode, type ProposedSeason } from "./series-plan";

export type CurrentEpisode = {
  id: string;
  // Relative to the Series folder, "/"-separated.
  path: string;
  number: number | null;
  missing: boolean;
};

export type CurrentSeason = {
  id: string;
  title: string;
  number: number | null;
  // In the Season's order.
  episodes: CurrentEpisode[];
};

export type RescannedEpisode =
  | { kind: "existing"; id: string; missing: boolean }
  | { kind: "new"; episode: Omit<ProposedEpisode, "codecWarnings"> };

export type RescannedSeason =
  | { kind: "existing"; id: string; episodes: RescannedEpisode[] }
  | { kind: "new"; title: string; number: number | null; episodes: RescannedEpisode[] };

export type SeriesRescanPlan = {
  // Every Season in its new order, each with its Episodes in their new order.
  seasons: RescannedSeason[];
  added: number;
  missing: number;
};

const withoutWarnings = ({
  codecWarnings: _codecWarnings,
  ...episode
}: ProposedEpisode): Omit<ProposedEpisode, "codecWarnings"> => episode;

/**
 * After the last Episode numbered at most `number`, else before the first
 * numbered one; at the end when unnumbered. Never moves the others.
 */
const insertByNumber = (
  episodes: RescannedEpisode[],
  numbers: Map<RescannedEpisode, number | null>,
  episode: RescannedEpisode,
  number: number | null
): void => {
  numbers.set(episode, number);
  if (number === null) {
    episodes.push(episode);
    return;
  }
  const numberOf = (candidate: RescannedEpisode): number | null => numbers.get(candidate) ?? null;
  let after = -1;
  episodes.forEach((candidate, index) => {
    const other = numberOf(candidate);
    if (other !== null && other <= number) after = index;
  });
  const firstNumbered = episodes.findIndex((candidate) => numberOf(candidate) !== null);
  const at = after >= 0 ? after + 1 : firstNumbered >= 0 ? firstNumbered : episodes.length;
  episodes.splice(at, 0, episode);
};

/**
 * Existing Seasons and Episodes keep their order; files no longer there are
 * missing. New Episodes join the Season they would have been imported into.
 */
export const planSeriesRescan = (
  current: CurrentSeason[],
  listing: FolderListing
): SeriesRescanPlan => {
  const planned = planSeriesImport(listing);
  const present = new Set(
    planned.seasons.flatMap((season) => season.episodes.map((episode) => episode.path))
  );
  const known = new Set(current.flatMap((season) => season.episodes.map((e) => e.path)));
  const seasons: RescannedSeason[] = current.map((season) => ({
    kind: "existing",
    id: season.id,
    episodes: season.episodes.map((episode) => ({
      kind: "existing",
      id: episode.id,
      missing: !present.has(episode.path),
    })),
  }));
  // Episode numbers by the id or path the plan knows them by.
  const numbers = new Map<RescannedEpisode, number | null>();
  for (const [index, season] of seasons.entries()) {
    for (const [at, episode] of season.episodes.entries()) {
      numbers.set(episode, current[index].episodes[at].number);
    }
  }
  // The Season already holding files the plan puts together, else the one with
  // the same number, or for a named folder the same title; else a new Season.
  const seasonFor = (plannedSeason: ProposedSeason): RescannedSeason => {
    const index = current.findIndex((season) =>
      season.episodes.some((episode) =>
        plannedSeason.episodes.some((planned) => planned.path === episode.path)
      )
    );
    const matched =
      index >= 0
        ? index
        : current.findIndex((season) =>
            plannedSeason.number === null
              ? season.number === null && season.title === plannedSeason.title
              : season.number === plannedSeason.number
          );
    if (matched >= 0) return seasons[matched];
    const created: RescannedSeason = {
      kind: "new",
      title: plannedSeason.title,
      number: plannedSeason.number,
      episodes: [],
    };
    seasons.push(created);
    return created;
  };
  let added = 0;
  for (const plannedSeason of planned.seasons) {
    const fresh = plannedSeason.episodes.filter((episode) => !known.has(episode.path));
    if (fresh.length === 0) continue;
    const target = seasonFor(plannedSeason);
    for (const episode of fresh) {
      insertByNumber(
        target.episodes,
        numbers,
        { kind: "new", episode: withoutWarnings(episode) },
        episode.number
      );
      added += 1;
    }
  }
  const missing = seasons
    .flatMap((season) => season.episodes)
    .filter((episode) => episode.kind === "existing" && episode.missing).length;
  return { seasons, added, missing };
};
