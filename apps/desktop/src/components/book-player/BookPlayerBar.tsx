import React from "react";
import { Link } from "@tanstack/react-router";
import { Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookPlayer, useBookPlayerState } from "@/services/book-player";

const SKIP_SECONDS = 30;

// What the bar says under the book title.
const trackLine = (state: ReturnType<typeof useBookPlayerState>): string => {
  if (state.status === "finished") return "Finished";
  if (state.status === "idle") return "";
  const track = state.book.tracks[state.trackIndex];
  const where = `Track ${state.trackIndex + 1} of ${state.book.tracks.length}`;
  if (state.status === "unavailable") return `${where} · can't be played`;
  return track ? `${where} · ${track.title}` : where;
};

/**
 * The bar at the bottom of every page while a book is in the Book player:
 * the book, its Track, and the controls. Hidden until the user presses play.
 */
export function BookPlayerBar(): React.JSX.Element | null {
  const state = useBookPlayerState();
  if (state.status === "idle") return null;

  const active = state.status === "playing" || state.status === "paused";
  const control = (
    label: string,
    icon: React.ReactNode,
    onClick: () => unknown,
    disabled = !active
  ): React.JSX.Element => (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => void onClick()}
    >
      {icon}
    </Button>
  );

  return (
    <div
      role="region"
      aria-label="Book player"
      className="flex items-center gap-4 border-t bg-background/95 px-4 py-2 backdrop-blur"
    >
      <div className="min-w-0 flex-1">
        <Link
          to="/audiobook"
          search={{ id: state.book.id }}
          className="block truncate text-sm font-medium hover:underline"
        >
          {state.book.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">{trackLine(state)}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {control("Previous Track", <SkipBack className="h-4 w-4" />, bookPlayer.previousTrack)}
        {control(`Back ${SKIP_SECONDS}s`, <RotateCcw className="h-4 w-4" />, () =>
          bookPlayer.skip(-SKIP_SECONDS)
        )}
        {state.status === "playing"
          ? control("Pause", <Pause className="h-5 w-5" />, bookPlayer.pause)
          : control("Play", <Play className="h-5 w-5" />, bookPlayer.resume)}
        {control(`Forward ${SKIP_SECONDS}s`, <RotateCw className="h-4 w-4" />, () =>
          bookPlayer.skip(SKIP_SECONDS)
        )}
        {control("Next Track", <SkipForward className="h-4 w-4" />, bookPlayer.nextTrack)}
      </div>
    </div>
  );
}
