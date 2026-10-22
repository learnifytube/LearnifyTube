import { useEffect, useState } from "react";

/**
 * A player's controls: shown at first, and hidden `hideAfterMs` after the
 * last touch while playing. `show` and `toggle` restart the wait.
 */
export function usePlayerOverlay(isPlaying: boolean, hideAfterMs: number) {
  const [visible, setVisible] = useState(true);
  const [touches, setTouches] = useState(0);

  useEffect(() => {
    if (!visible || !isPlaying) return;
    const timeout = setTimeout(() => setVisible(false), hideAfterMs);
    return () => clearTimeout(timeout);
  }, [visible, isPlaying, touches, hideAfterMs]);

  return {
    visible,
    show: () => {
      setVisible(true);
      setTouches((count) => count + 1);
    },
    hide: () => setVisible(false),
    toggle: () => {
      setVisible((shown) => !shown);
      setTouches((count) => count + 1);
    },
  };
}
