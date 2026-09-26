import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface ConnectionStore {
  serverUrl: string | null;
  serverName: string | null;
  lastConnected: number | null;
  // The desktop's mobile sync pairing code (Desktop → Settings → Sync), sent on every request.
  pairingCode: string | null;
  setServerUrl: (url: string) => void;
  setServerName: (name: string) => void;
  setPairingCode: (code: string) => void;
  disconnect: () => void;
  isConnected: () => boolean;
}

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set, get) => ({
      serverUrl: null,
      serverName: null,
      lastConnected: null,
      pairingCode: null,

      setServerUrl: (url) =>
        set({
          serverUrl: url,
          lastConnected: Date.now(),
        }),

      setServerName: (name) => set({ serverName: name }),

      setPairingCode: (code) => set({ pairingCode: code.trim() || null }),

      disconnect: () =>
        set({
          serverUrl: null,
          serverName: null,
          lastConnected: null,
        }),

      isConnected: () => get().serverUrl !== null,
    }),
    {
      name: "learnify-connection",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
