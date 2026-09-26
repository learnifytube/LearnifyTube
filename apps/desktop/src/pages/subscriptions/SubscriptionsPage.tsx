import React, { useState, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { trpcClient } from "@/utils/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/ui/page-container";
import { Loader2, Search, RefreshCw } from "lucide-react";
import { SourceVideoGrid } from "@/components/source-videos/SourceVideoGrid";

const PAGE_SIZE = 30;

export default function SubscriptionsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");

  const query = useInfiniteQuery({
    queryKey: ["subscriptions"],
    queryFn: async ({ pageParam = 0 }) => {
      return await trpcClient.watchStats.listRecentVideos.query({
        limit: PAGE_SIZE,
        offset: pageParam,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      // If the last page has fewer items than PAGE_SIZE, there's no more data
      if (lastPage.length < PAGE_SIZE) return undefined;
      // Otherwise, return the next offset
      return allPages.length * PAGE_SIZE;
    },
    initialPageParam: 0,
    staleTime: 60_000,
  });

  const videos = query.data?.pages.flat() ?? [];

  const filteredVideos = useMemo(() => {
    if (!searchQuery.trim()) return videos;
    const q = searchQuery.toLowerCase();
    return videos.filter(
      (v) => v.title.toLowerCase().includes(q) || v.channelTitle?.toLowerCase().includes(q)
    );
  }, [videos, searchQuery]);

  const handleRefresh = (): void => {
    query.refetch();
  };

  return (
    <PageContainer>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold sm:text-3xl">Subscriptions</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search videos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 pl-9"
            />
          </div>
          {searchQuery && (
            <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
              Clear
            </Button>
          )}
          <Button
            onClick={handleRefresh}
            disabled={query.isFetching}
            size="sm"
            variant="outline"
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recent Videos {filteredVideos.length > 0 && `(${filteredVideos.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filteredVideos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {searchQuery
                ? `No videos found matching "${searchQuery}"`
                : "No recent videos found."}
            </p>
          ) : (
            <>
              <SourceVideoGrid
                className="grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
                videos={filteredVideos.map((v) => ({
                  ...v,
                  subtitle: v.channelId ? (
                    <button
                      className="text-left hover:text-foreground hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate({ to: "/channel", search: { channelId: v.channelId! } });
                      }}
                    >
                      {v.channelTitle || v.channelId}
                    </button>
                  ) : (
                    v.channelTitle || "Unknown channel"
                  ),
                }))}
              />

              {/* Load More Button */}
              {query.hasNextPage && !searchQuery && (
                <div className="flex justify-center pt-4">
                  <Button
                    variant="outline"
                    onClick={() => query.fetchNextPage()}
                    disabled={query.isFetchingNextPage}
                  >
                    {query.isFetchingNextPage ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading…
                      </>
                    ) : (
                      "Load More"
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
