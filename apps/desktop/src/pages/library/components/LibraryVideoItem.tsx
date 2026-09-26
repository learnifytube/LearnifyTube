import React from "react";
import { Link } from "@tanstack/react-router";
import { Video } from "lucide-react";
import Thumbnail from "@/components/Thumbnail";
import { VideoActionsMenu, WatchStateBadge } from "@/components/WatchStateBadge";
import { PHONE_LIST_ID } from "@/lib/lists";
import type { LibraryVideo } from "../library-view";

export type LibraryItem = LibraryVideo & {
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  downloadStatus: string | null;
  downloadProgress: number | null;
  lastPositionSeconds: number | null;
};

const PLAYER_SEARCH = { playlistId: undefined, playlistIndex: undefined };

export function LibraryVideoCard({ video }: { video: LibraryItem }): React.JSX.Element {
  return (
    <div className="group relative">
      <Link to="/player" search={{ videoId: video.videoId, ...PLAYER_SEARCH }} className="block">
        <div className="relative overflow-hidden rounded-lg">
          <Thumbnail
            thumbnailPath={video.thumbnailPath}
            thumbnailUrl={video.thumbnailUrl}
            alt={video.title}
            className="aspect-video w-full object-cover transition-transform group-hover:scale-105"
            fallbackIcon={<Video className="h-8 w-8 text-muted-foreground" />}
          />
          <WatchStateBadge watchState={video.watchState} className="absolute left-2 top-2" />
          <FetchStatus video={video} className="absolute right-2 top-2" />
          {video.durationSeconds ? (
            <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
              {formatDuration(video.durationSeconds)}
            </span>
          ) : null}
          <ProgressBar video={video} />
        </div>
      </Link>
      <div className="mt-2 flex items-start gap-1">
        <Link
          to="/player"
          search={{ videoId: video.videoId, ...PLAYER_SEARCH }}
          className="min-w-0 flex-1 space-y-1"
        >
          <h3 className="line-clamp-2 text-sm font-medium leading-tight group-hover:text-primary">
            {video.title}
          </h3>
          <p className="truncate text-xs text-muted-foreground">{video.channelTitle}</p>
        </Link>
        <VideoActionsMenu
          videoId={video.videoId}
          watchState={video.watchState}
          onPhoneList={video.listIds.includes(PHONE_LIST_ID)}
        />
      </div>
    </div>
  );
}

export function LibraryVideoRow({ video }: { video: LibraryItem }): React.JSX.Element {
  return (
    <div className="group flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50">
      <Link
        to="/player"
        search={{ videoId: video.videoId, ...PLAYER_SEARCH }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="relative w-40 shrink-0 overflow-hidden rounded-md">
          <Thumbnail
            thumbnailPath={video.thumbnailPath}
            thumbnailUrl={video.thumbnailUrl}
            alt={video.title}
            className="aspect-video w-full object-cover"
            fallbackIcon={<Video className="h-6 w-6 text-muted-foreground" />}
          />
          <ProgressBar video={video} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="line-clamp-2 text-sm font-medium group-hover:text-primary">
            {video.title}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {video.channelTitle}
            {video.durationSeconds ? ` · ${formatDuration(video.durationSeconds)}` : ""}
          </p>
          <div className="flex items-center gap-2">
            <WatchStateBadge watchState={video.watchState} />
            <FetchStatus video={video} />
          </div>
        </div>
      </Link>
      <VideoActionsMenu
        videoId={video.videoId}
        watchState={video.watchState}
        onPhoneList={video.listIds.includes(PHONE_LIST_ID)}
      />
    </div>
  );
}

// A kept Video that is still on its way shows how far the fetch has got.
function FetchStatus({
  video,
  className,
}: {
  video: LibraryItem;
  className?: string;
}): React.JSX.Element | null {
  if (video.downloadStatus === "completed") return null;
  const failed = video.downloadStatus === "failed";
  const label = failed
    ? "Failed"
    : video.downloadStatus === "downloading"
      ? `Fetching ${video.downloadProgress ?? 0}%`
      : video.downloadStatus === "paused"
        ? "Paused"
        : "Queued";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium text-white ${
        failed ? "bg-destructive" : "bg-amber-600/90"
      } ${className ?? ""}`}
    >
      {label}
    </span>
  );
}

function ProgressBar({ video }: { video: LibraryItem }): React.JSX.Element | null {
  if (video.watchState !== "in-progress" || !video.durationSeconds) return null;
  const percent = Math.min(100, ((video.lastPositionSeconds ?? 0) / video.durationSeconds) * 100);
  return (
    <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
      <div className="h-full bg-blue-500" style={{ width: `${percent}%` }} />
    </div>
  );
}

export const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mmss = `${m.toString().padStart(h > 0 ? 2 : 1, "0")}:${s.toString().padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
};
