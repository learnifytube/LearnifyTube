import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Video } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { SourceVideoGrid } from "@/components/source-videos/SourceVideoGrid";

const LIMIT = 24;

type LoadInput = { channelId: string; limit: number; forceRefresh?: boolean };

const KINDS = {
  latest: {
    load: (input: LoadInput) => trpcClient.ytdlp.listChannelLatest.query(input),
    emptyTitle: "No videos yet",
    emptyHint: "Check back later for new content",
  },
  popular: {
    load: (input: LoadInput) => trpcClient.ytdlp.listChannelPopular.query(input),
    emptyTitle: "No popular videos",
    emptyHint: "Check back later for popular content",
  },
};

const formatViewCount = (count: number): string => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
};

// A Channel's latest or popular Videos, each with its kept state and Keep.
export function ChannelVideosTab({
  channelId,
  kind,
}: {
  channelId: string;
  kind: keyof typeof KINDS;
}): React.JSX.Element {
  const { load, emptyTitle, emptyHint } = KINDS[kind];
  const query = useQuery({
    queryKey: [`channel-${kind}`, channelId],
    queryFn: () => load({ channelId, limit: LIMIT }),
    enabled: !!channelId,
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: "offlineFirst",
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async (): Promise<void> => {
    if (isRefreshing) return;
    try {
      setIsRefreshing(true);
      await load({ channelId, limit: LIMIT, forceRefresh: true });
      await query.refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const videos = (query.data ?? []).map((video) => ({
    ...video,
    subtitle: [
      video.viewCount ? `${formatViewCount(video.viewCount)} views` : null,
      video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  return (
    <>
      {query.dataUpdatedAt > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <span>
            {query.isFetching ? (
              <>
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                Refreshing data...
              </>
            ) : (
              <>Last updated: {new Date(query.dataUpdatedAt).toLocaleString()}</>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={handleRefresh}
            disabled={query.isFetching || isRefreshing}
          >
            {query.isFetching || isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      )}

      {query.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-video w-full animate-pulse rounded-lg bg-muted" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : videos.length > 0 ? (
        <SourceVideoGrid videos={videos} />
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-3 rounded-full bg-muted p-4">
            <Video className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">{emptyTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
        </div>
      )}
    </>
  );
}
