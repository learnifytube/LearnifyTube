import React from "react";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Download, Video } from "lucide-react";
import Thumbnail from "@/components/Thumbnail";
import { WatchStateBadge } from "@/components/WatchStateBadge";
import type { WatchState } from "@/lib/watch-state";
import { formatDuration } from "@/pages/library/components/LibraryVideoItem";
import { VideoRowSection } from "./VideoRowSection";

type LibraryVideo = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  channelTitle: string | null;
  durationSeconds: number | null;
  downloadStatus: string | null;
  lastPositionSeconds: number | null;
  watchState: WatchState;
};

type LibraryRowSectionProps = {
  title: string;
  icon: LucideIcon;
  videos: LibraryVideo[];
  isLoading?: boolean;
  emptyTitle: string;
  emptyHint: string;
};

// A Home row of Videos from the Library, each opening in the player
export function LibraryRowSection({
  videos,
  ...section
}: LibraryRowSectionProps): React.JSX.Element {
  return (
    <VideoRowSection {...section} isEmpty={videos.length === 0}>
      {videos.map((video) => (
        <VideoCard key={video.videoId} video={video} />
      ))}
    </VideoRowSection>
  );
}

function VideoCard({ video }: { video: LibraryVideo }): React.JSX.Element {
  const progress =
    video.watchState === "in-progress" && video.durationSeconds
      ? Math.min(100, ((video.lastPositionSeconds ?? 0) / video.durationSeconds) * 100)
      : null;

  return (
    <Link
      to="/player"
      search={{ videoId: video.videoId, playlistId: undefined, playlistIndex: undefined }}
      className="group w-64 flex-shrink-0"
    >
      <div className="relative overflow-hidden rounded-lg">
        <Thumbnail
          thumbnailPath={video.thumbnailPath}
          thumbnailUrl={video.thumbnailUrl}
          alt={video.title}
          className="aspect-video w-full object-cover transition-transform group-hover:scale-105"
          fallbackIcon={<Video className="h-8 w-8 text-muted-foreground" />}
        />

        {/* Duration badge */}
        {video.durationSeconds && (
          <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(video.durationSeconds)}
          </div>
        )}

        <WatchStateBadge watchState={video.watchState} className="absolute left-2 top-2" />
        {video.downloadStatus !== "completed" && (
          <div className="absolute right-2 top-2 rounded bg-amber-600/90 px-1.5 py-0.5 text-xs font-medium text-white">
            <Download className="inline h-3 w-3" />
          </div>
        )}

        {/* How far it was played */}
        {progress !== null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1">
        <h4 className="line-clamp-2 text-sm font-medium leading-tight group-hover:text-primary">
          {video.title}
        </h4>
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {video.channelTitle ?? "Unknown Channel"}
        </p>
      </div>
    </Link>
  );
}
