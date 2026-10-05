import * as NavigationBar from "expo-navigation-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import { setStatusBarHidden } from "expo-status-bar";

const { OrientationLock } = ScreenOrientation;

// The player replaces itself for each Video in the Play queue, so a short
// release delay keeps the rotation and hidden bars from flickering between Videos.
const RELEASE_DELAY_MS = 300;

let playerScreens = 0;
let pendingRelease: ReturnType<typeof setTimeout> | null = null;

function lock(orientation: ScreenOrientation.OrientationLock) {
  ScreenOrientation.lockAsync(orientation).catch((error) => {
    console.warn("[player] Failed to lock orientation", error);
  });
}

function setSystemBarsHidden(hidden: boolean) {
  setStatusBarHidden(hidden, "fade");
  NavigationBar.setVisibilityAsync(hidden ? "hidden" : "visible").catch(
    () => {},
  );
}

/**
 * Lets the phone player follow the phone's rotation while it is open; the app
 * returns to portrait when the player closes. Returns the release for unmount.
 */
export function holdPlayerOrientation() {
  playerScreens += 1;
  if (pendingRelease) {
    clearTimeout(pendingRelease);
    pendingRelease = null;
  } else if (playerScreens === 1) {
    lock(OrientationLock.DEFAULT);
  }

  return () => {
    playerScreens -= 1;
    if (playerScreens > 0) return;
    pendingRelease = setTimeout(() => {
      pendingRelease = null;
      setSystemBarsHidden(false);
      lock(OrientationLock.PORTRAIT_UP);
    }, RELEASE_DELAY_MS);
  };
}

/** The full-screen button: forces landscape, or back to portrait from landscape. */
export function toggleFullScreen(isLandscape: boolean) {
  lock(isLandscape ? OrientationLock.PORTRAIT_UP : OrientationLock.LANDSCAPE);
}

/** Full screen hides the status and navigation bars; swiping from an edge shows them briefly. */
export function setFullScreenBars(isLandscape: boolean) {
  setSystemBarsHidden(isLandscape);
}
