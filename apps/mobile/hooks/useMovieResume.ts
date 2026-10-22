import { useEffect } from "react";
import type { VideoPlayer } from "expo-video";
import type { MovieKind } from "../../shared/mobile-sync-contract";
import { resumeAt } from "../services/movie-watch/movieWatch";
import { findTitle } from "../services/movie-watch/seriesWatch";
import { useMovieCatalogStore } from "../stores/movieCatalog";
import { movieWatchKey, useMovieWatchStore } from "../stores/movieWatch";

/** Where a title starts: where any device left it, unless that was the end. */
export function movieStartPosition(kind: MovieKind, id: string): number {
  const title = findTitle(useMovieCatalogStore.getState(), kind, id);
  return resumeAt({
    watch: title?.watch ?? null,
    kept: useMovieWatchStore.getState().progress[movieWatchKey(kind, id)],
    durationSeconds: title?.durationSeconds ?? null,
  });
}

/**
 * Seeks to the title's start position shortly after each source starts; a
 * later catalog refresh never seeks.
 */
export function useResumeWhenStarted(
  player: VideoPlayer,
  sourceUri: string | null,
  kind: MovieKind,
  id: string,
): void {
  useEffect(() => {
    if (!sourceUri) return;
    const start = movieStartPosition(kind, id);
    if (start <= 0) return;
    const timeout = setTimeout(() => {
      player.currentTime = start;
    }, 250);
    return () => clearTimeout(timeout);
  }, [player, sourceUri, kind, id]);
}
