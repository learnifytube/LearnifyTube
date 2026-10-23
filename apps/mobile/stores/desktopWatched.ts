import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type DesktopWatchedState = {
  /** Videos the desktop last said are watched (about 90% played, or marked). */
  watched: Record<string, true>;
  /** Takes the desktop's Watch state of these Videos, by Video id. */
  remember: (states: Record<string, boolean>) => void;
};

/**
 * The desktop's Watch state of the Videos in the Lists and YouTube playlists
 * this Device loaded, kept for Offline mode. A Video counts as watched here
 * when the desktop says so or this Device's own progress does.
 */
export const useDesktopWatchedStore = create<DesktopWatchedState>()(
  persist(
    (set) => ({
      watched: {},
      remember: (states) =>
        set((state) => {
          const watched = { ...state.watched };
          for (const [videoId, isWatched] of Object.entries(states)) {
            if (isWatched) watched[videoId] = true;
            else delete watched[videoId];
          }
          return { watched };
        }),
    }),
    {
      name: "learnify-desktop-watched-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ watched: state.watched }),
    },
  ),
);

export const isWatchedOnDesktop = (videoId: string) =>
  useDesktopWatchedStore.getState().watched[videoId] === true;
