import { Image, StyleSheet, View } from "react-native";
import { colors, radius } from "../../theme";
import { Headphones } from "../../theme/icons";

/** A square Audiobook cover, or the placeholder when it has none. */
export function AudiobookCover({
  uri,
  size,
}: {
  uri: string | null;
  size: number;
}) {
  const box = { width: size, height: size };
  if (!uri) {
    return (
      <View style={[styles.cover, styles.placeholder, box]}>
        <Headphones size={size / 3} color={colors.mutedForeground} />
      </View>
    );
  }
  return (
    <Image source={{ uri }} style={[styles.cover, box]} resizeMode="cover" />
  );
}

const styles = StyleSheet.create({
  cover: { borderRadius: radius.md, backgroundColor: colors.card },
  placeholder: { alignItems: "center", justifyContent: "center" },
});
