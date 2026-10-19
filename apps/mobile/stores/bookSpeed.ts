import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface BookSpeedStore {
  /** The Audiobook playback speed the listener chose, 0.75× to 2×. */
  speed: number;
  setSpeed: (speed: number) => void;
}

// Remembered across books and app starts; the Book player reads it at every Track.
export const useBookSpeedStore = create<BookSpeedStore>()(
  persist(
    (set) => ({
      speed: 1,
      setSpeed: (speed) => set({ speed }),
    }),
    {
      name: "learnify-book-speed",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
