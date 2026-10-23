import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AudiobookTrackPosition } from "../../shared/mobile-sync-contract";
import { newestWins } from "../../shared/newest-wins";
import type { KeptTrackPositions } from "../services/listening-position/trackPositions";

type TrackPositionsState = {
  /** The newest Track position this phone knows for each Track. */
  positions: KeptTrackPositions;
  keep: (positions: AudiobookTrackPosition[]) => void;
};

/**
 * Track positions kept on this phone (ADR-0006), so they hold in Offline mode;
 * they reach the desktop in the Device report too.
 */
export const useTrackPositionsStore = create<TrackPositionsState>()(
  persist(
    (set) => ({
      positions: {},
      keep: (kept) =>
        set((state) => {
          const positions = { ...state.positions };
          for (const position of kept) {
            positions[position.trackId] =
              newestWins(positions[position.trackId] ?? null, position) ??
              position;
          }
          return { positions };
        }),
    }),
    {
      name: "learnify-track-positions-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ positions: state.positions }),
    },
  ),
);
