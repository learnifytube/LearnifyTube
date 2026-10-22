// Import planner for video files: what kind of folder the user picked, and the
// Movies an Import would create from it. Pure; reading the disk happens in the
// scan step. Audiobook plans stay in ../audiobooks/import-plan.

import { isAudioPath, type FolderListing, type ListedFile } from "@/api/audiobooks/import-plan";

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mkv", "webm", "mov", "avi", "ts", "wmv"]);

const extensionOf = (path: string): string => path.split(".").pop()?.toLowerCase() ?? "";

export const isVideoPath = (path: string): boolean => VIDEO_EXTENSIONS.has(extensionOf(path));

export type ImportKind = "audiobooks" | "movies";

export type FolderKind = {
  // What Import offers for the folder; null when it has neither audio nor video.
  kind: ImportKind | null;
  audioFiles: number;
  videoFiles: number;
  // Both audio and video: the preview warns that the other kind is left out.
  mixed: boolean;
};

// The files decide: audio makes Audiobooks, video makes Movies; a mixed folder
// goes by whichever has more files.
export const classifyFolder = (listing: FolderListing): FolderKind => {
  const audioFiles = listing.files.filter((file) => isAudioPath(file.path)).length;
  const videoFiles = listing.files.filter((file) => isVideoPath(file.path)).length;
  const kind =
    audioFiles === 0 && videoFiles === 0
      ? null
      : videoFiles >= audioFiles
        ? "movies"
        : "audiobooks";
  return { kind, audioFiles, videoFiles, mixed: audioFiles > 0 && videoFiles > 0 };
};

// "series" joins with the Series Import.
export const MOVIE_LAYOUTS = ["one-movie", "movie-per-file"] as const;

export type MovieLayout = (typeof MOVIE_LAYOUTS)[number];

export type PosterSource =
  | { kind: "file"; path: string }
  | { kind: "embedded"; videoPath: string; stream: number }
  | { kind: "frame"; videoPath: string };

export type ProposedMovie = {
  // The video file, relative to the picked folder, "/"-separated.
  path: string;
  title: string;
  poster: PosterSource;
  durationSeconds: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
};

export type MovieImportPlan = { suggestedLayout: MovieLayout; movies: ProposedMovie[] };

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

const POSTER_NAME = /^(poster|folder|cover)$/i;

// Samples, trailers and extras that come with a film.
const EXTRA_FOLDER = /^(samples?|extras?|featurettes?|trailers?|behind the scenes|bonus)$/i;
const EXTRA_FILE = /(^|[\s._-])(sample|trailer)([\s._-]|$)/i;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const segmentsOf = (path: string): string[] => path.split("/");

const dirOf = (path: string): string => segmentsOf(path).slice(0, -1).join("/");

const baseNameOf = (path: string): string => {
  const name = segmentsOf(path).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

const isExtra = (path: string): boolean =>
  segmentsOf(path)
    .slice(0, -1)
    .some((folder) => EXTRA_FOLDER.test(folder)) || EXTRA_FILE.test(baseNameOf(path));

/**
 * An image named after the video (`Up.jpg`, `Up-poster.jpg`); else, when the
 * folder belongs to this Movie, its `poster`/`folder`/`cover` image; else the
 * video's embedded art; else a frame of the video.
 */
const choosePoster = (video: ListedFile, images: string[], ownFolders: string[]): PosterSource => {
  const dir = dirOf(video.path);
  const base = baseNameOf(video.path).toLowerCase();
  const named = images.find(
    (image) =>
      dirOf(image) === dir && [base, `${base}-poster`].includes(baseNameOf(image).toLowerCase())
  );
  if (named) return { kind: "file", path: named };
  for (const folder of ownFolders) {
    const poster = images.find(
      (image) => dirOf(image) === folder && POSTER_NAME.test(baseNameOf(image))
    );
    if (poster) return { kind: "file", path: poster };
  }
  if (typeof video.attachedPicStream === "number") {
    return { kind: "embedded", videoPath: video.path, stream: video.attachedPicStream };
  }
  return { kind: "frame", videoPath: video.path };
};

const proposeMovie = (
  video: ListedFile,
  title: string,
  images: string[],
  ownFolders: string[]
): ProposedMovie => ({
  path: video.path,
  title,
  poster: choosePoster(video, images, ownFolders),
  durationSeconds: video.durationSeconds ?? null,
  videoCodec: video.videoCodec ?? null,
  audioCodec: video.audioCodec ?? null,
});

const byLength = (a: ListedFile, b: ListedFile): number =>
  (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0) || collator.compare(a.path, b.path);

// The film is the longest video that isn't a sample or extra.
const oneMovie = (
  listing: FolderListing,
  videos: ListedFile[],
  images: string[]
): ProposedMovie[] => {
  const [main] = [...videos].sort(
    (a, b) => Number(isExtra(a.path)) - Number(isExtra(b.path)) || byLength(a, b)
  );
  if (!main) return [];
  const folders = [...new Set(["", dirOf(main.path)])];
  return [proposeMovie(main, listing.name, images, folders)];
};

// Each video is a Movie, named after its folder when it is that folder's only video.
const moviePerFile = (videos: ListedFile[], images: string[]): ProposedMovie[] => {
  const videosPerDir = new Map<string, number>();
  for (const video of videos) {
    const dir = dirOf(video.path);
    videosPerDir.set(dir, (videosPerDir.get(dir) ?? 0) + 1);
  }
  return videos
    .map((video) => {
      const dir = dirOf(video.path);
      const alone = dir !== "" && videosPerDir.get(dir) === 1;
      const title = alone ? (segmentsOf(dir).at(-1) ?? dir) : baseNameOf(video.path);
      return proposeMovie(video, title, images, alone ? [dir] : []);
    })
    .sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.path, b.path));
};

export const planMovieImport = (listing: FolderListing, layout?: MovieLayout): MovieImportPlan => {
  const videos = listing.files.filter((file) => isVideoPath(file.path));
  const images = listing.files
    .map((file) => file.path)
    .filter((path) => IMAGE_EXTENSIONS.has(extensionOf(path)));
  const films = videos.filter((video) => !isExtra(video.path));
  const suggestedLayout: MovieLayout = films.length <= 1 ? "one-movie" : "movie-per-file";
  const movies =
    (layout ?? suggestedLayout) === "one-movie"
      ? oneMovie(listing, videos, images)
      : moviePerFile(videos, images);
  return { suggestedLayout, movies };
};
