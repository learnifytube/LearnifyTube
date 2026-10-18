import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from "react-native";
import { colors, fontSize, fontWeight, spacing } from "../../theme";
import type { ListeningDisplayState } from "./listeningMode";
import { Headphones, RefreshCw } from "../../theme/icons";

interface ListeningModeViewProps {
  isLandscape: boolean;
  videoTitle: string;
  displayState: ListeningDisplayState;
  onReplaySentence: (startSeconds: number) => void;
  onTouched: () => void;
}

export function ListeningModeView({
  isLandscape,
  videoTitle,
  displayState,
  onReplaySentence,
  onTouched,
}: ListeningModeViewProps) {
  const contentWidth = isLandscape ? "75%" : "90%";
  const captionFontSize = isLandscape ? 22 : 24;
  const captionLineHeight = Math.round(captionFontSize * 1.5);

  return (
    <Pressable
      testID="listening-mode-surface"
      style={styles.container}
      onPress={onTouched}
    >
      <View style={[styles.content, { width: contentWidth }]}>
        {displayState.kind === "caption" ? (
          <Pressable
            testID="caption-sentence-replay"
            style={({ pressed }) => [
              styles.captionBox,
              pressed && styles.captionBoxPressed,
            ]}
            onPress={() => {
              onTouched();
              onReplaySentence(displayState.sentenceStart);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Replay sentence: ${displayState.text}`}
            accessibilityHint="Double tap to replay this sentence from the beginning"
          >
            <Text
              style={[
                styles.captionText,
                {
                  fontSize: captionFontSize,
                  lineHeight: captionLineHeight,
                },
              ]}
              textBreakStrategy="balanced"
            >
              {displayState.text}
            </Text>
            <View style={styles.replayHintRow}>
              <RefreshCw size={12} color={colors.textTertiary} />
              <Text style={styles.replayHintText}>Tap to replay</Text>
            </View>
          </Pressable>
        ) : displayState.kind === "no-transcript" ? (
          <View style={styles.fallbackBox}>
            <Headphones size={36} color={colors.mutedForeground} />
            <Text style={styles.fallbackTitle} numberOfLines={2}>
              {videoTitle}
            </Text>
            <Text style={styles.fallbackSubtitle}>
              Audio playback (no captions available)
            </Text>
          </View>
        ) : (
          <View style={styles.idleBox}>
            <View style={styles.idleDot} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0d0e12",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  captionBox: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    gap: spacing.sm,
  },
  captionBoxPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    transform: [{ scale: 0.99 }],
  },
  captionText: {
    color: colors.foreground,
    fontWeight: fontWeight.medium,
    textAlign: "center",
    letterSpacing: 0.3,
  },
  replayHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
    opacity: 0.8,
  },
  replayHintText: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
  },
  fallbackBox: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  fallbackTitle: {
    color: colors.foreground,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  fallbackSubtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    textAlign: "center",
  },
  idleBox: {
    height: 60,
    justifyContent: "center",
    alignItems: "center",
  },
  idleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
});
