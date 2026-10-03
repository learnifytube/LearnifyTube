import { useEffect } from "react";
import { PairingRequiredError, api } from "../services/api";
import { getAppSurface } from "../core/hooks/useAppSurface";
import { useConnectionStore } from "../stores/connection";

const HEALTH_MS = 15_000;
const HEALTH_TIMEOUT_MS = 4_000;

const whenHydrated = () =>
  new Promise<void>((resolve) => {
    if (useConnectionStore.persist.hasHydrated()) {
      resolve();
      return;
    }
    const unsubscribe = useConnectionStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });

/** Phone only: /info decides connected vs Offline mode, not a failed catalog fetch. */
export function usePhoneDesktopHealth() {
  useEffect(() => {
    if (getAppSurface() === "tv") return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const probe = async () => {
      const { serverUrl, savedUrl, markOffline, setServerUrl } =
        useConnectionStore.getState();
      const url = serverUrl ?? savedUrl;
      if (!url) return;

      try {
        await api.getInfo(url, { timeoutMs: HEALTH_TIMEOUT_MS });
        if (cancelled) return;
        if (useConnectionStore.getState().serverUrl !== url) {
          setServerUrl(url);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof PairingRequiredError) return;
        markOffline();
      }
    };

    void whenHydrated().then(() => {
      if (cancelled) return;
      void probe();
      timer = setInterval(probe, HEALTH_MS);
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);
}
