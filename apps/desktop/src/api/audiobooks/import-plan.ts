// Import planner: turns a listing of the folder the user picked into the
// Audiobooks an Import would create. Pure; reading the disk happens elsewhere.

export type ImportMode = "one-book" | "each-subfolder";

export type ListedFile = {
  // Relative to the picked folder, "/"-separated.
  path: string;
  artist?: string | null;
  durationSeconds?: number | null;
  hasEmbeddedArt?: boolean;
};

export type FolderListing = {
  // The picked folder's own name.
  name: string;
  files: ListedFile[];
};

export type ProposedTrack = {
  path: string;
  durationSeconds: number | null;
};

export type CoverSource =
  | { kind: "file"; path: string }
  | { kind: "embedded"; trackPath: string }
  | { kind: "placeholder" };

export type ProposedAudiobook = {
  // The book's folder relative to the picked folder; "" for the picked folder itself.
  folder: string;
  title: string;
  author: string | null;
  cover: CoverSource;
  tracks: ProposedTrack[];
};

export type ImportPlan = { suggestedMode: ImportMode; books: ProposedAudiobook[] };

const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "m4b", "aac", "flac", "ogg", "opus"]);

const extensionOf = (path: string): string => path.split(".").pop()?.toLowerCase() ?? "";

const isAudio = (path: string): boolean => AUDIO_EXTENSIONS.has(extensionOf(path));

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp"]);

const isImage = (path: string): boolean => IMAGE_EXTENSIONS.has(extensionOf(path));

const LIKELY_COVER_NAME = /^(cover|folder|front)\b/i;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const segmentsOf = (path: string): string[] => path.split("/");

// By subfolder, then file name, reading numbers as numbers.
const compareTrackPaths = (a: string, b: string): number => {
  const aDirs = segmentsOf(a).slice(0, -1);
  const bDirs = segmentsOf(b).slice(0, -1);
  for (let i = 0; i < Math.min(aDirs.length, bDirs.length); i++) {
    const order = collator.compare(aDirs[i], bDirs[i]);
    if (order !== 0) return order;
  }
  if (aDirs.length !== bDirs.length) return aDirs.length - bDirs.length;
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
};

const fileNameOf = (path: string): string => segmentsOf(path).at(-1) ?? path;

// The shallowest image, preferring names like cover.jpg or folder.png; else the
// first Track's embedded art; else a placeholder.
const chooseCover = (files: ListedFile[], firstTrack: ListedFile | undefined): CoverSource => {
  const [image] = files
    .filter((file) => isImage(file.path))
    .map((file) => file.path)
    .sort(
      (a, b) =>
        segmentsOf(a).length - segmentsOf(b).length ||
        Number(LIKELY_COVER_NAME.test(fileNameOf(b))) -
          Number(LIKELY_COVER_NAME.test(fileNameOf(a))) ||
        compareTrackPaths(a, b)
    );
  if (image) return { kind: "file", path: image };
  if (firstTrack?.hasEmbeddedArt) {
    return { kind: "embedded", trackPath: firstTrack.path };
  }
  return { kind: "placeholder" };
};

const DISC_FOLDER = /^(cd|disc|disk|part)\s*\d+$/i;

// "One book" when audio sits directly in the folder or every subfolder looks like a disc.
const suggestMode = (audioFiles: ListedFile[]): ImportMode => {
  const topFolders = new Set<string>();
  for (const file of audioFiles) {
    const segments = segmentsOf(file.path);
    if (segments.length === 1) return "one-book";
    topFolders.add(segments[0]);
  }
  return [...topFolders].every((folder) => DISC_FOLDER.test(folder))
    ? "one-book"
    : "each-subfolder";
};

const agreedArtist = (audioFiles: ListedFile[]): string | null => {
  const artists = new Set(audioFiles.map((file) => file.artist?.trim() || null));
  const [only] = artists;
  return artists.size === 1 ? only : null;
};

const proposeBook = (folder: string, title: string, files: ListedFile[]): ProposedAudiobook => {
  const audioFiles = files
    .filter((file) => isAudio(file.path))
    .sort((a, b) => compareTrackPaths(a.path, b.path));
  return {
    folder,
    title,
    author: agreedArtist(audioFiles),
    cover: chooseCover(files, audioFiles[0]),
    tracks: audioFiles.map((file) => ({
      path: file.path,
      durationSeconds: file.durationSeconds ?? null,
    })),
  };
};

// Audio loose in the picked folder becomes a book named after it.
const groupBySubfolder = (listing: FolderListing): ProposedAudiobook[] => {
  const groups = new Map<string, ListedFile[]>();
  for (const file of listing.files) {
    const segments = segmentsOf(file.path);
    const folder = segments.length === 1 ? "" : segments[0];
    groups.set(folder, [...(groups.get(folder) ?? []), file]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : collator.compare(a, b)))
    .map(([folder, files]) => proposeBook(folder, folder || listing.name, files));
};

export const planImport = (listing: FolderListing, mode?: ImportMode): ImportPlan => {
  const suggestedMode = suggestMode(listing.files.filter((file) => isAudio(file.path)));
  const books =
    (mode ?? suggestedMode) === "one-book"
      ? [proposeBook("", listing.name, listing.files)]
      : groupBySubfolder(listing);
  return { suggestedMode, books: books.filter((book) => book.tracks.length > 0) };
};
