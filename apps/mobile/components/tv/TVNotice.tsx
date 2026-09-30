import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTVNoticeStore } from "../../stores/tvNotice";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";

const NOTICE_MS = 6000;

/**
 * Shows the current TV notice over every TV screen for a few seconds. It never takes
 * focus, so whatever is playing or focused carries on underneath.
 */
export function TVNoticeHost() {
  const notice = useTVNoticeStore((state) => state.notice);
  const clear = useTVNoticeStore((state) => state.clear);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(clear, NOTICE_MS);
    return () => clearTimeout(timeout);
  }, [notice, clear]);

  if (!notice) return null;

  return (
    <View
      style={styles.container}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.notice} accessibilityLiveRegion="polite">
        <Text style={styles.title}>{notice.title}</Text>
        <Text style={styles.text}>{notice.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    alignItems: "center",
  },
  notice: {
    maxWidth: 720,
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  text: {
    color: colors.mutedForeground,
    fontSize: fontSize.lg,
  },
});
