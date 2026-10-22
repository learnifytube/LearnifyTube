import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TVMessageButton, TVMessageCard } from "./TVMessage";
import { goBackOrTVHome } from "./tvBack";
import type { TVMessageText } from "./tvMessages";
import { colors, spacing } from "../../theme";

/**
 * The TV Movie player's screen while nothing plays: starting, or why it can't,
 * with Retry when trying again could help, and Back.
 */
export function TVMovieMessage({
  message,
  retry,
}: {
  message: TVMessageText;
  // Null when trying again wouldn't help.
  retry: (() => void) | null;
}) {
  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.centered}>
        <TVMessageCard message={message}>
          {retry ? (
            <TVMessageButton
              label="Retry"
              onPress={retry}
              hasTVPreferredFocus
            />
          ) : null}
          <TVMessageButton
            label="Back"
            onPress={goBackOrTVHome}
            hasTVPreferredFocus={!retry}
          />
        </TVMessageCard>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
});
