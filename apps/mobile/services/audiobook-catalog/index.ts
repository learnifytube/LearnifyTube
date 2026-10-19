import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { api } from "../api";
import { createAudiobookCatalog } from "./createAudiobookCatalog";

export const audiobookCatalog = createAudiobookCatalog({
  getInfo: (serverUrl) => api.getInfo(serverUrl),
  getAudiobooks: (serverUrl) => api.getAudiobooks(serverUrl),
});

const SNAPSHOT_KEY = "learnify-audiobook-catalog-snapshot";

/** The desktop's last Audiobook catalog, so Offline mode can list the books it can't play. */
export const audiobookCatalogSnapshot = {
  load: async (): Promise<Audiobook[] | null> => {
    try {
      const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
      return raw ? (JSON.parse(raw) as Audiobook[]) : null;
    } catch {
      return null;
    }
  },
  save: (audiobooks: Audiobook[]) => {
    AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(audiobooks)).catch(
      (error) => {
        console.warn("[AudiobookCatalog] Failed to save the snapshot", error);
      },
    );
  },
};
