import { FlatList, StyleSheet, Text, View } from "react-native";
import { resolveRemoteAssetUrl } from "../../services/remoteAssetUrl";
import { movieOfflineCopy } from "../../services/offline-copy";
import { useMovieCatalogStore } from "../../stores/movieCatalog";
import { movieWatchKey, useMovieWatchStore } from "../../stores/movieWatch";
import { useSeriesLastEpisodesStore } from "../../stores/seriesLastEpisodes";
import type { StreamingVideo } from "../../stores/playback";
import type { Episode, Movie } from "../../../shared/mobile-sync-contract";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import { VideoGridCard, type VideoGridCardData } from "../VideoGridCard";
import {
  mergeContinueWatching,
  type ContinueWatchingItem,
} from "./continueWatching";

const CARD_WIDTH = 168;

/**
 * Continue watching with the Movies and Series merged in: the Videos given
 * (those this phone can play now, newest first) plus what the Movie catalog
 * and this phone's Movie watch say is in progress.
 */
export function useContinueWatching({
  serverUrl,
  videos,
}: {
  serverUrl: string | null;
  videos: { video: StreamingVideo; lastWatchedAt: number | null }[];
}) {
  const catalog = useMovieCatalogStore();
  const progress = useMovieWatchStore((state) => state.progress);
  const lastEpisodes = useSeriesLastEpisodesStore(
    (state) => state.lastEpisodes,
  );
  const getMovieOfflineUri = movieOfflineCopy.useLookup();
  const current = !serverUrl || catalog.serverUrl === serverUrl;
  return mergeContinueWatching({
    connected: !!serverUrl,
    videos,
    movies: current ? catalog.movies : [],
    series: current ? catalog.series : [],
    kept: (kind, id) => progress[movieWatchKey(kind, id)],
    keptLastEpisode: (seriesId) => lastEpisodes[seriesId],
    onThisPhone: (id) => getMovieOfflineUri(id) !== null,
  });
}

function itemKey(item: ContinueWatchingItem) {
  if (item.kind === "video") return `video:${item.video.id}`;
  if (item.kind === "movie") return `movie:${item.movie.id}`;
  return `series:${item.series.id}`;
}

function cardData(
  item: Exclude<ContinueWatchingItem, { kind: "video" }>,
  serverUrl: string | null,
): VideoGridCardData {
  const title = item.kind === "movie" ? item.movie : item.episode;
  const posterUrl =
    item.kind === "movie" ? item.movie.posterUrl : item.series.posterUrl;
  return {
    id: title.id,
    title: title.title,
    channelTitle: item.kind === "movie" ? "Movie" : item.series.title,
    duration: title.durationSeconds ?? 0,
    thumbnailUrl: serverUrl
      ? resolveRemoteAssetUrl(serverUrl, posterUrl)
      : null,
  };
}

/** The phone's first Home row. Hidden when nothing is in progress. */
export function ContinueWatchingRow({
  items,
  serverUrl,
  onPlayVideo,
  onPlayMovie,
  onPlayEpisode,
}: {
  items: ContinueWatchingItem[];
  serverUrl: string | null;
  /** Plays the row's Videos as one Play queue, from this one. */
  onPlayVideo: (videoIndex: number) => void;
  onPlayMovie: (movie: Movie) => void;
  onPlayEpisode: (episode: Episode) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.block} testID="continue-watching-row">
      <Text style={styles.title}>Continue watching</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={itemKey}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        initialNumToRender={3}
        maxToRenderPerBatch={4}
        windowSize={3}
        renderItem={({ item }) => {
          if (item.kind === "video") {
            return (
              <View style={styles.card}>
                <VideoGridCard
                  video={item.video}
                  onPress={() => onPlayVideo(item.videoIndex)}
                />
              </View>
            );
          }
          return (
            <View
              style={[styles.card, item.needsDesktop && styles.dimmed]}
              pointerEvents={item.needsDesktop ? "none" : "auto"}
              testID={`continue-${itemKey(item)}`}
            >
              <VideoGridCard
                video={cardData(item, serverUrl)}
                subtitle={item.needsDesktop ? "Needs the desktop" : undefined}
                onPress={() =>
                  item.kind === "movie"
                    ? onPlayMovie(item.movie)
                    : onPlayEpisode(item.episode)
                }
              />
            </View>
          );
        }}
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
  card: { width: CARD_WIDTH },
  dimmed: { opacity: 0.45 },
});
