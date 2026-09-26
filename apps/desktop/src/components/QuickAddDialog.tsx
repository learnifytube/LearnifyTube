import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { toast } from "sonner";
import { logger } from "@/helpers/logger";
import { extractYoutubePlaylistReference } from "@/lib/youtube-url";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download,
  CheckCircle2,
  Loader2,
  Video,
  List as ListIcon,
  Users,
  Clock,
} from "lucide-react";
import Thumbnail from "@/components/Thumbnail";

type QuickAddDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const isValidUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol);
  } catch {
    return false;
  }
};

const isChannelUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("youtube.com")) return false;
    const pathname = u.pathname;
    return (
      /^\/@[^/]+/.test(pathname) ||
      /^\/channel\/[^/]+/.test(pathname) ||
      /^\/c\/[^/]+/.test(pathname) ||
      /^\/user\/[^/]+/.test(pathname)
    );
  } catch {
    return false;
  }
};

const isVideoUrl = (url: string): boolean => {
  if (!isValidUrl(url)) return false;
  // Not a channel URL and not a playlist-only URL
  if (isChannelUrl(url)) return false;
  try {
    const u = new URL(url);
    // YouTube video URLs contain watch?v= or youtu.be/
    if (u.hostname.includes("youtube.com") && u.pathname === "/watch" && u.searchParams.has("v")) {
      return true;
    }
    if (u.hostname === "youtu.be" && u.pathname.length > 1) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

const normalizeChannelUrl = (url: string): string => {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("youtube.com")) return url;
    const pathname = u.pathname;
    let basePath = pathname;

    const atMatch = pathname.match(/^\/@([^/]+)/);
    if (atMatch) {
      basePath = `/@${atMatch[1]}`;
    } else if (/^\/channel\/[^/]+/.test(pathname)) {
      const channelMatch = pathname.match(/^\/channel\/([^/]+)/);
      if (channelMatch) {
        basePath = `/channel/${channelMatch[1]}`;
      }
    } else if (/^\/c\/[^/]+/.test(pathname)) {
      const cMatch = pathname.match(/^\/c\/([^/]+)/);
      if (cMatch) {
        basePath = `/c/${cMatch[1]}`;
      }
    } else if (/^\/user\/[^/]+/.test(pathname)) {
      const userMatch = pathname.match(/^\/user\/([^/]+)/);
      if (userMatch) {
        basePath = `/user/${userMatch[1]}`;
      }
    }

    u.pathname = basePath;
    u.search = "";
    return u.toString();
  } catch {
    return url;
  }
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

type VideoPreview = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  channelId: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
};

