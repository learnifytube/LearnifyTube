import React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Rss, Video } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import Thumbnail from "@/components/Thumbnail";
import { formatDuration } from "@/pages/library/components/LibraryVideoItem";
import { VideoRowSection } from "./VideoRowSection";

type SubscriptionVideo = {
  videoId: string;
  title: string;
  channelTitle: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
};

// Videos from Subscriptions not yet in the Library, each with a Keep button
export function NewFromSubscriptionsSection(): React.JSX.Element {
  const queryClient = useQueryClient();

  const videosQuery = useQuery({
    queryKey: ["library", "newFromSubscriptions"],
    queryFn: () => trpcClient.library.newFromSubscriptions.query(),
  });

  const keepMutation = useMutation({
    mutationFn: (video: SubscriptionVideo) =>
      trpcClient.library.keep.mutate({ videoIds: [video.videoId] }),
    onSuccess: (res, video) => {
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["queue", "status"] });
        queryClient.invalidateQueries({ queryKey: ["library"] });
        toast.success(`Keeping "${video.title}"`);
      } else {
        toast.error(res.message);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to keep Video"),
  });

  const videos = videosQuery.data ?? [];

  return (
    <VideoRowSection
      title="New from Subscriptions"
      icon={Rss}
      isLoading={videosQuery.isLoading}
      isEmpty={videos.length === 0}
      emptyTitle="Nothing new"
      emptyHint="New Videos from your Subscriptions show up here for you to keep."
    >
      {videos.map((video) => (
        <SubscriptionVideoCard
          key={video.videoId}
          video={video}
          isKeeping={keepMutation.isPending && keepMutation.variables?.videoId === video.videoId}
          onKeep={() => keepMutation.mutate(video)}
        />
      ))}
    </VideoRowSection>
  );
}

function SubscriptionVideoCard({
  video,
  isKeeping,
  onKeep,
}: {
  video: SubscriptionVideo;
  isKeeping: boolean;
  onKeep: () => void;
}): React.JSX.Element {
  return (
    <div className="group w-64 flex-shrink-0">
      <Link
        to="/player"
        search={{ videoId: video.videoId, playlistId: undefined, playlistIndex: undefined }}
      >
        <div className="relative overflow-hidden rounded-lg">
          <Thumbnail
            thumbnailPath={video.thumbnailPath}
            thumbnailUrl={video.thumbnailUrl}
            alt={video.title}
            className="aspect-video w-full object-cover transition-transform group-hover:scale-105"
            fallbackIcon={<Video className="h-8 w-8 text-muted-foreground" />}
          />
          {video.durationSeconds && (
            <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
              {formatDuration(video.durationSeconds)}
            </div>
          )}
        </div>
      </Link>

      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h4 className="line-clamp-2 text-sm font-medium leading-tight">{video.title}</h4>
          <p className="line-clamp-1 text-xs text-muted-foreground">{video.channelTitle}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1"
          onClick={onKeep}
          disabled={isKeeping}
        >
          {isKeeping ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Keep
        </Button>
      </div>
    </div>
  );
}
