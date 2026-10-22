import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Caption } from "../../../shared/mobile-sync-contract";
import { PlayerProgressBar } from "./PlayerProgressBar";
import { toggleFullScreen } from "./playerOrientation";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import {
  Captions,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "../../theme/icons";

const SEEK_SECONDS = 10;

type MoviePlayerChromeProps = {
  title: string;
  isLandscape: boolean;
  sideInset: number;
  bottomInset: number;
  position: number;
  duration: number;
  // False until a source is loaded: play and seek do nothing yet.
  canPlay: boolean;
  isPlaying: boolean;
  captions: {
    available: boolean;
    selected: Caption | null;
    count: number;
    next: () => void;
  };
  onSeek: (seconds: number) => void;
  onSkip: (seconds: number) => void;
  onPlayPause: () => void;
  // Any press on the controls keeps them showing.
  onTouch: () => void;
  onHeight: (height: number) => void;
};

/** The phone Movie player's controls along the bottom: title, bar and buttons. */
export function MoviePlayerChrome({
  title,
  isLandscape,
  sideInset,
  bottomInset,
  position,
  duration,
  canPlay,
  isPlaying,
  captions,
  onSeek,
  onSkip,
  onPlayPause,
  onTouch,
  onHeight,
}: MoviePlayerChromeProps) {
  return (
    <View
      style={[
        styles.chrome,
        {
          paddingBottom: bottomInset,
          paddingHorizontal: sideInset + spacing.md,
        },
      ]}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      <Text style={styles.title} numberOfLines={isLandscape ? 1 : 2}>
        {title}
      </Text>
      <PlayerProgressBar
        currentTime={position}
        duration={duration}
        onSeek={onSeek}
        onScrubStart={onTouch}
        onScrubEnd={onTouch}
      />
      <View style={styles.actions}>
        <Pressable
          testID="movie-seek-back"
          onPress={() => onSkip(-SEEK_SECONDS)}
          disabled={!canPlay}
          accessibilityLabel={`Back ${SEEK_SECONDS} seconds`}
          hitSlop={8}
        >
          <RotateCcw size={26} color={colors.foreground} />
        </Pressable>
        <Pressable
          testID="movie-play-pause"
          onPress={onPlayPause}
          disabled={!canPlay}
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
          hitSlop={8}
        >
          {isPlaying ? (
            <Pause size={34} color={colors.foreground} />
          ) : (
            <Play size={34} color={colors.foreground} />
          )}
        </Pressable>
        <Pressable
          testID="movie-seek-forward"
          onPress={() => onSkip(SEEK_SECONDS)}
          disabled={!canPlay}
          accessibilityLabel={`Forward ${SEEK_SECONDS} seconds`}
          hitSlop={8}
        >
          <RotateCw size={26} color={colors.foreground} />
        </Pressable>
        {captions.available ? (
          <Pressable
            testID="captions-toggle"
            style={styles.captionsButton}
            onPress={() => {
              onTouch();
              captions.next();
            }}
            accessibilityLabel={
              captions.selected
                ? `Captions: ${captions.selected.label}`
                : "Captions off"
            }
            hitSlop={8}
          >
            <Captions
              size={26}
              color={captions.selected ? colors.primary : colors.foreground}
            />
            {captions.selected && captions.count > 1 ? (
              <Text style={styles.captionsLabel} numberOfLines={1}>
                {captions.selected.label}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
        <Pressable
          testID="movie-full-screen-toggle"
          onPress={() => {
            onTouch();
            toggleFullScreen(isLandscape);
          }}
          accessibilityLabel={isLandscape ? "Exit full screen" : "Full screen"}
          hitSlop={8}
        >
          {isLandscape ? (
            <Minimize size={24} color={colors.foreground} />
          ) : (
            <Maximize size={24} color={colors.foreground} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    paddingTop: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.55)",
    gap: spacing.sm,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  captionsButton: { alignItems: "center", maxWidth: 96 },
  captionsLabel: { color: colors.primary, fontSize: fontSize.xs },
});
