import React from "react";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpcClient } from "@/utils/trpc";
import { queryClient } from "@/utils/queryClient";
import { bookPlayer, useBookPlayerState } from "@/services/book-player";

// Plays a book from its Listening position, read fresh so it resumes where it left off.
const playFromListening = async (id: string): Promise<void> => {
  const book = await queryClient.fetchQuery({
    queryKey: ["audiobooks", "get", id],
    queryFn: () => trpcClient.audiobooks.get.query({ id }),
    staleTime: 0,
  });
  if (!book) return;
  if (book.tracks.every((track) => track.missing)) {
    toast.error("This book's files are missing");
    return;
  }
  await bookPlayer.play(book);
};

/**
 * The play button over an Audiobook card's cover: resumes the book from its
 * Listening position, or pauses it while it plays. Sits beside the card's link.
 */
export function AudiobookCardPlayButton({
  bookId,
  title,
}: {
  bookId: string;
  title: string;
}): React.JSX.Element {
  const state = useBookPlayerState();
  const status = state.status !== "idle" && state.book.id === bookId ? state.status : null;
  const playing = status === "playing";
  const label = playing ? `Pause ${title}` : `Play ${title}`;

  return (
    <button
      type="button"
      aria-label={label}
      title={playing ? "Pause" : "Play"}
      className={cn(
        "pointer-events-auto absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-opacity hover:scale-105 focus-visible:opacity-100 group-hover:opacity-100",
        status === "playing" || status === "paused" ? "opacity-100" : "opacity-0"
      )}
      onClick={() => {
        if (playing) bookPlayer.pause();
        else if (status === "paused") bookPlayer.resume();
        else playFromListening(bookId).catch(() => toast.error("Couldn't play this book"));
      }}
    >
      {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
    </button>
  );
}
