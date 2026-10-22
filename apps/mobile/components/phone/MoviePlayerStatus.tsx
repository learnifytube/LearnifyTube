import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import type { MovieKind } from "../../../shared/mobile-sync-contract";
import type {
  PlaybackFailure,
  PlaybackSourceKind,
} from "../../services/playback-source";
import { colors, fontSize, fontWeight, spacing } from "../../theme";

function failureText(failure: PlaybackFailure, kind: MovieKind) {
  const what = kind === "episode" ? "episode" : "movie";
  if (failure.kind === "notOnThisTV") {
    return `This ${what} needs the desktop.`;
  }
  return `Couldn't play this ${what}. Try again when the desktop is around.`;
}

/**
 * Over the phone Movie player: a spinner while the source is preparing, or
 * why it can't play with Try again (or Back when there's no desktop to retry).
 */
export function MoviePlayerStatus({
  source,
  kind,
  retry,
}: {
  source: PlaybackSourceKind;
  kind: MovieKind;
  retry: () => void;
}) {
  if (source.kind === "preparing") {
    return (
      <View style={styles.center} pointerEvents="none">
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }
  if (source.kind !== "failed") return null;
  return (
    <View style={styles.center} pointerEvents="box-none">
      <Text style={styles.status}>{failureText(source.failure, kind)}</Text>
      <Pressable
        style={styles.button}
        onPress={source.canRetry ? retry : router.back}
      >
        <Text style={styles.buttonText}>
          {source.canRetry ? "Try again" : "Back"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  status: {
    color: colors.foreground,
    fontSize: fontSize.md,
    textAlign: "center",
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 10,
  },
  buttonText: {
    color: colors.primaryForeground,
    fontWeight: fontWeight.semibold,
  },
});
