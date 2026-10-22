import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Movie, Series } from "../../shared/mobile-sync-contract";

type MovieCatalogState = {
  serverUrl: string | null;
  movies: Movie[];
  series: Series[];
};

/**
 * The Movies and Series the desktop at `serverUrl` served last, for the Home
 * rows and the Movie player. Saved between launches with the Catalog snapshot,
 * so Offline mode still lists them.
 */
export const useMovieCatalogStore = create<MovieCatalogState>()(
  persist(
    (): MovieCatalogState => ({ serverUrl: null, movies: [], series: [] }),
    {
      name: "learnify-movie-catalog-v1",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
