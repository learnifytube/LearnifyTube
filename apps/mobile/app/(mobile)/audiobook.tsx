import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { bookPlayer, useBookPlayerState } from "../../services/book-player";
import { currentListening } from "../../services/listening-position/listeningPosition";
import { useAudiobookItems } from "../../components/phone/AudiobooksRow";
import { AudiobookOnThisPhone } from "../../components/phone/AudiobookOnThisPhone";
import { useConnectionStore } from "../../stores/connection";
import { useListeningPositionsStore } from "../../stores/listeningPositions";
import { AudiobookCover } from "../../components/phone/AudiobookCover";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";
import { ArrowLeft, RotateCcw } from "../../theme/icons";
import { formatTrackDuration } from "../../components/phone/formatTrackDuration";

const COVER_SIZE = 120;

// The book screen: an Audiobook's Tracks to jump to, and Start over.
export default function AudiobookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  // The desktop's book, or in Offline mode the one held on this phone.
  const item = useAudiobookItems(serverUrl).find(
    (candidate) => candidate.book.id === id && !candidate.needsDesktop,
  );
  const book = item?.book;
  const kept = useListeningPositionsStore((s) =>
    id ? s.positions[id] : undefined,
  );
  const playerState = useBookPlayerState();

  if (!book) {
    return (
      <SafeAreaView style={styles.container}>
        <BackButton />
        <Text style={styles.message}>This Audiobook isn't available now.</Text>
      </SafeAreaView>
    );
  }

  // The Track playing now, else the one the Listening position is in.
  const listening = currentListening(book, kept);
  const currentTrackId =
    playerState.status !== "idle" &&
    playerState.status !== "finished" &&
    playerState.book.id === book.id
      ? book.tracks[playerState.trackIndex]?.id
      : listening && !listening.finished
        ? listening.trackId
        : null;

  const play = (start: () => Promise<void>) => {
    void start();
    router.replace("/book-player");
  };

  return (
    <SafeAreaView style={styles.container}>
      <BackButton />
      <FlatList
        data={book.tracks}
        keyExtractor={(track) => track.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <AudiobookCover
              book={book}
              serverUrl={serverUrl}
              size={COVER_SIZE}
            />
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={3}>
                {book.title}
              </Text>
              {book.author ? (
                <Text style={styles.author}>{book.author}</Text>
              ) : null}
              <Pressable
                testID="audiobook-start-over"
                style={styles.startOver}
                onPress={() => play(() => bookPlayer.startOver(book))}
                accessibilityLabel="Start over"
              >
                <RotateCcw size={16} color={colors.primaryForeground} />
                <Text style={styles.startOverText}>Start over</Text>
              </Pressable>
              <AudiobookOnThisPhone bookId={book.id} title={book.title} />
            </View>
          </View>
        }
        renderItem={({ item: track, index }) => {
          const current = track.id === currentTrackId;
          return (
            <Pressable
              testID={`audiobook-track-${index}`}
              disabled={track.missing}
              style={({ pressed }) => [
                styles.track,
                current && styles.trackCurrent,
                pressed && styles.pressed,
              ]}
              onPress={() => play(() => bookPlayer.jumpTo(book, index))}
              accessibilityLabel={`Play Track ${index + 1}, ${track.title}`}
            >
              <Text style={styles.trackNumber}>{index + 1}</Text>
              <Text
                style={[styles.trackTitle, track.missing && styles.missing]}
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
  );
}

function BackButton() {
  return (
    <Pressable
      testID="audiobook-back"
      style={styles.back}
      onPress={() => router.back()}
      accessibilityLabel="Back"
    >
      <ArrowLeft size={20} color={colors.foreground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  back: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.sm,
  },
  message: {
    color: colors.mutedForeground,
    fontSize: fontSize.base,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  header: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  headerText: { flex: 1, gap: spacing.xs },
  title: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  author: { color: colors.mutedForeground, fontSize: fontSize.sm },
  startOver: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  startOverText: {
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  track: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  trackCurrent: { backgroundColor: colors.card },
  pressed: { opacity: 0.7 },
  trackNumber: {
    width: 28,
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    textAlign: "right",
  },
  trackTitle: { flex: 1, color: colors.foreground, fontSize: fontSize.sm },
  missing: {
    color: colors.mutedForeground,
    textDecorationLine: "line-through",
  },
  trackDuration: { color: colors.mutedForeground, fontSize: fontSize.xs },
});
