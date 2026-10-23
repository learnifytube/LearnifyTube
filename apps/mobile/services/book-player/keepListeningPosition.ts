import { api } from "../api";
import { sendToResumeDesktop } from "../desktop-protocol";
import { useConnectionStore } from "../../stores/connection";
import { useListeningPositionsStore } from "../../stores/listeningPositions";
import { useTrackPositionsStore } from "../../stores/trackPositions";
import type { BookPlayer } from "../../../shared/book-player/createBookPlayer";
import { keepListeningPosition } from "../../../shared/book-player/keepListeningPosition";
import { trackPositionOfListening } from "../../../shared/listening-position";
import type { AudiobookTrackPosition } from "../../../shared/mobile-sync-contract";

/**
 * Keeps the Book player's Listening position on this phone, and tells the
 * desktop at every save, meaningful or periodic alike. The Device report
 * carries the kept positions too.
 */
export function keepListeningPositionOnPhone(player: BookPlayer) {
  return keepListeningPosition(player, ({ listening }) => {
    useListeningPositionsStore.getState().keep(listening);
    // The Track playing is where the Listening position is, so its Track
    // position follows it (the desktop does the same with reported ones);
    // only reaching its end marks a Track played to its end.
    const ofTrack = trackPositionOfListening(listening);
    if (ofTrack) useTrackPositionsStore.getState().keep([ofTrack]);
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

/**
 * Keeps Track positions on this phone and sends them to the desktop straight
 * away while connected; in Offline mode they wait for the next Device report.
 * A desktop older than resume (v5) is sent nothing.
 */
export function keepTrackPositionsOnPhone(positions: AudiobookTrackPosition[]) {
  if (positions.length === 0) return;
  useTrackPositionsStore.getState().keep(positions);
  sendToResumeDesktop(async (serverUrl) => {
    for (const position of positions) {
      await api.reportTrackPosition(serverUrl, position);
    }
  }, "Track positions");
}
