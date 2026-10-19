import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  audiobookCatalog,
  audiobookCatalogSnapshot,
} from "../../services/audiobook-catalog";
import { heldAudiobooks } from "../../services/held-audiobooks";
import { resolveRemoteAssetUrl } from "../../services/browseCache";
import type { Book } from "../../services/book-player";
import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import { Smartphone } from "../../theme/icons";
import { AudiobookCover } from "./AudiobookCover";
import { audiobooksRowItems } from "./audiobooksRowItems";

const COVER_SIZE = 132;

// The desktop's latest catalog, saved for Offline mode; refreshes held books.
async function loadCatalog(serverUrl: string | null) {
  if (!serverUrl) return audiobookCatalogSnapshot.load();
  const audiobooks = await audiobookCatalog.load(serverUrl);
  audiobookCatalogSnapshot.save(audiobooks);
  heldAudiobooks.refresh(audiobooks);
  return audiobooks;
}

/**
 * The Audiobooks Home row: every Audiobook on the desktop, and the books held
 * on this phone. In Offline mode books not on this phone show as needing the
 * desktop and do nothing when tapped. Hidden when there are none.
 */
export function AudiobooksRow({
  serverUrl,
  onPlay,
}: {
  serverUrl: string | null;
  onPlay: (book: Book) => void;
}) {
  const [books, setBooks] = useState<{
    serverUrl: string | null;
    audiobooks: Audiobook[] | null;
  } | null>(null);
  const holds = heldAudiobooks.useHolds();

  // Home stays mounted behind other screens, so reload on focus.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadCatalog(serverUrl)
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

  const items = audiobooksRowItems({
    connected: !!serverUrl,
    catalog: books?.serverUrl === serverUrl ? books.audiobooks : null,
    holds,
  });
  if (items.length === 0) return null;

  return (
    <View style={styles.block} testID="audiobooks-row">
      <Text style={styles.title}>Audiobooks</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.book.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        renderItem={({ item: { book, onThisPhone, needsDesktop } }) => (
          <Pressable
            testID={`audiobook-${book.id}`}
            style={({ pressed }) => [
              styles.card,
              needsDesktop && styles.dimmed,
              pressed && !needsDesktop && styles.pressed,
            ]}
            onPress={needsDesktop ? undefined : () => onPlay(book)}
            accessibilityLabel={
              needsDesktop
                ? `${book.title} needs the desktop`
                : `Play ${book.title}`
            }
          >
            <AudiobookCover
              uri={
                serverUrl
                  ? resolveRemoteAssetUrl(serverUrl, book.coverUrl)
                  : null
              }
              size={COVER_SIZE}
            />
            <Text style={styles.bookTitle} numberOfLines={2}>
              {book.title}
            </Text>
            {book.author ? (
              <Text style={styles.caption} numberOfLines={1}>
                {book.author}
              </Text>
            ) : null}
            {onThisPhone ? (
              <View style={styles.badge} testID={`audiobook-held-${book.id}`}>
                <Smartphone size={12} color={colors.primary} />
                <Text style={styles.badgeText}>On this phone</Text>
              </View>
            ) : null}
            {needsDesktop ? (
              <Text style={styles.caption}>Needs the desktop</Text>
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
  dimmed: { opacity: 0.45 },
  bookTitle: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.xs + 2,
  },
  caption: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  badgeText: { color: colors.primary, fontSize: fontSize.xs },
});
