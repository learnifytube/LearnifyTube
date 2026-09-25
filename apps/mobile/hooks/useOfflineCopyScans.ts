import { useEffect } from "react";
import { AppState } from "react-native";
import { offlineCopy } from "../services/offline-copy";
import { subscribeToVideoStorageLocation } from "../services/storage-location";

// Scans run once the database is ready (this hook mounts inside the database
// gate), when the Storage location changes, and when the app returns to the
// foreground, which catches a USB drive being plugged back in.
export function useOfflineCopyScans() {
  useEffect(() => {
    void offlineCopy.scan();

    let appState = AppState.currentState;
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextAppState) => {
        if (
          appState.match(/inactive|background/) &&
          nextAppState === "active"
        ) {
          void offlineCopy.scan();
        }
        appState = nextAppState;
      },
    );
    const unsubscribeLocation = subscribeToVideoStorageLocation(() => {
      void offlineCopy.scan();
    });

    return () => {
      appStateSubscription.remove();
      unsubscribeLocation();
    };
  }, []);
}
