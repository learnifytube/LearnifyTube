import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { audiobookCatalog } from "../../services/audiobook-catalog";
import { resolveRemoteAssetUrl } from "../../services/browseCache";
import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import { AudiobookCover } from "./AudiobookCover";

const COVER_SIZE = 132;

/**
 * The Audiobooks Home row: every Audiobook on the desktop. Hidden when the
 * desktop has none, is too old to serve them, or isn't connected.
 */
export function AudiobooksRow({
  serverUrl,
  onPlay,
}: {
  serverUrl: string | null;
  onPlay: (book: Audiobook) => void;
}) {
  const [books, setBooks] = useState<{
    serverUrl: string;
    audiobooks: Audiobook[];
  } | null>(null);

  // Home stays mounted behind other screens, so reload on focus.
  useFocusEffect(
    useCallback(() => {
      if (!serverUrl) return;
      let cancelled = false;
      audiobookCatalog
        .load(serverUrl)
        .then((audiobooks) => {
          if (!cancelled) setBooks({ serverUrl, audiobooks });
        })
        .catch((error) =>
          console.warn("[AudiobooksRow] Loading Audiobooks failed:", error),
        );
      return () => {
        cancelled = true;
      };
    }, [serverUrl]),
  );

  // Streaming needs the desktop, so the row shows only while connected to it.
  const audiobooks =
    serverUrl && books?.serverUrl === serverUrl ? books.audiobooks : [];
  if (audiobooks.length === 0) return null;

  return (
    <View style={styles.block} testID="audiobooks-row">
      <Text style={styles.title}>Audiobooks</Text>
      <FlatList
        horizontal
        data={audiobooks}
        keyExtractor={(book) => book.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        renderItem={({ item: book }) => (
          <Pressable
            testID={`audiobook-${book.id}`}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            onPress={() => onPlay(book)}
            accessibilityLabel={`Play ${book.title}`}
          >
            <AudiobookCover
              uri={resolveRemoteAssetUrl(serverUrl, book.coverUrl)}
              size={COVER_SIZE}
            />
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
