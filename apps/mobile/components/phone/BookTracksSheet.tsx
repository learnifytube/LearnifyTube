import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Book } from "../../services/book-player";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";
import { X } from "../../theme/icons";
import { formatTrackDuration } from "./formatTrackDuration";

type Props = {
  book: Book;
  currentIndex: number;
  visible: boolean;
  onClose: () => void;
  onPlayTrack: (trackIndex: number) => void;
};

// The book's Tracks in Track order, over the Book player: the current one
// highlighted, missing ones greyed out; tapping one plays it from its start.
export function BookTracksSheet({
  book,
  currentIndex,
  visible,
  onClose,
  onPlayTrack,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.heading}>Tracks</Text>
          <Pressable
            testID="book-tracks-close"
            style={styles.close}
            onPress={onClose}
            accessibilityLabel="Close Tracks"
          >
            <X size={20} color={colors.foreground} />
          </Pressable>
        </View>
        <FlatList
          data={book.tracks}
          keyExtractor={(track) => track.id}
          initialScrollIndex={currentIndex}
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          renderItem={({ item: track, index }) => {
            const current = index === currentIndex;
            return (
              <Pressable
                testID={`book-tracks-track-${index}`}
                disabled={track.missing}
                style={({ pressed }) => [
                  styles.track,
                  current && styles.trackCurrent,
                  pressed && styles.pressed,
                ]}
                onPress={() => onPlayTrack(index)}
                accessibilityLabel={`Play Track ${index + 1}, ${track.title}`}
                accessibilityState={{
                  selected: current,
                  disabled: track.missing,
                }}
              >
                <Text style={[styles.trackNumber, current && styles.current]}>
                  {index + 1}
                </Text>
                <Text
                  style={[
                    styles.trackTitle,
                    current && styles.current,
                    track.missing && styles.missing,
                  ]}
                  numberOfLines={1}
                >
                  {track.title}
                </Text>
                <Text style={styles.trackDuration}>
                  {track.missing
                    ? "Missing"
                    : formatTrackDuration(track.durationSeconds)}
                </Text>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const ROW_HEIGHT = 48;

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlayLight },
  sheet: {
    maxHeight: "70%",
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  heading: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  close: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  trackCurrent: { backgroundColor: colors.cardHover },
  pressed: { opacity: 0.7 },
  trackNumber: {
    width: 28,
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    textAlign: "right",
  },
  trackTitle: { flex: 1, color: colors.foreground, fontSize: fontSize.sm },
  current: { color: colors.primary, fontWeight: fontWeight.semibold },
  missing: {
    color: colors.mutedForeground,
    textDecorationLine: "line-through",
  },
  trackDuration: { color: colors.mutedForeground, fontSize: fontSize.xs },
});
