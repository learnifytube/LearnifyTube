import type { WatchState } from "@/lib/watch-state";

export type LibraryVideo = {
  videoId: string;
  title: string;
  channelId: string | null;
  channelTitle: string;
  durationSeconds: number | null;
  keptAt: number;
  watchState: WatchState;
  listIds: string[];
};

export type LibrarySort = "recently-kept" | "title" | "duration" | "channel";

export type LibraryView = {
  search: string;
  sort: LibrarySort;
  watchState: WatchState | "all";
  channelId: string | "all";
  listId: string | "all";
};

const byRecentlyKept = (a: LibraryVideo, b: LibraryVideo): number => b.keptAt - a.keptAt;

const comparators: Record<LibrarySort, (a: LibraryVideo, b: LibraryVideo) => number> = {
  "recently-kept": byRecentlyKept,
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  duration: (a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1),
  channel: (a, b) =>
    a.channelTitle.localeCompare(b.channelTitle, undefined, { sensitivity: "base" }) ||
    byRecentlyKept(a, b),
};

export const selectLibraryVideos = <T extends LibraryVideo>(
  videos: T[],
  view: LibraryView
): T[] => {
  const search = view.search.trim().toLowerCase();
  return videos
    .filter(
      (v) =>
        (!search ||
          v.title.toLowerCase().includes(search) ||
          v.channelTitle.toLowerCase().includes(search)) &&
        (view.watchState === "all" || v.watchState === view.watchState) &&
        (view.channelId === "all" || v.channelId === view.channelId) &&
        (view.listId === "all" || v.listIds.includes(view.listId))
    )
    .sort(comparators[view.sort]);
};
