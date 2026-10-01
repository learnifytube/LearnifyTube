/**
 * Android TV sizes and the one focus treatment, for viewing from across a room.
 * Colors stay the shared tokens in ./colors.
 */
import { colors } from "./colors";

export const tvFontSize = {
  caption: 16,
  body: 18,
  label: 20,
  title: 22,
  heading: 30,
} as const;

/** Every focusable TV element: a white ring that reads on any thumbnail, and a lift. */
export const tvFocus = {
  borderWidth: 4,
  borderColor: colors.foreground,
  shadowColor: colors.foreground,
  shadowOpacity: 0.35,
  shadowRadius: 16,
  elevation: 12,
  transform: [{ scale: 1.04 }],
} as const;

/** Unfocused elements keep a transparent ring of the same width, so focus doesn't shift layout. */
export const tvRestingBorder = {
  borderWidth: 4,
  borderColor: "transparent",
} as const;

/** colors.background at 88%: text over a thumbnail sits on this. */
export const tvScrim = "rgba(10, 15, 26, 0.88)";
