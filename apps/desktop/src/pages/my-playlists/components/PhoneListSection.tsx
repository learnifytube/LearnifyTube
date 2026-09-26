import React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone, Video, X } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import Thumbnail from "@/components/Thumbnail";

// The built-in Phone List: single Videos that are always on every Device.
export function PhoneListSection({ searchQuery }: { searchQuery: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const phoneListQuery = useQuery({
    queryKey: ["onDevices", "phoneList"],
    queryFn: () => trpcClient.onDevices.listPhoneList.query(),
  });
  const remove = useMutation({
    mutationFn: (videoId: string) =>
      trpcClient.onDevices.setOnPhoneList.mutate({ videoId, on: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onDevices"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      toast.success("Removed from the Phone List", {
        description: "Devices remove it the next time they connect, unless another List holds it.",
      });
    },
  });

  const query = searchQuery.trim().toLowerCase();
  const videos = (phoneListQuery.data ?? []).filter(
    (v) =>
      !query ||
      v.title.toLowerCase().includes(query) ||
      v.channelTitle.toLowerCase().includes(query)
  );

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Smartphone className="h-4 w-4" />
        Always on your Devices. Add single Videos with "Add to Phone" on a Video card.
      </p>
      {!phoneListQuery.isLoading && videos.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          {query ? `No Videos matching "${searchQuery}"` : "The Phone List is empty."}
        </div>
      ) : (
        <div className="divide-y">
          {videos.map((video) => (
            <div key={video.videoId} className="group flex items-center gap-3 py-2">
              <Link
                to="/player"
                search={{ videoId: video.videoId, playlistId: undefined, playlistIndex: undefined }}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <Thumbnail
                  thumbnailPath={video.thumbnailPath}
                  thumbnailUrl={video.thumbnailUrl}
                  alt={video.title}
                  className="aspect-video w-32 shrink-0 rounded object-cover"
                  fallbackIcon={<Video className="h-5 w-5 text-muted-foreground" />}
                />
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium group-hover:text-primary">
                    {video.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{video.channelTitle}</p>
                </div>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                disabled={remove.isPending}
                onClick={() => remove.mutate(video.videoId)}
              >
                <X className="h-4 w-4" />
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
