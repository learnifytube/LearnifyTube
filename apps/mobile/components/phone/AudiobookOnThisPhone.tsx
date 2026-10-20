import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { bookPlayer, useBookPlayerState } from "../../services/book-player";
import { heldAudiobooks } from "../../services/held-audiobooks";
import { colors, fontSize, radius, spacing } from "../../theme";
import { Trash2 } from "../../theme/icons";

/** How much of a book is on this phone, and Remove from this phone. */
export function AudiobookOnThisPhone({
  bookId,
  title,
}: {
  bookId: string;
  title: string;
}) {
  const hold = heldAudiobooks.useHolds().get(bookId);
  const playerState = useBookPlayerState();
  if (!hold) return null;

  // Brought by the Audiobook Mirror: the desktop decides whether it stays.
  const sent = hold.reasons.includes("mirrored");

  const playingThis =
    playerState.status !== "idle" && playerState.book.id === bookId;

  const confirmRemove = () => {
    const message = sent
      ? `${title} stays on the desktop. It was sent to Devices, so it comes back at the next sync unless it is removed from Devices on the desktop.`
      : `${title} stays on the desktop.`;
    Alert.alert("Remove from this phone?", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          if (playingThis) bookPlayer.pause();
          void heldAudiobooks.remove(bookId);
        },
      },
    ]);
  };

  return (
    <View style={styles.block}>
      <Text style={styles.held} testID="audiobook-held">
        {hold.complete
          ? "On this phone"
          : `Getting it onto this phone: ${hold.heldTracks} of ${hold.totalTracks} Tracks`}
        {sent ? " · Sent from the desktop" : ""}
      </Text>
      <Pressable
        testID="audiobook-remove-from-phone"
        style={styles.remove}
        onPress={confirmRemove}
        accessibilityLabel="Remove from this phone"
      >
        <Trash2 size={16} color={colors.foreground} />
        <Text style={styles.removeText}>Remove from this phone</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.xs, marginTop: spacing.sm },
  held: { color: colors.mutedForeground, fontSize: fontSize.xs },
  remove: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  removeText: { color: colors.foreground, fontSize: fontSize.sm },
});
