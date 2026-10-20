import React from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookPlayer, useBookPlayerState, type DesktopAudiobook } from "@/services/book-player";

/** The Track of this book the Book player is on, or null when it is on another book. */
export function useCurrentTrackId(bookId: string | undefined): string | null {
  const state = useBookPlayerState();
  if (!("trackIndex" in state) || state.book.id !== bookId) return null;
  return state.book.tracks[state.trackIndex]?.id ?? null;
}

// Play/Resume from the Listening position (from the start once finished),
// Pause while this book plays, and Start over.
export function AudiobookPlayButtons({ book }: { book: DesktopAudiobook }): React.JSX.Element {
  const state = useBookPlayerState();
  const status = state.status !== "idle" && state.book.id === book.id ? state.status : null;
  const canResume = book.listeningTrackId !== null && !book.finished;
  const disabled = book.tracks.every((track) => track.missing);

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {status === "playing" ? (
        <Button size="sm" className="gap-2" onClick={bookPlayer.pause}>
          <Pause className="h-4 w-4" />
          Pause
        </Button>
      ) : (
        <Button
          size="sm"
          className="gap-2"
          disabled={disabled}
          onClick={() => void (status === "paused" ? bookPlayer.resume() : bookPlayer.play(book))}
        >
          <Play className="h-4 w-4" />
          {status === "paused" || canResume ? "Resume" : "Play"}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={disabled}
        onClick={() => void bookPlayer.startOver(book)}
      >
        <RotateCcw className="h-4 w-4" />
        Start over
      </Button>
    </div>
  );
}
