import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { OnDeviceSet } from "../../shared/mobile-sync-contract";

/** The On-device set as the Device mirror last fetched it, kept for Offline mode. */
export const useOnDeviceSetStore = create<OnDeviceSet>()(
  persist(() => ({ videos: [] as OnDeviceSet["videos"] }), {
    name: "learnify-on-device-set-v1",
    storage: createJSONStorage(() => AsyncStorage),
  }),
);
