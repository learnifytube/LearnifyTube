import { api } from "../api";
import { desktopProtocol, supportsProtocol } from "../desktop-protocol";
import { useConnectionStore } from "../../stores/connection";
import { useListeningPositionsStore } from "../../stores/listeningPositions";
import { useTrackPositionsStore } from "../../stores/trackPositions";
import type { BookPlayer } from "../../../shared/book-player/createBookPlayer";
import { keepListeningPosition } from "../../../shared/book-player/keepListeningPosition";
import {
  RESUME_SYNC_PROTOCOL_VERSION,
  type AudiobookTrackPosition,
} from "../../../shared/mobile-sync-contract";

/**
 * Keeps the Book player's Listening position on this phone, and tells the
 * desktop at every save, meaningful or periodic alike. The Device report
 * carries the kept positions too.
 */
export function keepListeningPositionOnPhone(player: BookPlayer) {
  return keepListeningPosition(player, ({ listening }) => {
    useListeningPositionsStore.getState().keep(listening);
    // The Track playing is where the Listening position is, so its Track
    // position follows it (the desktop does the same with reported ones).
    useTrackPositionsStore.getState().keep([
      {
        audiobookId: listening.audiobookId,
        trackId: listening.trackId,
        seconds: listening.seconds,
        playedToEnd: listening.finished,
        updatedAt: listening.updatedAt,
      },
    ]);
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
  const serverUrl = useConnectionStore.getState().serverUrl;
  if (!serverUrl) return;
  // Unknown until the Device mirror learns it: the next report carries them.
  const version = desktopProtocol.known(serverUrl);
  if (!supportsProtocol(version, RESUME_SYNC_PROTOCOL_VERSION)) return;
  void (async () => {
    for (const position of positions) {
      await api.reportTrackPosition(serverUrl, position);
    }
  })().catch((error) => {
    console.warn("[BookPlayer] Reporting Track positions failed", error);
  });
}
