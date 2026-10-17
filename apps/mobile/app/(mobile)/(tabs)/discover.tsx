import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Image,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useConnectionStore } from "../../../stores/connection";
import { useSyncStore } from "../../../stores/sync";
import { useBrowseCatalog } from "../../../core/hooks/useBrowseCatalog";
import { resolveRemoteAssetUrl } from "../../../services/browseCache";
import {
  colors,
  spacing,
  radius,
  fontSize,
  fontWeight,
  getPlaceholderColor,
} from "../../../theme";
import {
  ChevronRight,
  Folder,
  ListVideo,
  Tv,
} from "../../../theme/icons";

type DiscoverTab = "channels" | "playlists" | "mylists";

interface DiscoverItem {
  id: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  kind: "channel" | "playlist" | "mylist";
}

export default function DiscoverScreen() {
  const serverUrl = useConnectionStore((state) => state.serverUrl);
  const sync = useSyncStore();
  const { channels, playlists, myLists } = useBrowseCatalog();
  const [activeTab, setActiveTab] = useState<DiscoverTab>("channels");
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    if (!serverUrl) return;
    setRefreshing(true);
    try {
      await Promise.all([
        sync.fetchChannels(serverUrl),
        sync.fetchPlaylists(serverUrl),
        sync.fetchMyLists(serverUrl),
      ]);
    } catch (err) {
      console.warn("[DiscoverScreen] Refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  }, [serverUrl, sync]);

  const items: DiscoverItem[] = (() => {
    switch (activeTab) {
      case "channels":
        return channels.map((c) => ({
          id: c.channelId,
          title: c.channelTitle,
          subtitle: `${c.videoCount} video${c.videoCount === 1 ? "" : "s"}`,
          thumbnailUrl: resolveRemoteAssetUrl(serverUrl, c.thumbnailUrl),
          kind: "channel",
        }));
      case "playlists":
        return playlists.map((p) => ({
          id: p.playlistId,
          title: p.title,
          subtitle: `${p.itemCount} video${p.itemCount === 1 ? "" : "s"}`,
          thumbnailUrl: resolveRemoteAssetUrl(serverUrl, p.thumbnailUrl),
          kind: "playlist",
        }));
      case "mylists":
        return myLists.map((l) => ({
          id: l.id,
          title: l.name,
          subtitle: `${l.itemCount} video${l.itemCount === 1 ? "" : "s"}`,
          thumbnailUrl: resolveRemoteAssetUrl(serverUrl, l.thumbnailUrl),
          kind: "mylist",
        }));
    }
  })();

  const openCollection = (item: DiscoverItem) => {
    router.push({
      pathname: "/(mobile)/collection",
      params: {
        kind: item.kind,
        id: item.id,
        title: item.title,
      },
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Text style={styles.screenTitle}>Discover</Text>

      {/* Segmented control */}
      <View style={styles.tabBar}>
        <Pressable
          style={[
            styles.tabButton,
            activeTab === "channels" && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab("channels")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "channels" && styles.tabTextActive,
            ]}
          >
            Channels
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.tabButton,
            activeTab === "playlists" && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab("playlists")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "playlists" && styles.tabTextActive,
            ]}
          >
            Playlists
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.tabButton,
            activeTab === "mylists" && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab("mylists")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "mylists" && styles.tabTextActive,
            ]}
          >
            My Lists
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              No {activeTab === "channels" ? "channels" : activeTab === "playlists" ? "playlists" : "lists"} found
            </Text>
            <Text style={styles.emptyText}>
              {serverUrl
                ? "Pull down to refresh and sync with desktop"
                : "Connect to your desktop app to discover channels and playlists"}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.itemRow,
              pressed && styles.itemRowPressed,
            ]}
            onPress={() => openCollection(item)}
          >
            {item.thumbnailUrl ? (
              <Image
                source={{ uri: item.thumbnailUrl }}
                style={item.kind === "channel" ? styles.avatar : styles.thumbnail}
              />
            ) : (
              <View
                style={[
                  item.kind === "channel" ? styles.avatar : styles.thumbnail,
                  styles.placeholderIcon,
                  { backgroundColor: getPlaceholderColor(item.title) },
                ]}
              >
                {item.kind === "channel" ? (
                  <Tv size={20} color={colors.foreground} />
                ) : item.kind === "playlist" ? (
                  <ListVideo size={20} color={colors.foreground} />
                ) : (
                  <Folder size={20} color={colors.foreground} />
                )}
              </View>
            )}
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.itemSubtitle}>{item.subtitle}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenTitle: {
    color: colors.foreground,
    fontSize: fontSize["2xl"],
    fontWeight: fontWeight.bold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: radius.md,
  },
  tabButtonActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  tabTextActive: {
    color: colors.primaryForeground,
    fontWeight: fontWeight.semibold,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  itemRowPressed: {
    backgroundColor: colors.cardHover,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  thumbnail: {
    width: 64,
    height: 48,
    borderRadius: radius.md,
  },
  placeholderIcon: {
    alignItems: "center",
    justifyContent: "center",
  },
  itemInfo: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
  },
  itemTitle: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    marginBottom: 2,
  },
  itemSubtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing["2xl"],
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    textAlign: "center",
    lineHeight: 20,
  },
});
