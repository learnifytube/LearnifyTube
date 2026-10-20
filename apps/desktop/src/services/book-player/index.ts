import { useSyncExternalStore } from "react";
import { logger } from "@/helpers/logger";
import { trpcClient } from "@/utils/trpc";
import { queryClient } from "@/utils/queryClient";
import type { BookPlayerState } from "../../../../shared/book-player/createBookPlayer";
import { createDesktopBookPlayer } from "./desktopBookPlayer";

/**
 * The desktop's one Book player. Its `<audio>` element belongs to this module,
 * not to a page, so the book keeps playing while the user browses and while the
 * window is hidden to the tray. Nothing plays after a restart until the user
 * presses play.
 */
export const bookPlayer = createDesktopBookPlayer({
  audio: document.createElement("audio"),
  saveListening: ({ listening, moment }) => {
    trpcClient.audiobooks.recordListening
      .mutate(listening)
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

export function useBookPlayerState(): BookPlayerState {
  return useSyncExternalStore(bookPlayer.subscribe, bookPlayer.getState);
}

export type { DesktopAudiobook } from "./desktopBookPlayer";
export type { BookPlayerState };
