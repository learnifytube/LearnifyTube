import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useConnectionStore } from "../../stores/connection";
import { useMovieCatalogStore } from "../../stores/movieCatalog";
import { movieWatchKey, useMovieWatchStore } from "../../stores/movieWatch";
import { useSeriesLastEpisodesStore } from "../../stores/seriesLastEpisodes";
import { watchStateOf } from "../../services/movie-watch/movieWatch";
import {
  seriesEpisodes,
  seriesNextUp,
} from "../../services/movie-watch/seriesWatch";
import { MoviePoster } from "../../components/phone/MoviesRow";
import { seasonCountText } from "../../components/phone/SeriesRow";
import { formatTrackDuration } from "../../components/phone/formatTrackDuration";
import { showMovieOptions } from "../../components/phone/movieOnThisPhone";
import { heldMovies } from "../../services/held-movies";
import { heldTitleOfEpisode } from "../../services/held-movies/heldTitle";
import { movieOfflineCopy } from "../../services/offline-copy";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";
import { ArrowLeft, Check, Play } from "../../theme/icons";
import type { Episode } from "../../../shared/mobile-sync-contract";

function playEpisode(episode: Episode) {
  router.push({
    pathname: "/movie-player",
    params: { kind: "episode", id: episode.id },
  });
}

const episodeLabel = (episode: Episode) =>
  episode.number !== null
    ? `${episode.number}. ${episode.title}`
    : episode.title;

/**
 * A Series screen: its Seasons and Episodes in order. Play Streams the
 * next-up Episode (the start again once all are watched); tapping an Episode
 * plays that one. Either way the Episodes after it autoplay. Long-press an
 * Episode for Download to this phone, or Remove from this phone once held.
 */
export default function SeriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const series = useMovieCatalogStore((state) =>
    state.series.find((item) => item.id === id),
  );
  const progress = useMovieWatchStore((state) => state.progress);
  const keptLastEpisode = useSeriesLastEpisodesStore((state) =>
    id ? state.lastEpisodes[id] : undefined,
  );
  const getOfflineUri = movieOfflineCopy.useLookup();
  const holds = heldMovies.useHolds();

  if (!series || !serverUrl) {
    return (
      <SafeAreaView style={styles.container}>
        <BackButton />
        <Text style={styles.message}>
          {series
            ? "This Series needs the desktop."
            : "This Series isn't available now."}
        </Text>
      </SafeAreaView>
    );
  }

  const kept = (episodeId: string) =>
    progress[movieWatchKey("episode", episodeId)];
  const nextUp = seriesNextUp(series, kept, keptLastEpisode);
  const toPlay =
    nextUp?.episode ??
    seriesEpisodes(series).find((episode) => !episode.missing) ??
    null;
  const playText = !nextUp
    ? "Watch again"
    : nextUp.lastWatchedAt === null
      ? "Play"
      : `Continue: ${episodeLabel(nextUp.episode)}`;

  return (
    <SafeAreaView style={styles.container}>
      <BackButton />
      <SectionList
        sections={series.seasons.map((season) => ({
          key: season.id,
          title: season.title,
          data: season.episodes,
        }))}
        keyExtractor={(episode) => episode.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <MoviePoster posterUrl={series.posterUrl} serverUrl={serverUrl} />
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={3}>
                {series.title}
              </Text>
              <Text style={styles.subtitle}>{seasonCountText(series)}</Text>
              {toPlay ? (
                <Pressable
                  testID="series-play"
                  style={styles.play}
                  onPress={() => playEpisode(toPlay)}
                  accessibilityLabel={playText}
                >
                  <Play size={16} color={colors.primaryForeground} />
                  <Text style={styles.playText} numberOfLines={2}>
                    {playText}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.seasonTitle}>{section.title}</Text>
        )}
        renderItem={({ item: episode }) => {
          const { state } = watchStateOf({
            watch: episode.watch,
            kept: kept(episode.id),
            durationSeconds: episode.durationSeconds,
          });
          const current = episode.id === nextUp?.episode.id;
          const held = holds.some((hold) => hold.id === episode.id);
          const onThisPhone =
            getOfflineUri(episode.id) !== null
              ? "On this phone"
              : held
                ? "Downloading"
                : null;
          return (
            <Pressable
              testID={`series-episode-${episode.id}`}
              disabled={episode.missing}
              style={({ pressed }) => [
                styles.episode,
                current && styles.episodeCurrent,
                pressed && styles.pressed,
              ]}
              onPress={() => playEpisode(episode)}
              onLongPress={() =>
                showMovieOptions({
                  title: heldTitleOfEpisode(series, episode),
                  held,
                  connected: true,
                })
              }
              accessibilityLabel={`Play ${episode.title}`}
            >
              <View style={styles.episodeText}>
                <Text
                  style={[
                    styles.episodeTitle,
                    episode.missing && styles.missing,
                  ]}
                  numberOfLines={2}
                >
                  {episodeLabel(episode)}
                </Text>
                {onThisPhone ? (
                  <Text style={styles.episodeMeta}>{onThisPhone}</Text>
                ) : null}
              </View>
              {state === "watched" ? (
                <Check size={16} color={colors.mutedForeground} />
              ) : null}
              <Text style={styles.episodeMeta}>
                {episode.missing
                  ? "Missing"
                  : state === "in-progress"
                    ? "In progress"
                    : formatTrackDuration(episode.durationSeconds)}
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
      testID="series-back"
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
  header: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  headerText: { flex: 1, gap: spacing.xs },
  title: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  subtitle: { color: colors.mutedForeground, fontSize: fontSize.sm },
  play: {
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
  playText: {
    flexShrink: 1,
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  seasonTitle: {
    color: colors.foreground,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  episode: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  episodeCurrent: { backgroundColor: colors.card },
  pressed: { opacity: 0.7 },
  episodeText: { flex: 1 },
  episodeTitle: { color: colors.foreground, fontSize: fontSize.sm },
  missing: {
    color: colors.mutedForeground,
    textDecorationLine: "line-through",
  },
  episodeMeta: { color: colors.mutedForeground, fontSize: fontSize.xs },
});
