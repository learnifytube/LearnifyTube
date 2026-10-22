import { useRef, useState } from "react";
import { FlatList, Image, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  colors,
  fontWeight,
  radius,
  spacing,
  tvFontSize,
  tvRestingBorder,
} from "../../../theme";
import { useMovieCatalogStore } from "../../../stores/movieCatalog";
import { movieWatchKey, useMovieWatchStore } from "../../../stores/movieWatch";
import { desktopConnection } from "../../../services/desktop-connection";
import { resolveRemoteAssetUrl } from "../../../services/browseCache";
import { TVFocusPressable } from "../../../components/tv/TVFocusPressable";
import { TV_GRID_SIDE_PADDING } from "../../../components/tv/grid";
import { goBackOrTVHome } from "../../../components/tv/tvBack";
import {
  TVMessageButton,
  TVMessageCard,
} from "../../../components/tv/TVMessage";
import { seriesNotFound } from "../../../components/tv/tvMessages";
import {
  buildTVSeriesView,
  type TVEpisodeCard,
} from "../../../components/tv/tvSeries";

const EPISODE_ROW_HEIGHT = 96;
const EPISODE_ROW_GAP = spacing.sm;

/**
 * A Series on the TV: Seasons as tabs, each Season's Episodes as a list the
 * D-pad moves through. It opens on the next-up Episode; pressing an Episode
 * Streams it and the Episodes after it.
 */
export default function TVSeriesScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const connection = desktopConnection.useConnection();
  const serverUrl = connection.status === "connected" ? connection.url : null;
  const series = useMovieCatalogStore((state) =>
    state.series.find((item) => item.id === id),
  );
  const progress = useMovieWatchStore((state) => state.progress);

  const view = series
    ? buildTVSeriesView({
        series,
        keptEpisodeWatch: (episodeId) =>
          progress[movieWatchKey("episode", episodeId)],
      })
    : null;

  // Where the screen opened, fixed so later progress doesn't move focus.
  const openedAt = useRef(view?.focus ?? null).current;
  const [seasonIndex, setSeasonIndex] = useState(openedAt?.seasonIndex ?? 0);

  if (!series || !view) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.centered}>
          <TVMessageCard message={seriesNotFound}>
            <TVMessageButton
              label="Back"
              onPress={goBackOrTVHome}
              hasTVPreferredFocus
            />
          </TVMessageCard>
        </View>
      </SafeAreaView>
    );
  }

  const season = view.seasons[Math.min(seasonIndex, view.seasons.length - 1)];
  const episodes = season?.episodes ?? [];
  const focusedEpisodeIndex =
    openedAt && openedAt.seasonIndex === seasonIndex
      ? episodes.findIndex((item) => item.id === openedAt.episodeId)
      : -1;
  const posterUrl = resolveRemoteAssetUrl(serverUrl, series.posterUrl);

  const play = (episode: TVEpisodeCard) => {
    if (!episode.playable) return;
    router.push({
      pathname: "/(tv)/movie/[id]",
      params: { id: episode.id, kind: "episode" },
    } as Href);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        {posterUrl ? (
          <Image source={{ uri: posterUrl }} style={styles.poster} />
        ) : (
          <View style={styles.poster} />
        )}
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={2}>
            {series.title}
          </Text>
          {view.seasons.length > 1 ? (
            <View style={styles.seasonTabs}>
              {view.seasons.map((item, index) => (
                <TVFocusPressable
                  key={item.id}
                  style={[
                    styles.seasonTab,
                    index === seasonIndex && styles.seasonTabActive,
                  ]}
                  onPress={() => setSeasonIndex(index)}
                  onFocus={() => setSeasonIndex(index)}
                  hasTVPreferredFocus={!openedAt && index === 0}
                >
                  <Text
                    style={[
                      styles.seasonTabText,
                      index === seasonIndex && styles.seasonTabTextActive,
                    ]}
                  >
                    {item.title}
                  </Text>
                </TVFocusPressable>
              ))}
            </View>
          ) : (
            <Text style={styles.seasonTitle}>{season?.title}</Text>
          )}
        </View>
      </View>

      <FlatList
        key={season?.id}
        data={episodes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        initialScrollIndex={
          focusedEpisodeIndex > 0 ? focusedEpisodeIndex : undefined
        }
        getItemLayout={(_, index) => ({
          length: EPISODE_ROW_HEIGHT + EPISODE_ROW_GAP,
          offset: (EPISODE_ROW_HEIGHT + EPISODE_ROW_GAP) * index,
          index,
        })}
        renderItem={({ item, index }) => (
          <TVFocusPressable
            style={[styles.episode, !item.playable && styles.episodeMissing]}
            onPress={() => play(item)}
            accessibilityLabel={`${item.title}, ${item.subtitle}`}
            hasTVPreferredFocus={index === focusedEpisodeIndex}
          >
            <Text style={styles.episodeTitle} numberOfLines={1}>
              {item.title}
            </Text>
            {item.subtitle ? (
              <Text style={styles.episodeSubtitle} numberOfLines={1}>
                {item.subtitle}
              </Text>
            ) : null}
          </TVFocusPressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: TV_GRID_SIDE_PADDING,
    paddingTop: spacing.md,
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    gap: spacing.lg,
    marginBottom: spacing.md,
    alignItems: "flex-end",
  },
  poster: {
    width: 120,
    height: 180,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
  },
  headerText: { flex: 1, gap: spacing.sm },
  title: {
    color: colors.foreground,
    fontSize: tvFontSize.title,
    fontWeight: fontWeight.bold,
  },
  seasonTitle: { color: colors.mutedForeground, fontSize: tvFontSize.label },
  seasonTabs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  seasonTab: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...tvRestingBorder,
  },
  seasonTabActive: { backgroundColor: colors.primary },
  seasonTabText: {
    color: colors.mutedForeground,
    fontSize: tvFontSize.label,
    fontWeight: fontWeight.semibold,
  },
  seasonTabTextActive: {
    color: colors.primaryForeground,
    fontWeight: fontWeight.bold,
  },
  list: { paddingBottom: spacing.lg },
  episode: {
    height: EPISODE_ROW_HEIGHT,
    marginBottom: EPISODE_ROW_GAP,
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    ...tvRestingBorder,
  },
  episodeMissing: { opacity: 0.5 },
  episodeTitle: {
    color: colors.foreground,
    fontSize: tvFontSize.label,
    fontWeight: fontWeight.semibold,
  },
  episodeSubtitle: {
    color: colors.mutedForeground,
    fontSize: tvFontSize.body,
  },
});
