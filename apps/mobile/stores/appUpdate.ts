import { create } from "zustand";
import {
  getAndroidApkUpdateAvailability,
  type AndroidApkUpdateAvailability,
} from "../services/app-update";

// Whether a newer phone APK is out. The launch check fills it and Settings
// reads it, so nothing pops over the screen. Not persisted.
export const useAppUpdateStore = create<{
  availability: AndroidApkUpdateAvailability | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}>()((set, get) => ({
  availability: null,
  isLoading: false,
  refresh: async () => {
    if (get().isLoading) return;
    set({ isLoading: true });
    try {
      set({ availability: await getAndroidApkUpdateAvailability() });
    } finally {
      set({ isLoading: false });
    }
  },
}));
