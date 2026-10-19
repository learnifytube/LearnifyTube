import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Audiobook } from "../../shared/mobile-sync-contract";

type AudiobookCatalogState = {
  serverUrl: string | null;
  audiobooks: Audiobook[];
};

/**
 * The Audiobooks the desktop at `serverUrl` served last, for the Home rows and
 * the book screen. Saved between launches, so Offline mode still lists them.
 */
export const useAudiobookCatalogStore = create<AudiobookCatalogState>()(
  persist((): AudiobookCatalogState => ({ serverUrl: null, audiobooks: [] }), {
    name: "learnify-audiobook-catalog-v1",
    storage: createJSONStorage(() => AsyncStorage),
  }),
);
