import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MovieLayout } from "@/api/movies/import-plan";
import { formatListeningTime } from "@/pages/audiobooks/format";
import { MoviePoster } from "./MoviePoster";

type ImportPreview = Awaited<ReturnType<typeof trpcClient.movies.previewImport.mutate>>;
type PreviewMovie = ImportPreview["plans"][MovieLayout][number];

function PreviewPoster({
  folderPath,
  movie,
}: {
  folderPath: string;
  movie: PreviewMovie;
}): React.JSX.Element {
  const poster = useQuery({
    queryKey: ["movies", "previewPoster", folderPath, movie.poster],
    queryFn: () =>
      trpcClient.movies.previewPoster.query({
        folderPath,
        poster: movie.poster,
        durationSeconds: movie.durationSeconds,
      }),
    staleTime: Infinity,
  });
  return <MoviePoster posterDataUrl={poster.data} title={movie.title} />;
}

// Shows what Import would create; nothing is saved until the user confirms.
export function MovieImportDialog({
  preview,
  onClose,
}: {
  preview: ImportPreview;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [layout, setLayout] = useState<MovieLayout>(preview.suggestedLayout);
  // Edited titles by layout and then video path; untouched Movies keep their planned title.
  const [titles, setTitles] = useState<Record<MovieLayout, Record<string, string>>>({
    "one-movie": {},
    "movie-per-file": {},
  });
  const movies = preview.plans[layout];
  const { folder } = preview;

  const confirm = useMutation({
    mutationFn: () =>
      trpcClient.movies.confirmImport.mutate({
        folderPath: preview.folderPath,
        layout,
        titles: titles[layout],
      }),
    onSuccess: async ({ ids }) => {
      await queryClient.invalidateQueries({ queryKey: ["movies", "list"] });
      toast.success(ids.length === 1 ? "Imported 1 Movie" : `Imported ${ids.length} Movies`);
      onClose();
    },
    onError: () => toast.error("Import failed"),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !confirm.isPending && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Import Movies</DialogTitle>
          <DialogDescription className="break-all">{preview.folderPath}</DialogDescription>
        </DialogHeader>

        {folder.mixed && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            This folder mixes {folder.videoFiles} video and {folder.audioFiles} audio files. Only
            the video files are imported as Movies; import the audio from Audiobooks.
          </p>
        )}

        <Tabs value={layout} onValueChange={(value) => setLayout(value as MovieLayout)}>
          <TabsList>
            <TabsTrigger value="one-movie">One Movie</TabsTrigger>
            <TabsTrigger value="movie-per-file">One Movie per file</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {movies.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {folder.kind === "audiobooks"
                ? "This folder holds audio files. Import it from Audiobooks."
                : "No video files found in this folder."}
            </p>
          )}
          {movies.map((movie) => (
            <div key={movie.path} className="flex gap-4 rounded-lg border p-3">
              <div className="w-20 shrink-0">
                <PreviewPoster folderPath={preview.folderPath} movie={movie} />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  aria-label="Title"
                  value={titles[layout][movie.path] ?? movie.title}
                  onChange={(event) =>
                    setTitles((current) => ({
                      ...current,
                      [layout]: { ...current[layout], [movie.path]: event.target.value },
                    }))
                  }
                />
                <p className="truncate text-xs text-muted-foreground" title={movie.path}>
                  {[movie.path, formatListeningTime(movie.durationSeconds)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={confirm.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => confirm.mutate()}
            disabled={movies.length === 0 || confirm.isPending}
            className="gap-2"
          >
            {confirm.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {movies.length === 1 ? "Import 1 Movie" : `Import ${movies.length} Movies`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
