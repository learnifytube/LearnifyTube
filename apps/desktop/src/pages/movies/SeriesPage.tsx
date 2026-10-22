import React, { useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Pencil, Play, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { toLocalFileUrl } from "@/helpers/localFile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/ui/page-container";
import { WatchStateBadge } from "@/components/WatchStateBadge";
import { VideoPlayer } from "@/pages/player/components/VideoPlayer";
import type { EpisodesTarget, SeriesDetail, SeriesEpisode } from "@/api/movies/series-catalog";
import { episodeAfter } from "../../../../shared/series/nextUp";
import { MoviePoster } from "./components/MoviePoster";
import { SeriesSeasons } from "./components/SeriesSeasons";
import { ShownOnDevicesSwitch } from "./components/ShownOnDevicesSwitch";
import { ChoosePosterButton } from "./components/ChoosePosterButton";
import { useMovieProgress } from "./useMovieProgress";
import { useCaptionTracks } from "./useCaptionTracks";

// Plays one Episode from its Watch progress; mounted once per Episode.
function EpisodePlayer({
  episode,
  onEnded,
}: {
  episode: SeriesEpisode;
  onEnded: () => void;
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [unplayable, setUnplayable] = useState(false);
  const videoSrc = toLocalFileUrl(episode.filePath);
  // Playing it pauses the Book player, as any Video does.
  useMovieProgress(videoRef, episode, videoSrc, "episode");
  const captions = useCaptionTracks("episode", episode.id);
  if (unplayable) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded border bg-muted text-sm text-muted-foreground">
        This file can&apos;t be played here. The desktop doesn&apos;t support its format.
      </div>
    );
  }
  return (
    <VideoPlayer
      videoRef={videoRef}
      videoSrc={videoSrc}
      onTimeUpdate={() => undefined}
      onError={() => setUnplayable(true)}
      onEnded={onEnded}
      captions={captions}
      className="max-h-[70vh]"
    />
  );
}

function SeriesView({ series }: { series: SeriesDetail }): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const inOrder = series.seasons.flatMap((season) => season.episodes);
  const playing = inOrder.find((episode) => episode.id === playingId) ?? null;
  const upNext = inOrder.find((episode) => episode.id === series.nextUpEpisodeId) ?? null;

  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ["movies"] });

  const setWatched = useMutation({
    mutationFn: ({ target, watched }: { target: EpisodesTarget; watched: boolean }) =>
      trpcClient.movies.series.setWatched.mutate({ target, watched }),
    onSuccess: refresh,
  });

  const rename = useMutation({
    mutationFn: (title: string) => trpcClient.movies.series.rename.mutate({ id: series.id, title }),
    onSuccess: async () => {
      setEditingTitle(null);
      await refresh();
    },
    onError: () => toast.error("Couldn't rename the Series"),
  });

  const move = useMutation({
    mutationFn: ({
      target,
      by,
    }: {
      target: { seasonId: string } | { episodeId: string };
      by: -1 | 1;
    }) =>
      "seasonId" in target
        ? trpcClient.movies.series.moveSeason.mutate({ id: target.seasonId, by })
        : trpcClient.movies.series.moveEpisode.mutate({ id: target.episodeId, by }),
    onSuccess: refresh,
    onError: () => toast.error("Couldn't change the order"),
  });

  const rescan = useMutation({
    mutationFn: () => trpcClient.movies.series.rescan.mutate({ id: series.id }),
    onSuccess: async ({ added, missing }) => {
      await refresh();
      const parts = [
        added > 0 ? `${added} new Episode${added === 1 ? "" : "s"}` : "No new Episodes",
        ...(missing > 0 ? [`${missing} missing`] : []),
      ];
      toast.success(parts.join(", "));
    },
    onError: () => toast.error("Couldn't rescan the Series"),
  });

  const forget = useMutation({
    mutationFn: () => trpcClient.movies.series.forget.mutate({ id: series.id }),
    onSuccess: async () => {
      await refresh();
      toast.success("Removed from Movies. Your files were not touched.");
      await navigate({ to: "/movies" });
    },
  });

  const seriesWatched = series.watchState === "watched";

  return (
    <div className="space-y-4">
      {playing && (
        <EpisodePlayer
          key={playing.id}
          episode={playing}
          // The next Episode plays by itself.
          onEnded={() => setPlayingId(episodeAfter(inOrder, playing.id)?.id ?? null)}
        />
      )}

      <div className="flex flex-wrap items-start gap-4">
        {!playing && (
          <div className="w-32 shrink-0">
            <MoviePoster posterPath={series.posterPath} title={series.title} />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          {editingTitle === null ? (
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-bold">
                {playing ? `${series.title} · ${playing.title}` : series.title}
              </h1>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit title"
                onClick={() => setEditingTitle(series.title)}
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
                Save
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditingTitle(null)}>
                Cancel
              </Button>
            </form>
          )}
          <WatchStateBadge watchState={series.watchState} />
          <ShownOnDevicesSwitch kind="series" id={series.id} shown={series.shownOnDevices} />
          <div className="flex flex-wrap gap-2">
            {upNext && upNext.id !== playingId && (
              <Button className="gap-2" onClick={() => setPlayingId(upNext.id)}>
                <Play className="h-4 w-4" />
                {upNext.watchState === "in-progress" ? "Resume" : "Play"} {upNext.title}
              </Button>
            )}
            <Button
              variant="outline"
              className="gap-2"
              disabled={setWatched.isPending}
              onClick={() =>
                setWatched.mutate({ target: { seriesId: series.id }, watched: !seriesWatched })
              }
            >
              {seriesWatched ? (
                <Circle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {seriesWatched ? "Mark Series unwatched" : "Mark Series watched"}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              disabled={rescan.isPending}
              onClick={() => rescan.mutate()}
            >
              <RefreshCw className={rescan.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Rescan
            </Button>
            <ChoosePosterButton kind="series" id={series.id} />
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
      </div>

      <SeriesSeasons
        seasons={series.seasons}
        playingId={playingId}
        marking={setWatched.isPending}
        moving={move.isPending}
        onPlay={setPlayingId}
        onMark={(target, watched) => setWatched.mutate({ target, watched })}
        onMove={(target, by) => move.mutate({ target, by })}
      />
    </div>
  );
}

export default function SeriesPage(): React.JSX.Element {
  const { id } = useSearch({ from: "/series" });
  const seriesQuery = useQuery({
    queryKey: ["movies", "series", "get", id],
    queryFn: () => trpcClient.movies.series.get.query({ id }),
    enabled: !!id,
  });

  return (
    <PageContainer>
      {seriesQuery.isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : seriesQuery.data ? (
        <SeriesView key={seriesQuery.data.id} series={seriesQuery.data} />
      ) : (
        <p className="text-sm text-muted-foreground">This Series is no longer in Movies.</p>
      )}
    </PageContainer>
  );
}
