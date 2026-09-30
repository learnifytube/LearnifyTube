import { useRef, useState, type ReactNode } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";
import { TVFocusPressable } from "./TVFocusPressable";
import type { UpdateMessenger } from "../../services/app-update";
import {
  describeUpdateMessage,
  describeUpdateQuestion,
  type TVMessageText,
  type TVQuestionContent,
} from "./tvMessages";

/** A message's title and text with its actions below, laid out for the couch. */
export function TVMessageCard({
  message,
  children,
}: {
  message: TVMessageText;
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

type ResolveAnswer = ((answer: boolean) => void) | null;

/** Resolves the open question's promise, if there is one, exactly once. */
function resolvePendingAnswer(
  resolveRef: { current: ResolveAnswer },
  answer: boolean,
) {
  const resolve = resolveRef.current;
  resolveRef.current = null;
  resolve?.(answer);
}

type OpenMessage =
  | { kind: "message"; content: TVMessageText }
  | { kind: "question"; content: TVQuestionContent };

/**
 * Shows TV messages in place of system alerts. The message opens in its own window
 * with OK focused; Android keeps the screen's focused view while it's open, so focus
 * goes back there when OK or Back closes it. `ask` shows two answers with the first
 * focused and resolves true for it; Back, the second answer or a newer message
 * resolve false.
 */
export function useTVMessage() {
  const [open, setOpen] = useState<OpenMessage | null>(null);
  const resolveRef = useRef<ResolveAnswer>(null);

  const answer = (value: boolean) => {
    resolvePendingAnswer(resolveRef, value);
    setOpen(null);
  };

  const show = (content: TVMessageText) => {
    resolvePendingAnswer(resolveRef, false);
    setOpen({ kind: "message", content });
  };

  const ask = (content: TVQuestionContent) => {
    resolvePendingAnswer(resolveRef, false);
    setOpen({ kind: "question", content });
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  };

  const element = (
    <Modal
      visible={open !== null}
      transparent
      animationType="fade"
      onRequestClose={() => answer(false)}
    >
      <View style={styles.backdrop}>
        {open?.kind === "message" ? (
          <TVMessageCard message={open.content}>
            <TVMessageButton
              label="OK"
              onPress={() => answer(false)}
              hasTVPreferredFocus
            />
          </TVMessageCard>
        ) : null}
        {open?.kind === "question" ? (
          <TVMessageCard message={open.content}>
            <TVMessageButton
              label={open.content.confirmLabel}
              onPress={() => answer(true)}
              hasTVPreferredFocus
            />
            <TVMessageButton
              label={open.content.cancelLabel}
              onPress={() => answer(false)}
            />
          </TVMessageCard>
        ) : null}
      </View>
    </Modal>
  );

  return { show, ask, isOpen: open !== null, element };
}

/** The update check's prompts as a screen's TV messages, in viewer wording. */
export function toTVUpdateMessenger({
  show,
  ask,
}: Pick<ReturnType<typeof useTVMessage>, "show" | "ask">) {
  return {
    show: (message) => show(describeUpdateMessage(message)),
    ask: (question) => ask(describeUpdateQuestion(question)),
  } satisfies UpdateMessenger;
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
