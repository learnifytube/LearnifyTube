import React, { useRef, useState, useEffect, useCallback } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Rewind,
  FastForward,
  ListPlus,
  MoreVertical,
  Download,
  Trash2,
  Music,
  MonitorSmartphone,
} from "lucide-react";
import { toast } from "sonner";
import { AddToPlaylistDialog } from "@/components/playlists/AddToPlaylistDialog";
import { useWatchProgress } from "./hooks/useWatchProgress";
import { VideoPlayer } from "./components/VideoPlayer";
import { VideoProgressIndicator } from "./components/VideoProgressIndicator";
import { DownloadStatus } from "./components/DownloadStatus";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { VideoDescription } from "./components/VideoDescription";
import { PlaylistNavigation } from "./components/PlaylistNavigation";
import { VideoToolsPanel } from "./components/VideoToolsPanel";
import { ExternalLink } from "@/components/ExternalLink";
import { FavoriteButton } from "@/components/FavoriteButton";
import {
  beginVideoPlayback,
  usePlayerStore,
  updateCurrentTime,
  setPlaybackData,
} from "@/context/playerStore";
import { trpcClient } from "@/utils/trpc";
import { logger } from "@/helpers/logger";

export default function PlayerPage(): React.JSX.Element {
  const search = useSearch({ from: "/player" });
  const videoId = search.videoId;
  const playlistId = search.playlistId;
  const playlistUrl = search.playlistUrl;
  const playlistIndex = search.playlistIndex;

  // Video reference for playback control
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // External store state
  const playerState = usePlayerStore();

  // Local seek indicator state (replaces atom)
  const [seekIndicator, setSeekIndicator] = useState<{
    direction: "forward" | "backward";
    amount: number;
  } | null>(null);

  // Timeout ref for seek indicator
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track if video file failed to load (e.g., file was deleted)
  const [videoLoadError, setVideoLoadError] = useState(false);

  // Track video duration for progress indicator
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  // Add to playlist dialog
  const [showAddToPlaylistDialog, setShowAddToPlaylistDialog] = useState(false);

  // Auto-clear seek indicator after 800ms
  useEffect(() => {
    if (!seekIndicator) {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
        seekTimeoutRef.current = null;
      }
      return;
    }
    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    seekTimeoutRef.current = setTimeout(() => setSeekIndicator(null), 800);
    return () => {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
    };
  }, [seekIndicator]);

  const { data: playback, isLoading: playbackIsLoading } = useQuery({
    queryKey: ["video-playback", videoId],
    queryFn: async () => {
      if (!videoId) return null;
      return await trpcClient.ytdlp.getVideoPlayback.query({ videoId });
    },
    enabled: !!videoId,
    // Always refetch on mount to check if file still exists
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (!status || typeof status !== "string") return false;
      return ["downloading", "queued", "paused"].includes(status) ? 1500 : false;
    },
  });

  const ensuredDirectoryRef = useRef<Set<string>>(new Set());

  const startDownloadMutation = useMutation({
    mutationFn: async () => {
      if (!videoId) throw new Error("Missing videoId");

      // If video has error or is being re-downloaded, reset the download status first
      if (videoLoadError || playback?.status === "completed") {
        await trpcClient.ytdlp.resetDownloadStatus.mutate({ videoId });
      }

      const url = `https://www.youtube.com/watch?v=${videoId}`;
      return await trpcClient.queue.addToQueue.mutate({ urls: [url] });
    },
    onSuccess: (result) => {
      // Clear error state when starting a new download
      setVideoLoadError(false);
      queryClient.invalidateQueries({ queryKey: ["video-playback", videoId] });
      // Invalidate queue status to resume polling and update sidebar
      queryClient.invalidateQueries({ queryKey: ["queue", "status"] });

      if (result.success) {
        toast.success("Download started");
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start download");
    },
  });

  const ensureDirectoryAccessMutation = useMutation({
    mutationFn: async (targetFile?: string) => {
      return await trpcClient.preferences.ensureDownloadDirectoryAccess.mutate({
        filePath: targetFile,
      });
    },
  });

  const { data: phoneList = [] } = useQuery({
    queryKey: ["onDevices", "phoneList"],
    queryFn: () => trpcClient.onDevices.listPhoneList.query(),
  });

  const isOnDevices = !!videoId && phoneList.some((item) => item.videoId === videoId);

  const toggleOnDevicesMutation = useMutation({
    mutationFn: async (on: boolean) => {
      if (!videoId) throw new Error("Missing videoId");
      return await trpcClient.onDevices.setOnPhoneList.mutate({ videoId, on });
    },
    onSuccess: (_result, on) => {
      queryClient.invalidateQueries({ queryKey: ["onDevices"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      toast.success(on ? "Sent to Devices" : "Removed from Devices", {
        description: on
          ? "Your phone and TV will download it now."
          : "Devices remove it the next time they connect, unless another List holds it.",
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update devices");
    },
  });

  const deleteVideoMutation = useMutation({
    mutationFn: async () => {
      if (!videoId) throw new Error("Missing videoId");
      return await trpcClient.ytdlp.deleteDownloadedVideo.mutate({ videoId });
    },
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Video deleted");
        queryClient.invalidateQueries({ queryKey: ["video-playback", videoId] });
        queryClient.invalidateQueries({ queryKey: ["ytdlp", "downloadedVideosDetailed"] });
      } else {
        toast.error(result.message || "Failed to delete video");
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete video");
    },
  });

  const convertToAudioMutation = useMutation({
    mutationFn: async () => {
      if (!videoId) throw new Error("Missing videoId");
      return await trpcClient.optimization.startAudioConversion.mutate({
        videoIds: [videoId],
        deleteOriginal: true, // Replace video with audio to save storage
      });
    },
    onSuccess: (result) => {
      if (result.success) {
        toast.success("Converting to audio (video will be replaced)");
        queryClient.invalidateQueries({ queryKey: ["video-playback", videoId] });
      } else {
        toast.error(result.message || "Failed to start audio conversion");
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start audio conversion");
    },
  });

  // Reset error state when videoId or filePath changes
  useEffect(() => {
    setVideoLoadError(false);
    setVideoDuration(null);
    autoStartedRef.current = false;
  }, [videoId, playback?.filePath]);

  // Track video duration when metadata loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = (): void => {
      if (video.duration && isFinite(video.duration)) {
        setVideoDuration(video.duration);
      }
    };

    // Check if already loaded
    if (video.duration && isFinite(video.duration)) {
      setVideoDuration(video.duration);
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => video.removeEventListener("loadedmetadata", handleLoadedMetadata);
  }, [playback?.filePath]);

  // Auto-start download once if file is missing and not already downloading
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!videoId) return;
    if (playback?.filePath) return; // We already have the file

    const st = playback?.status;
    const isActive = typeof st === "string" && ["downloading", "queued", "paused"].includes(st);

    if (!isActive && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startDownloadMutation.mutate();
    }
  }, [videoId, playback?.filePath, playback?.status]);

  // When status flips to completed but filePath not yet populated, force a refresh once
  const completionRefetchRef = useRef(false);
  useEffect(() => {
    if (!videoId) return;
    if (playback?.filePath) return;
    if (playback?.status === "completed" && !completionRefetchRef.current) {
      completionRefetchRef.current = true;
      queryClient.invalidateQueries({ queryKey: ["video-playback", videoId] });
    }
  }, [playback?.status, playback?.filePath, videoId]);

  // WATCH PROGRESS (using existing hook)
  // Only calculate initial start time when video changes, not on every time update
  const initialStartTime = React.useMemo(() => {
    if (playerState.videoId === videoId && playerState.currentTime > 0) {
      return playerState.currentTime;
    }
    return playback?.resumeAtSeconds ?? 0;
  }, [videoId, playerState.videoId, playback?.resumeAtSeconds]);

  const { currentTime, handleTimeUpdate } = useWatchProgress(videoId, videoRef, initialStartTime, {
    onCurrentTimeChange: (time) => updateCurrentTime(time),
  });

  // Extract playback data for easier access
  const videoTitle = playback?.title ?? "Untitled";
  const filePath = playback?.filePath ?? null;
  const mediaUrl = playback?.mediaUrl ?? null; // HTTP streaming URL

  // Auto re-download if file is missing (filePath exists but mediaUrl is null)
  const [autoRedownloadTriggered, setAutoRedownloadTriggered] = useState(false);
  useEffect(() => {
    if (
      videoId &&
      filePath &&
      !mediaUrl &&
      !playbackIsLoading &&
      !startDownloadMutation.isPending &&
      !autoRedownloadTriggered
    ) {
      setAutoRedownloadTriggered(true);
      startDownloadMutation.mutate();
    }
  }, [
    videoId,
    filePath,
    mediaUrl,
    playbackIsLoading,
    startDownloadMutation.isPending,
    autoRedownloadTriggered,
  ]);

  // Reset auto-redownload flag when video changes
  useEffect(() => {
    setAutoRedownloadTriggered(false);
  }, [videoId]);

  // Initialize / update store when video changes
  useEffect(() => {
    if (!videoId) return;
    beginVideoPlayback({
      videoId,
      playlistId: playlistId || null,
      playlistIndex: playlistIndex ?? null,
      startTime: initialStartTime,
    });
  }, [videoId, playlistId, playlistIndex, initialStartTime]);

  // Update playback data in external store
  useEffect(() => {
    setPlaybackData(playback || null);
  }, [playback]);

  // Fetch playlist details if we have a playlistId
  const playlistQuery = useQuery({
    queryKey: ["playlist-details", playlistId, playlistUrl],
    queryFn: async () => {
      if (!playlistId) return null;
      return await trpcClient.playlists.getDetails.query({ playlistId, playlistUrl });
    },
    enabled: !!playlistId,
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: "offlineFirst",
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Bump lastViewedAt/viewCount once per playlist session so the playlist
  // appears (and ranks) correctly in Recent Playlists.
  useEffect(() => {
    if (!playlistId) return;
    trpcClient.playlists.updateView
      .mutate({ playlistId })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["playlists", "listAll"] });
      })
      .catch((error: unknown) => {
        logger.warn("[player] Failed to update playlist view stats", { playlistId, error });
      });
  }, [playlistId, queryClient]);

  // A Video started from a List, Favorites or YouTube playlist becomes its Current
  // Video (ADR-0006); started anywhere else, no Current Video moves.
  useEffect(() => {
    if (!videoId || !playlistId) return;
    trpcClient.collections.videoStarted
      .mutate({ videoId, collectionId: playlistId })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["playlists", "listAll"] });
        queryClient.invalidateQueries({ queryKey: ["playlist-details", playlistId] });
        queryClient.invalidateQueries({ queryKey: ["customPlaylist-details", playlistId] });
        queryClient.invalidateQueries({ queryKey: ["collections", "pickUp"] });
      })
      .catch((error: unknown) => {
        logger.warn("[player] Failed to record the Current Video", { playlistId, videoId, error });
      });
  }, [videoId, playlistId, queryClient]);

  const playlistData = playlistQuery.data;
  const playlistVideos = playlistData?.videos ?? [];
  const playlistCurrentIndex = playlistIndex ?? 0;

  // Check if there's a next/previous video
  const playlistHasNext = playlistCurrentIndex < playlistVideos.length - 1;
  const playlistHasPrevious = playlistCurrentIndex > 0;

  // Navigate to next video
  const goToNextVideo = useCallback(() => {
    if (!playlistHasNext || !playlistId) return;

    const nextIndex = playlistCurrentIndex + 1;
    const nextVideo = playlistVideos[nextIndex];

    if (nextVideo) {
      navigate({
        to: "/player",
        search: {
          videoId: nextVideo.videoId,
          playlistId,
          playlistUrl: playlistData?.url ?? playlistUrl,
          playlistIndex: nextIndex,
        },
      });
    }
  }, [
    playlistHasNext,
    playlistId,
    playlistData?.url,
    playlistUrl,
    playlistCurrentIndex,
    playlistVideos,
    navigate,
  ]);

  // Navigate to previous video
  const goToPreviousVideo = useCallback(() => {
    if (!playlistHasPrevious || !playlistId) return;

    const previousIndex = playlistCurrentIndex - 1;
    const previousVideo = playlistVideos[previousIndex];

    if (previousVideo) {
      navigate({
        to: "/player",
        search: {
          videoId: previousVideo.videoId,
          playlistId,
          playlistUrl: playlistData?.url ?? playlistUrl,
          playlistIndex: previousIndex,
        },
      });
    }
  }, [
    playlistHasPrevious,
    playlistId,
    playlistData?.url,
    playlistUrl,
    playlistCurrentIndex,
    playlistVideos,
    navigate,
  ]);

  const isPlaylist = !!playlistId && !!playlistData;
  const playlistTitle = playlistData?.title;
  const playlistTotalVideos = playlistVideos.length;

  const playbackStatus = playback && typeof playback.status === "string" ? playback.status : null;

  // Handle video load error (e.g., file was deleted)
  const handleVideoLoadError = useCallback(() => {
    logger.error("[PlayerPage] Video load error reported by VideoPlayer", {
      videoId,
      filePath,
    });
    setVideoLoadError(true);
  }, [videoId, filePath]);

  const handleSeek = useCallback((seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play();
    }
  }, []);

  useEffect(() => {
    if (!videoId) return;
    if (!filePath && playbackStatus === "completed") {
      logger.warn("[PlayerPage] Completed download missing file path", { videoId });
    }

    return () => {
      // Cleanup on unmount
    };
  }, [videoId, filePath, playbackStatus]);

  useEffect(() => {
    if (!filePath) return;
    const normalizedPath = filePath.toLowerCase();
    if (ensuredDirectoryRef.current.has(normalizedPath)) {
      return;
    }

    ensureDirectoryAccessMutation.mutate(filePath, {
      onSuccess: (result) => {
        if (result.success) {
          ensuredDirectoryRef.current.add(normalizedPath);
        } else {
          logger.warn("[PlayerPage] Failed to gain directory access", {
            videoId,
            filePath,
            result,
          });
          toast.error(result.message || "LearnifyTube needs access to this folder.");
          setVideoLoadError(true);
        }
      },
      onError: (error) => {
        logger.error("[PlayerPage] Directory access request failed", {
          videoId,
          filePath,
          error,
        });
        toast.error(error instanceof Error ? error.message : "Unable to access download folder");
        setVideoLoadError(true);
      },
    });
  }, [filePath]);

  // Check if video content is ready to show (for showing tools panel)
  const showVideoContent = !!(
    filePath &&
    mediaUrl &&
    !videoLoadError &&
    !playbackIsLoading &&
    videoId &&
    playback
  );

  return (
    <>
      {/* Global Seek Indicator Overlay - Always rendered to prevent layout shifts */}
      <div
        className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
        style={{ contain: "layout style paint" }}
        aria-hidden={!seekIndicator}
      >
        {seekIndicator && (
          <div className="flex items-center gap-3 rounded-lg bg-black/80 px-6 py-4 shadow-lg backdrop-blur-sm duration-200 animate-in fade-in zoom-in-95">
            {seekIndicator.direction === "backward" ? (
              <>
                <Rewind className="h-8 w-8 text-white" />
                <div className="text-white">
                  <p className="text-2xl font-bold">-{seekIndicator.amount}s</p>
                  <p className="text-xs text-white/70">Backward</p>
                </div>
              </>
            ) : (
              <>
                <div className="text-right text-white">
                  <p className="text-2xl font-bold">+{seekIndicator.amount}s</p>
                  <p className="text-xs text-white/70">Forward</p>
                </div>
                <FastForward className="h-8 w-8 text-white" />
              </>
            )}
          </div>
        )}
      </div>

      {/* Two-column layout: Main content + Tools sidebar */}
      <div className="flex h-full">
        {/* Left column: Main content (scrollable) */}
        <div className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-5xl space-y-6 px-4 py-4 pb-8 sm:px-6">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">
                      <ExternalLink
                        href={`https://www.youtube.com/watch?v=${videoId}`}
                        className="transition-colors hover:text-primary"
                        iconClassName="h-3.5 w-3.5 opacity-50 group-hover:opacity-100"
                      >
                        {videoTitle}
                      </ExternalLink>
                    </CardTitle>
                    {videoId && (
                      <FavoriteButton
                        entityType="video"
                        entityId={videoId}
                        size="sm"
                        variant="ghost"
                      />
                    )}
                    {videoId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={isOnDevices ? "text-primary" : "text-muted-foreground"}
                        onClick={() => toggleOnDevicesMutation.mutate(!isOnDevices)}
                        disabled={toggleOnDevicesMutation.isPending}
                        title={isOnDevices ? "Remove from Devices" : "Send to Devices"}
                      >
                        <MonitorSmartphone className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {videoId && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setShowAddToPlaylistDialog(true)}>
                          <ListPlus className="mr-2 h-4 w-4" />
                          Add to Mylist
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => toggleOnDevicesMutation.mutate(!isOnDevices)}
                        >
                          <MonitorSmartphone className="mr-2 h-4 w-4" />
                          {isOnDevices ? "Remove from Devices" : "Send to Devices"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => convertToAudioMutation.mutate()}
                          disabled={convertToAudioMutation.isPending}
                        >
                          <Music className="mr-2 h-4 w-4" />
                          Convert to Audio
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => startDownloadMutation.mutate()}
                          disabled={startDownloadMutation.isPending}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Re-download Video
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => deleteVideoMutation.mutate()}
                          disabled={deleteVideoMutation.isPending}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Video
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {/* Video progress indicator - only show when video is loaded */}
                {filePath && !videoLoadError && videoDuration && (
                  <VideoProgressIndicator
                    currentTime={currentTime}
                    duration={videoDuration}
                    className="mt-2"
                  />
                )}
              </CardHeader>
              <CardContent>
                {playbackIsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : !videoId ? (
                  <Alert>
                    <AlertTitle>Missing video</AlertTitle>
                    <AlertDescription>No video id provided.</AlertDescription>
                  </Alert>
                ) : !playback ? (
                  <Alert>
                    <AlertTitle>Not found</AlertTitle>
                    <AlertDescription>Could not find that video.</AlertDescription>
                  </Alert>
                ) : !filePath ? (
                  <DownloadStatus
                    videoId={videoId}
                    status={typeof playback?.status === "string" ? playback.status : undefined}
                    progress={playback?.progress ?? null}
                    onStartDownload={() => startDownloadMutation.mutate()}
                    isStarting={startDownloadMutation.isPending}
                    thumbnailPath={playback?.thumbnailPath}
                    thumbnailUrl={playback?.thumbnailUrl}
                    title={playback?.title}
                  />
                ) : !mediaUrl ? (
                  // File path exists in DB but actual file is missing - auto re-downloading
                  <DownloadStatus
                    videoId={videoId}
                    status={typeof playback?.status === "string" ? playback.status : "pending"}
                    progress={playback?.progress ?? null}
                    onStartDownload={() => startDownloadMutation.mutate()}
                    isStarting={startDownloadMutation.isPending}
                    thumbnailPath={playback?.thumbnailPath}
                    thumbnailUrl={playback?.thumbnailUrl}
                    title={playback?.title}
                  />
                ) : videoLoadError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Video file not found</AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>The video file could not be loaded. It may have been deleted or moved.</p>
                      <Button
                        onClick={() => startDownloadMutation.mutate()}
                        disabled={startDownloadMutation.isPending}
                      >
                        {startDownloadMutation.isPending
                          ? "Starting download..."
                          : "Re-download video"}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-4">
                    <VideoPlayer
                      videoRef={videoRef}
                      videoSrc={mediaUrl} // Use HTTP streaming URL
                      onTimeUpdate={handleTimeUpdate}
                      onError={handleVideoLoadError}
                      onSeekIndicator={(indicator) => setSeekIndicator(indicator)}
                    />

                    {/* Transcript - Self-contained, owns all its state */}
                    <TranscriptPanel
                      videoId={videoId}
                      videoRef={videoRef}
                      currentTime={currentTime}
                      playbackData={playback || null}
                      onSeekIndicator={(indicator) => setSeekIndicator(indicator)}
                    />

                    {playback?.description && (
                      <VideoDescription description={playback.description} onSeek={handleSeek} />
                    )}
                    {/* Playlist Navigation - Show when playing from a playlist */}
                    {isPlaylist && (
                      <PlaylistNavigation
                        playlistTitle={playlistTitle}
                        currentIndex={playlistCurrentIndex}
                        totalVideos={playlistTotalVideos}
                        hasNext={playlistHasNext}
                        hasPrevious={playlistHasPrevious}
                        onNext={goToNextVideo}
                        onPrevious={goToPreviousVideo}
                      />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right column: Video Tools Panel (Notes, Vocab, AI Summary, Quiz) */}
        {showVideoContent && (
          <VideoToolsPanel
            videoId={videoId}
            videoRef={videoRef}
            videoTitle={playback?.title || undefined}
            currentTime={currentTime}
          />
        )}
      </div>

      {/* Add to Playlist Dialog */}
      {videoId && (
        <AddToPlaylistDialog
          open={showAddToPlaylistDialog}
          onOpenChange={setShowAddToPlaylistDialog}
          videoId={videoId}
          videoTitle={videoTitle}
          channelTitle={playback?.channelTitle ?? undefined}
          thumbnailUrl={playback?.thumbnailUrl ?? undefined}
          durationSeconds={playback?.durationSeconds ?? undefined}
        />
      )}
    </>
  );
}
