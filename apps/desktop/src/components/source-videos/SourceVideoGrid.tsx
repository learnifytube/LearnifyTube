import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { isOnItsWay } from "@/lib/kept-video";
import {
  firstNotKeptVideoId,
  getSourceVideoState,
  type SourceVideoState,
} from "@/lib/source-video-state";
import { cn } from "@/lib/utils";
import { KeepButton } from "./KeepButton";
import { SourceVideoCard, type SourceVideo } from "./SourceVideoCard";

type KeepRequest = { videoIds: string[]; listId?: string };

const KEEP_MUTATION_KEY = ["library", "keep"];

// Videos on a Source page (Channel, YouTube playlist, Subscriptions), each showing whether it
// is kept, with Keep, Keep and add to a List, and multi-select to keep several at once.
// Opens scrolled to the first Video not kept yet.
export function SourceVideoGrid({
  videos,
  onPlay,
  className = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
}: {
  videos: SourceVideo[];
  onPlay?: (videoId: string, index: number) => void;
  className?: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const libraryQuery = useQuery({
    queryKey: ["library", "list"],
    queryFn: () => trpcClient.library.list.query(),
    refetchInterval: (query) =>
      query.state.data?.videos.some((v) => isOnItsWay(v.downloadStatus)) ? 2000 : false,
  });
  const libraryVideos = new Map((libraryQuery.data?.videos ?? []).map((v) => [v.videoId, v]));
  const lists = libraryQuery.data?.lists ?? [];
  const stateOf = (videoId: string): SourceVideoState =>
    getSourceVideoState(libraryVideos.get(videoId));

  const keepMutation = useMutation({
    mutationKey: KEEP_MUTATION_KEY,
    mutationFn: (request: KeepRequest) => trpcClient.library.keep.mutate(request),
    onSuccess: (res, request) => {
      if (!res.success) {
        toast.error(res.message);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["queue", "status"] });
      queryClient.invalidateQueries({ queryKey: ["customPlaylists"] });
      setSelectedIds((prev) => new Set([...prev].filter((id) => !request.videoIds.includes(id))));
      const count = request.videoIds.length;
      const what = count === 1 ? "Video" : `${count} Videos`;
      const list = lists.find((l) => l.id === request.listId);
      toast.success(list ? `Keeping ${what}, added to ${list.name}` : `Keeping ${what}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to keep Videos"),
  });
  const keepingIds = useMutationState({
    filters: { mutationKey: KEEP_MUTATION_KEY, status: "pending" },
    select: (mutation) => (mutation.state.variables as KeepRequest | undefined)?.videoIds ?? [],
  }).flat();

  // Open at the Videos not kept yet: decided once, when the page and a fresh Library have loaded
  const isReady = libraryQuery.isFetchedAfterMount && videos.length > 0;
  const scrollTarget = firstNotKeptVideoId(
    videos.map((v) => v.videoId),
    stateOf
  );
  const hasScrolled = useRef(false);
  useEffect(() => {
    if (!isReady || hasScrolled.current) return;
    hasScrolled.current = true;
    if (!scrollTarget || scrollTarget === videos[0]?.videoId) return;
    document
      .getElementById(`source-video-${scrollTarget}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [isReady, scrollTarget, videos]);

  const notKeptIds = videos.map((v) => v.videoId).filter((id) => stateOf(id) === "not-kept");
  const selected = notKeptIds.filter((id) => selectedIds.has(id));
  const allSelected = notKeptIds.length > 0 && selected.length === notKeptIds.length;

  const toggle = (videoId: string): void =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });

  const play = (videoId: string, index: number): void => {
    if (onPlay) onPlay(videoId, index);
    else
      void navigate({
        to: "/player",
        search: { videoId, playlistId: undefined, playlistIndex: undefined },
      });
  };

  return (
    <div className="space-y-4">
      {notKeptIds.length > 0 && (
        <div
          className={cn(
            "sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-sm backdrop-blur",
            selected.length > 0 && "border-primary/30"
          )}
        >
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={allSelected}
              onCheckedChange={() => setSelectedIds(allSelected ? new Set() : new Set(notKeptIds))}
            />
            {selected.length > 0 ? (
              <span>
                <span className="font-semibold">{selected.length}</span> of {notKeptIds.length}{" "}
                selected
              </span>
            ) : (
              <span className="text-muted-foreground">{notKeptIds.length} not kept yet</span>
            )}
          </label>
          {selected.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="h-4 w-4" />
                Clear
              </Button>
              <KeepButton
                lists={lists}
                label={`Keep ${selected.length}`}
                isKeeping={keepMutation.isPending}
                onKeep={(listId) => keepMutation.mutate({ videoIds: selected, listId })}
              />
            </div>
          )}
        </div>
      )}

      <div className={cn("grid gap-4", className)}>
        {videos.map((video, index) => (
          <SourceVideoCard
            key={video.videoId}
            video={video}
            state={stateOf(video.videoId)}
            progress={libraryVideos.get(video.videoId)?.downloadProgress ?? null}
            isSelected={selectedIds.has(video.videoId)}
            isKeeping={keepingIds.includes(video.videoId)}
            lists={lists}
            onPlay={() => play(video.videoId, index)}
            onToggleSelect={() => toggle(video.videoId)}
            onKeep={(listId) => keepMutation.mutate({ videoIds: [video.videoId], listId })}
          />
        ))}
      </div>
    </div>
  );
}
