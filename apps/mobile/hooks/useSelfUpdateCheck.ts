import { useEffect } from "react";
import {
  checkForAndroidApkUpdate,
  shouldCheckForUpdatesOnLaunch,
  type UpdateMessenger,
} from "../services/app-update";

/** Checks for an update once on launch, asking through `messenger`. */
export function useSelfUpdateCheck(messenger: UpdateMessenger) {
  useEffect(() => {
    if (!shouldCheckForUpdatesOnLaunch()) {
      return;
    }

    void checkForAndroidApkUpdate({ messenger });
    // Once per launch: the messenger's first value is the one to ask through.
  }, []);
}
