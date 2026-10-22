import React, { useRef, useEffect } from "react";
import { useNavigate, useMatches } from "@tanstack/react-router";
import { Play, Pause, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toLocalFileUrl } from "@/helpers/localFile";
import {
  usePlayerStore,
  setIsPlaying,
  updateCurrentTime,
  setPlayerState,
} from "@/context/playerStore";
import { useWatchProgress } from "@/pages/player/hooks/useWatchProgress";
import Thumbnail from "@/components/Thumbnail";

export function MinimizedPlayer(): React.JSX.Element | null {
  const matches = useMatches();
  const currentPath = matches[matches.length - 1]?.pathname ?? "/";
  const isOnPlayerPage = currentPath === "/player";

  // Use a persistent ref that doesn't change
  const persistentVideoRef = useRef<HTMLVideoElement>(null);
  const playerState = usePlayerStore();
  const filePath = playerState.filePath;
  const playbackData = playerState.playback;
  const currentTime = playerState.currentTime;
  const isPlaying = playerState.isPlaying;
  const thumbnailPath = playerState.thumbnailPath;
  const thumbnailUrl = playerState.thumbnailUrl;
  const navigate = useNavigate();

  // Check if we have an active video
  const hasVideo = filePath && playbackData?.videoId;

  // Use the same watch progress hook to sync time (must be called before early return)
  const { handleTimeUpdate } = useWatchProgress(
    playbackData?.videoId,
    persistentVideoRef,
    playbackData?.resumeAtSeconds,
    {
      onCurrentTimeChange: (t) => updateCurrentTime(t),
    }
  );

  // When NOT on player page, use persistent video as the main video element
  // Restore currentTime and playback only once per filePath change
  const lastRestoredRef = useRef<{ filePath: string | null; time: number }>({
    filePath: null,
    time: 0,
  });
  useEffect(() => {
    if (isOnPlayerPage || !hasVideo) {
      return; // On player page, VideoPlayer handles the video
    }

    const persistentVideo = persistentVideoRef.current;
    if (!persistentVideo) return;

    // Only restore if filePath or time changed
    const shouldRestore =
      filePath !== lastRestoredRef.current.filePath ||
      Math.abs(currentTime - lastRestoredRef.current.time) > 1;

    if (!shouldRestore) {
      return;
    }

    const restoreTimeAndPlayback = (): void => {
      if (currentTime > 0 && Math.abs(persistentVideo.currentTime - currentTime) > 1) {
        persistentVideo.currentTime = currentTime;
      }
      lastRestoredRef.current = { filePath, time: currentTime };
      if (isPlaying && persistentVideo.paused) {
        persistentVideo.play().catch(() => {});
      } else if (!isPlaying && !persistentVideo.paused) {
        persistentVideo.pause();
      }
    };

    // Listen for loadedmetadata (guaranteed to fire before canplay)
    if (persistentVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
      restoreTimeAndPlayback();
    } else {
      persistentVideo.addEventListener("loadedmetadata", restoreTimeAndPlayback, { once: true });
    }

    return () => {
      persistentVideo.removeEventListener("loadedmetadata", restoreTimeAndPlayback);
    };
  }, [isOnPlayerPage, filePath, currentTime, isPlaying, hasVideo]);

  // Sync playing state to atom
  useEffect(() => {
    const persistentVideo = persistentVideoRef.current;
    if (!persistentVideo || isOnPlayerPage || !hasVideo) return;

    const updatePlayingState = (): void => {
      setIsPlaying(!persistentVideo.paused);
    };

    persistentVideo.addEventListener("play", updatePlayingState);
    persistentVideo.addEventListener("pause", updatePlayingState);

    return () => {
      persistentVideo.removeEventListener("play", updatePlayingState);
      persistentVideo.removeEventListener("pause", updatePlayingState);
    };
  }, [isOnPlayerPage, setIsPlaying, hasVideo]);

  // Only show if we have an active video
  if (!hasVideo) return null;

  const videoId = playbackData!.videoId;
  const videoTitle = playbackData!.title || videoId || "Video";

  // Get the active video ref (persistent when not on player page, or VideoPlayer's when on player page)
  const activeVideoRef = isOnPlayerPage ? null : persistentVideoRef;
  const activeIsPlaying = activeVideoRef?.current && !activeVideoRef.current.paused;

  // Format time display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const duration = activeVideoRef?.current?.duration || 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handlePlayPause = (): void => {
    if (!activeVideoRef?.current) return;
    if (activeVideoRef.current.paused) {
      activeVideoRef.current.play().catch(() => {
        // Ignore play errors
      });
    } else {
      activeVideoRef.current.pause();
    }
  };

  const handleMaximize = (): void => {
    navigate({
      to: "/player",
      search: {
        videoId,
        playlistId: playerState.playlistId ?? undefined,
        playlistIndex: playerState.playlistIndex ?? undefined,
      },
    });
  };

  const handleClose = (): void => {
    if (!activeVideoRef?.current) return;
    activeVideoRef.current.pause();
    setPlayerState({ isPlaying: false });
  };

  return (
    <>
      {/* Hidden persistent video element - only rendered when NOT on player page */}
      {!isOnPlayerPage && (
        <video
          ref={persistentVideoRef}
          key={filePath}
          src={toLocalFileUrl(filePath)}
          className="pointer-events-none fixed -z-50 opacity-0"
          style={{ width: "1px", height: "1px", position: "absolute", top: "-9999px" }}
          onTimeUpdate={handleTimeUpdate}
          playsInline
        />
      )}

      {/* Only show UI when not on player page */}
      {!isOnPlayerPage && (
        <div className="border-t border-primary/20 bg-muted/30 dark:border-primary/10 dark:bg-muted/20">
          <div className="flex items-center gap-2 p-2">
            {/* Thumbnail */}
            <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded bg-black">
              {thumbnailPath || thumbnailUrl ? (
                <Thumbnail
                  thumbnailPath={thumbnailPath ?? undefined}
                  thumbnailUrl={thumbnailUrl ?? undefined}
                  alt={videoTitle}
                  className="h-full w-full object-cover"
                  fallbackIcon={
                    <span className="text-[10px] text-muted-foreground">No preview</span>
                  }
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                  No preview
                </div>
              )}
            </div>

            {/* Video info and controls */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {/* Title */}
              <p className="truncate text-xs font-medium text-foreground">{videoTitle}</p>

              {/* Progress bar */}
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Time and controls */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {formatTime(currentTime)} / {duration > 0 ? formatTime(duration) : "--:--"}
                </span>

                <div className="flex items-center gap-1">
                  {/* Play/Pause button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={handlePlayPause}
                  >
                    {activeIsPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  </Button>

                  {/* Maximize button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={handleMaximize}
                    title="Open in player"
                  >
                    <Maximize2 className="h-3 w-3" />
                  </Button>

                  {/* Close button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={handleClose}
                    title="Stop"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
