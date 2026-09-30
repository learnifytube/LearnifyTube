import { useCallback, useEffect, useMemo, useState } from "react";
import Constants from "expo-constants";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, type Href } from "expo-router";
import { Logs } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { desktopConnection } from "../../services/desktop-connection";
import { logger, type AppLogEntry } from "../../services/logger";
import {
  checkForAndroidApkUpdate,
  getAndroidApkUpdateAvailability,
  type AndroidApkUpdateAvailability,
} from "../../services/app-update";
import {
  getVideoStorageLocation,
  selectVideoStorageDirectory,
  setInternalVideoStorage,
  type VideoStorageLocation,
} from "../../services/storage-location";
import {
  describeConnectionProblem,
  describeConnectionStatus,
} from "../../components/tv/connectionText";
import { TVFocusPressable } from "../../components/tv/TVFocusPressable";
import {
  toTVUpdateMessenger,
  useTVMessage,
} from "../../components/tv/TVMessage";
import { storageFolderFailed } from "../../components/tv/tvMessages";

const LOG_PAGE_SIZE = 16;

function getAndroidApiLevel(): number {
  if (Platform.OS !== "android") return 0;
  if (typeof Platform.Version === "number") return Platform.Version;
  const parsed = Number.parseInt(String(Platform.Version), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export default function TVSettingsScreen() {
  const connection = desktopConnection.useConnection();
  const isConnected = connection.status === "connected";

  const [input, setInput] = useState("");
  const {
    show: showTVMessage,
    ask: askTVMessage,
    element: tvMessageElement,
  } = useTVMessage();
  const [isManualConnectPending, setIsManualConnectPending] = useState(false);
  const [manualFailure, setManualFailure] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isLoadingUpdateAvailability, setIsLoadingUpdateAvailability] =
    useState(false);
  const [updateAvailability, setUpdateAvailability] =
    useState<AndroidApkUpdateAvailability | null>(null);
  const [videoStorageLocation, setVideoStorageLocation] =
    useState<VideoStorageLocation | null>(null);
  const [isSelectingStorage, setIsSelectingStorage] = useState(false);

  const appVersion =
    Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "unknown";
  const appBuild = Constants.nativeBuildVersion ?? "-";
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [logEntries, setLogEntries] = useState<AppLogEntry[]>(() =>
    logger.getEntries(),
  );
  const [logPage, setLogPage] = useState(0);

  const reversedLogs = useMemo(() => [...logEntries].reverse(), [logEntries]);
  const totalLogPages = Math.max(
    1,
    Math.ceil(reversedLogs.length / LOG_PAGE_SIZE),
  );
  const clampedLogPage = Math.min(logPage, totalLogPages - 1);
  const pageStart = clampedLogPage * LOG_PAGE_SIZE;
  const pagedLogs = reversedLogs.slice(pageStart, pageStart + LOG_PAGE_SIZE);
  const hasOlderLogs = pageStart + LOG_PAGE_SIZE < reversedLogs.length;
  const hasNewerLogs = clampedLogPage > 0;

  useEffect(() => {
    const unsubscribe = logger.subscribe((entries) => {
      setLogEntries(entries);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (logPage !== clampedLogPage) {
      setLogPage(clampedLogPage);
    }
  }, [clampedLogPage, logPage]);

  useEffect(() => {
    logger.info("[TV Settings] Opened settings", {
      platform: Platform.OS,
      androidApiLevel: getAndroidApiLevel(),
      appVersion,
      appBuild,
    });

    return () => {
      logger.info("[TV Settings] Closed settings");
    };
  }, [appBuild, appVersion]);

  const connectToManualInput = async () => {
    if (!input.trim()) {
      setManualFailure("Enter the desktop's address first.");
      return;
    }
    setIsManualConnectPending(true);
    setManualFailure(null);
    const result = await desktopConnection.connectManually(input);
    setIsManualConnectPending(false);
    if (result.status !== "connected") {
      setManualFailure(describeConnectionProblem(result));
    }
  };

  const openPairing = () => router.push("/(tv)/connect" as Href);

  const refreshUpdateAvailability = useCallback(async () => {
    setIsLoadingUpdateAvailability(true);
    try {
      const availability = await getAndroidApkUpdateAvailability();
      setUpdateAvailability(availability);
    } finally {
      setIsLoadingUpdateAvailability(false);
    }
  }, []);

  useEffect(() => {
    void refreshUpdateAvailability();
  }, [refreshUpdateAvailability]);

  useEffect(() => {
    void getVideoStorageLocation().then(setVideoStorageLocation);
  }, []);

  const handleSelectStorage = useCallback(async () => {
    if (isSelectingStorage) return;

    setIsSelectingStorage(true);
    try {
      const location = await selectVideoStorageDirectory();
      if (location) {
        setVideoStorageLocation(location);
        logger.info("[TV Settings] Video storage folder selected", {
          label: location.label,
          kind: location.kind,
        });
      }
    } catch (error) {
      showTVMessage(storageFolderFailed);
      logger.error(
        "[TV Settings] Failed to select video storage folder",
        error,
      );
    } finally {
      setIsSelectingStorage(false);
    }
  }, [isSelectingStorage, showTVMessage]);

  const handleUseInternalStorage = useCallback(async () => {
    const location = await setInternalVideoStorage();
    setVideoStorageLocation(location);
    logger.info("[TV Settings] Video storage reset to internal");
  }, []);

  const handleUpdatePress = useCallback(async () => {
    if (isCheckingUpdate) return;

    setIsCheckingUpdate(true);
    try {
      await checkForAndroidApkUpdate({
        manual: true,
        messenger: toTVUpdateMessenger({
          show: showTVMessage,
          ask: askTVMessage,
        }),
      });
    } finally {
      setIsCheckingUpdate(false);
      void refreshUpdateAvailability();
    }
  }, [
    askTVMessage,
    isCheckingUpdate,
    refreshUpdateAvailability,
    showTVMessage,
  ]);

  const openLogViewer = useCallback(() => {
    setLogPage(0);
    setIsLogViewerOpen(true);
    logger.info("[TV Settings] Opened log viewer");
  }, []);

  const closeLogViewer = useCallback(() => {
    setIsLogViewerOpen(false);
    logger.info("[TV Settings] Closed log viewer");
  }, []);

  const clearLogs = useCallback(() => {
    logger.clearEntries();
    logger.info("[TV Settings] Cleared app logs");
    setLogPage(0);
  }, []);

  const statusLabel = describeConnectionStatus(connection);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.topActions}>
          <TVFocusPressable style={styles.logButton} onPress={openLogViewer}>
            <Logs size={20} color="#fffef2" />
          </TVFocusPressable>
          <TVFocusPressable
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backText}>Back</Text>
          </TVFocusPressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        <View style={styles.settingsGrid}>
          <View style={styles.gridColumn}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Desktop Connection</Text>
              <Text style={styles.statusText}>
                {isConnected && connection.desktopName
                  ? `${statusLabel} to ${connection.desktopName}`
                  : statusLabel}
              </Text>

              {!isConnected ? (
                <View style={styles.discoveryHint}>
                  {connection.status === "connecting" ? (
                    <ActivityIndicator size="small" color="#ffd93d" />
                  ) : null}
                  <Text style={styles.discoveryHintText}>
                    {describeConnectionProblem(connection)}
                  </Text>
                </View>
              ) : null}

              <View style={styles.actionsRow}>
                <TVFocusPressable
                  style={styles.primaryAction}
                  onPress={openPairing}
                >
                  <Text style={styles.actionText}>Pair with desktop</Text>
                </TVFocusPressable>
                {connection.status !== "pairingRequired" ? (
                  <TVFocusPressable
                    style={styles.secondaryAction}
                    onPress={desktopConnection.retryNow}
                  >
                    <Text style={styles.actionText}>Retry</Text>
                  </TVFocusPressable>
                ) : null}
                {isConnected ? (
                  <TVFocusPressable
                    style={styles.secondaryAction}
                    onPress={desktopConnection.disconnect}
                  >
                    <Text style={styles.actionText}>Disconnect</Text>
                  </TVFocusPressable>
                ) : null}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>App</Text>
              <Text style={styles.statusText}>
                Version {appVersion} (build {appBuild})
              </Text>

              {isLoadingUpdateAvailability ? (
                <View style={styles.discoveryHint}>
                  <ActivityIndicator size="small" color="#ffd93d" />
                  <Text style={styles.discoveryHintText}>
                    Checking update status...
                  </Text>
                </View>
              ) : null}

              <TVFocusPressable
                style={[
                  styles.primaryAction,
                  isCheckingUpdate && styles.actionDisabled,
                ]}
                onPress={() => void handleUpdatePress()}
                disabled={isCheckingUpdate}
              >
                <Text style={styles.actionText}>
                  {isCheckingUpdate
                    ? "Opening installer..."
                    : updateAvailability?.hasUpdate
                      ? "Download Update"
                      : "Check for Updates"}
                </Text>
              </TVFocusPressable>

              {updateAvailability?.hasUpdate ? (
                <Text style={styles.discoveryHintText}>
                  {updateAvailability.latestVersionLabel
                    ? `New version ${updateAvailability.latestVersionLabel} is available`
                    : "A new app version is available"}
                </Text>
              ) : null}

              {!isLoadingUpdateAvailability &&
              updateAvailability?.configured &&
              !updateAvailability.hasUpdate ? (
                <Text style={styles.candidatesText}>App is up to date</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.gridColumn}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Manual Fallback</Text>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="192.168.1.5"
                placeholderTextColor="#64748b"
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <TVFocusPressable
                style={[
                  styles.primaryAction,
                  isManualConnectPending && styles.actionDisabled,
                ]}
                onPress={() => void connectToManualInput()}
                disabled={isManualConnectPending}
              >
                <Text style={styles.actionText}>
                  {isManualConnectPending ? "Connecting…" : "Connect"}
                </Text>
              </TVFocusPressable>

              {manualFailure && !isConnected ? (
                <Text style={styles.errorText}>{manualFailure}</Text>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Video Storage</Text>
              <Text style={styles.statusText} numberOfLines={2}>
                {videoStorageLocation?.label ?? "Internal app storage"}
              </Text>
              <View style={styles.actionsRow}>
                <TVFocusPressable
                  style={[
                    styles.primaryAction,
                    isSelectingStorage && styles.actionDisabled,
                  ]}
                  onPress={() => void handleSelectStorage()}
                  disabled={isSelectingStorage}
                >
                  <Text style={styles.actionText}>
                    {isSelectingStorage ? "Opening..." : "Choose Folder"}
                  </Text>
                </TVFocusPressable>
                {videoStorageLocation?.kind !== "internal" ? (
                  <TVFocusPressable
                    style={styles.secondaryAction}
                    onPress={() => void handleUseInternalStorage()}
                  >
                    <Text style={styles.actionText}>Use Internal</Text>
                  </TVFocusPressable>
                ) : null}
              </View>
              <Text style={styles.candidatesText}>
                If folder picker is unavailable, LearnifyTube will try a
                connected USB drive automatically.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {isLogViewerOpen ? (
        <View style={styles.logOverlay}>
          <View style={styles.logPanel}>
            <View style={styles.logHeader}>
              <Text style={styles.logTitle}>App Logs</Text>
              <Text style={styles.logMeta}>
                Page {clampedLogPage + 1}/{totalLogPages} · {logEntries.length}{" "}
                entries
              </Text>
            </View>

            <View style={styles.logActions}>
              <TVFocusPressable
                style={[
                  styles.logActionButton,
                  !hasOlderLogs && styles.logActionDisabled,
                ]}
                disabled={!hasOlderLogs}
                onPress={() => setLogPage((prev) => prev + 1)}
              >
                <Text style={styles.logActionText}>Older</Text>
              </TVFocusPressable>

              <TVFocusPressable
                style={[
                  styles.logActionButton,
                  !hasNewerLogs && styles.logActionDisabled,
                ]}
                disabled={!hasNewerLogs}
                onPress={() => setLogPage((prev) => Math.max(0, prev - 1))}
              >
                <Text style={styles.logActionText}>Newer</Text>
              </TVFocusPressable>

              <TVFocusPressable
                style={styles.logActionButton}
                onPress={clearLogs}
              >
                <Text style={styles.logActionText}>Clear</Text>
              </TVFocusPressable>

              <TVFocusPressable
                style={styles.logActionButton}
                onPress={closeLogViewer}
                hasTVPreferredFocus
              >
                <Text style={styles.logActionText}>Close</Text>
              </TVFocusPressable>
            </View>

            <View style={styles.logBody}>
              {pagedLogs.length === 0 ? (
                <Text style={styles.logEmptyText}>No logs yet</Text>
              ) : (
                pagedLogs.map((entry) => (
                  <Text
                    key={entry.id}
                    style={[
                      styles.logLine,
                      entry.level === "warn" && styles.logLineWarn,
                      entry.level === "error" && styles.logLineError,
                    ]}
                    numberOfLines={2}
                  >
                    [{entry.timestamp}] [{entry.level.toUpperCase()}]{" "}
                    {entry.message}
                    {entry.context ? ` ${entry.context}` : ""}
                    {entry.error ? ` | ${entry.error}` : ""}
                  </Text>
                ))
              )}
            </View>
          </View>
        </View>
      ) : null}
      {tvMessageElement}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#132447",
    paddingHorizontal: 24,
    paddingBottom: 10,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  settingsGrid: {
    flexDirection: "row",
    gap: 12,
    alignItems: "stretch",
  },
  gridColumn: {
    flex: 1,
    gap: 12,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: "#fff4cc",
    fontSize: 34,
    fontWeight: "900",
  },
  logButton: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#8ec5ff",
    backgroundColor: "#2d7ff9",
    paddingHorizontal: 11,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff8a00",
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  backText: {
    color: "#fffef2",
    fontSize: 17,
    fontWeight: "900",
  },
  section: {
    marginTop: 0,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#2f5f9f",
    backgroundColor: "#1b376f",
    padding: 12,
    gap: 7,
    shadowColor: "#020817",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  sectionTitle: {
    color: "#fffef2",
    fontSize: 20,
    fontWeight: "900",
  },
  statusText: {
    color: "#eaf5ff",
    fontSize: 16,
    fontWeight: "700",
  },
  discoveryHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  discoveryHintText: {
    color: "#eaf5ff",
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: "#ffe3e3",
    fontSize: 13,
    fontWeight: "700",
  },
  actionsRow: {
    marginTop: 2,
    flexDirection: "row",
    gap: 8,
  },
  primaryAction: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff6b6b",
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  secondaryAction: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff8a00",
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  actionText: {
    color: "#fffef2",
    fontSize: 16,
    fontWeight: "900",
  },
  actionDisabled: {
    opacity: 0.6,
  },
  input: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#8ec5ff",
    backgroundColor: "#132447",
    color: "#fffef2",
    fontSize: 17,
    fontWeight: "800",
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  candidatesText: {
    color: "#dbeafe",
    fontSize: 13,
    fontWeight: "700",
  },
  logOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    paddingHorizontal: 28,
    paddingVertical: 22,
    justifyContent: "center",
  },
  logPanel: {
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#8ec5ff",
    backgroundColor: "#0f1b3a",
    padding: 16,
    gap: 12,
  },
  logHeader: {
    gap: 4,
  },
  logTitle: {
    color: "#fff4cc",
    fontSize: 28,
    fontWeight: "900",
  },
  logMeta: {
    color: "#bfdbfe",
    fontSize: 15,
    fontWeight: "700",
  },
  logActions: {
    flexDirection: "row",
    gap: 10,
  },
  logActionButton: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#ffd93d",
    backgroundColor: "#ff8a00",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  logActionDisabled: {
    opacity: 0.45,
  },
  logActionText: {
    color: "#fffef2",
    fontSize: 16,
    fontWeight: "800",
  },
  logBody: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#020817",
    minHeight: 420,
    maxHeight: 420,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  logEmptyText: {
    color: "#94a3b8",
    fontSize: 15,
    fontWeight: "700",
  },
  logLine: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "500",
  },
  logLineWarn: {
    color: "#fde68a",
  },
  logLineError: {
    color: "#fca5a5",
  },
});
