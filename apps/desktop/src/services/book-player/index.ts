import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { logger } from "@/helpers/logger";
import { trpcClient } from "@/utils/trpc";
import { queryClient } from "@/utils/queryClient";
import type { BookPlayerState } from "../../../../shared/book-player/createBookPlayer";
import { createDesktopBookPlayer } from "./desktopBookPlayer";

/**
 * The desktop's one Book player. Its `<audio>` element belongs to this module,
 * not to a page, so the book keeps playing while the user browses and while the
 * window is hidden to the tray. Nothing plays after a restart until the user
 * presses play. Playing a Video pauses it.
 */
export const bookPlayer = createDesktopBookPlayer({
  audio: document.createElement("audio"),
  page: document,
  saveListening: ({ listening, moment }) => {
    trpcClient.audiobooks.recordListening
      .mutate({ listening, announce: moment === "meaningful" })
      .then(() => {
        // The Audiobook page shows Resume from the new spot.
        if (moment === "meaningful") {
          return queryClient.invalidateQueries({ queryKey: ["audiobooks", "get"] });
        }
      })
      .catch((error: unknown) => {
        logger.warn("[BookPlayer] Saving the Listening position failed", { error });
      });
  },
});

// A missing or unreadable Track is passed over; say which.
bookPlayer.onTracksSkipped((tracks) => {
  const names = tracks.map((track) => `"${track.title}"`).join(", ");
  toast.warning(tracks.length === 1 ? `Skipped ${names}` : `Skipped ${tracks.length} Tracks`, {
    description:
      tracks.length === 1
        ? "Its file is missing or can't be read."
        : `${names}: their files are missing or can't be read.`,
  });
});

export function useBookPlayerState(): BookPlayerState {
  return useSyncExternalStore(bookPlayer.subscribe, bookPlayer.getState);
}

export type { DesktopAudiobook } from "./desktopBookPlayer";
export type { BookPlayerState };
