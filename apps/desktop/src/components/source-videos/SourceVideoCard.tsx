import React from "react";
import { CheckCircle2, Circle, CircleCheck, Loader2, Play, Video } from "lucide-react";
import Thumbnail from "@/components/Thumbnail";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { SourceVideoState } from "@/lib/source-video-state";
import { formatDuration } from "@/pages/library/components/LibraryVideoItem";
import { KeepButton, type ListOption } from "./KeepButton";

export type SourceVideo = {
  videoId: string;
  title: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  durationSeconds?: number | null;
  subtitle?: React.ReactNode;
};

const STATE_BADGES = {
  "not-kept": { label: "Not kept", icon: Circle, className: "bg-black/60 text-white" },
  keeping: { label: "Keeping", icon: Loader2, className: "bg-blue-600/90 text-white" },
  kept: { label: "Kept", icon: CircleCheck, className: "bg-green-600/90 text-white" },
  watched: { label: "Watched", icon: CheckCircle2, className: "bg-zinc-700/90 text-white" },
} satisfies Record<SourceVideoState, unknown>;

export function SourceVideoCard({
  video,
  state,
  progress,
  isSelected,
  isKeeping,
  lists,
  onPlay,
  onToggleSelect,
  onKeep,
}: {
  video: SourceVideo;
  state: SourceVideoState;
  progress: number | null;
  isSelected: boolean;
  isKeeping: boolean;
  lists: ListOption[];
  onPlay: () => void;
  onToggleSelect: () => void;
  onKeep: (listId?: string) => void;
}): React.JSX.Element {
  const badge = STATE_BADGES[state];
  const isNotKept = state === "not-kept";
  const hideNoThumb =
    typeof video.thumbnailUrl === "string" && video.thumbnailUrl.includes("no_thumbnail");

  return (
    <div
      id={`source-video-${video.videoId}`}
      className={cn(
        "group cursor-pointer scroll-mt-24 overflow-hidden rounded-xl bg-card transition-colors",
        isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "hover:bg-accent",
        !isNotKept && "opacity-80"
      )}
      onClick={onPlay}
    >
      <div className="relative">
        {hideNoThumb ? (
          <div className="flex aspect-video w-full items-center justify-center bg-muted">
            <Video className="h-8 w-8 text-muted-foreground" />
          </div>
        ) : (
          <Thumbnail
            thumbnailPath={video.thumbnailPath}
            thumbnailUrl={video.thumbnailUrl}
            alt={video.title}
            className="aspect-video w-full object-cover transition-transform group-hover:scale-105"
            fallbackIcon={<Video className="h-8 w-8 text-muted-foreground" />}
          />
        )}

        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <div className="scale-0 rounded-full bg-primary p-3 text-primary-foreground transition-transform group-hover:scale-100">
            <Play className="h-5 w-5" fill="currentColor" />
          </div>
        </div>

        <span
          className={cn(
            "absolute left-2 top-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
            badge.className
          )}
        >
          <badge.icon className={cn("h-3 w-3", state === "keeping" && "animate-spin")} />
          {badge.label}
          {state === "keeping" && progress ? ` ${Math.round(progress)}%` : null}
        </span>

        {isNotKept && (
          <div
            className={cn(
              "absolute right-2 top-2 transition-opacity",
              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelect}
              aria-label={`Select ${video.title}`}
              className="h-5 w-5 border-2 border-white bg-black/50 data-[state=checked]:border-primary data-[state=checked]:bg-primary"
            />
          </div>
        )}

        {typeof video.durationSeconds === "number" && (
          <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(video.durationSeconds)}
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">
            {video.title}
          </h3>
          {video.subtitle && (
            <div className="line-clamp-1 text-xs text-muted-foreground">{video.subtitle}</div>
          )}
        </div>
        {isNotKept && <KeepButton lists={lists} isKeeping={isKeeping} onKeep={onKeep} />}
      </div>
    </div>
  );
}
