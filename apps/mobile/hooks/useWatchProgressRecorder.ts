import { useEffect, useRef } from "react";
import type { VideoPlayer } from "expo-video";
import { upsertWatchProgress } from "../db/repositories/watchHistory";

type WatchedVideo = {
  id: string;
  title: string;
  channelTitle: string;
  duration: number;
  thumbnailUrl?: string | null;
};

const SAVE_INTERVAL_MS = 5000;

// Records where playback is, so the desktop's Watch state can follow what was watched here.
export function useWatchProgressRecorder(
  player: VideoPlayer,
  video: WatchedVideo | undefined,
) {
  const videoRef = useRef(video);
  videoRef.current = video;
  const videoId = video?.id;

  useEffect(() => {
    if (!videoId) return;
    let unsaved = 0;

    const save = (positionSeconds: number) => {
      const current = videoRef.current;
      if (!current || current.id !== videoId || positionSeconds <= 0) return;
      try {
        upsertWatchProgress({
          videoId,
          title: current.title,
          channelTitle: current.channelTitle,
          duration: current.duration,
          thumbnailUrl: current.thumbnailUrl ?? null,
          lastPositionSeconds: positionSeconds,
          additionalWatchSeconds: unsaved,
        });
        unsaved = 0;
      } catch (error) {
        console.warn("[WatchProgress] Failed to save", error);
      }
    };

    const interval = setInterval(() => {
      if (!player.playing) return;
      unsaved += SAVE_INTERVAL_MS / 1000;
      save(player.currentTime);
    }, SAVE_INTERVAL_MS);
    const endSubscription = player.addListener("playToEnd", () => {
      save(player.duration || videoRef.current?.duration || player.currentTime);
    });

    return () => {
      clearInterval(interval);
      endSubscription.remove();
      try {
        save(player.currentTime);
      } catch {
        // The player may already be released when the screen closes.
      }
    };
  }, [player, videoId]);
}
