import { StyleSheet, Text, View } from "react-native";
import type { TrackPosition } from "../../../shared/mobile-sync-contract";
import { trackListenState } from "../../services/listening-position/trackPositions";
import { colors, fontSize, spacing } from "../../theme";
import { Check } from "../../theme/icons";
import { formatTrackDuration } from "./formatTrackDuration";

// A Track's state in a Track list: nothing when not started, "At m:ss" in
// progress, "Played" once played to its end.
export function TrackListenBadge({
  position,
}: {
  position: TrackPosition | null | undefined;
}) {
  const state = trackListenState(position);
  if (state === "not-started") return null;
  if (state === "played-to-end") {
    return (
      <View style={styles.played}>
        <Check size={12} color={colors.mutedForeground} />
        <Text style={styles.playedText}>Played</Text>
      </View>
    );
  }
  return (
    <Text style={styles.inProgress}>
      At {formatTrackDuration(position?.seconds ?? 0)}
    </Text>
  );
}

const styles = StyleSheet.create({
  played: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  playedText: { color: colors.mutedForeground, fontSize: fontSize.xs },
  inProgress: { color: colors.primary, fontSize: fontSize.xs },
});
