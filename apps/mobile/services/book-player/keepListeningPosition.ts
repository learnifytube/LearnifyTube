import { api } from "../api";
import { useConnectionStore } from "../../stores/connection";
import { useListeningPositionsStore } from "../../stores/listeningPositions";
import type { BookPlayer } from "../../../shared/book-player/createBookPlayer";
import { keepListeningPosition } from "../../../shared/book-player/keepListeningPosition";

/**
 * Keeps the Book player's Listening position on this phone, and tells the
 * desktop at every save, meaningful or periodic alike. The Device report
 * carries the kept positions too.
 */
export function keepListeningPositionOnPhone(player: BookPlayer) {
  return keepListeningPosition(player, ({ listening }) => {
    useListeningPositionsStore.getState().keep(listening);
    const serverUrl = useConnectionStore.getState().serverUrl;
    if (!serverUrl) return;
    api.reportListening(serverUrl, listening).catch((error) => {
      console.warn(
        "[BookPlayer] Reporting the Listening position failed",
        error,
      );
    });
  });
}
