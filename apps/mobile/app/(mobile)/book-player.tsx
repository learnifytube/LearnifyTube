import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  bookPlayer,
  useBookPlayerState,
  useBookSpeed,
} from "../../services/book-player";
import { resolveRemoteAssetUrl } from "../../services/browseCache";
import { useConnectionStore } from "../../stores/connection";
import { AudiobookCover } from "../../components/phone/AudiobookCover";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";
import {
  ArrowLeft,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "../../theme/icons";

const COVER_SIZE = 240;
const SKIP_SECONDS = 30;
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

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
          <View style={styles.controls}>
            <SkipButton seconds={-SKIP_SECONDS} />
            <Pressable
              testID="book-play-pause"
              style={styles.playButton}
              onPress={() =>
                state.status === "playing"
                  ? bookPlayer.pause()
                  : bookPlayer.resume()
              }
              accessibilityLabel={
                state.status === "playing" ? "Pause" : "Play"
              }
            >
              {state.status === "playing" ? (
                <Pause size={32} color={colors.primaryForeground} />
              ) : (
                <Play size={32} color={colors.primaryForeground} />
              )}
            </Pressable>
            <SkipButton seconds={SKIP_SECONDS} />
          </View>
        ) : null}
        {state.status === "playing" || state.status === "paused" ? (
          <SpeedButton />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

// ±30s, crossing into the previous or next Track.
function SkipButton({ seconds }: { seconds: number }) {
  const forward = seconds > 0;
  const Icon = forward ? RotateCw : RotateCcw;
  return (
    <Pressable
      testID={forward ? "book-skip-forward" : "book-skip-back"}
      style={styles.skipButton}
      onPress={() => void bookPlayer.skip(seconds)}
      accessibilityLabel={`${forward ? "Forward" : "Back"} ${Math.abs(seconds)} seconds`}
    >
      <Icon size={28} color={colors.foreground} />
      <Text style={styles.skipLabel}>{Math.abs(seconds)}</Text>
    </Pressable>
  );
}

// Cycles through the speeds; the Book player remembers the choice.
function SpeedButton() {
  const speed = useBookSpeed();
  const next =
    SPEEDS.find((option) => option > speed + 0.001) ?? SPEEDS[0] ?? 1;
  return (
    <Pressable
      testID="book-speed"
      style={styles.speedButton}
      onPress={() => bookPlayer.setSpeed(next)}
      accessibilityLabel={`Speed ${speed}×, change to ${next}×`}
    >
      <Text style={styles.speedLabel}>{speed}×</Text>
    </Pressable>
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
  controls: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
  },
  skipButton: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  skipLabel: {
    position: "absolute",
    color: colors.foreground,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  speedButton: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speedLabel: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
