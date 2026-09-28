import { AppState } from "react-native";
import { api, PairingRequiredError } from "../api";
import { getAndroidEmulatorHostConnectUrls } from "../android-emulator";
import { ensureDiscoveryPermissions } from "../discovery-permissions";
import { logger } from "../logger";
import { rescanPeers, subscribeToPeers } from "../p2p/discovery";
import {
  assertSyncCompatibility,
  SyncCompatibilityError,
} from "../sync-compatibility";
import { useConnectionStore } from "../../stores/connection";
import {
  createDesktopConnection,
  DEFAULT_SYNC_PORT,
  LEGACY_SYNC_PORT,
  type DesktopConnectionPlatform,
} from "./createDesktopConnection";

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

const platform: DesktopConnectionPlatform = {
  checkDesktop: async (url) => {
    try {
      const info = await api.getInfo(url);
      assertSyncCompatibility(info);
      return { kind: "ok", name: info.name || "Desktop" };
    } catch (error) {
      if (error instanceof PairingRequiredError)
        return { kind: "pairingRequired" };
      if (error instanceof SyncCompatibilityError) {
        return { kind: "incompatible", issue: error.issue };
      }
      return { kind: "unreachable" };
    }
  },
  discovery: {
    subscribe: (listener) => {
      let unsubscribe: (() => void) | null = null;
      let cancelled = false;
      ensureDiscoveryPermissions()
        .then(({ granted, details }) => {
          if (cancelled) return;
          if (!granted) {
            logger.warn(
              "[DesktopConnection] No permission to discover desktops",
              {
                details,
              },
            );
            return;
          }
          unsubscribe = subscribeToPeers(listener);
        })
        .catch((error) => {
          logger.warn("[DesktopConnection] Discovery failed to start", {
            reason: error instanceof Error ? error.message : String(error),
          });
        });
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },
    rescan: rescanPeers,
  },
  isForeground: () => AppState.currentState === "active",
  onForegroundChange: (listener) => {
    const subscription = AppState.addEventListener("change", listener);
    return () => subscription.remove();
  },
  loadSaved: async () => {
    await whenHydrated();
    const { savedUrl, pairingCode } = useConnectionStore.getState();
    return { url: savedUrl, pairingCode };
  },
  saveDesktop: (url, name) =>
    useConnectionStore.getState().saveDesktop(url, name),
  forgetDesktop: () => useConnectionStore.getState().forgetDesktop(),
  savePairingCode: (code) => useConnectionStore.getState().setPairingCode(code),
  fallbackUrls: getAndroidEmulatorHostConnectUrls([
    DEFAULT_SYNC_PORT,
    LEGACY_SYNC_PORT,
  ]),
  clock: {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) =>
      clearTimeout(timer as ReturnType<typeof setTimeout>),
  },
};

export const desktopConnection = createDesktopConnection(platform);

/**
 * Starts the Desktop connection and publishes the connected desktop as the connection
 * store's serverUrl, which the Device mirror, the Download queue and the API helpers read.
 */
export function startDesktopConnection() {
  const stop = desktopConnection.start();
  let unsubscribe = () => {};
  let cancelled = false;

  const publish = () => {
    const { url } = desktopConnection.getState();
    if (useConnectionStore.getState().serverUrl !== url) {
      useConnectionStore.setState({ serverUrl: url });
    }
  };

  void whenHydrated().then(() => {
    if (cancelled) return;
    publish();
    const unsubscribeConnection = desktopConnection.subscribe(publish);
    // TV Settings still connects and disconnects through the store; follow it.
    const unsubscribeStore = useConnectionStore.subscribe((state, previous) => {
      if (state.serverUrl === previous.serverUrl) return;
      const { url } = desktopConnection.getState();
      if (state.serverUrl === url) return;
      if (state.serverUrl)
        void desktopConnection.connectManually(state.serverUrl);
      else if (url) desktopConnection.disconnect();
    });
    unsubscribe = () => {
      unsubscribeConnection();
      unsubscribeStore();
    };
  });

  return () => {
    cancelled = true;
    stop();
    unsubscribe();
  };
}

export type {
  ConnectionStatus,
  DesktopConnectionState,
} from "./createDesktopConnection";
