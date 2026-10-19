import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { bookPlayer, useBookPlayerState } from "../../services/book-player";
import { resolveRemoteAssetUrl } from "../../services/browseCache";
import { useConnectionStore } from "../../stores/connection";
import { AudiobookCover } from "../../components/phone/AudiobookCover";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import { ArrowLeft, Pause, Play } from "../../theme/icons";

const COVER_SIZE = 240;

// The book playing now. Leaving this screen keeps the book playing.
export default function BookPlayerScreen() {
  const state = useBookPlayerState();
  const serverUrl = useConnectionStore((s) => s.serverUrl);

  if (state.status === "idle") {
    return (
      <SafeAreaView style={styles.container}>
        <BackButton />
      </SafeAreaView>
    );
  }

  const { book } = state;
  const trackIndex = state.status === "finished" ? null : state.trackIndex;
  const track = trackIndex === null ? null : book.tracks[trackIndex];
  const message =
    state.status === "finished"
      ? "Finished"
      : state.status === "unavailable"
        ? "Can't play this Track without the desktop."
        : null;

  return (
    <SafeAreaView style={styles.container}>
      <BackButton />
      <View style={styles.body}>
        <AudiobookCover
          uri={resolveRemoteAssetUrl(serverUrl, book.coverUrl)}
          size={COVER_SIZE}
        />
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
        {book.author ? <Text style={styles.author}>{book.author}</Text> : null}
        {track && trackIndex !== null ? (
          <Text style={styles.track} numberOfLines={1} testID="book-track">
            Track {trackIndex + 1} of {book.tracks.length} · {track.title}
          </Text>
        ) : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {state.status === "playing" || state.status === "paused" ? (
          <Pressable
            testID="book-play-pause"
            style={styles.playButton}
            onPress={() =>
              state.status === "playing"
                ? bookPlayer.pause()
                : bookPlayer.resume()
            }
            accessibilityLabel={state.status === "playing" ? "Pause" : "Play"}
          >
            {state.status === "playing" ? (
              <Pause size={32} color={colors.primaryForeground} />
            ) : (
              <Play size={32} color={colors.primaryForeground} />
            )}
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function BackButton() {
  return (
    <Pressable
      testID="book-player-back"
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
  body: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textAlign: "center",
    marginTop: spacing.md,
  },
  author: { color: colors.mutedForeground, fontSize: fontSize.base },
  track: { color: colors.mutedForeground, fontSize: fontSize.sm },
  message: { color: colors.warning, fontSize: fontSize.sm, textAlign: "center" },
  playButton: {
    marginTop: spacing.lg,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
