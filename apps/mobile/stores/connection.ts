import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAppSurface } from "../core/hooks/useAppSurface";
import { verifyPairingCode } from "../services/verify-desktop";

const isTV = getAppSurface() === "tv";

interface ConnectionStore {
  // The desktop the app talks to right now. On the TV, the Desktop connection sets it while connected only.
  serverUrl: string | null;
  // The TV's saved desktop address, kept through Offline mode (services/desktop-connection).
  savedUrl: string | null;
  serverName: string | null;
  lastConnected: number | null;
  // The desktop's mobile sync pairing code (Desktop → Settings → Sync), sent on every request.
  pairingCode: string | null;
  setServerUrl: (url: string) => void;
  setServerName: (name: string) => void;
  setPairingCode: (code: string) => void;
  saveDesktop: (url: string, name: string) => void;
  forgetDesktop: () => void;
  disconnect: () => void;
  isConnected: () => boolean;
}

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set, get) => ({
      serverUrl: null,
      savedUrl: null,
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

      saveDesktop: (url, name) =>
        set({ savedUrl: url, serverName: name, lastConnected: Date.now() }),

      forgetDesktop: () => set({ savedUrl: null, serverName: null }),

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
      // On the TV, a desktop from the last session isn't connected until the Desktop connection
      // checks it; before savedUrl existed, serverUrl was the only saved address.
      merge: (persisted, current) => {
        // Nothing is persisted on a fresh install.
        const saved = (persisted ?? {}) as Partial<ConnectionStore>;
        const withVerifyCode = verifyPairingCode
          ? { pairingCode: verifyPairingCode }
          : {};
        if (!isTV) return { ...current, ...saved, ...withVerifyCode };
        return {
          ...current,
          ...saved,
          ...withVerifyCode,
          serverUrl: null,
          savedUrl: saved.savedUrl ?? saved.serverUrl ?? null,
        };
      },
    }
  )
);
