import { useEffect, useState, type Ref } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  Image,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type ImageSourcePropType,
} from "react-native";
import {
  colors,
  fontWeight,
  radius,
  spacing,
  tvFocus,
  tvFontSize,
  tvRestingBorder,
  tvScrim,
} from "../../theme";
import {
  TVFocusPressable,
  type TVFocusPressableHandle,
} from "./TVFocusPressable";

export const TV_GRID_CARD_WIDTH = 372;
export const TV_GRID_CARD_HEIGHT = 184;
const FALLBACK_THUMBNAIL = require("../../assets/tv-banner.png");

interface TVCardProps {
  title: string;
  subtitle?: string;
  /** Shows a spinner while pressing the card is still opening it. */
  busy?: boolean;
  thumbnailUrl?: string | null;
  onPress?: () => void;
  onFocus?: () => void;
  hasTVPreferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  pressableRef?: Ref<TVFocusPressableHandle>;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusUp?: number;
  nextFocusDown?: number;
}

export function TVCard({
  title,
  subtitle,
  busy,
  thumbnailUrl,
  onPress,
  onFocus,
  hasTVPreferredFocus,
  style,
  pressableRef,
  nextFocusLeft,
  nextFocusRight,
  nextFocusUp,
  nextFocusDown,
}: TVCardProps) {
  const [thumbnailError, setThumbnailError] = useState(false);

  useEffect(() => {
    setThumbnailError(false);
  }, [thumbnailUrl]);

  const imageSource: ImageSourcePropType =
    thumbnailUrl && !thumbnailError
      ? { uri: thumbnailUrl }
      : FALLBACK_THUMBNAIL;

  return (
    <TVFocusPressable
      ref={pressableRef}
      style={[styles.card, style]}
      focusedStyle={styles.cardFocused}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={onFocus}
      onPress={onPress}
      nextFocusLeft={nextFocusLeft}
      nextFocusRight={nextFocusRight}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
    >
      <Image
        source={imageSource}
        style={styles.thumbnail}
        resizeMode="cover"
        onError={() => setThumbnailError(true)}
      />
      <View style={styles.bottomScrim} />
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator size="small" color={colors.foreground} />
          <Text style={styles.busyText}>Opening…</Text>
        </View>
      ) : null}
      <View style={styles.cardInner}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </TVFocusPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: TV_GRID_CARD_WIDTH,
    height: TV_GRID_CARD_HEIGHT,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    ...tvRestingBorder,
    overflow: "hidden",
  },
  thumbnail: {
    ...StyleSheet.absoluteFillObject,
  },
  // The thumbnail stays clear up top; a one-line title sits on a solid band, away from text drawn
  // into the thumbnail itself.
  bottomScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: "58%",
    backgroundColor: tvScrim,
  },
  busy: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  busyText: {
    color: colors.foreground,
    fontSize: tvFontSize.caption,
    fontWeight: fontWeight.semibold,
  },
  cardFocused: tvFocus,
  cardInner: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  title: {
    color: colors.foreground,
    fontSize: tvFontSize.title,
    lineHeight: 28,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: tvFontSize.caption,
    fontWeight: fontWeight.medium,
  },
});
