import { forwardRef, type ComponentRef, useState } from "react";
import {
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { tvFocus } from "../../theme";

type TVFocusState = PressableStateCallbackType & { focused: boolean };

type FocusableStyle =
  StyleProp<ViewStyle> | ((state: TVFocusState) => StyleProp<ViewStyle>);

interface TVFocusPressableProps extends Omit<PressableProps, "style"> {
  style?: FocusableStyle;
  focusedStyle?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusUp?: number;
  nextFocusDown?: number;
}

export type TVFocusPressableHandle = ComponentRef<typeof Pressable>;

function resolveStyle(
  style: FocusableStyle | undefined,
  state: TVFocusState,
): StyleProp<ViewStyle> {
  if (typeof style === "function") return style(state);
  return style;
}

export const TVFocusPressable = forwardRef<
  TVFocusPressableHandle,
  TVFocusPressableProps
>(function TVFocusPressable(
  { style, focusedStyle, pressedStyle, onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      {...props}
      ref={ref}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={(state) => {
        const stateWithFocus: TVFocusState = { ...state, focused };
        return [
          resolveStyle(style, stateWithFocus),
          state.pressed && (pressedStyle ?? styles.defaultPressed),
          focused && (focusedStyle ?? styles.defaultFocused),
        ];
      }}
    />
  );
});

TVFocusPressable.displayName = "TVFocusPressable";

const styles = StyleSheet.create({
  defaultPressed: {
    opacity: 0.95,
    transform: [{ scale: 0.985 }],
  },
  defaultFocused: tvFocus,
});
