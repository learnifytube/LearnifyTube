import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLibraryStore } from "../../../stores/library";
import { playQueue } from "../../../services/play-queue";
import { VideoGridCard } from "../../../components/VideoGridCard";
import { useLibraryCatalog } from "../../../core/hooks/useLibraryCatalog";
import { colors, spacing, fontSize, fontWeight } from "../../../theme";

export default function OnThisPhoneScreen() {
  const { offlineVideos } = useLibraryCatalog();
  const removeVideo = useLibraryStore((state) => state.removeVideo);

  const playAt = (index: number) => {
    const videos = offlineVideos.map((item) => ({
      id: item.id,
      title: item.title,
      channelTitle: item.channelTitle,
      duration: item.duration,
      thumbnailUrl: item.thumbnailUrl ?? undefined,
    }));
    const video = playQueue.start({
      id: "on-this-phone",
      title: "On this phone",
      videos,
      startIndex: index,
    });
    if (!video) return;
    router.push(`/player/${video.id}`);
  };

  const remove = (videoId: string, title: string) => {
    Alert.alert("Remove from this phone?", title, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => removeVideo(videoId),
      },
    ]);
  };

  if (offlineVideos.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>On this phone</Text>
          <Text style={styles.emptyText}>
            Videos you play while connected stay here for Offline mode.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Text style={styles.screenTitle}>On this phone</Text>
      <Text style={styles.hint}>Long-press a video to remove it</Text>
      <FlatList
        data={offlineVideos}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        renderItem={({ item, index }) => (
          <View style={styles.gridItem}>
            <VideoGridCard
              video={item}
              onPress={() => playAt(index)}
              onLongPress={() => remove(item.id, item.title)}
            />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  screenTitle: {
    color: colors.foreground,
    fontSize: fontSize["2xl"],
    fontWeight: fontWeight.bold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  hint: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  grid: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xl },
  gridItem: { width: "50%" },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.base,
    textAlign: "center",
    lineHeight: 22,
  },
});
