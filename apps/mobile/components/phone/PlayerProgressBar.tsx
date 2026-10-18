import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  type GestureResponderEvent,
} from "react-native";
import { colors, fontSize, spacing } from "../../theme";
import {
  calculateProgressPercent,
  calculateScrubTime,
  formatPlayerTime,
} from "./playerScrubber";

interface PlayerProgressBarProps {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}

export function PlayerProgressBar({
  currentTime,
  duration,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: PlayerProgressBarProps) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  const trackRef = useRef<View>(null);
  const trackBoundsRef = useRef({ pageX: 0, width: 0 });

  const getTargetTimeFromEvent = (evt: GestureResponderEvent): number => {
    const { pageX, width } = trackBoundsRef.current;
    if (width <= 0) return 0;
    const touchX = evt.nativeEvent.pageX - pageX;
    return calculateScrubTime(touchX, width, duration);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        onScrubStart?.();
        setIsScrubbing(true);
        trackRef.current?.measure((_x, _y, width, _height, pageX) => {
          trackBoundsRef.current = { pageX, width };
          const touchX = evt.nativeEvent.pageX - pageX;
          const target = calculateScrubTime(touchX, width, duration);
          setScrubTime(target);
        });
      },
      onPanResponderMove: (evt) => {
        const target = getTargetTimeFromEvent(evt);
        setScrubTime(target);
      },
      onPanResponderRelease: (evt) => {
        const target = getTargetTimeFromEvent(evt);
        setIsScrubbing(false);
        onSeek(target);
        onScrubEnd?.();
      },
      onPanResponderTerminate: () => {
        setIsScrubbing(false);
        onScrubEnd?.();
      },
    }),
  ).current;

  const displayTime = isScrubbing ? scrubTime : currentTime;
  const progressPercent = calculateProgressPercent(displayTime, duration);

  return (
    <View style={styles.container} testID="player-progress-bar">
      <Text style={styles.timeText}>{formatPlayerTime(displayTime)}</Text>
      <View
        ref={trackRef}
        style={styles.trackContainer}
        onLayout={() => {
          trackRef.current?.measure((_x, _y, width, _height, pageX) => {
            trackBoundsRef.current = { pageX, width };
          });
        }}
        {...panResponder.panHandlers}
      >
        <View style={styles.trackBackground}>
          <View
            style={[styles.trackFill, { width: `${progressPercent}%` }]}
          />
        </View>

        {/* Thumb */}
        <View
          style={[
            styles.thumb,
            { left: `${progressPercent}%` },
            isScrubbing && styles.thumbActive,
          ]}
        />

        {/* Floating Time Bubble while scrubbing */}
        {isScrubbing && (
          <View
            style={[styles.bubble, { left: `${progressPercent}%` }]}
            pointerEvents="none"
          >
            <Text style={styles.bubbleText}>
              {formatPlayerTime(scrubTime)}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.timeText}>{formatPlayerTime(duration)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    width: "100%",
    paddingVertical: spacing.xs,
  },
  timeText: {
    color: colors.foreground,
    fontSize: fontSize.xs,
    fontVariant: ["tabular-nums"],
    minWidth: 42,
    textAlign: "center",
  },
  trackContainer: {
    flex: 1,
    height: 28,
    justifyContent: "center",
    position: "relative",
  },
  trackBackground: {
    height: 4,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 2,
    overflow: "hidden",
  },
  trackFill: {
    height: "100%",
    backgroundColor: colors.primary,
  },
  thumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
    marginLeft: -7,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  thumbActive: {
    transform: [{ scale: 1.25 }],
    backgroundColor: colors.primary,
  },
  bubble: {
    position: "absolute",
    bottom: 24,
    marginLeft: -26,
    width: 52,
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  bubbleText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
});
