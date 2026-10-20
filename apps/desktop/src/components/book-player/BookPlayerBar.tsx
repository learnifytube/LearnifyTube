import React from "react";
import { Link } from "@tanstack/react-router";
import {
  Pause,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookPlayer, useBookPlayerState } from "@/services/book-player";
import { BookSeekBar } from "./BookSeekBar";
import { BookSpeedMenu } from "./BookSpeedMenu";

const SKIP_SECONDS = 30;

/** How far toasts sit above the bottom while the bar shows, to clear its controls. */
export const BOOK_PLAYER_BAR_TOAST_OFFSET = 112;

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
 * the book, its Track, and the controls. Hidden until the user presses play,
 * and again once closed. A finished book can be played again, and a Track that
 * couldn't be played tried again.
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

      <div className="flex w-80 shrink-0 flex-col items-center lg:w-[28rem]">
        <div className="flex items-center gap-1">
          {control("Previous Track", <SkipBack className="h-4 w-4" />, bookPlayer.previousTrack)}
          {control(`Back ${SKIP_SECONDS}s`, <RotateCcw className="h-4 w-4" />, () =>
            bookPlayer.skip(-SKIP_SECONDS)
          )}
          {state.status === "finished"
            ? control("Play again", <Repeat className="h-5 w-5" />, bookPlayer.playAgain, false)
            : state.status === "unavailable"
              ? control("Try again", <RefreshCw className="h-5 w-5" />, bookPlayer.retry, false)
              : state.status === "playing"
                ? control("Pause", <Pause className="h-5 w-5" />, bookPlayer.pause)
                : control("Play", <Play className="h-5 w-5" />, bookPlayer.resume)}
          {control(`Forward ${SKIP_SECONDS}s`, <RotateCw className="h-4 w-4" />, () =>
            bookPlayer.skip(SKIP_SECONDS)
          )}
          {control("Next Track", <SkipForward className="h-4 w-4" />, bookPlayer.nextTrack)}
        </div>
        <BookSeekBar disabled={!active} />
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1">
        <BookSpeedMenu />
        {control("Close the Book player", <X className="h-4 w-4" />, bookPlayer.close, false)}
      </div>
    </div>
  );
}
