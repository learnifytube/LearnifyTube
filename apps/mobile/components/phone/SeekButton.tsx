import { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import { RotateCcw, RotateCw } from "../../theme/icons";
import {
  formatSeekNudge,
  SEEK_STEP_SECONDS,
  type SeekNudge,
} from "../playerSeek";

export const SEEK_BUTTON_SIZE = 56;

const NUDGE_HOLD_MS = 900;
const NUDGE_FADE_MS = 400;

type SeekButtonProps = {
  direction: 1 | -1;
  /** The latest taps' seconds, shown above the button when they went this way. */
  nudge: SeekNudge | null;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SeekButton({
  direction,
  nudge,
  onPress,
  style,
}: SeekButtonProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const ownNudge =
    nudge && Math.sign(nudge.amount) === direction ? nudge : null;

  useEffect(() => {
    // The button remounts when the controls come back; don't replay an old tap.
    if (!ownNudge || Date.now() - ownNudge.at > NUDGE_HOLD_MS) return;
    opacity.setValue(1);
    const fade = Animated.sequence([
      Animated.delay(NUDGE_HOLD_MS),
      Animated.timing(opacity, {
        toValue: 0,
        duration: NUDGE_FADE_MS,
        useNativeDriver: true,
      }),
    ]);
    fade.start();
    return () => fade.stop();
  }, [ownNudge?.at, opacity]);

  const Icon = direction === 1 ? RotateCw : RotateCcw;

  return (
    <Pressable
      testID={direction === 1 ? "seek-forward" : "seek-back"}
      style={[styles.button, style]}
      onPress={onPress}
      accessibilityLabel={`${direction === 1 ? "Forward" : "Back"} ${SEEK_STEP_SECONDS} seconds`}
      hitSlop={8}
    >
      <Icon size={26} color={colors.foreground} />
      {ownNudge ? (
        <Animated.Text style={[styles.nudge, { opacity }]} pointerEvents="none">
          {formatSeekNudge(ownNudge.amount)}
        </Animated.Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    zIndex: 2,
    width: SEEK_BUTTON_SIZE,
    height: SEEK_BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: SEEK_BUTTON_SIZE / 2,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  nudge: {
    position: "absolute",
    bottom: SEEK_BUTTON_SIZE + spacing.xs,
    width: 80,
    left: (SEEK_BUTTON_SIZE - 80) / 2,
    textAlign: "center",
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
