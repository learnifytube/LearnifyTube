import React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Video } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import Thumbnail from "@/components/Thumbnail";
import { formatBytes } from "../format";

// The On-device set: what every Device holds. Decided on the Lists page, not here.
export function OnDeviceSetCard(): React.JSX.Element {
  const setQuery = useQuery({
    queryKey: ["onDevices", "set"],
    queryFn: () => trpcClient.onDevices.getSet.query(),
  });
  const videos = setQuery.data?.videos ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>On your Devices</CardTitle>
        <CardDescription>
          {videos.length} {videos.length === 1 ? "Video" : "Videos"} ·{" "}
          {formatBytes(setQuery.data?.totalBytes ?? 0)}. Switch Lists on for devices in{" "}
          <Link to="/my-playlists" className="underline">
            Lists
          </Link>
          , or use "Add to Phone" on a Video.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {videos.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Nothing is set to go to your Devices yet.
          </p>
        ) : (
          <ScrollArea className="h-[420px] pr-4">
            <div className="space-y-2">
              {videos.map((video) => (
                <div key={video.id} className="flex items-center gap-3">
                  <Thumbnail
                    thumbnailPath={video.thumbnailPath}
                    thumbnailUrl={video.thumbnailUrl}
                    alt={video.title}
                    className="aspect-video w-24 shrink-0 rounded object-cover"
                    fallbackIcon={<Video className="h-4 w-4 text-muted-foreground" />}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{video.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {video.channelTitle}
                      {video.downloadStatus === "completed"
                        ? ` · ${formatBytes(video.downloadFileSize ?? 0)}`
                        : " · being fetched on the desktop first"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
