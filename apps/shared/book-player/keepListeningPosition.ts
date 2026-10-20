import type { AudiobookListening } from "../mobile-sync-contract";
import type { BookPlayer } from "./createBookPlayer";

const WHILE_PLAYING_MS = 15_000;

/**
 * A save of the Listening position: a meaningful moment (play, pause, Track
 * change, finish) or a periodic save while playing.
 */
export type ListeningSave = {
  listening: AudiobookListening;
  moment: "meaningful" | "periodic";
};

/**
 * Tells `report` the Book player's Listening position on every play, pause,
 * Track change and finish, and every 15 seconds while playing. Returns a
 * function that stops it.
 */
export function keepListeningPosition(
  player: BookPlayer,
  report: (save: ListeningSave) => void,
) {
  const save = (moment: ListeningSave["moment"]) => {
    const position = player.listeningPosition();
    if (!position) return;
    report({ listening: { ...position, updatedAt: Date.now() }, moment });
  };

  const unsubscribe = player.subscribe(() => save("meaningful"));
  const interval = setInterval(() => {
    if (player.getState().status === "playing") save("periodic");
  }, WHILE_PLAYING_MS);

  return () => {
    unsubscribe();
    clearInterval(interval);
  };
}
