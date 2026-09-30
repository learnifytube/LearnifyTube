import { create } from "zustand";
import type { TVMessageContent } from "../components/tv/tvMessages";

// A short TV message that outlives the screen that raised it, such as the player
// leaving when the desktop drops out. Not persisted.
export const useTVNoticeStore = create<{
  notice: TVMessageContent | null;
  show: (notice: TVMessageContent) => void;
  clear: () => void;
}>()((set) => ({
  notice: null,
  show: (notice) => set({ notice }),
  clear: () => set({ notice: null }),
}));
