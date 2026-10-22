import { useEffect, useEffectEvent, useState } from "react";
import type { VideoPlayer } from "expo-video";

/**
 * Where the player is and how long its file is, for the progress bar. The
 * length is the player's once it knows it, else `knownDuration`. While
 * `holdPosition` says so (a seek the player hasn't caught up with), the
 * position stays where `setPosition` put it.
 */
export function usePlayerTime(
  player: VideoPlayer,
  {
    knownDuration,
    holdPosition = () => false,
  }: { knownDuration: number | null; holdPosition?: () => boolean },
) {
  const [time, setTime] = useState({ position: 0, duration: 0 });
  const held = useEffectEvent(holdPosition);

  useEffect(() => {
    const timeSubscription = player.addListener("timeUpdate", (event) => {
      if (held()) return;
      setTime((prev) => ({
        position: event.currentTime,
        duration: player.duration > 0 ? player.duration : prev.duration,
      }));
    });
    const loadSubscription = player.addListener("sourceLoad", (event) =>
      setTime((prev) => ({ ...prev, duration: event.duration })),
    );
    return () => {
      timeSubscription.remove();
      loadSubscription.remove();
    };
  }, [player]);

  const duration = time.duration > 0 ? time.duration : (knownDuration ?? 0);
  return {
    position: duration > 0 ? Math.min(time.position, duration) : time.position,
    duration,
    setPosition: (position: number) =>
      setTime((prev) => ({ ...prev, position })),
  };
}
