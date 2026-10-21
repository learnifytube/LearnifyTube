import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  bookPlayer,
  useBookPlayerState,
  useBookSpeed,
  useTrackProgress,
  type Book,
} from "../../services/book-player";
import { BOOK_SPEEDS } from "../../../shared/book-player/createBookPlayer";
import {
  formatTimeLeft,
  timeLeftInBook,
} from "../../../shared/book-player/timeLeftInBook";
import { useConnectionStore } from "../../stores/connection";
import { AudiobookCover } from "../../components/phone/AudiobookCover";
import { BookTracksSheet } from "../../components/phone/BookTracksSheet";
import { PlayerProgressBar } from "../../components/phone/PlayerProgressBar";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";
import {
  ArrowLeft,
  List,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
} from "../../theme/icons";

const COVER_SIZE = 240;
const SKIP_SECONDS = 30;

// The book playing now. Leaving this screen keeps the book playing.
export default function BookPlayerScreen() {
  const state = useBookPlayerState();
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const [showTracks, setShowTracks] = useState(false);

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
        <AudiobookCover book={book} serverUrl={serverUrl} size={COVER_SIZE} />
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
        {book.author ? <Text style={styles.author}>{book.author}</Text> : null}
        {track && trackIndex !== null ? (
          <Text style={styles.track} numberOfLines={1} testID="book-track">
            Track {trackIndex + 1} of {book.tracks.length} · {track.title}
          </Text>
        ) : null}
        {trackIndex !== null ? (
          <TrackProgress
            book={book}
            trackIndex={trackIndex}
            active={state.status === "playing" || state.status === "paused"}
          />
        ) : (
          <FinishedProgress book={book} />
        )}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {state.status === "playing" || state.status === "paused" ? (
          <View style={styles.controls}>
            <Pressable
              testID="book-previous-track"
              style={styles.trackButton}
              onPress={() => void bookPlayer.previousTrack()}
              accessibilityLabel="Previous Track"
            >
              <SkipBack size={24} color={colors.foreground} />
            </Pressable>
            <SkipButton seconds={-SKIP_SECONDS} />
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
            <SkipButton seconds={SKIP_SECONDS} />
            <Pressable
              testID="book-next-track"
              style={styles.trackButton}
              onPress={() => void bookPlayer.nextTrack()}
              accessibilityLabel="Next Track"
            >
              <SkipForward size={24} color={colors.foreground} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.extras}>
          {state.status === "playing" || state.status === "paused" ? (
            <SpeedButton />
          ) : null}
          {trackIndex !== null ? (
            <Pressable
              testID="book-tracks"
              style={styles.pillButton}
              onPress={() => setShowTracks(true)}
              accessibilityLabel="Tracks"
            >
              <List size={16} color={colors.foreground} />
              <Text style={styles.pillLabel}>Tracks</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {trackIndex !== null ? (
        <BookTracksSheet
          book={book}
          currentIndex={trackIndex}
          visible={showTracks}
          onClose={() => setShowTracks(false)}
          onPlayTrack={(index) => {
            setShowTracks(false);
            void bookPlayer.playTrack(index);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

// Where the book is in its Track, a bar to seek within it, and how long the
// rest of the book takes at this speed (when every Track's length is known).
function TrackProgress({
  book,
  trackIndex,
  active,
}: {
  book: Book;
  trackIndex: number;
  active: boolean;
}) {
  const { elapsed, duration } = useTrackProgress();
  const speed = useBookSpeed();
  const left = active
    ? timeLeftInBook({
        tracks: book.tracks,
        trackIndex,
        elapsed,
        trackLength: duration,
        speed,
      })
    : null;
  return (
    <View style={styles.progress}>
      <PlayerProgressBar
        currentTime={elapsed}
        duration={duration}
        onSeek={bookPlayer.seekTo}
        disabled={!active}
      />
      {left !== null ? (
        <Text style={styles.timeLeft} testID="book-time-left">
          {formatTimeLeft(left)} left in book
        </Text>
      ) : null}
    </View>
  );
}

// A finished book shows its last Track played to the end.
function FinishedProgress({ book }: { book: Book }) {
  const length = book.tracks.at(-1)?.durationSeconds ?? 0;
  return (
    <View style={styles.progress}>
      <PlayerProgressBar
        currentTime={length}
        duration={length}
        onSeek={() => {}}
        disabled
      />
    </View>
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
    BOOK_SPEEDS.find((option) => option > speed + 0.001) ?? BOOK_SPEEDS[0] ?? 1;
  return (
    <Pressable
      testID="book-speed"
      style={styles.pillButton}
      onPress={() => bookPlayer.setSpeed(next)}
      accessibilityLabel={`Speed ${speed}×, change to ${next}×`}
    >
      <Text style={styles.pillLabel}>{speed}×</Text>
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
  progress: { alignSelf: "stretch", alignItems: "center", gap: spacing.xs },
  timeLeft: { color: colors.mutedForeground, fontSize: fontSize.sm },
  message: {
    color: colors.warning,
    fontSize: fontSize.sm,
    textAlign: "center",
  },
  controls: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  trackButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
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
  extras: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pillButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillLabel: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
