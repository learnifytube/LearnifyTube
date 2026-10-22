import React from "react";
import { Button } from "@/components/ui/button";
import {
  Play,
  RotateCcw,
  RefreshCw,
  ListVideo,
  CheckCircle2,
  Download,
  Loader2,
} from "lucide-react";
import Thumbnail from "@/components/Thumbnail";

interface PlaylistHeaderProps {
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  itemCount: number;
  /** The Current Video's place in the List; null when none is set. */
  currentVideoIndex: number | null;
  downloadedCount: number;
  isRefreshing: boolean;
  lastUpdated?: number;
  /** Plays where the List picks up (the Current Video, or the next unwatched one). */
  onResume: () => void;
  onPlayFromStart: () => void;
  onRefresh: () => void;
}

export function PlaylistHeader({
  title,
  description,
  thumbnailUrl,
  thumbnailPath,
  itemCount,
  currentVideoIndex,
  downloadedCount,
  isRefreshing,
  lastUpdated,
  onResume,
  onPlayFromStart,
  onRefresh,
}: PlaylistHeaderProps): React.JSX.Element {
  const progress =
    itemCount > 0 && currentVideoIndex !== null
      ? Math.round((currentVideoIndex / itemCount) * 100)
      : 0;
  const notDownloadedCount = itemCount - downloadedCount;
  const allDownloaded = notDownloadedCount === 0 && itemCount > 0;
  const hideNoThumb = typeof thumbnailUrl === "string" && thumbnailUrl.includes("no_thumbnail");

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-background to-background">
      {/* Background blur effect */}
      <div className="absolute inset-0 overflow-hidden">
        {!hideNoThumb && thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            className="h-full w-full object-cover opacity-10 blur-3xl"
          />
        )}
      </div>

      <div className="relative p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          {/* Thumbnail */}
          <div className="relative shrink-0 overflow-hidden rounded-xl shadow-xl md:w-72">
            {hideNoThumb ? (
              <div className="flex aspect-video w-full items-center justify-center bg-muted">
                <ListVideo className="h-12 w-12 text-muted-foreground" />
              </div>
            ) : (
              <Thumbnail
                thumbnailPath={thumbnailPath}
                thumbnailUrl={thumbnailUrl}
                alt={title}
                className="aspect-video w-full object-cover"
              />
            )}

            {/* Playlist badge overlay */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
              <div className="flex items-center gap-1.5 text-white">
                <ListVideo className="h-4 w-4" />
                <span className="text-sm font-medium">{itemCount} videos</span>
              </div>
              {progress > 0 && <span className="text-xs text-white/80">{progress}% watched</span>}
            </div>
          </div>

          {/* Info */}
          <div className="flex flex-1 flex-col gap-4">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold leading-tight">{title}</h1>
              {description && (
                <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              )}
            </div>

            {/* Stats row */}
            <div className="flex flex-wrap items-center gap-3">
              <StatPill
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                value={downloadedCount}
                label="saved"
                variant={allDownloaded ? "success" : "default"}
              />
              {notDownloadedCount > 0 && (
                <StatPill
                  icon={<Download className="h-3.5 w-3.5" />}
                  value={notDownloadedCount}
                  label="to download"
                  variant="outline"
                />
              )}
              {progress > 0 && (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">{progress}%</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={onResume} className="gap-2">
                <Play className="h-4 w-4" fill="currentColor" />
                {currentVideoIndex !== null ? "Resume" : "Play"}
              </Button>
              <Button variant="outline" onClick={onPlayFromStart} className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Play from start
              </Button>
              <Button
                variant="outline"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="gap-2"
              >
                {isRefreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
            </div>

            {/* Last updated */}
            {lastUpdated && lastUpdated > 0 && (
              <p className="text-xs text-muted-foreground">
                Last updated: {new Date(lastUpdated).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatPillProps {
  icon: React.ReactNode;
  value: number;
  label: string;
  variant?: "default" | "success" | "outline";
}

function StatPill({ icon, value, label, variant = "default" }: StatPillProps): React.JSX.Element {
  const baseClasses =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium";
  const variantClasses = {
    default: "bg-primary/10 text-primary",
    success: "bg-green-500/10 text-green-600 dark:text-green-400",
    outline: "border border-border bg-background text-muted-foreground",
  };

  return (
    <div className={`${baseClasses} ${variantClasses[variant]}`}>
      {icon}
      <span>{value}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}

export function PlaylistHeaderSkeleton(): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-primary/5 via-background to-background p-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="aspect-video w-full animate-pulse rounded-xl bg-muted md:w-72" />
        <div className="flex flex-1 flex-col gap-4">
          <div className="space-y-2">
            <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex gap-3">
            <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
            <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="flex gap-3">
            <div className="h-10 w-36 animate-pulse rounded-lg bg-muted" />
            <div className="h-10 w-24 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}
