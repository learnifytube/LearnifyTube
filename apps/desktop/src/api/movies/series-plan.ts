// Import planner for a Series: the Seasons and Episodes an Import would create
// from a folder of video files. Pure, like ./import-plan which plans Movies.

import type { FolderListing, ListedFile } from "@/api/audiobooks/import-plan";
import {
  IMAGE_EXTENSIONS,
  MOVIE_LAYOUTS,
  POSTER_NAME,
  baseNameOf,
  collator,
  dirOf,
  extensionOf,
  isExtra,
  isVideoPath,
  planMovieImport,
  segmentsOf,
  type PosterSource,
} from "./import-plan";
import { codecWarningsFor, type CodecWarning } from "./codec-warnings";
import { pairCaptions, type ProposedCaption } from "./caption-pairing";

// Every way the preview can import a folder of video files.
export const VIDEO_LAYOUTS = [...MOVIE_LAYOUTS, "series"] as const;

export type VideoLayout = (typeof VIDEO_LAYOUTS)[number];

export type ProposedEpisode = {
  // The video file, relative to the picked folder, "/"-separated.
  path: string;
  title: string;
  // From E02 in the file name (or "Episode 2"), if any.
  number: number | null;
  durationSeconds: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  // What Android is likely to refuse to play; the preview warns before saving.
  codecWarnings: CodecWarning[];
  // Sidecar subtitle files named after the video.
  captions: ProposedCaption[];
};

export type ProposedSeason = {
  // Stable within one plan, so the preview can send back its corrected order.
  key: string;
  title: string;
  // From S01 in the file names or a "Season 1" folder; 0 is Specials.
  number: number | null;
  episodes: ProposedEpisode[];
};

export type SeriesImportPlan = { title: string; poster: PosterSource; seasons: ProposedSeason[] };

// S01E02, s1e2, 1x02 (the first one, for a double Episode).
const SEASON_EPISODE =
  /(?:^|[^a-z0-9])s(\d{1,3})[\s._-]?e(\d{1,4})|(?:^|[^a-z0-9])(\d{1,2})x(\d{2,3})(?![0-9])/i;
const EPISODE_ONLY = /(?:^|[^a-z0-9])(?:ep|episode)[\s._-]*(\d{1,4})(?![0-9])/i;
const SEASON_FOLDER = /^(?:season|series|saison|staffel)[\s._-]*(\d{1,3})\b|^s(\d{1,3})$/i;
const SPECIALS_FOLDER = /^specials?$/i;

type Numbers = { season: number | null; episode: number | null };

const numbersInName = (path: string): Numbers | null => {
  const match = SEASON_EPISODE.exec(baseNameOf(path));
  if (!match) return null;
  return { season: Number(match[1] ?? match[3]), episode: Number(match[2] ?? match[4]) };
};

// The Season number a folder name stands for, if any.
const seasonOfFolder = (folder: string): number | null => {
  if (SPECIALS_FOLDER.test(folder)) return 0;
  const match = SEASON_FOLDER.exec(folder);
  return match ? Number(match[1] ?? match[2]) : null;
};

const filmsIn = (listing: FolderListing): ListedFile[] =>
  listing.files.filter((file) => isVideoPath(file.path) && !isExtra(file.path));

const seasonTitle = (number: number): string => (number === 0 ? "Specials" : `Season ${number}`);

// Numbered Seasons first, Specials last; folders without a number in between.
const seasonRank = (season: ProposedSeason): [number, number] =>
  season.number === null ? [1, 0] : season.number === 0 ? [2, 0] : [0, season.number];

const compareSeasons = (a: ProposedSeason, b: ProposedSeason): number => {
  const [groupA, numberA] = seasonRank(a);
  const [groupB, numberB] = seasonRank(b);
  if (groupA !== groupB || numberA !== numberB) return groupA - groupB || numberA - numberB;
  // The root folder's loose Episodes before named folders.
  if (a.key === "folder:" || b.key === "folder:") return a.key === "folder:" ? -1 : 1;
  return collator.compare(a.title, b.title);
};

const compareEpisodes = (a: ProposedEpisode, b: ProposedEpisode): number => {
  if (a.number !== null && b.number !== null && a.number !== b.number) return a.number - b.number;
  if ((a.number === null) !== (b.number === null)) return a.number === null ? 1 : -1;
  return collator.compare(a.path, b.path);
};

const proposeEpisode = (
  video: ListedFile,
  number: number | null,
  paths: string[]
): ProposedEpisode => ({
  path: video.path,
  title: baseNameOf(video.path),
  number,
  durationSeconds: video.durationSeconds ?? null,
  videoCodec: video.videoCodec ?? null,
  audioCodec: video.audioCodec ?? null,
  codecWarnings: codecWarningsFor(video),
  captions: pairCaptions(video.path, paths),
});

