import { useEffect } from "react";
import type { VideoPlayer } from "expo-video";
import type { MovieWatch } from "../../shared/mobile-sync-contract";
import { deviceMirror } from "../services/device-mirror";
import { useMovieWatchStore } from "../stores/movieWatch";

const SAVE_INTERVAL_MS = 5000;

/**
 * Keeps where a Movie or Episode is playing on this Device; the Device report
 * takes it to the desktop. Never the Video watch history (ADR-0005).
 */
export function useMovieProgressRecorder(
  player: VideoPlayer,
  kind: MovieWatch["kind"],
  id: string,
): void {
  useEffect(() => {
    if (!id) return;
    const save = (positionSeconds: number): void => {
      if (positionSeconds <= 0) return;
      useMovieWatchStore.getState().keep({
        kind,
        id,
        lastPositionSeconds: positionSeconds,
        lastWatchedAt: Date.now(),
      });
    };
    const interval = setInterval(() => {
      if (player.playing) save(player.currentTime);
    }, SAVE_INTERVAL_MS);
    const endSubscription = player.addListener("playToEnd", () =>
      save(player.duration || player.currentTime),
    );
    return () => {
      clearInterval(interval);
      endSubscription.remove();
      try {
        save(player.currentTime);
      } catch {
        // The player may already be released when the screen closes.
      }
      // Tell the desktop now rather than at the next sync.
      void deviceMirror.syncNow();
    };
  }, [player, kind, id]);
}
