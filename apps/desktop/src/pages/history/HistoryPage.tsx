import React from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { Clock, PlayCircle, Loader2, ListVideo } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import Thumbnail from "@/components/Thumbnail";
import { logger } from "@/helpers/logger";

const PAGE_SIZE = 30;

export default function HistoryPage(): React.JSX.Element {
  const navigate = useNavigate();

  // Fetch recently played playlists (sorted by lastViewedAt on the server).
  const playlistsQuery = useQuery({
    queryKey: ["playlists", "listAll"],
    queryFn: () => trpcClient.playlists.listAll.query({ limit: 30 }),
  });

  const recentPlaylists = (playlistsQuery.data ?? []).filter((p) => p.lastViewedAt !== null);

  // Resumes where the playlist picks up: its Current Video, or the next unwatched one.
  const handleResumePlaylist = async (playlist: {
    playlistId: string;
    url: string | null;
  }): Promise<void> => {
    try {
      const [details, pickUp] = await Promise.all([
        trpcClient.playlists.getDetails.query({
          playlistId: playlist.playlistId,
          playlistUrl: playlist.url ?? undefined,
        }),
        trpcClient.collections.pickUp.query({
          kind: "youtube_playlist",
          id: playlist.playlistId,
        }),
      ]);
      const videos = details?.videos ?? [];
      const video = videos.find((v) => v.videoId === pickUp?.videoId) ?? videos[0];
      if (!video) {
        toast.error("This playlist has no videos to resume.");
        return;
      }
      navigate({
        to: "/player",
        search: {
          videoId: video.videoId,
          playlistId: playlist.playlistId,
          playlistUrl: playlist.url ?? undefined,
          playlistIndex: videos.indexOf(video),
        },
      });
    } catch (error) {
      logger.error("[history] Failed to resume playlist", { playlist, error });
      toast.error("Could not resume this playlist.");
    }
  };

  // Fetch metadata for recently played videos with pagination
  const query = useInfiniteQuery({
    queryKey: ["recent-watched"],
    queryFn: async ({ pageParam = 0 }) => {
      return await trpcClient.watchStats.listRecentWatched.query({
        limit: PAGE_SIZE,
        offset: pageParam,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.length * PAGE_SIZE;
    },
    initialPageParam: 0,
  });

  const videos = query.data?.pages.flat() ?? [];

  // Calculate total stats from loaded videos
  const totalWatchedMinutes =
    videos.length > 0
      ? Math.round(videos.reduce((sum, v) => sum + (v.totalWatchSeconds ?? 0), 0) / 60)
      : 0;

  return (
    <PageContainer>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold sm:text-3xl">History</h1>
        {totalWatchedMinutes > 0 && (
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
            <Clock className="h-4 w-4" />
            <span>{totalWatchedMinutes} min watched total</span>
          </div>
        )}
      </div>

      {recentPlaylists.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListVideo className="h-4 w-4 text-primary" />
              Recently Played Playlists ({recentPlaylists.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {recentPlaylists.map((p) => {
                const itemCount = p.itemCount ?? 0;
                const resumePosition = (p.currentVideoIndex ?? 0) + 1;
                const resumeLabel =
                  itemCount > 0 && p.currentVideoIndex !== null
                    ? `Resume video ${Math.min(resumePosition, itemCount)} of ${itemCount}`
                    : "Resume";
                return (
                  <div
                    key={p.playlistId}
                    role="button"
                    tabIndex={0}
                    className="group cursor-pointer space-y-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-muted/50"
                    onClick={() =>
                      handleResumePlaylist({
                        playlistId: p.playlistId,
                        url: p.url,
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleResumePlaylist({
                          playlistId: p.playlistId,
                          url: p.url,
                        });
                      }
                    }}
                  >
                    <div className="relative">
                      <Thumbnail
                        thumbnailPath={p.thumbnailPath}
                        thumbnailUrl={p.thumbnailUrl}
                        alt={p.title}
                        className="aspect-video w-full rounded object-cover"
                        fallbackIcon={<ListVideo className="h-6 w-6 text-muted-foreground" />}
                      />
                      {itemCount > 0 && (
                        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
                          <ListVideo className="h-3 w-3" />
                          {itemCount}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="line-clamp-2 text-sm font-medium">{p.title}</div>
                      {p.channelTitle && (
                        <div className="line-clamp-1 text-xs text-muted-foreground">
                          {p.channelTitle}
                        </div>
                      )}
                      <div className="flex items-center gap-1 pt-1 text-xs text-primary">
                        <PlayCircle className="h-3.5 w-3.5" />
                        <span className="font-medium">{resumeLabel}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recently Played {videos.length > 0 && `(${videos.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No playback history yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {videos.map((v) => {
                  const hideNoThumb =
                    typeof v?.thumbnailUrl === "string" && v.thumbnailUrl.includes("no_thumbnail");
                  const watchedMinutes =
                    typeof v.totalWatchSeconds === "number"
                      ? Math.round(v.totalWatchSeconds / 60)
                      : 0;
                  const durationMinutes =
                    typeof v.durationSeconds === "number" ? Math.round(v.durationSeconds / 60) : 0;
                  const progressPercent =
                    durationMinutes > 0
                      ? Math.min(100, Math.round((watchedMinutes / durationMinutes) * 100))
                      : 0;
                  return (
                    <div
                      key={v.videoId}
                      className="group cursor-pointer space-y-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-muted/50"
                      onClick={() =>
                        navigate({
                          to: "/player",
                          search: {
                            videoId: v.videoId,
                            playlistId: undefined,
                            playlistIndex: undefined,
                          },
                        })
                      }
                    >
                      <div className="relative">
                        {hideNoThumb ? (
                          <div className="aspect-video w-full rounded bg-muted" />
                        ) : (
                          <Thumbnail
                            thumbnailPath={v?.thumbnailPath}
                            thumbnailUrl={v?.thumbnailUrl}
                            alt={v.title}
                            className="aspect-video w-full rounded object-cover"
                          />
                        )}
                        {/* Progress bar overlay at bottom of thumbnail */}
                        {progressPercent > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="line-clamp-2 text-sm font-medium">{v.title}</div>
                        {v.channelId ? (
                          <button
                            className="line-clamp-1 text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate({
                                to: "/channel",
                                search: { channelId: v.channelId! },
                              });
                            }}
                          >
                            {v.channelTitle || v.channelId}
                          </button>
                        ) : (
                          <div className="line-clamp-1 text-xs text-muted-foreground">
                            {v.channelTitle || "Unknown channel"}
                          </div>
                        )}
                        {/* Watch stats row */}
                        <div className="flex items-center gap-3 pt-1 text-xs">
                          {watchedMinutes > 0 && (
                            <div className="flex items-center gap-1 text-primary">
                              <PlayCircle className="h-3.5 w-3.5" />
                              <span className="font-medium">{watchedMinutes} min watched</span>
                            </div>
                          )}
                          {durationMinutes > 0 && progressPercent > 0 && (
                            <div className="text-muted-foreground">{progressPercent}% complete</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More Button */}
              {query.hasNextPage && (
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
