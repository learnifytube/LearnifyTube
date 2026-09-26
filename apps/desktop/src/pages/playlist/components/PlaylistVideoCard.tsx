import React from "react";

export interface PlaylistVideo {
  videoId: string;
  title: string;
  url: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  durationSeconds?: number | null;
  viewCount?: number | null;
  downloadStatus?: string | null;
  downloadFilePath?: string | null;
}

export function PlaylistVideoCardSkeleton(): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl bg-card">
      <div className="aspect-video w-full animate-pulse bg-muted" />
      <div className="space-y-2 p-3">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