const seasonsOf = (videos: ListedFile[], paths: string[]): ProposedSeason[] => {
  const seasons = new Map<string, ProposedSeason>();
  for (const video of videos) {
    const named = numbersInName(video.path);
    const dir = dirOf(video.path);
    const folderNumber = dir ? seasonOfFolder(segmentsOf(dir).at(-1) ?? dir) : null;
    const number = named?.season ?? folderNumber;
    const key = number === null ? `folder:${dir}` : `season:${number}`;
    const season = seasons.get(key) ?? {
      key,
      title:
        number === null
          ? dir
            ? (segmentsOf(dir).at(-1) ?? dir)
            : "Episodes"
          : seasonTitle(number),
      number,
      episodes: [],
    };
    const episodeNumber =
      named?.episode ?? Number(EPISODE_ONLY.exec(baseNameOf(video.path))?.[1] ?? NaN);
    season.episodes.push(
      proposeEpisode(video, Number.isNaN(episodeNumber) ? null : episodeNumber, paths)
    );
    seasons.set(key, season);
  }
  const ordered = [...seasons.values()].sort(compareSeasons);
  for (const season of ordered) season.episodes.sort(compareEpisodes);
  // A flat folder of Episodes is Season 1.
  const [only] = ordered;
  if (ordered.length === 1 && only.key === "folder:") {
    return [{ ...only, title: seasonTitle(1), number: 1 }];
  }
  return ordered;
};

// The folder's poster/folder/cover image, else the first Episode's art, else a frame of it.
const seriesPoster = (listing: FolderListing, first: ProposedEpisode | undefined): PosterSource => {
  const poster = listing.files.find(
    (file) =>
      dirOf(file.path) === "" &&
      IMAGE_EXTENSIONS.has(extensionOf(file.path)) &&
      POSTER_NAME.test(baseNameOf(file.path))
  );
  if (poster) return { kind: "file", path: poster.path };
  const video = listing.files.find((file) => file.path === first?.path);
  if (video && typeof video.attachedPicStream === "number") {
    return { kind: "embedded", videoPath: video.path, stream: video.attachedPicStream };
  }
  return { kind: "frame", videoPath: first?.path ?? "" };
};

export const planSeriesImport = (listing: FolderListing): SeriesImportPlan => {
  const seasons = seasonsOf(
    filmsIn(listing),
    listing.files.map((file) => file.path)
  );
  return {
    title: listing.name,
    poster: seriesPoster(listing, seasons[0]?.episodes[0]),
    seasons,
  };
};

export type SeriesOrder = { key: string; episodes: string[] }[];

/**
 * The user's corrected order from the preview: Seasons in the given order, each
 * with the given Episodes. Only planned Episodes count; any it leaves out stay
 * at the end of their planned Season, and Seasons left empty are dropped.
 */
export const reorderSeries = (plan: SeriesImportPlan, order: SeriesOrder): SeriesImportPlan => {
  const planned = new Map(
    plan.seasons.flatMap((season) =>
      season.episodes.map((episode) => [episode.path, { episode, seasonKey: season.key }] as const)
    )
  );
  const placed = new Set<string>();
  const result = new Map<string, ProposedSeason>();
  for (const entry of order) {
    const season = plan.seasons.find((candidate) => candidate.key === entry.key);
    if (!season || result.has(season.key)) continue;
    const episodes = entry.episodes.flatMap((path) => {
      const found = planned.get(path);
      if (!found || placed.has(path)) return [];
      placed.add(path);
      return [found.episode];
    });
    result.set(season.key, { ...season, episodes });
  }
  for (const season of plan.seasons) {
    if (!result.has(season.key)) result.set(season.key, { ...season, episodes: [] });
  }
  for (const [path, { episode, seasonKey }] of planned) {
    if (!placed.has(path)) result.get(seasonKey)?.episodes.push(episode);
  }
  return { ...plan, seasons: [...result.values()].filter((season) => season.episodes.length > 0) };
};

/**
 * Moves an Episode one place up (-1) or down (1) in the preview's order; past
 * the edge of its Season it joins the end of the previous Season or the start
 * of the next one.
 */
export const moveEpisode = (order: SeriesOrder, path: string, by: -1 | 1): SeriesOrder => {
  const seasonIndex = order.findIndex((season) => season.episodes.includes(path));
  if (seasonIndex < 0) return order;
  const episodes = order[seasonIndex].episodes;
  const index = episodes.indexOf(path);
  const target = index + by;
  const next = order.map((season) => ({ ...season, episodes: [...season.episodes] }));
  if (target >= 0 && target < episodes.length) {
    next[seasonIndex].episodes.splice(index, 1);
    next[seasonIndex].episodes.splice(target, 0, path);
    return next;
  }
  const neighbour = next[seasonIndex + by];
  if (!neighbour) return order;
  next[seasonIndex].episodes.splice(index, 1);
  if (by < 0) neighbour.episodes.push(path);
  else neighbour.episodes.unshift(path);
  return next;
};

export const moveSeason = (order: SeriesOrder, key: string, by: -1 | 1): SeriesOrder => {
  const index = order.findIndex((season) => season.key === key);
  const target = index + by;
  if (index < 0 || target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

const stemWithoutNumbers = (path: string): string =>
  baseNameOf(path).replace(/\d+/g, "#").toLowerCase();

/**
 * A Series when files carry SxxEyy, sit in Season folders, or are numbered
 * alike ("Episode 1", "Episode 2"); else what the Movie planner suggests.
 */
export const suggestVideoLayout = (listing: FolderListing): VideoLayout => {
  const videos = filmsIn(listing);
  const numbered = videos.filter((video) => numbersInName(video.path)).length;
  const inSeasonFolders = videos.some((video) =>
    segmentsOf(dirOf(video.path)).some((folder) => folder && seasonOfFolder(folder) !== null)
  );
  const stems = new Set(videos.map((video) => stemWithoutNumbers(video.path)));
  const numberedAlike = videos.length >= 2 && stems.size === 1 && [...stems][0].includes("#");
  if (numbered >= 2 || inSeasonFolders || numberedAlike) return "series";
  return planMovieImport(listing).suggestedLayout;
};
