import React, { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { bookPlayer, useTrackProgress } from "@/services/book-player";

// "4:05", or "1:02:09" past an hour.
const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
};

/** Where the book is in its Track: elapsed and total time, and a bar to seek with. */
export function BookSeekBar({ disabled }: { disabled: boolean }): React.JSX.Element {
  const { elapsed, duration } = useTrackProgress();
  // Where the user is dragging to; the book seeks once they let go.
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? elapsed;

  return (
    <div className="flex w-full items-center gap-2 text-xs tabular-nums text-muted-foreground">
      <span className="w-12 shrink-0 text-right">{formatClock(shown)}</span>
      <Slider
        aria-label="Seek within the Track"
        min={0}
        max={duration || 1}
        step={1}
        value={[Math.min(shown, duration || 1)]}
        disabled={disabled || duration === 0}
        onValueChange={([value]) => setDragging(value ?? null)}
        onValueCommit={([value]) => {
          if (value !== undefined) bookPlayer.seekTo(value);
          setDragging(null);
        }}
        className="[&_.bg-secondary]:h-1 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
      />
      <span className="w-12 shrink-0">{formatClock(duration)}</span>
    </div>
  );
}
