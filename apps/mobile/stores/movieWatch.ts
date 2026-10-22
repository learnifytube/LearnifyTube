import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { MovieWatch } from "../../shared/mobile-sync-contract";

/** One key per Movie or Episode, since their ids come from different tables. */
export const movieWatchKey = (kind: MovieWatch["kind"], id: string) =>
  `${kind}:${id}`;

type MovieWatchState = {
  /** Where this Device last stopped in each Movie and Episode it played. */
  progress: Record<string, MovieWatch>;
  keep: (watch: MovieWatch) => void;
};

/**
 * Movie and Episode progress made on this Device (never the Video watch
 * history: Movies aren't Videos, ADR-0005). It reaches the desktop in the
 * Device report.
 */
export const useMovieWatchStore = create<MovieWatchState>()(
  persist(
    (set) => ({
      progress: {},
      keep: (watch) =>
        set((state) => ({
          progress: {
            ...state.progress,
            [movieWatchKey(watch.kind, watch.id)]: watch,
          },
        })),
    }),
    {
      name: "learnify-movie-watch-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ progress: state.progress }),
    },
  ),
);
