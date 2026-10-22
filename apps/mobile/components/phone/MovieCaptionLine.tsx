import { StyleSheet, Text, View } from "react-native";
import { fontWeight } from "../../theme";

/** The Caption on screen in the phone Movie player, `bottom` above the edge. */
export function MovieCaptionLine({
  text,
  bottom,
  maxWidth,
  fontSize,
}: {
  text: string;
  bottom: number;
  maxWidth: number;
  fontSize: number;
}) {
  return (
    <View style={[styles.caption, { bottom }]} pointerEvents="none">
      <Text
        style={[
          styles.captionLine,
          { maxWidth, fontSize, lineHeight: Math.round(fontSize * 1.45) },
        ]}
        textBreakStrategy="balanced"
      >
        <Text style={styles.captionText}>{` ${text} `}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1,
    alignItems: "center",
  },
  captionLine: {
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  captionText: {
    color: "#fff",
    fontWeight: fontWeight.semibold,
    backgroundColor: "rgba(8,8,8,0.72)",
  },
});
