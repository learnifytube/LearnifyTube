import { useQuery } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";

export type PlayerCaption = { id: string; label: string; language: string | null; src: string };

/**
 * A Movie's or Episode's sidecar Captions as <track> sources. Each is a data:
 * URL of WebVTT, which the CSP's media-src allows and Chromium reads as same-origin.
 */
export const useCaptionTracks = (kind: "movie" | "episode", id: string): PlayerCaption[] => {
  const query = useQuery({
    queryKey: ["movies", "captions", kind, id],
    queryFn: () => trpcClient.movies.captions.query({ kind, id }),
  });
  return (query.data ?? []).map(({ vtt, ...caption }) => ({
    ...caption,
    src: `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`,
  }));
};
