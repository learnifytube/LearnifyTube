import React from "react";
import { CheckCircle2, Circle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WatchStateBadge } from "@/components/WatchStateBadge";
import { cn } from "@/lib/utils";
import type { EpisodesTarget, SeriesSeason } from "@/api/movies/series-catalog";
import { formatListeningTime } from "@/pages/audiobooks/format";
import { SeasonOnDevices } from "./SeasonOnDevices";
import { MoveButtons } from "./ImportPreviewParts";

function MarkButton({
  watched,
  label,
  disabled,
  onMark,
}: {
  watched: boolean;
  label: string;
  disabled: boolean;
  onMark: (watched: boolean) => void;
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5"
      disabled={disabled}
      aria-label={`${watched ? "Mark unwatched" : "Mark watched"}: ${label}`}
      onClick={() => onMark(!watched)}
    >
      {watched ? <Circle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
      {watched ? "Mark unwatched" : "Mark watched"}
    </Button>
  );
}

// A Series' Seasons and Episodes with their Watch state; any Episode can be played or
// marked, and a Season or an Episode (within its Season) moved up or down.
export function SeriesSeasons({
  seasons,
  playingId,
  marking,
  moving,
  onPlay,
  onMark,
  onMove,
}: {
  seasons: SeriesSeason[];
  playingId: string | null;
  marking: boolean;
  moving: boolean;
  onPlay: (episodeId: string) => void;
  onMark: (target: EpisodesTarget, watched: boolean) => void;
  onMove: (target: { seasonId: string } | { episodeId: string }, by: -1 | 1) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      {seasons.map((season) => (
        <section key={season.id} className="rounded-lg border">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <MoveButtons
                label={season.title}
                disabled={moving}
                onMove={(by) => onMove({ seasonId: season.id }, by)}
              />
              <h2 className="font-semibold">{season.title}</h2>
              <WatchStateBadge watchState={season.watchState} />
            </div>
            <MarkButton
              watched={season.watchState === "watched"}
              label={season.title}
              disabled={marking}
              onMark={(watched) => onMark({ seasonId: season.id }, watched)}
            />
          </div>
          <div className="border-b px-3 py-2">
            <SeasonOnDevices id={season.id} sentToDevices={season.sentToDevices} />
          </div>
          <ol className="divide-y">
            {season.episodes.map((episode) => (
              <li
                key={episode.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2",
                  episode.id === playingId && "bg-muted"
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Play ${episode.title}`}
                  disabled={episode.missing}
                  onClick={() => onPlay(episode.id)}
                >
                  <Play className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{episode.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {episode.missing
                      ? "File missing"
                      : formatListeningTime(episode.durationSeconds)}
                  </p>
                </div>
                <WatchStateBadge watchState={episode.watchState} />
                <MoveButtons
                  label={episode.title}
                  disabled={moving}
                  onMove={(by) => onMove({ episodeId: episode.id }, by)}
                />
                <MarkButton
                  watched={episode.watchState === "watched"}
                  label={episode.title}
                  disabled={marking}
                  onMark={(watched) => onMark({ episodeId: episode.id }, watched)}
                />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
