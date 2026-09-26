import React, { useState, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageContainer } from "@/components/ui/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { PlaylistHeader, PlaylistHeaderSkeleton } from "./components/PlaylistHeader";
import { PlaylistVideoCardSkeleton, type PlaylistVideo } from "./components/PlaylistVideoCard";
import { SourceVideoGrid } from "@/components/source-videos/SourceVideoGrid";
import { CustomPlaylistVideoCard } from "./components/CustomPlaylistVideoCard";
import { BatchDownloadBar } from "./components/BatchDownloadBar";
import {
  PlaylistFilters,
  PlaylistEmptyState,
  type FilterOption,
  type ViewMode,
} from "./components/PlaylistFilters";
import { EditPlaylistDialog } from "@/components/playlists/EditPlaylistDialog";
import { DeleteCustomPlaylistDialog } from "@/components/playlists/DeleteCustomPlaylistDialog";
import { FavoriteButton } from "@/components/FavoriteButton";
import { cn } from "@/lib/utils";
import { FolderHeart, MoreVertical, Pencil, Trash2 } from "lucide-react";

export default function PlaylistPage(): React.JSX.Element {
  const navigate = useNavigate();
  const search = useSearch({ from: "/playlist" });
  const playlistId = search.playlistId;
  const playlistUrl = search.playlistUrl;
  const isCustomPlaylist = search.type === "custom";
  const queryClient = useQueryClient();

  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterOption>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);

  // YouTube playlist query
  const youtubeQuery = useQuery({
    queryKey: ["playlist-details", playlistId, playlistUrl, "youtube"],
    queryFn: async () => {
      // Double-check this is not a custom playlist (guard against race conditions)
      if (!playlistId || isCustomPlaylist) return null;
      return await trpcClient.playlists.getDetails.query({ playlistId, playlistUrl });
    },
    enabled: !!playlistId && !isCustomPlaylist,
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: "offlineFirst",
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Custom playlist query
  const customQuery = useQuery({
    queryKey: ["customPlaylist-details", playlistId],
    queryFn: async () => {
      if (!playlistId) return null;
      return await trpcClient.customPlaylists.getDetails.query({ playlistId });
    },
    enabled: !!playlistId && isCustomPlaylist,
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: "offlineFirst",
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const query = isCustomPlaylist ? customQuery : youtubeQuery;

  const downloadMutation = useMutation({
    mutationFn: (urls: string[]) => trpcClient.queue.addToQueue.mutate({ urls }),
    onSuccess: (res) => {
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["queue", "status"] });
        toast.success(`${res.downloadIds.length} video(s) added to download queue`);
        setSelectedVideoIds(new Set());
        query.refetch();
      } else {
        toast.error(res.message ?? "Failed to add to queue");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add to queue"),
  });

  const removePlaylistMutation = useMutation({
    mutationFn: () => trpcClient.playlists.remove.mutate({ playlistId: playlistId! }),
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message ?? "Failed to remove playlist");
        return;
      }

      setShowRemoveDialog(false);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["playlists"] }),
        queryClient.invalidateQueries({ queryKey: ["playlist-details", playlistId] }),
        queryClient.invalidateQueries({ queryKey: ["channel-playlists"] }),
        queryClient.invalidateQueries({ queryKey: ["favorites"] }),
        ...(result.channelId
          ? [queryClient.invalidateQueries({ queryKey: ["channel", result.channelId] })]
          : []),
      ]);

      toast.success(`Removed "${result.title}" from playlists`);
      navigate({ to: "/playlists" });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to remove playlist");
    },
  });

  // Normalize data from both query types
  const data = useMemo(() => {
    if (isCustomPlaylist && customQuery.data) {
      return {
        playlistId: customQuery.data.id,
        title: customQuery.data.name,
        description: customQuery.data.description,
        thumbnailUrl: customQuery.data.thumbnailUrl,
        thumbnailPath: customQuery.data.thumbnailPath,
        itemCount: customQuery.data.itemCount,
        currentVideoIndex: customQuery.data.currentVideoIndex ?? 0,
        url: null,
        videos: customQuery.data.videos ?? [],
      };
    } else if (!isCustomPlaylist && youtubeQuery.data) {
      return youtubeQuery.data;
    }
    return null;
  }, [isCustomPlaylist, customQuery.data, youtubeQuery.data]);

  // Calculate stats
  const stats = useMemo(() => {
    const videos = data?.videos ?? [];
    const downloaded = videos.filter((v) => v.downloadStatus === "completed" && v.downloadFilePath);
    return {
      total: videos.length,
      downloaded: downloaded.length,
      notDownloaded: videos.length - downloaded.length,
    };
  }, [data?.videos]);

  // Filter videos
  const filteredVideos = useMemo((): PlaylistVideo[] => {
    const videos = data?.videos ?? [];
    switch (filter) {
      case "downloaded":
        return videos.filter((v) => v.downloadStatus === "completed" && v.downloadFilePath);
      case "not-downloaded":
        return videos.filter((v) => v.downloadStatus !== "completed" || !v.downloadFilePath);
      default:
        return videos;
    }
  }, [data?.videos, filter]);

  // Get not downloaded videos for selection
  const notDownloadedVideos = useMemo(() => {
    return (data?.videos ?? []).filter(
      (v) => v.downloadStatus !== "completed" || !v.downloadFilePath
    );
  }, [data?.videos]);

  const handleRefresh = async (): Promise<void> => {
    if (!playlistId || isRefreshing) return;
    try {
      setIsRefreshing(true);
      if (isCustomPlaylist) {
        await customQuery.refetch();
      } else {
        await trpcClient.playlists.getDetails.query({
          playlistId,
          playlistUrl: data?.url ?? playlistUrl,
          forceRefresh: true,
        });
        await youtubeQuery.refetch();
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handlePlayAll = (): void => {
    if (!data?.videos || data.videos.length === 0) {
      toast.error("No videos in playlist");
      return;
    }
    const startIndex = data.currentVideoIndex || 0;
    const video = data.videos[startIndex];
    if (video && playlistId) {
      navigate({
        to: "/player",
        search: {
          videoId: video.videoId,
          playlistId: isCustomPlaylist ? playlistId : playlistId,
          playlistUrl: isCustomPlaylist ? undefined : (data?.url ?? playlistUrl),
          playlistIndex: startIndex,
        },
      });
    }
  };

  const handlePlayVideo = (index: number): void => {
    const video = data?.videos[index];
    if (video && playlistId) {
      navigate({
        to: "/player",
        search: {
          videoId: video.videoId,
          playlistId,
          playlistUrl: isCustomPlaylist ? undefined : (data?.url ?? playlistUrl),
          playlistIndex: index,
        },
      });
    }
  };

  const handleToggleVideo = (videoId: string): void => {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  const handleToggleAll = (): void => {
    if (selectedVideoIds.size === notDownloadedVideos.length) {
      setSelectedVideoIds(new Set());
    } else {
      setSelectedVideoIds(new Set(notDownloadedVideos.map((v) => v.videoId)));
    }
  };

  const handleClearSelection = (): void => {
    setSelectedVideoIds(new Set());
  };

  const handleDownloadSelected = (): void => {
    if (selectedVideoIds.size === 0) {
      toast.error("Please select videos to download");
      return;
    }
    const urls = Array.from(selectedVideoIds).map(
      (videoId) => `https://www.youtube.com/watch?v=${videoId}`
    );
    downloadMutation.mutate(urls);
  };

  const handleConfirmRemovePlaylist = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    if (!playlistId || removePlaylistMutation.isPending) return;
    removePlaylistMutation.mutate();
  };

  // Loading state
  if (query.isLoading) {
    return (
      <PageContainer className="space-y-6">
        <PlaylistHeaderSkeleton />
        <div
          className={cn(
            "grid gap-4",
            viewMode === "grid"
              ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              : "grid-cols-1"
          )}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <PlaylistVideoCardSkeleton key={i} />
          ))}
        </div>
      </PageContainer>
    );
  }

  // Missing playlist ID
  if (!playlistId) {
    return (
      <PageContainer>
        <Alert>
          <AlertTitle>Missing playlist</AlertTitle>
          <AlertDescription>No playlist ID provided.</AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  // Playlist not found
  if (!data) {
    return (
      <PageContainer>
        <Alert>
          <AlertTitle>Not found</AlertTitle>
          <AlertDescription>Could not find that playlist.</AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  const title = data.title ?? playlistId;

  return (
    <PageContainer className="space-y-6">
      {/* Custom playlist badge and actions */}
      <div className="flex items-center justify-between">
        {isCustomPlaylist ? (
          <Badge variant="secondary" className="flex items-center gap-1.5">
            <FolderHeart className="h-3.5 w-3.5" />
            My Playlist
          </Badge>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          <FavoriteButton
            entityType={isCustomPlaylist ? "custom_playlist" : "channel_playlist"}
            entityId={playlistId}
            variant="outline"
            size="sm"
            showLabel
          />
          {!isCustomPlaylist && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-destructive hover:text-destructive"
              onClick={() => setShowRemoveDialog(true)}
            >
              <Trash2 className="h-4 w-4" />
              Remove Playlist
            </Button>
          )}
          {isCustomPlaylist && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <MoreVertical className="h-4 w-4" />
                  Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit Playlist
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Playlist
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <PlaylistHeader
        title={title}
        description={data.description}
        thumbnailUrl={data.thumbnailUrl}
        thumbnailPath={data.thumbnailPath}
        itemCount={stats.total}
        currentVideoIndex={data.currentVideoIndex || 0}
        downloadedCount={stats.downloaded}
        isRefreshing={query.isFetching || isRefreshing}
        lastUpdated={query.dataUpdatedAt}
        onPlayAll={handlePlayAll}
        onRefresh={handleRefresh}
      />

      {isCustomPlaylist ? (
        <>
          <BatchDownloadBar
            selectedCount={selectedVideoIds.size}
            totalNotDownloaded={stats.notDownloaded}
            isDownloading={downloadMutation.isPending}
            onSelectAll={handleToggleAll}
            onClearSelection={handleClearSelection}
            onDownload={handleDownloadSelected}
            isAllSelected={selectedVideoIds.size === notDownloadedVideos.length}
          />

          <PlaylistFilters
            filter={filter}
            viewMode={viewMode}
            totalCount={stats.total}
            downloadedCount={stats.downloaded}
            notDownloadedCount={stats.notDownloaded}
            onFilterChange={setFilter}
            onViewModeChange={setViewMode}
          />

          {filteredVideos.length === 0 ? (
            <PlaylistEmptyState filter={filter} />
          ) : (
            <div
              className={cn(
                "grid gap-4",
                viewMode === "grid"
                  ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                  : "grid-cols-1 md:grid-cols-2"
              )}
            >
              {filteredVideos.map((video) => {
                const originalIndex = (data.videos ?? []).findIndex(
                  (v) => v.videoId === video.videoId
                );
                return (
                  <CustomPlaylistVideoCard
                    key={video.videoId}
                    video={video}
                    index={originalIndex}
                    playlistId={playlistId}
                    totalVideos={data.videos?.length ?? 0}
                    isCurrentVideo={originalIndex === (data.currentVideoIndex || 0)}
                    isSelected={selectedVideoIds.has(video.videoId)}
                    onPlay={() => handlePlayVideo(originalIndex)}
                    onToggleSelect={() => handleToggleVideo(video.videoId)}
                    onRemoved={() => query.refetch()}
                  />
                );
              })}
            </div>
          )}
        </>
      ) : data.videos.length === 0 ? (
        <PlaylistEmptyState filter="all" />
      ) : (
        <SourceVideoGrid
          className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          videos={data.videos.map((video, index) => ({
            ...video,
            subtitle: `#${index + 1}${video.viewCount ? ` · ${video.viewCount.toLocaleString()} views` : ""}`,
          }))}
          onPlay={(_videoId, index) => handlePlayVideo(index)}
        />
      )}

      {/* Edit dialog for custom playlists */}
      {isCustomPlaylist && customQuery.data && (
        <EditPlaylistDialog
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          playlistId={playlistId}
          initialName={customQuery.data.name}
          initialDescription={customQuery.data.description}
          onUpdated={() => customQuery.refetch()}
        />
      )}

      {/* Delete confirmation dialog */}
      {isCustomPlaylist && (
        <DeleteCustomPlaylistDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          playlistId={playlistId}
          playlistName={title}
          videoCount={stats.total}
          onDeleted={() => navigate({ to: "/playlists" })}
        />
      )}

      {!isCustomPlaylist && (
        <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove playlist?</AlertDialogTitle>
              <AlertDialogDescription>
                Remove "{title}" from your saved playlists? This removes the playlist and its cached
                video list from the desktop app. Downloaded videos and favorites stay in your
                library.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removePlaylistMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmRemovePlaylist}
                disabled={removePlaylistMutation.isPending}
                className="bg-destructive hover:bg-destructive/90"
              >
                {removePlaylistMutation.isPending ? "Removing..." : "Remove Playlist"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </PageContainer>
  );
}
