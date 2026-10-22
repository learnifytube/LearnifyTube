import React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import type { CodecWarning } from "@/api/movies/codec-warnings";
import type { PosterSource } from "@/api/movies/import-plan";
import { MoviePoster } from "./MoviePoster";

// A poster the Import would save, read from the previewed folder.
export function PreviewPoster({
  folderPath,
  poster,
  durationSeconds,
  title,
}: {
  folderPath: string;
  poster: PosterSource;
  durationSeconds: number | null;
  title: string;
}): React.JSX.Element {
  const preview = useQuery({
    queryKey: ["movies", "previewPoster", folderPath, poster],
    queryFn: () => trpcClient.movies.previewPoster.query({ folderPath, poster, durationSeconds }),
    staleTime: Infinity,
  });
  return <MoviePoster posterDataUrl={preview.data} title={title} />;
}

const PART_LABELS: Record<CodecWarning["part"], string> = {
  container: "file type",
  video: "video",
  audio: "audio",
};

// Import only warns; the file is saved as it is and may still play on some Devices.
export function CodecWarnings({
  warnings,
}: {
  warnings: CodecWarning[];
}): React.JSX.Element | null {
  if (warnings.length === 0) return null;
  const parts = warnings.map((warning) => `${warning.name} ${PART_LABELS[warning.part]}`);
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      May not play on Android phones and TVs: {parts.join(", ")}.
    </p>
  );
}
