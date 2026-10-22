import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MovieHold } from "../../services/held-movies/types";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import { MoviePoster } from "./MoviesRow";
import { confirmRemoveFromThisPhone } from "./movieOnThisPhone";

/**
 * The Movies and Episodes On this phone, as poster cards before its Videos.
 * They never join the row's Play queue; tapping one opens its player, and
 * long-press offers Remove from this phone.
 */
export function HeldMovieCards({
  holds,
  serverUrl,
  onPlay,
}: {
  holds: MovieHold[];
  serverUrl: string | null;
  onPlay: (hold: MovieHold) => void;
}) {
  if (holds.length === 0) return null;
  return (
    <View style={styles.cards}>
      {holds.map((hold) => (
        <Pressable
          key={`${hold.kind}:${hold.id}`}
          testID={`held-${hold.kind}-${hold.id}`}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          onPress={() => onPlay(hold)}
          onLongPress={() => confirmRemoveFromThisPhone(hold)}
          accessibilityLabel={`Play ${hold.title}`}
        >
          <MoviePoster posterUrl={hold.posterUrl} serverUrl={serverUrl} />
          <Text style={styles.title} numberOfLines={2}>
            {hold.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: "row" },
  card: { width: 120, marginHorizontal: spacing.xs },
  pressed: { opacity: 0.8 },
  title: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.sm,
  },
});
