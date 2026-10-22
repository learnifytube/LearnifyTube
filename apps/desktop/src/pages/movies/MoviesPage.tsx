import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Film, FolderInput, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { WatchStateBadge } from "@/components/WatchStateBadge";
import { formatListeningTime } from "@/pages/audiobooks/format";
import { MoviePoster } from "./components/MoviePoster";
import { MovieImportDialog } from "./components/MovieImportDialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Filter = "all" | "movies" | "series";

export default function MoviesPage(): React.JSX.Element {
  const moviesQuery = useQuery({
    queryKey: ["movies", "list"],
    queryFn: () => trpcClient.movies.list.query(),
  });

  // Pick a folder, then read it for the preview. Nothing is saved yet.
  const startImport = useMutation({
    mutationFn: async () => {
      const folderPath = await trpcClient.movies.pickFolder.mutate();
      if (!folderPath) return null;
      return trpcClient.movies.previewImport.mutate({ folderPath });
    },
    onError: () => toast.error("Couldn't read that folder"),
  });

  const seriesQuery = useQuery({
    queryKey: ["movies", "series", "list"],
    queryFn: () => trpcClient.movies.series.list.query(),
  });
  const [filter, setFilter] = useState<Filter>("all");

  const movies = filter === "series" ? [] : (moviesQuery.data ?? []);
  const seriesList = filter === "movies" ? [] : (seriesQuery.data ?? []);
  const isLoading = moviesQuery.isLoading || seriesQuery.isLoading;
  const isEmpty = (moviesQuery.data ?? []).length === 0 && (seriesQuery.data ?? []).length === 0;

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Movies</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading..."
              : `${moviesQuery.data?.length ?? 0} Movies · ${seriesQuery.data?.length ?? 0} Series`}
          </p>
        </div>
        <Button
          onClick={() => startImport.mutate()}
          disabled={startImport.isPending}
          className="gap-2"
        >
          {startImport.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FolderInput className="h-4 w-4" />
          )}
          {startImport.isPending ? "Reading folder..." : "Import"}
        </Button>
      </div>

      {!isEmpty && (
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)} className="mt-4">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="movies">Movies</TabsTrigger>
            <TabsTrigger value="series">Series</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {!isLoading && isEmpty ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Film className="h-10 w-10" />
          <p className="max-w-sm text-sm">
            Import a folder of video files from your computer. Your files stay where they are.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {seriesList.map((series) => (
            <Link
              key={series.id}
              to="/series"
              search={{ id: series.id }}
              className="group relative block"
            >
              <MoviePoster
                posterPath={series.posterPath}
                title={series.title}
                className="transition-transform group-hover:scale-105"
              />
              <WatchStateBadge watchState={series.watchState} className="absolute left-2 top-2" />
              <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-tight group-hover:text-primary">
                {series.title}
              </h3>
              <p className="truncate text-xs text-muted-foreground">
                Series · {series.seasonCount === 1 ? "1 Season" : `${series.seasonCount} Seasons`} ·{" "}
                {series.episodeCount === 1 ? "1 Episode" : `${series.episodeCount} Episodes`}
              </p>
            </Link>
          ))}
          {movies.map((movie) => (
            <Link
              key={movie.id}
              to="/movie"
              search={{ id: movie.id }}
              className="group relative block"
            >
              <MoviePoster
                posterPath={movie.posterPath}
                title={movie.title}
                className="transition-transform group-hover:scale-105"
              />
              <WatchStateBadge watchState={movie.watchState} className="absolute left-2 top-2" />
              <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-tight group-hover:text-primary">
                {movie.title}
              </h3>
              <p className="truncate text-xs text-muted-foreground">
                {movie.missing ? "File missing" : formatListeningTime(movie.durationSeconds)}
              </p>
            </Link>
          ))}
        </div>
      )}

      {startImport.data && (
        <MovieImportDialog
          key={startImport.data.folderPath}
          preview={startImport.data}
          onClose={() => startImport.reset()}
        />
      )}
    </PageContainer>
  );
}
