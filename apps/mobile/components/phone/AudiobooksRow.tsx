import { useCallback } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { audiobookCatalog } from "../../services/audiobook-catalog";
import { resolveRemoteAssetUrl } from "../../services/browseCache";
import { continueListening } from "../../services/listening-position/listeningPosition";
import { useAudiobookCatalogStore } from "../../stores/audiobookCatalog";
import { useListeningPositionsStore } from "../../stores/listeningPositions";
import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import { Info } from "../../theme/icons";
import { AudiobookCover } from "./AudiobookCover";

const COVER_SIZE = 132;

type RowProps = {
  serverUrl: string | null;
  onPlay: (book: Audiobook) => void;
  /** Opens the book screen (long-press or ⓘ). */
  onOpen: (book: Audiobook) => void;
};

// The Audiobooks of the desktop at serverUrl. Streaming needs the desktop, so
// the rows show only while connected to it.
function useAudiobooks(serverUrl: string | null) {
  const catalog = useAudiobookCatalogStore();
  return serverUrl && catalog.serverUrl === serverUrl ? catalog.audiobooks : [];
}

/**
 * The Audiobooks Home row: every Audiobook on the desktop. It loads them for
 * Continue listening and the book screen too. Hidden when the desktop has none,
 * is too old to serve them, or isn't connected.
 */
export function AudiobooksRow({ serverUrl, onPlay, onOpen }: RowProps) {
  // Home stays mounted behind other screens, so reload on focus.
  useFocusEffect(
    useCallback(() => {
      if (!serverUrl) return;
      let cancelled = false;
      audiobookCatalog
        .load(serverUrl)
        .then((audiobooks) => {
          if (!cancelled)
            useAudiobookCatalogStore.setState({ serverUrl, audiobooks });
        })
        .catch((error) =>
          console.warn("[AudiobooksRow] Loading Audiobooks failed:", error),
        );
      return () => {
        cancelled = true;
      };
    }, [serverUrl]),
  );

  return (
    <AudiobookShelf
      title="Audiobooks"
      testID="audiobooks-row"
      cardTestID="audiobook"
      books={useAudiobooks(serverUrl)}
      serverUrl={serverUrl}
      onPlay={onPlay}
      onOpen={onOpen}
    />
  );
}

/** The Continue listening Home row: Audiobooks started but not finished on any device, newest first. */
export function ContinueListeningRow({ serverUrl, onPlay, onOpen }: RowProps) {
  const books = useAudiobooks(serverUrl);
  const kept = useListeningPositionsStore((state) => state.positions);
  return (
    <AudiobookShelf
      title="Continue listening"
      testID="continue-listening-row"
      cardTestID="continue-listening"
      books={continueListening(books, kept)}
      serverUrl={serverUrl}
      onPlay={onPlay}
      onOpen={onOpen}
    />
  );
}

function AudiobookShelf({
  title,
  testID,
  cardTestID,
  books,
  serverUrl,
  onPlay,
  onOpen,
}: RowProps & {
  title: string;
  testID: string;
  cardTestID: string;
  books: Audiobook[];
}) {
  if (books.length === 0) return null;

  return (
    <View style={styles.block} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      <FlatList
        horizontal
        data={books}
        keyExtractor={(book) => book.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        renderItem={({ item: book }) => (
          <Pressable
            testID={`${cardTestID}-${book.id}`}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            onPress={() => onPlay(book)}
            onLongPress={() => onOpen(book)}
            accessibilityLabel={`Play ${book.title}`}
          >
            <View>
              <AudiobookCover
                uri={resolveRemoteAssetUrl(serverUrl, book.coverUrl)}
                size={COVER_SIZE}
              />
              <Pressable
                testID={`${cardTestID}-${book.id}-info`}
                style={styles.info}
                hitSlop={8}
                onPress={() => onOpen(book)}
                accessibilityLabel={`${book.title}: Tracks`}
              >
                <Info size={18} color={colors.foreground} />
              </Pressable>
            </View>
            <Text style={styles.bookTitle} numberOfLines={2}>
              {book.title}
            </Text>
            {book.author ? (
              <Text style={styles.author} numberOfLines={1}>
                {book.author}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.lg },
  title: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  scroll: { paddingHorizontal: spacing.sm },
  card: { width: COVER_SIZE, marginHorizontal: spacing.xs },
  pressed: { opacity: 0.8 },
  info: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.background,
    opacity: 0.85,
    alignItems: "center",
    justifyContent: "center",
  },
  bookTitle: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.xs + 2,
  },
  author: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
});
