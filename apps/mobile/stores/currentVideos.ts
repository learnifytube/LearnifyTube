import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  CollectionRef,
  CurrentVideo,
} from "../../shared/mobile-sync-contract";
import { newestWins } from "../../shared/newest-wins";

const keyOf = ({ kind, id }: CollectionRef) => `${kind}:${id}`;

type CurrentVideosState = {
  /** The newest Current Video this Device knows for each List and YouTube playlist. */
  currentVideos: Record<string, CurrentVideo>;
  /** Which collection each collection screen named, so it resumes in Offline mode too. */
  collections: Record<string, CollectionRef>;
  keep: (currentVideo: CurrentVideo) => void;
  rememberCollection: (screenKey: string, collection: CollectionRef) => void;
};

/**
 * Current Videos kept on this Device: the desktop's and the Device's own,
 * newest wins. The Device report carries them to the desktop.
 */
export const useCurrentVideosStore = create<CurrentVideosState>()(
  persist(
    (set) => ({
      currentVideos: {},
      collections: {},
      keep: (currentVideo) =>
        set((state) => {
          const key = keyOf({
            kind: currentVideo.collectionKind,
            id: currentVideo.collectionId,
          });
          const existing = state.currentVideos[key] ?? null;
          if (newestWins(existing, currentVideo) !== currentVideo) return state;
          return {
            currentVideos: { ...state.currentVideos, [key]: currentVideo },
          };
        }),
      rememberCollection: (screenKey, collection) =>
        set((state) => {
          const known = state.collections[screenKey];
          if (known?.kind === collection.kind && known.id === collection.id)
            return state;
          return {
            collections: { ...state.collections, [screenKey]: collection },
          };
        }),
    }),
    {
      name: "learnify-current-videos-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        currentVideos: state.currentVideos,
        collections: state.collections,
      }),
    },
  ),
);

export const currentVideoOf = (
  currentVideos: Record<string, CurrentVideo>,
  collection: CollectionRef,
) => currentVideos[keyOf(collection)] ?? null;
