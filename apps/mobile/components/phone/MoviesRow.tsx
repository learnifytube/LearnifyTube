import { useCallback } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { refreshMovieCatalog } from "../../services/movie-catalog";
import { resolveRemoteAssetUrl } from "../../services/remoteAssetUrl";
import { useMovieCatalogStore } from "../../stores/movieCatalog";
import type { Movie } from "../../../shared/mobile-sync-contract";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";
import { Film } from "../../theme/icons";
import { moviesRowItems } from "./moviesRowItems";
import { showMovieOptions } from "./movieOnThisPhone";
import { heldMovies } from "../../services/held-movies";
import { heldTitleOfMovie } from "../../services/held-movies/heldTitle";
import { movieOfflineCopy } from "../../services/offline-copy";

const POSTER_WIDTH = 120;
const POSTER_HEIGHT = 180;

/** A Movie's poster (2:3), or the placeholder when it has none or the desktop is away. */
export function MoviePoster({
  posterUrl,
  serverUrl,
}: {
  posterUrl: string | null;
  serverUrl: string | null;
}) {
  const uri = serverUrl ? resolveRemoteAssetUrl(serverUrl, posterUrl) : null;
  if (!uri) {
    return (
      <View style={[styles.poster, styles.placeholder]}>
        <Film size={36} color={colors.mutedForeground} />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.poster} resizeMode="cover" />;
}

/**
 * The Movies Home row: the desktop's Movies (in Offline mode the last catalog
 * seen, dimmed unless on this phone). Tapping one plays its Offline copy or
 * Streams it; long-press offers Download to this phone or Remove from this
 * phone. Hidden when there are none, and on a desktop too old to serve Movies.
 */
export function MoviesRow({
  serverUrl,
  onPlay,
}: {
  serverUrl: string | null;
  onPlay: (movie: Movie) => void;
}) {
  // Home stays mounted behind other screens, so reload on focus.
  useFocusEffect(
    useCallback(() => {
      if (!serverUrl) return;
      refreshMovieCatalog(serverUrl).catch((error) =>
        console.warn("[MoviesRow] Loading Movies failed:", error),
      );
    }, [serverUrl]),
  );

  const catalog = useMovieCatalogStore();
  const getOfflineUri = movieOfflineCopy.useLookup();
  const holds = heldMovies.useHolds();
  const onThisPhone = (id: string) => getOfflineUri(id) !== null;
  const items = moviesRowItems({
    connected: !!serverUrl,
    movies: !serverUrl || catalog.serverUrl === serverUrl ? catalog.movies : [],
    onThisPhone,
  });
  if (items.length === 0) return null;

  const caption = (movie: Movie, needsDesktop: boolean) => {
    if (needsDesktop) return "Needs the desktop";
    if (onThisPhone(movie.id)) return "On this phone";
    if (holds.some((hold) => hold.id === movie.id)) return "Downloading";
    return null;
  };

  return (
    <View style={styles.block} testID="movies-row">
      <Text style={styles.title}>Movies</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.movie.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        renderItem={({ item: { movie, needsDesktop } }) => (
          <Pressable
            testID={`movie-${movie.id}`}
            style={({ pressed }) => [
              styles.card,
              needsDesktop && styles.dimmed,
              pressed && !needsDesktop && styles.pressed,
            ]}
            disabled={needsDesktop}
            onPress={() => onPlay(movie)}
            onLongPress={() =>
              showMovieOptions({
                title: heldTitleOfMovie(movie),
                held: holds.some((hold) => hold.id === movie.id),
                connected: !!serverUrl,
              })
            }
            accessibilityLabel={
              needsDesktop
                ? `${movie.title} needs the desktop`
                : `Play ${movie.title}`
            }
          >
            <MoviePoster posterUrl={movie.posterUrl} serverUrl={serverUrl} />
            <Text style={styles.movieTitle} numberOfLines={2}>
              {movie.title}
            </Text>
            {caption(movie, needsDesktop) ? (
              <Text style={styles.caption}>{caption(movie, needsDesktop)}</Text>
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
  card: { width: POSTER_WIDTH, marginHorizontal: spacing.xs },
  pressed: { opacity: 0.8 },
  dimmed: { opacity: 0.45 },
  poster: {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  placeholder: { alignItems: "center", justifyContent: "center" },
  movieTitle: {
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
