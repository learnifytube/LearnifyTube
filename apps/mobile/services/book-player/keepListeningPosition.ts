import { api } from "../api";
import { useConnectionStore } from "../../stores/connection";
import { useListeningPositionsStore } from "../../stores/listeningPositions";
import type { BookPlayer } from "./createBookPlayer";

const WHILE_PLAYING_MS = 15_000;

/**
 * Keeps the Book player's Listening position on this phone, and tells the
 * desktop: on every play, pause, Track change and finish, and every few
 * seconds while playing. The Device report carries the kept positions too.
 */
export function keepListeningPosition(player: BookPlayer) {
  const keep = () => {
    const position = player.listeningPosition();
    if (!position) return;
    const listening = { ...position, updatedAt: Date.now() };
    useListeningPositionsStore.getState().keep(listening);
    const serverUrl = useConnectionStore.getState().serverUrl;
    if (!serverUrl) return;
    api.reportListening(serverUrl, listening).catch((error) => {
      console.warn(
        "[BookPlayer] Reporting the Listening position failed",
        error,
      );
    });
  };

  const unsubscribe = player.subscribe(keep);
  const interval = setInterval(() => {
    if (player.getState().status === "playing") keep();
  }, WHILE_PLAYING_MS);

  return () => {
    unsubscribe();
    clearInterval(interval);
  };
}
