import { useState, type ReactNode } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";
import { TVFocusPressable } from "./TVFocusPressable";
import type { TVMessageContent } from "./tvMessages";

/** A message's title and text with its actions below, laid out for the couch. */
export function TVMessageCard({
  message,
  children,
}: {
  message: Pick<TVMessageContent, "title" | "text">;
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{message.title}</Text>
      <Text style={styles.text}>{message.text}</Text>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

export function TVMessageButton({
  label,
  onPress,
  hasTVPreferredFocus,
}: {
  label: string;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
}) {
  return (
    <TVFocusPressable
      style={styles.button}
      focusedStyle={styles.buttonFocused}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TVFocusPressable>
  );
}

/**
 * Shows TV messages in place of system alerts. The message opens in its own window
 * with OK focused; Android keeps the screen's focused view while it's open, so focus
 * goes back there when OK or Back closes it.
 */
export function useTVMessage() {
  const [message, setMessage] = useState<TVMessageContent | null>(null);
  const close = () => setMessage(null);

  const element = (
    <Modal
      visible={message !== null}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        {message ? (
          <TVMessageCard message={message}>
            <TVMessageButton label="OK" onPress={close} hasTVPreferredFocus />
          </TVMessageCard>
        ) : null}
      </View>
    </Modal>
  );

  return { show: setMessage, isOpen: message !== null, element };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  card: {
    maxWidth: 640,
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize["3xl"],
    fontWeight: fontWeight.bold,
    textAlign: "center",
  },
  text: {
    color: colors.mutedForeground,
    fontSize: fontSize.xl,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  button: {
    minWidth: 140,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  buttonFocused: {
    borderColor: colors.warning,
    backgroundColor: colors.cardHover,
  },
  buttonText: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
});
