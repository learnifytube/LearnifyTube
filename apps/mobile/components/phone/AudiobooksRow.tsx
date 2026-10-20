import { useCallback } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { audiobookCatalog } from "../../services/audiobook-catalog";
import { heldAudiobooks } from "../../services/held-audiobooks";
import { continueListening } from "../../services/listening-position/listeningPosition";
import { useAudiobookCatalogStore } from "../../stores/audiobookCatalog";
import { useListeningPositionsStore } from "../../stores/listeningPositions";
import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";
import { Info, Smartphone } from "../../theme/icons";
import { AudiobookCover } from "./AudiobookCover";
import {
  audiobooksRowItems,
  type AudiobooksRowItem,
} from "./audiobooksRowItems";

const COVER_SIZE = 132;

type RowProps = {
  serverUrl: string | null;
  onPlay: (book: Audiobook) => void;
  /** Opens the book screen (long-press or ⓘ). */
  onOpen: (book: Audiobook) => void;
};

/**
 * The Audiobooks this phone can show: the desktop's at serverUrl (in Offline
 * mode the last catalog seen, saved between launches) and the books held on
 * this phone, each marked On this phone or Needs the desktop.
 */
export function useAudiobookItems(serverUrl: string | null) {
  const catalog = useAudiobookCatalogStore();
  const holds = heldAudiobooks.useHolds();
  return audiobooksRowItems({
    connected: !!serverUrl,
    catalog: !serverUrl
      ? catalog.audiobooks
      : catalog.serverUrl === serverUrl
        ? catalog.audiobooks
        : null,
    holds,
  });
}

/**
 * The Audiobooks Home row: every Audiobook on the desktop and every one held
 * on this phone. It loads them for Continue listening and the book screen
 * too. Hidden when there are none.
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
          if (cancelled) return;
          useAudiobookCatalogStore.setState({ serverUrl, audiobooks });
          heldAudiobooks.refresh(audiobooks);
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
      items={useAudiobookItems(serverUrl)}
      serverUrl={serverUrl}
      onPlay={onPlay}
      onOpen={onOpen}
    />
  );
}

/** The Continue listening Home row: Audiobooks started but not finished on any device, newest first. */
export function ContinueListeningRow({ serverUrl, onPlay, onOpen }: RowProps) {
  const items = useAudiobookItems(serverUrl);
  const kept = useListeningPositionsStore((state) => state.positions);
  const byId = new Map(items.map((item) => [item.book.id, item]));
  const inProgress = continueListening(
    items.map((item) => item.book),
    kept,
  ).flatMap((book) => byId.get(book.id) ?? []);
  return (
    <AudiobookShelf
      title="Continue listening"
      testID="continue-listening-row"
      cardTestID="continue-listening"
      items={inProgress}
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
  items,
  serverUrl,
  onPlay,
  onOpen,
}: RowProps & {
  title: string;
  testID: string;
  cardTestID: string;
  items: AudiobooksRowItem[];
}) {
  if (items.length === 0) return null;

  return (
    <View style={styles.block} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.book.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        renderItem={({ item: { book, onThisPhone, needsDesktop } }) => (
          <Pressable
            testID={`${cardTestID}-${book.id}`}
            style={({ pressed }) => [
              styles.card,
              needsDesktop && styles.dimmed,
              pressed && !needsDesktop && styles.pressed,
            ]}
            // Offline mode: a book not on this phone does nothing.
            disabled={needsDesktop}
            onPress={() => onPlay(book)}
            onLongPress={() => onOpen(book)}
            accessibilityLabel={
              needsDesktop
                ? `${book.title} needs the desktop`
                : `Play ${book.title}`
            }
          >
            <View>
              <AudiobookCover
                book={book}
                serverUrl={serverUrl}
                size={COVER_SIZE}
              />
              {needsDesktop ? null : (
                <Pressable
                  testID={`${cardTestID}-${book.id}-info`}
                  style={styles.info}
                  hitSlop={8}
                  onPress={() => onOpen(book)}
                  accessibilityLabel={`${book.title}: Tracks`}
                >
                  <Info size={18} color={colors.foreground} />
                </Pressable>
              )}
            </View>
            <Text style={styles.bookTitle} numberOfLines={2}>
              {book.title}
            </Text>
            {book.author ? (
              <Text style={styles.caption} numberOfLines={1}>
                {book.author}
              </Text>
            ) : null}
            {onThisPhone ? (
              <View
                style={styles.badge}
                testID={`${cardTestID}-held-${book.id}`}
              >
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
  info: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    opacity: 0.85,
    alignItems: "center",
    justifyContent: "center",
  },
  bookTitle: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.sm,
  },
  caption: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  badgeText: { color: colors.primary, fontSize: fontSize.xs },
});
