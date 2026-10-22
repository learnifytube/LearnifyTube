import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { logger } from "@/helpers/logger";
import { resumeAt as resumePosition } from "../../../../shared/resume-at";

const SAVE_EVERY_MS = 10_000;

type Playback = { id: string; positionSeconds: number; durationSeconds: number | null };

const recorders = {
  movie: ({ id, ...playback }: Playback) =>
    trpcClient.movies.recordPlayback.mutate({ movieId: id, ...playback }),
  episode: ({ id, ...playback }: Playback) =>
    trpcClient.movies.series.recordPlayback.mutate({ episodeId: id, ...playback }),
} satisfies Record<string, (playback: Playback) => Promise<void>>;

/**
 * Resumes a Movie or Episode where it stopped (from the start once it was
 * watched, by the shared "resume at" rule) and saves where it is now and then, on pause, at the end
 * and on leaving. The desktop's Watch progress turns watched at about 90%
 * (Video rule). Mount it once per Movie or Episode (a `key`).
 */
export function useMovieProgress(
  videoRef: React.RefObject<HTMLVideoElement>,
  movie: {
    id: string;
    positionSeconds: number | null;
    durationSeconds: number | null;
    // Marked watched or played to about 90%.
    watched: boolean;
  } | null,
  videoSrc: string | null,
  kind: keyof typeof recorders = "movie"
): void {
  const queryClient = useQueryClient();
  // The saved position at the time the page opened, read once per Movie.
  const resumeAt = useRef<number | null>(null);
  const movieId = movie?.id ?? null;
  if (movie && resumeAt.current === null) {
    resumeAt.current = resumePosition({
      positionSeconds: movie.positionSeconds,
      durationSeconds: movie.durationSeconds,
      watched: movie.watched,
    });
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !movieId || !videoSrc) return;

    const save = (): void => {
      if (!Number.isFinite(video.currentTime) || video.currentTime <= 0) return;
      const durationSeconds =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      recorders[kind]({ id: movieId, positionSeconds: video.currentTime, durationSeconds })
        .then(() => queryClient.invalidateQueries({ queryKey: ["movies"] }))
        .catch((error: unknown) => logger.warn("[movies] Saving Watch progress failed", { error }));
    };

    const resume = (): void => {
      const at = resumeAt.current ?? 0;
      if (at > 0 && at < video.duration) video.currentTime = at;
    };

    if (video.readyState >= 1) resume();
    else video.addEventListener("loadedmetadata", resume, { once: true });
    video.addEventListener("pause", save);
    video.addEventListener("ended", save);
    const timer = setInterval(() => {
      if (!video.paused) save();
    }, SAVE_EVERY_MS);

    return () => {
      clearInterval(timer);
      video.removeEventListener("loadedmetadata", resume);
      video.removeEventListener("pause", save);
      video.removeEventListener("ended", save);
      save();
    };
  }, [videoRef, movieId, videoSrc, queryClient, kind]);
}
