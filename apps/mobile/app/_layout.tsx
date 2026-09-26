import { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as ScreenOrientation from "expo-screen-orientation";
import { useDatabase } from "../hooks/useDatabase";
import { downloadQueue } from "../services/download-queue";
import { useOfflineCopyScans } from "../hooks/useOfflineCopyScans";
import { useLibraryStore } from "../stores/library";
import { useNavigationLogger } from "../hooks/useNavigationLogger";
import { usePresencePublisher } from "../hooks/usePresencePublisher";
import { useSelfUpdateCheck } from "../hooks/useSelfUpdateCheck";
import { colors } from "../theme";

function DownloadQueueRunner() {
  useEffect(() => downloadQueue.start(), []);
  return null;
}

function OfflineCopyScanner() {
  useOfflineCopyScans();
  return null;
}

function NavigationLogger() {
  useNavigationLogger();
  return null;
}

function PresencePublisher() {
  usePresencePublisher();
  return null;
}

function SelfUpdateChecker() {
  useSelfUpdateCheck();
  return null;
}

function OrientationController() {
  useEffect(() => {
    if (Platform.OS !== "android" && Platform.OS !== "ios") {
      return;
    }

    const lockOrientation = async () => {
      const orientation = Platform.isTV
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP;
      await ScreenOrientation.lockAsync(orientation);
    };

    lockOrientation().catch((error) => {
      console.warn("[orientation] Failed to lock orientation", error);
    });
  }, []);

  return null;
}

function DatabaseInitializer({ children }: { children: React.ReactNode }) {
  const { isReady, error } = useDatabase();
  const loadVideos = useLibraryStore((state) => state.loadVideos);
  const isLoaded = useLibraryStore((state) => state.isLoaded);

  useEffect(() => {
    if (isReady && !isLoaded) {
      loadVideos();
    }
  }, [isReady, isLoaded, loadVideos]);

  if (error) {
    return (
      <View style={styles.loading}>
        <Text style={styles.errorText}>Database Error</Text>
        <Text style={styles.errorDetail}>{error.message}</Text>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Initializing...</Text>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 16,
    color: colors.mutedForeground,
    fontSize: 16,
  },
  errorText: {
    color: colors.destructive,
    fontSize: 18,
    fontWeight: "bold",
  },
  errorDetail: {
    color: colors.mutedForeground,
    fontSize: 14,
    marginTop: 8,
  },
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DatabaseInitializer>
        <DownloadQueueRunner />
        <OfflineCopyScanner />
        <NavigationLogger />
        <PresencePublisher />
        <SelfUpdateChecker />
        <OrientationController />
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: {
              backgroundColor: colors.background,
            },
          }}
        >
          <Stack.Screen name="(mobile)" options={{ headerShown: false }} />
          <Stack.Screen name="(tv)" options={{ headerShown: false }} />
        </Stack>
      </DatabaseInitializer>
    </SafeAreaProvider>
  );
}
