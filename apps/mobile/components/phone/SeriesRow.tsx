import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useMovieCatalogStore } from "../../stores/movieCatalog";
import type { Series } from "../../../shared/mobile-sync-contract";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import { MoviePoster } from "./MoviesRow";
import { seriesRowItems } from "./seriesRowItems";

const POSTER_WIDTH = 120;

export function seasonCountText(series: Series) {
  const count = series.seasons.length;
  return count === 1 ? "1 Season" : `${count} Seasons`;
}

/**
 * The Series Home row: the desktop's Series (in Offline mode the last catalog
 * seen, dimmed). Tapping one opens its Series screen. `MoviesRow` loads the
 * catalog; hidden when there are none.
 */
export function SeriesRow({
  serverUrl,
  onOpen,
}: {
  serverUrl: string | null;
  onOpen: (series: Series) => void;
}) {
  const catalog = useMovieCatalogStore();
  const items = seriesRowItems({
    connected: !!serverUrl,
    series: !serverUrl || catalog.serverUrl === serverUrl ? catalog.series : [],
  });
  if (items.length === 0) return null;

  return (
    <View style={styles.block} testID="series-row">
      <Text style={styles.title}>Series</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.series.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        renderItem={({ item: { series, needsDesktop } }) => (
          <Pressable
            testID={`series-${series.id}`}
            style={({ pressed }) => [
              styles.card,
              needsDesktop && styles.dimmed,
              pressed && !needsDesktop && styles.pressed,
            ]}
            disabled={needsDesktop}
            onPress={() => onOpen(series)}
            accessibilityLabel={
              needsDesktop
                ? `${series.title} needs the desktop`
                : `Open ${series.title}`
            }
          >
            <MoviePoster posterUrl={series.posterUrl} serverUrl={serverUrl} />
            <Text style={styles.seriesTitle} numberOfLines={2}>
              {series.title}
            </Text>
            <Text style={styles.caption}>
              {needsDesktop ? "Needs the desktop" : seasonCountText(series)}
            </Text>
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
  card: { width: POSTER_WIDTH, marginHorizontal: spacing.xs },
  pressed: { opacity: 0.8 },
  dimmed: { opacity: 0.45 },
  seriesTitle: {
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
});
