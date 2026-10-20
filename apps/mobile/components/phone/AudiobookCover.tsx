import { Image, StyleSheet, View } from "react-native";
import { heldAudiobooks } from "../../services/held-audiobooks";
import { localFirstCoverUri } from "../../services/held-audiobooks/localFirstCoverUri";
import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { colors, radius } from "../../theme";
import { Headphones } from "../../theme/icons";

/**
 * A square Audiobook cover, or the placeholder when it has none: the cover
 * stored on the phone with a held book, else the desktop's at serverUrl.
 */
export function AudiobookCover({
  book,
  serverUrl,
  size,
}: {
  book: Pick<Audiobook, "id" | "coverUrl">;
  serverUrl: string | null;
  size: number;
}) {
  const heldCoverUri = heldAudiobooks.useHolds().get(book.id)?.coverUri ?? null;
  const uri = localFirstCoverUri({
    heldCoverUri,
    serverUrl,
    coverUrl: book.coverUrl,
  });
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
