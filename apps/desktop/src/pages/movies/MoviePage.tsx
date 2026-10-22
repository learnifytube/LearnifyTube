import React, { useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { toLocalFileUrl } from "@/helpers/localFile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/ui/page-container";
import { WatchStateBadge } from "@/components/WatchStateBadge";
import { VideoPlayer } from "@/pages/player/components/VideoPlayer";
import { formatListeningTime } from "@/pages/audiobooks/format";
import { watchStateOf } from "@/api/movies/watch-progress";
import { ShownOnDevicesSwitch } from "./components/ShownOnDevicesSwitch";
import { useMovieProgress } from "./useMovieProgress";
import { useCaptionTracks } from "./useCaptionTracks";
import { MovieOnDevices } from "./components/MovieOnDevices";
import { ChoosePosterButton } from "./components/ChoosePosterButton";

type Movie = NonNullable<Awaited<ReturnType<typeof trpcClient.movies.get.query>>>;

function MovieView({ movie }: { movie: Movie }): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [unplayable, setUnplayable] = useState(false);
  const videoSrc = movie.missing ? null : toLocalFileUrl(movie.filePath);
  // Playing it pauses the Book player, as any Video does.
  useMovieProgress(videoRef, movie, videoSrc);
  const captions = useCaptionTracks("movie", movie.id);

  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ["movies"] });

  const rename = useMutation({
    mutationFn: (title: string) => trpcClient.movies.rename.mutate({ id: movie.id, title }),
    onSuccess: async () => {
      setEditingTitle(null);
      await refresh();
    },
    onError: () => toast.error("Couldn't rename the Movie"),
  });

  const watchState = watchStateOf(movie);
  const setWatched = useMutation({
    mutationFn: (watched: boolean) =>
      trpcClient.movies.setWatched.mutate({ id: movie.id, watched }),
    onSuccess: refresh,
  });

  const forget = useMutation({
    mutationFn: () => trpcClient.movies.forget.mutate({ id: movie.id }),
    onSuccess: async () => {
      await refresh();
      toast.success("Removed from Movies. Your file was not touched.");
      await navigate({ to: "/movies" });
    },
  });

  return (
    <div className="space-y-4">
      {videoSrc && !unplayable ? (
        <VideoPlayer
          videoRef={videoRef}
          videoSrc={videoSrc}
          onTimeUpdate={() => undefined}
          onError={() => setUnplayable(true)}
          captions={captions}
          className="max-h-[70vh]"
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded border bg-muted text-sm text-muted-foreground">
          {movie.missing
            ? "This Movie's file is missing."
            : "This file can't be played here. The desktop doesn't support its format."}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {editingTitle === null ? (
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-bold">{movie.title}</h1>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit title"
                onClick={() => setEditingTitle(movie.title)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <form
              className="flex max-w-xl gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (editingTitle.trim()) rename.mutate(editingTitle);
              }}
            >
              <Input
                aria-label="Title"
                autoFocus
                value={editingTitle}
                onChange={(event) => setEditingTitle(event.target.value)}
              />
              <Button type="submit" disabled={!editingTitle.trim() || rename.isPending}>
                {rename.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditingTitle(null)}>
                Cancel
              </Button>
            </form>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <WatchStateBadge watchState={watchState} />
            <span>{formatListeningTime(movie.durationSeconds)}</span>
          </div>
          <p className="break-all text-xs text-muted-foreground">{movie.filePath}</p>
          <ShownOnDevicesSwitch kind="movie" id={movie.id} shown={movie.shownOnDevices} />
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            disabled={setWatched.isPending}
            onClick={() => setWatched.mutate(watchState !== "watched")}
          >
            {watchState === "watched" ? (
              <Circle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {watchState === "watched" ? "Mark unwatched" : "Mark watched"}
          </Button>
          <ChoosePosterButton kind="movie" id={movie.id} />
          <Button
            variant="outline"
            className="gap-2"
            disabled={forget.isPending}
            onClick={() => forget.mutate()}
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        </div>
      </div>

      <MovieOnDevices id={movie.id} sentToDevices={movie.sentToDevices} />
    </div>
  );
}

export default function MoviePage(): React.JSX.Element {
  const { id } = useSearch({ from: "/movie" });
  const movieQuery = useQuery({
    queryKey: ["movies", "get", id],
    queryFn: () => trpcClient.movies.get.query({ id }),
    enabled: !!id,
  });

  return (
    <PageContainer>
      {movieQuery.isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : movieQuery.data ? (
        <MovieView key={movieQuery.data.id} movie={movieQuery.data} />
      ) : (
        <p className="text-sm text-muted-foreground">This Movie is no longer in Movies.</p>
      )}
    </PageContainer>
  );
}
