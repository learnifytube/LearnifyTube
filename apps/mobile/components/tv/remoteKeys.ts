/** A hardware key event from react-native's `onHWKeyEvent`. */
export type RemoteKeyEvent = { eventType?: string; eventKeyAction?: number };

const MEDIA_KEYS = new Set(["playPause", "rewind", "fastForward"]);

// Android's KeyEvent.ACTION_UP.
const KEY_UP = 1;

function getDirection(eventType: string) {
  const normalized = eventType.toLowerCase();
  for (const direction of ["up", "down", "left", "right"] as const) {
    if (
      normalized === direction ||
      normalized === `arrow${direction}` ||
      normalized.includes(`dpad_${direction}`)
    ) {
      return direction;
    }
  }
  return null;
}

export function decideRemoteKey(
  event: RemoteKeyEvent,
  state: { overlayVisible: boolean; progressFocused: boolean },
) {
  const eventType = event.eventType;
  if (!eventType || eventType === "focus" || eventType === "blur") {
    return { kind: "ignore" } as const;
  }

  // While the overlay is hidden, a d-pad press only shows it: it doesn't pause, skip or
  // seek. Some TV remotes only emit ACTION_UP for the d-pad, so either action wakes it.
  if (!state.overlayVisible && !MEDIA_KEYS.has(eventType)) {
    // Show the overlay and focus it. Only Select clicks the focused button, so
    // swallow that click.
    return { kind: "wake", suppressPress: eventType === "select" } as const;
  }

  if (event.eventKeyAction === KEY_UP) return { kind: "ignore" } as const;

  const direction = getDirection(eventType);
  if (direction && state.progressFocused) {
    if (direction === "left" || direction === "right") {
      return {
        kind: "seek",
        direction: direction === "right" ? 1 : -1,
      } as const;
    }
    // Down from the progress row, the bottom of the overlay, hides it.
    if (direction === "down") return { kind: "hide" } as const;
  }

  // Play/pause also reaches expo-video's media session, which toggles playback itself;
  // toggling here too would undo it.
  if (eventType === "rewind" || eventType === "fastForward") {
    return {
      kind: "seek",
      direction: eventType === "fastForward" ? 1 : -1,
    } as const;
  }

  // Keep the overlay showing and restart its auto-hide.
  return { kind: "show" } as const;
}

/** What the TV player's overlay does with a remote key. */
export type RemoteKeyCommand = ReturnType<typeof decideRemoteKey>;
