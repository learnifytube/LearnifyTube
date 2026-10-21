import React from "react";
import { formatTimeLeft, timeLeftInBook } from "../../../../shared/book-player/timeLeftInBook";
import { useBookPlayerState, useBookSpeed, useTrackProgress } from "@/services/book-player";

/**
 * How long the rest of the book takes at this speed, while it plays or is
 * paused. Hidden when a Track still to play has no known length.
 */
export function BookTimeLeft(): React.JSX.Element | null {
  const state = useBookPlayerState();
  const { elapsed, duration } = useTrackProgress();
  const speed = useBookSpeed();
  if (state.status !== "playing" && state.status !== "paused") return null;

  const left = timeLeftInBook({
    tracks: state.book.tracks,
    trackIndex: state.trackIndex,
    elapsed,
    trackLength: duration,
    speed,
  });
  if (left === null) return null;
  return (
    <p className="text-xs tabular-nums text-muted-foreground">
      {formatTimeLeft(left)} left in book
    </p>
  );
}
