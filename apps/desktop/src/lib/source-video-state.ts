import { isOnItsWay } from "@/lib/kept-video";
import type { WatchState } from "@/lib/watch-state";

export type SourceVideoState = "not-kept" | "keeping" | "kept" | "watched";

// A Video on a Source page, as the Library sees it. A failed fetch can be kept again.
export const getSourceVideoState = (
  libraryVideo: { downloadStatus: string | null; watchState: WatchState } | undefined
): SourceVideoState => {
  if (!libraryVideo || libraryVideo.downloadStatus === "failed") return "not-kept";
  if (isOnItsWay(libraryVideo.downloadStatus)) return "keeping";
  return libraryVideo.watchState === "watched" ? "watched" : "kept";
};

// Where a Source page opens: the first Video, in page order, not kept yet.
export const firstNotKeptVideoId = (
  videoIds: string[],
  stateOf: (videoId: string) => SourceVideoState
): string | null => videoIds.find((videoId) => stateOf(videoId) === "not-kept") ?? null;
