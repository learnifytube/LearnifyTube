import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SeriesLastEpisode } from "../../shared/mobile-sync-contract";
import { newestWins } from "../../shared/newest-wins";

type SeriesLastEpisodesState = {
  /** The newest last Episode this Device knows for each Series, by Series id. */
  lastEpisodes: Record<string, SeriesLastEpisode>;
  keep: (entry: SeriesLastEpisode) => void;
};

/**
 * Each Series' last Episode as started on this Device (ADR-0006), kept in
 * Offline mode too; the Device report takes it to the desktop.
 */
export const useSeriesLastEpisodesStore = create<SeriesLastEpisodesState>()(
  persist(
    (set) => ({
      lastEpisodes: {},
      keep: (entry) =>
        set((state) => ({
          lastEpisodes: {
            ...state.lastEpisodes,
            [entry.seriesId]:
              newestWins(state.lastEpisodes[entry.seriesId] ?? null, entry) ??
              entry,
          },
        })),
    }),
    {
      name: "learnify-series-last-episodes-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ lastEpisodes: state.lastEpisodes }),
    },
  ),
);
