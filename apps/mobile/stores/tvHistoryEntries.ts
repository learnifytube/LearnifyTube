import type { StreamingVideo } from "./playback";

const MAX_ENTRIES = 20;

/** A Play queue of Videos played on the TV, and where in it the viewer was. */
export type TVRecentPlaylist = {
  kind: "videos";
  playlistId: string;
  title: string;
  videos: StreamingVideo[];
  lastIndex: number;
  lastVideoId: string | null;
  updatedAt: number;
};

/**
 * A Movie played on the TV. Where it resumes isn't kept here: pressing it
 * reads the Movie's Watch progress then. A Series entry (#53) joins this union
 * the same way, with the Episode to play chosen at press time.
 */
export type TVRecentMovie = {
  kind: "movie";
  movieId: string;
  title: string;
  updatedAt: number;
};

/** What a played title records; the time is added when it's recorded. */
export type TVPlayedTitle = Omit<TVRecentMovie, "updatedAt">;

/** One History card: a Video queue or a title. */
export type TVHistoryEntry = TVRecentPlaylist | TVRecentMovie;

/** An entry's identity in History; a title can't collide with a queue id. */
export function historyKey(entry: TVHistoryEntry | TVPlayedTitle) {
  if (entry.kind === "movie") return `movie:${entry.movieId}`;
  return entry.playlistId;
}

const putFirst = (entries: TVHistoryEntry[], entry: TVHistoryEntry) =>
  [
    entry,
    ...entries.filter((item) => historyKey(item) !== historyKey(entry)),
  ].slice(0, MAX_ENTRIES);

const clampIndex = (index: number, length: number) =>
  Math.min(Math.max(index, 0), Math.max(length - 1, 0));

// Keep only the queue fields, so a location from an older version (or an
// object carrying extra fields) is never persisted.
const toHistoryVideo = ({
  id,
  title,
  channelTitle,
  duration,
  thumbnailUrl,
}: StreamingVideo): StreamingVideo => ({
  id,
  title,
  channelTitle,
  duration,
  thumbnailUrl,
});

/** History after a Play queue of Videos started. */
export function recordPlayedQueue(
  entries: TVHistoryEntry[],
  {
    playlistId,
    title,
    videos,
    startIndex,
  }: {
    playlistId: string;
    title: string;
    videos: StreamingVideo[];
    startIndex: number;
  },
  now: number,
): TVHistoryEntry[] {
  if (!playlistId || videos.length === 0) return entries;
  const lastIndex = clampIndex(startIndex, videos.length);
  return putFirst(entries, {
    kind: "videos",
    playlistId,
    title,
    videos: videos.map(toHistoryVideo),
    lastIndex,
    lastVideoId: videos[lastIndex]?.id ?? null,
    updatedAt: now,
  });
}

/** History after a Movie started playing. */
export function recordPlayedTitle(
  entries: TVHistoryEntry[],
  title: TVPlayedTitle,
  now: number,
): TVHistoryEntry[] {
  return putFirst(entries, { ...title, updatedAt: now });
}

/** History after the player moved to another Video of a queue. */
export function recordQueueProgress(
  entries: TVHistoryEntry[],
  {
    playlistId,
    currentIndex,
    currentVideoId,
  }: {
    playlistId: string;
    currentIndex: number;
    currentVideoId?: string | null;
  },
  now: number,
): TVHistoryEntry[] {
  const entry = entries.find(
    (item) => item.kind === "videos" && item.playlistId === playlistId,
  );
  if (!playlistId || entry?.kind !== "videos") return entries;
  const lastIndex = clampIndex(currentIndex, entry.videos.length);
  return putFirst(entries, {
    ...entry,
    lastIndex,
    lastVideoId: currentVideoId ?? entry.videos[lastIndex]?.id ?? null,
    updatedAt: now,
  });
}

type SavedEntry = Partial<Omit<TVRecentPlaylist, "kind">> & {
  kind?: TVHistoryEntry["kind"];
  movieId?: string;
  serverUrl?: string | null;
};

/**
 * History saved by an older version: v0 kept each Video's file location, v1
 * the desktop's address, and before v3 every entry was a Video queue.
 */
export function migrateTVHistory(persisted: unknown): {
  entries: TVHistoryEntry[];
} {
  const state = persisted as
    { recentPlaylists?: SavedEntry[]; entries?: SavedEntry[] } | undefined;
  const saved = state?.entries ?? state?.recentPlaylists ?? [];
  return {
    entries: saved.map((entry): TVHistoryEntry => {
      // Kept for later versions: from v3 an entry can be a Movie.
      if (entry.kind === "movie") {
        return {
          kind: "movie",
          movieId: entry.movieId ?? "",
          title: entry.title ?? "",
          updatedAt: entry.updatedAt ?? 0,
        };
      }
      return {
        kind: "videos",
        playlistId: entry.playlistId ?? "",
        title: entry.title ?? "",
        videos: (entry.videos ?? []).map(toHistoryVideo),
        lastIndex: entry.lastIndex ?? 0,
        lastVideoId: entry.lastVideoId ?? null,
        updatedAt: entry.updatedAt ?? 0,
      };
    }),
  };
}
