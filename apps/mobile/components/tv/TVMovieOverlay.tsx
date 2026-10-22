import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Caption } from "../../../shared/mobile-sync-contract";
import { TVFocusPressable } from "./TVFocusPressable";
import { formatPlaybackTime } from "../playerSeek";
import {
  Captions,
  colors,
  fontSize,
  fontWeight,
  Pause,
  Play,
  radius,
  spacing,
  tvFontSize,
  tvRestingBorder,
  tvScrim,
} from "../../theme";

type TVMovieOverlayProps = {
  visible: boolean;
  title: string;
  streaming: boolean;
  position: number;
  duration: number;
  isPlaying: boolean;
  preferPlayFocus: boolean;
  captions: { available: boolean; selected: Caption | null };
  // The Caption line on screen now, kept clear of the overlay while it shows.
  captionText: string | null;
  onPlayPause: () => void;
  onCaptions: () => void;
  // Focus moving within the overlay keeps it showing.
  onFocusInside: () => void;
  onPlayFocus: () => void;
  onProgressFocus: (focused: boolean) => void;
};

/**
 * The TV Movie player's overlay along the bottom (title, progress and buttons),
 * and the Caption line above it.
 */
export function TVMovieOverlay({
  visible,
  title,
  streaming,
  position,
  duration,
  isPlaying,
  preferPlayFocus,
  captions,
  captionText,
  onPlayPause,
  onCaptions,
  onFocusInside,
  onPlayFocus,
  onProgressFocus,
}: TVMovieOverlayProps) {
  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;
  return (
    <>
      {captionText ? (
        <View
          style={[styles.caption, visible && styles.captionAboveOverlay]}
          pointerEvents="none"
        >
          <Text style={styles.captionLine}>
            <Text style={styles.captionText}>{` ${captionText} `}</Text>
          </Text>
        </View>
      ) : null}
      <SafeAreaView
        style={[styles.overlay, !visible && styles.overlayHidden]}
        edges={["bottom", "left", "right"]}
        pointerEvents={visible ? "auto" : "none"}
      >
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.meta}>
          {streaming ? "Streaming" : "On this TV"}
        </Text>

        <TVFocusPressable
          style={styles.progressRow}
          focusedStyle={styles.progressRowFocused}
          accessibilityLabel={`${formatPlaybackTime(position)} of ${formatPlaybackTime(duration)}`}
          onPress={onPlayPause}
          onFocus={() => {
            onProgressFocus(true);
            onFocusInside();
          }}
          onBlur={() => onProgressFocus(false)}
        >
          <Text style={styles.progressTime}>
            {formatPlaybackTime(position)}
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[styles.progressFill, { width: `${progressPercent}%` }]}
            />
          </View>
          <Text style={styles.progressTime}>
            {formatPlaybackTime(duration)}
          </Text>
        </TVFocusPressable>

        <View style={styles.controls}>
          <TVFocusPressable
            style={styles.playPause}
            accessibilityLabel={isPlaying ? "Pause" : "Play"}
            onPress={onPlayPause}
            onFocus={() => {
              onPlayFocus();
              onFocusInside();
            }}
            hasTVPreferredFocus={preferPlayFocus}
          >
            {isPlaying ? (
              <Pause size={34} color={colors.primaryForeground} />
            ) : (
              <Play size={34} color={colors.primaryForeground} />
            )}
          </TVFocusPressable>
          {captions.available ? (
            <TVFocusPressable
              style={styles.captionsButton}
              focusedStyle={styles.captionsButtonFocused}
              accessibilityLabel={
                captions.selected
                  ? `Captions: ${captions.selected.label}`
                  : "Captions off"
              }
              onPress={onCaptions}
              onFocus={onFocusInside}
            >
              <Captions
                size={30}
                color={captions.selected ? colors.primary : colors.foreground}
              />
              <Text style={styles.captionsLabel} numberOfLines={1}>
                {captions.selected ? captions.selected.label : "Captions off"}
              </Text>
            </TVFocusPressable>
          ) : null}
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  caption: {
    position: "absolute",
    left: "12%",
    right: "12%",
    bottom: spacing["2xl"],
    alignItems: "center",
  },
  // Clear of the overlay while it shows.
  captionAboveOverlay: { bottom: 240 },
  captionLine: {
    textAlign: "center",
    fontSize: fontSize["3xl"],
    lineHeight: Math.round(fontSize["3xl"] * 1.4),
  },
  captionText: {
    color: "#fff",
    fontWeight: fontWeight.semibold,
    backgroundColor: "rgba(8,8,8,0.72)",
  },
  // Anchored to the bottom so the picture stays clear above it.
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    backgroundColor: tvScrim,
    gap: spacing.xs,
  },
  overlayHidden: { opacity: 0 },
  title: {
    color: colors.foreground,
    fontSize: tvFontSize.title,
    fontWeight: fontWeight.bold,
  },
  meta: { color: colors.mutedForeground, fontSize: tvFontSize.body },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    ...tvRestingBorder,
  },
  progressRowFocused: {
    borderColor: colors.foreground,
    backgroundColor: colors.overlayLight,
  },
  progressTime: {
    color: colors.foreground,
    fontSize: tvFontSize.body,
    fontWeight: fontWeight.semibold,
    fontVariant: ["tabular-nums"],
    minWidth: 72,
    textAlign: "center",
  },
  progressTrack: {
    flex: 1,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.primary },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
  },
  playPause: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    ...tvRestingBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  captionsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 56,
    borderRadius: radius.full,
    ...tvRestingBorder,
  },
  captionsButtonFocused: {
    borderColor: colors.foreground,
    backgroundColor: colors.overlayLight,
  },
  captionsLabel: {
    color: colors.foreground,
    fontSize: tvFontSize.body,
    fontWeight: fontWeight.semibold,
    maxWidth: 320,
  },
});
