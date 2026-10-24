import { Pressable, StyleSheet, Text } from "react-native";
import { colors, fontSize, fontWeight, radius, spacing } from "../../theme";
import { Download } from "../../theme/icons";
import type { phoneSeriesDownload } from "./phoneSeries";

/**
 * The Series screen's Download series button, shown while connected and an
 * Episode is left to pull, and how many Episodes are on this phone.
 */
export function SeriesDownload({
  download,
  connected,
  onPress,
}: {
  download: ReturnType<typeof phoneSeriesDownload>;
  connected: boolean;
  onPress: () => void;
}) {
  return (
    <>
      {connected && download.toPull.length > 0 ? (
        <Pressable
          testID="series-download"
          style={styles.button}
          onPress={onPress}
          accessibilityLabel="Download series to this phone"
        >
          <Download size={16} color={colors.foreground} />
          <Text style={styles.text}>Download series</Text>
        </Pressable>
      ) : null}
      {download.status ? (
        <Text style={styles.status}>{download.status}</Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  status: { color: colors.mutedForeground, fontSize: fontSize.sm },
});
