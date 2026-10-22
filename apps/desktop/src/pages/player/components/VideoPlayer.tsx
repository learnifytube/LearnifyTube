import React, { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { logger } from "@/helpers/logger";
import { setIsPlaying } from "@/context/playerStore";

import { cn } from "@/lib/utils";

interface VideoPlayerProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  videoSrc: string | null; // Can be mediaUrl (HTTP) or local-file:// URL
  onTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
  onSeekIndicator?: (indicator: { direction: "forward" | "backward"; amount: number }) => void;
  onError?: () => void;
  className?: string;
  autoPlay?: boolean;
  onEnded?: () => void;
}

export function VideoPlayer({
  videoRef,
  videoSrc,
  onTimeUpdate,
  onSeekIndicator,
  onError,
  className,
  autoPlay = true,
  onEnded,
}: VideoPlayerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const isSeekingRef = useRef<boolean>(false);

  // Handle video load error
  const handleVideoError = (): void => {
    if (!videoRef) return;
    const video = videoRef.current;
    const mediaError = video?.error;

    // Comprehensive error logging to identify root cause
    const errorDetails: Record<string, unknown> = {
      src: video?.currentSrc,
      code: mediaError?.code,
      message: mediaError?.message,
      readyState: video?.readyState,
      networkState: video?.networkState,
    };

    // Add comprehensive video element state
    if (video) {
      // Check file format from source URL
      const src = video.currentSrc || video.src || "";
      errorDetails.sourceUrl = src;

      if (src.includes(".mp4") || src.toLowerCase().includes("mp4")) {
        errorDetails.fileFormat = "mp4";
      } else if (src.includes(".webm") || src.toLowerCase().includes("webm")) {
        errorDetails.fileFormat = "webm";
      }

      // Video element properties to diagnose file validity
      errorDetails.videoWidth = video.videoWidth;
      errorDetails.videoHeight = video.videoHeight;
      errorDetails.duration = video.duration;
      errorDetails.buffered =
        video.buffered.length > 0
          ? {
              start: video.buffered.start(0),
              end: video.buffered.end(0),
              length: video.buffered.length,
            }
          : null;
      errorDetails.seekable =
        video.seekable.length > 0
          ? {
              start: video.seekable.start(0),
              end: video.seekable.end(0),
              length: video.seekable.length,
            }
          : null;
      errorDetails.paused = video.paused;
      errorDetails.ended = video.ended;
      errorDetails.muted = video.muted;
      errorDetails.volume = video.volume;

      // Check codec support capabilities
      errorDetails.canPlayTypeMp4 = video.canPlayType("video/mp4");
      errorDetails.canPlayTypeWebm = video.canPlayType("video/webm");
      errorDetails.canPlayTypeMp4H264 = video.canPlayType('video/mp4; codecs="avc1.42E01E"');
      errorDetails.canPlayTypeMp4H265 = video.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"');

      // Note: getVideoTracks is not available on HTMLVideoElement (only on MediaStream)
      // Codec information is better obtained from yt-dlp format logs or file metadata

      // MEDIA_ERR codes: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
      const errorCodeNames: Record<number, string> = {
        1: "MEDIA_ERR_ABORTED",
        2: "MEDIA_ERR_NETWORK",
        3: "MEDIA_ERR_DECODE",
        4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
      };
      errorDetails.errorCodeName = mediaError?.code ? errorCodeNames[mediaError.code] : "UNKNOWN";

      // Additional diagnosis based on error code
      if (mediaError?.code === 3) {
        errorDetails.diagnosis =
          "DECODE error - file may be corrupted, incomplete, or use unsupported codec";
      } else if (mediaError?.code === 4) {
        errorDetails.diagnosis = "SRC_NOT_SUPPORTED - format/codec not supported by browser";
      } else if (mediaError?.code === 2) {
        errorDetails.diagnosis =
          "NETWORK error - file may not be accessible or protocol handler issue";
      }
    }

    logger.error("[VideoPlayer] video playback error - comprehensive diagnostics", errorDetails);
    if (onError) {
      onError();
    }
  };

  // Sync playing state to atom
  useEffect(() => {
    if (!videoRef) return;
    const video = videoRef.current;
    if (!video) return;

    const updatePlayingState = (e: Event): void => {
      const target = e.target;
      if (!(target instanceof HTMLVideoElement)) {
        return;
      }
      // Ignore events if the element is no longer connected to the DOM (unmounting)
      if (!target.isConnected) return;
      setIsPlaying(!target.paused);
    };

    video.addEventListener("play", updatePlayingState);
    video.addEventListener("pause", updatePlayingState);

    // Update initial state
    setIsPlaying(!video.paused);

    return () => {
      video.removeEventListener("play", updatePlayingState);
      video.removeEventListener("pause", updatePlayingState);
    };
  }, [videoRef]);

  // Timeout-based error detection for cases where video fails silently (e.g., 404 from media server)
  useEffect(() => {
    if (!videoRef || !videoSrc) return;
    const video = videoRef.current;
    if (!video) return;

    let loadedSuccessfully = false;
    const timeoutId = setTimeout(() => {
      // If video hasn't loaded metadata within 5 seconds, assume it failed
      if (!loadedSuccessfully && video.readyState < 1) {
        logger.error("[VideoPlayer] Video load timeout - file may be missing or inaccessible", {
          src: videoSrc,
          readyState: video.readyState,
          networkState: video.networkState,
        });
        if (onError) {
          onError();
        }
      }
    }, 5000);

    const handleMetadataLoaded = (): void => {
      loadedSuccessfully = true;
      clearTimeout(timeoutId);
    };

    video.addEventListener("loadedmetadata", handleMetadataLoaded);

    return () => {
      clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", handleMetadataLoaded);
    };
  }, [videoRef, videoSrc, onError]);

  // Log video metadata when successfully loaded
  useEffect(() => {
    if (!videoRef) return;
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = (): void => {
      const src = video.currentSrc || video.src || "";
      const fileFormat = src.includes(".mp4") ? "mp4" : src.includes(".webm") ? "webm" : "unknown";

      logger.info("[VideoPlayer] Video metadata loaded successfully", {
        src,
        fileFormat,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        duration: video.duration,
        readyState: video.readyState,
        networkState: video.networkState,
        canPlayTypeMp4: video.canPlayType("video/mp4"),
        canPlayTypeWebm: video.canPlayType("video/webm"),
        canPlayTypeMp4H264: video.canPlayType('video/mp4; codecs="avc1.42E01E"'),
        canPlayTypeMp4H265: video.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"'),
        note: "Video file loaded and metadata available. If playback fails, check error logs.",
      });
    };

    const handleCanPlay = (): void => {
      logger.info("[VideoPlayer] Video can start playing", {
        src: video.currentSrc || video.src || "",
        readyState: video.readyState,
        networkState: video.networkState,
        buffered:
          video.buffered.length > 0
            ? {
                start: video.buffered.start(0),
                end: video.buffered.end(0),
              }
            : null,
      });
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
    };
  }, [videoRef]);

  useEffect(() => {
    if (!videoRef) return;
    const video = videoRef.current;
    if (!video) return;

    const handleEnterPiP = (): void => {
      logger.debug("[VideoPlayer] enter picture-in-picture");
    };

    const handleLeavePiP = (): void => {
      logger.debug("[VideoPlayer] leave picture-in-picture");
      const shouldResume = video.paused && !video.ended;
      if (shouldResume) {
        void video.play().catch((err) => {
          logger.warn("[VideoPlayer] Failed to resume after PiP exit", err);
        });
      }
      video.focus();
    };

    video.addEventListener("enterpictureinpicture", handleEnterPiP);
    video.addEventListener("leavepictureinpicture", handleLeavePiP);

    return () => {
      video.removeEventListener("enterpictureinpicture", handleEnterPiP);
      video.removeEventListener("leavepictureinpicture", handleLeavePiP);
    };
  }, [videoRef]);

  // Automatically enter Picture-in-Picture when window is hidden/closed
  useEffect(() => {
    if (!videoRef) return;
    const video = videoRef.current;
    if (!video) return;

    const handleVisibilityChange = async (): Promise<void> => {
      // Only enter PiP if video is playing and not already in PiP
      if (
        document.hidden &&
        !video.paused &&
        !video.ended &&
        document.pictureInPictureElement !== video &&
        document.pictureInPictureEnabled
      ) {
        try {
          await video.requestPictureInPicture();
          logger.debug("[VideoPlayer] Auto-entered Picture-in-Picture on window hide");
        } catch (err) {
          // PiP might fail if user hasn't interacted with the page yet
          // or if it's not supported - silently handle this
          logger.debug("[VideoPlayer] Could not auto-enter PiP", err);
        }
      }
    };

    // Listen for visibility changes (window hide/show)
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Also listen for beforeunload to catch window close attempts
    const handleBeforeUnload = async (): Promise<void> => {
      if (
        !video.paused &&
        !video.ended &&
        document.pictureInPictureElement !== video &&
        document.pictureInPictureEnabled
      ) {
        try {
          await video.requestPictureInPicture();
          logger.debug("[VideoPlayer] Auto-entered Picture-in-Picture on window close");
        } catch (err) {
          logger.debug("[VideoPlayer] Could not auto-enter PiP on close", err);
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [videoRef]);

  // Mouse wheel seeking
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent): void => {
      // Only handle wheel events when hovering over the video player area
      if (!videoRef) return;
      const video = videoRef.current;
      if (!video) return;

      // Throttle: Ignore wheel events if we're already seeking
      if (isSeekingRef.current) {
        e.preventDefault();
        return;
      }

      // Prevent default scrolling
      e.preventDefault();

      // Mark as seeking
      isSeekingRef.current = true;

      // Determine seek direction and amount
      const seekAmount = 5; // seconds per scroll tick
      const direction = e.deltaY < 0 ? "backward" : "forward";
      const delta = direction === "forward" ? seekAmount : -seekAmount;

      // Seek the video
      const newTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
      video.currentTime = newTime;

      // Trigger shared seek indicator
      if (onSeekIndicator) onSeekIndicator({ direction, amount: seekAmount });

      // Reset seeking flag after a short delay
      setTimeout(() => {
        isSeekingRef.current = false;
      }, 200);
    };

    // Add wheel listener with passive: false to allow preventDefault
    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
      isSeekingRef.current = false;
    };
  }, [videoRef, onSeekIndicator]);

  // Keyboard shortcuts for seeking
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!videoRef) return;
      const video = videoRef.current;
      if (!video) return;

      // Only handle if video player area has focus or no input is focused
      const activeElement = document.activeElement;
      if (
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.getAttribute("contenteditable") === "true"
      ) {
        return;
      }

      let handled = false;
      let seekAmount = 0;
      let direction: "forward" | "backward" | null = null;

      switch (e.key) {
        case "ArrowLeft":
          seekAmount = 5;
          direction = "backward";
          video.currentTime = Math.max(0, video.currentTime - seekAmount);
          handled = true;
          break;
        case "ArrowRight":
          seekAmount = 5;
          direction = "forward";
          video.currentTime = Math.min(video.duration || 0, video.currentTime + seekAmount);
          handled = true;
          break;
        case "j":
        case "J":
          seekAmount = 10;
          direction = "backward";
          video.currentTime = Math.max(0, video.currentTime - seekAmount);
          handled = true;
          break;
        case "l":
        case "L":
          seekAmount = 10;
          direction = "forward";
          video.currentTime = Math.min(video.duration || 0, video.currentTime + seekAmount);
          handled = true;
          break;
        case "k":
        case "K":
        case " ":
          // Play/Pause
          if (video.paused) {
            video.play();
          } else {
            video.pause();
          }
          handled = true;
          break;
      }

      if (handled) {
        e.preventDefault();
        if (direction) {
          if (onSeekIndicator) onSeekIndicator({ direction, amount: seekAmount });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [videoRef, onSeekIndicator]);

  return (
    <div className="space-y-4" ref={containerRef}>
      <div className="group relative">
        {videoRef && videoSrc && (
          <video
            ref={videoRef}
            key={videoSrc}
            src={videoSrc}
            autoPlay={autoPlay}
            controls
            className={cn("aspect-video w-full rounded border bg-black object-contain", className)}
            onTimeUpdate={onTimeUpdate}
            onError={handleVideoError}
            onEnded={onEnded}
          />
        )}

        {/* Keyboard Shortcuts Hint (shows on hover) */}
        <div className="pointer-events-none absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="space-y-1 rounded-md bg-black/70 px-3 py-2 text-xs text-white backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                <ChevronLeft className="h-3 w-3" />
              </Badge>
              <span>5s back</span>
              <Badge variant="secondary" className="ml-2 px-1 py-0 text-[10px]">
                <ChevronRight className="h-3 w-3" />
              </Badge>
              <span>5s forward</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                J
              </Badge>
              <span>10s back</span>
              <Badge variant="secondary" className="ml-2 px-1 py-0 text-[10px]">
                L
              </Badge>
              <span>10s forward</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                K/Space
              </Badge>
              <span>Play/Pause</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                Scroll
              </Badge>
              <span>Seek ±5s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