export function QuickAddDialog({ open, onOpenChange }: QuickAddDialogProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<VideoPreview | null>(null);
  const [lastFetchedUrl, setLastFetchedUrl] = useState<string | null>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setUrl("");
      setPreview(null);
      setLastFetchedUrl(null);
    }
  }, [open]);

  // Fetch video info for preview (also creates/updates channel info)
  const fetchPreviewMutation = useMutation({
    mutationFn: (videoUrl: string) => trpcClient.ytdlp.fetchVideoInfo.mutate({ url: videoUrl }),
    onSuccess: (res, videoUrl) => {
      if (res.success && res.info) {
        setPreview({
          videoId: res.info.videoId,
          title: res.info.title,
          channelTitle: res.info.channelTitle,
          channelId: res.info.channelId,
          thumbnailUrl: res.info.thumbnailUrl,
          duration: res.info.durationSeconds,
        });
        setLastFetchedUrl(videoUrl);
        // Invalidate channel queries since channel info may have been created/updated
        queryClient.invalidateQueries({ queryKey: ["ytdlp", "channels"] });
      } else if (!res.success) {
        toast.error(res.message || "Failed to fetch video info");
      }
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to fetch video info");
    },
  });

  const startMutation = useMutation({
    mutationFn: (u: string) => trpcClient.queue.addToQueue.mutate({ urls: [u] }),
    onSuccess: (res) => {
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["queue", "status"] });
        queryClient.invalidateQueries({ queryKey: ["library"] });
        toast.success(`Download added to queue (${res.downloadIds.length})`);
      } else {
        toast.error(res.message ?? "Failed to start download");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add to queue"),
  });

  const addChannelMutation = useMutation({
    mutationFn: (channelUrl: string) =>
      trpcClient.ytdlp.fetchChannelInfo.mutate({ url: channelUrl }),
    onSuccess: (res) => {
      if (res.channel) {
        queryClient.invalidateQueries({ queryKey: ["ytdlp", "channels"] });
        toast.success(`Channel "${res.channel.channelTitle}" added successfully`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add channel"),
  });

  // Auto-fetch preview when URL changes and is a valid video URL
  useEffect(() => {
    if (!isVideoUrl(url)) {
      // Clear preview if URL is not a video
      if (preview && !isVideoUrl(url)) {
        setPreview(null);
        setLastFetchedUrl(null);
      }
      return;
    }

    // Don't refetch if we already fetched this URL
    if (lastFetchedUrl === url) return;

    // Debounce the fetch
    const timeoutId = setTimeout(() => {
      logger.debug("QuickAdd auto-fetching video preview", { url });
      fetchPreviewMutation.mutate(url);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [url, lastFetchedUrl]);

  const isPlaylistUrl = useMemo(() => {
    return isValidUrl(url) && extractYoutubePlaylistReference(url) !== null;
  }, [url]);

  const isChannelUrlMemo = useMemo(() => {
    return isValidUrl(url) && isChannelUrl(url);
  }, [url]);

  const isVideoUrlMemo = useMemo(() => isVideoUrl(url), [url]);
  const hasPreviewForCurrentUrl = isVideoUrlMemo && preview !== null && lastFetchedUrl === url;
  const isPreviewLoading =
    isVideoUrlMemo && fetchPreviewMutation.isPending && lastFetchedUrl !== url;

  const canSubmit = useMemo(() => {
    if (!isValidUrl(url)) return false;
    // Disable only when actually adding to queue or channel
    if (startMutation.isPending || addChannelMutation.isPending) return false;
    return true;
  }, [url, startMutation.isPending, addChannelMutation.isPending]);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!isValidUrl(url)) {
      toast.error("Please enter a valid URL");
      return;
    }

    // Handle channel URLs - add channel directly
    if (isChannelUrl(url)) {
      const normalizedUrl = normalizeChannelUrl(url);
      logger.debug("QuickAdd adding channel", { url, normalizedUrl });
      onOpenChange(false);
      addChannelMutation.mutate(normalizedUrl);
      return;
    }

    // Handle playlist URLs - navigate to playlist page
    const playlistRef = extractYoutubePlaylistReference(url);
    if (playlistRef) {
      logger.debug("QuickAdd navigating to playlist", {
        url,
        playlistId: playlistRef.playlistId,
        playlistUrl: playlistRef.playlistUrl,
      });
      onOpenChange(false);
      navigate({
        to: "/playlist",
        search: {
          playlistId: playlistRef.playlistId,
          playlistUrl: playlistRef.playlistUrl,
          type: undefined,
        },
      });
      return;
    }

    // Capture URL before closing dialog
    const videoUrl = url;

    // Close dialog immediately
    onOpenChange(false);

    // Add to queue immediately - UI updates right away
    logger.debug("QuickAdd start download", { url: videoUrl });
    startMutation.mutate(videoUrl);

    // Fetch video info in background (creates/updates channel info)
    if (!preview || lastFetchedUrl !== videoUrl) {
      trpcClient.ytdlp.fetchVideoInfo
        .mutate({ url: videoUrl })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["ytdlp", "channels"] });
        })
        .catch((err: unknown) => {
          logger.warn("Failed to fetch video info in background", { url: videoUrl, error: err });
        });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Add Video
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="relative">
              <Input
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="pr-10"
                inputMode="url"
                autoFocus
              />
              {isValidUrl(url) && (
                <CheckCircle2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-green-500" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Paste any YouTube video, playlist, or channel URL
            </p>
          </div>

          {/* Video Preview slot - always rendered to keep modal height stable */}
          <div className="rounded-lg border bg-muted/30 p-3">
            {hasPreviewForCurrentUrl ? (
              <div className="flex gap-3">
                <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-md bg-muted">
                  <Thumbnail
                    thumbnailUrl={preview.thumbnailUrl}
                    alt={preview.title}
                    className="h-full w-full object-cover"
                  />
                  {preview.duration && (
                    <div className="absolute bottom-1 right-1 flex items-center gap-1 rounded bg-black/80 px-1 py-0.5 text-[10px] text-white">
                      <Clock className="h-2.5 w-2.5" />
                      {formatDuration(preview.duration)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <h3
                    className="line-clamp-2 text-sm font-medium leading-tight"
                    title={preview.title}
                  >
                    {preview.title}
                  </h3>
                  {preview.channelTitle && (
                    <p className="truncate text-xs text-muted-foreground">{preview.channelTitle}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Skeleton
                  className={`h-16 w-28 shrink-0 ${isPreviewLoading ? "" : "animate-none opacity-50"}`}
                />
                <div className="flex-1 space-y-2">
                  <Skeleton
                    className={`h-4 w-3/4 ${isPreviewLoading ? "" : "animate-none opacity-50"}`}
                  />
                  <Skeleton
                    className={`h-3 w-1/2 ${isPreviewLoading ? "" : "animate-none opacity-40"}`}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="gap-2">
              {startMutation.isPending || addChannelMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Adding...</span>
                </>
              ) : isChannelUrlMemo ? (
                <>
                  <Users className="h-4 w-4" />
                  <span>Add Channel</span>
                </>
              ) : isPlaylistUrl ? (
                <>
                  <ListIcon className="h-4 w-4" />
                  <span>Open Playlist</span>
                </>
              ) : (
                <>
                  <Video className="h-4 w-4" />
                  <span>Download</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
