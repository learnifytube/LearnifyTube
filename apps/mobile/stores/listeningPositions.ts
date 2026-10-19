import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AudiobookListening } from "../../shared/mobile-sync-contract";
import { newestListening } from "../../shared/listening-position";
import type { KeptListening } from "../services/listening-position/listeningPosition";

type ListeningPositionsState = {
  /** The newest Listening position this phone knows for each Audiobook. */
  positions: KeptListening;
  keep: (listening: AudiobookListening) => void;
};

/** Listening positions kept on this phone; they reach the desktop in the Device report too. */
export const useListeningPositionsStore = create<ListeningPositionsState>()(
  persist(
    (set) => ({
      positions: {},
      keep: (listening) =>
        set((state) => ({
          positions: {
            ...state.positions,
            [listening.audiobookId]:
              newestListening(
                state.positions[listening.audiobookId] ?? null,
                listening,
              ) ?? listening,
          },
        })),
    }),
    {
      name: "learnify-listening-positions-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ positions: state.positions }),
    },
  ),
);
