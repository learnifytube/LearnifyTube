import Constants from "expo-constants";
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  Modal,
  ActivityIndicator,
  Alert,
  Pressable,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSettingsStore, LANGUAGES } from "../../../stores/settings";
import { useConnectionStore } from "../../../stores/connection";
import { api } from "../../../services/api";
import { startScanning, stopScanning } from "../../../services/p2p/discovery";
import {
  assertSyncCompatibility,
  SyncCompatibilityError,
} from "../../../services/sync-compatibility";
import {
  checkForAndroidApkUpdate,
  getAndroidApkUpdateAvailability,
  type AndroidApkUpdateAvailability,
} from "../../../services/app-update";
import { ensureDiscoveryPermissions } from "../../../services/discovery-permissions";
import { logger, type AppLogEntry } from "../../../services/logger";
import { verifyDesktopUrl } from "../../../services/verify-desktop";
import type { DiscoveredPeer } from "../../../types";

const DEFAULT_SYNC_PORT = 53318;
const LEGACY_SYNC_PORT = 8384;
const DISCOVERY_SCAN_TIMEOUT_MS = 15000;
const CONNECTION_ATTEMPT_TIMEOUT_MS = 4000;
const LOG_PAGE_SIZE = 20;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function buildManualConnectUrls(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    const protocol = parsed.protocol === "https:" ? "https:" : "http:";

    if (parsed.port) {
      return [`${protocol}//${parsed.hostname}:${parsed.port}`];
    }

    return Array.from(
      new Set([
        `${protocol}//${parsed.hostname}:${DEFAULT_SYNC_PORT}`,
        `${protocol}//${parsed.hostname}:${LEGACY_SYNC_PORT}`,
      ])
    );
  } catch {
    if (trimmed.includes(":")) return [`http://${trimmed}`];
    return [
      `http://${trimmed}:${DEFAULT_SYNC_PORT}`,
      `http://${trimmed}:${LEGACY_SYNC_PORT}`,
    ];
  }
}

function normalizeDiscoveredHost(host: string): string {
  const trimmed = host.trim().replace(/%.+$/, "");
  if (trimmed.includes(":") && !trimmed.startsWith("[")) {
    return `[${trimmed}]`;
  }
  return trimmed;
}

function hostPriority(host: string): number {
  const bare = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) return 0;
  if (bare.endsWith(".local")) return 1;
  if (bare.includes(":")) return 2;
  return 3;
}

function buildDiscoveredConnectUrls(device: DiscoveredPeer): string[] {
  const hosts = (
    device.hosts && device.hosts.length > 0 ? device.hosts : [device.host]
  )
    .map(normalizeDiscoveredHost)
    .filter((host) => host.length > 0)
    .sort((a, b) => hostPriority(a) - hostPriority(b));

  if (hosts.length === 0) return [];

  const ports = [device.port, DEFAULT_SYNC_PORT, LEGACY_SYNC_PORT].filter(
    (value, index, arr): value is number =>
      Number.isInteger(value) && value > 0 && arr.indexOf(value) === index
  );

  const urls: string[] = [];
  for (const host of hosts) {
    for (const port of ports) {
      urls.push(`http://${host}:${port}`);
    }
  }
  return Array.from(new Set(urls));
}

export default function SettingsScreen() {
  const targetLang = useSettingsStore((s) => s.translationTargetLang);
  const setTargetLang = useSettingsStore((s) => s.setTranslationTargetLang);

  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const serverName = useConnectionStore((s) => s.serverName);
  const { setServerUrl, setServerName } = useConnectionStore();
  const disconnect = useConnectionStore((s) => s.disconnect);
  const isConnected = !!serverUrl;

  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isLoadingUpdateAvailability, setIsLoadingUpdateAvailability] =
    useState(false);
  const [updateAvailability, setUpdateAvailability] =
    useState<AndroidApkUpdateAvailability | null>(null);
  const [logEntries, setLogEntries] = useState<AppLogEntry[]>(() =>
    logger.getEntries()
  );
  const [logPage, setLogPage] = useState(0);

  // Connection state
  const [ipAddress, setIpAddress] = useState(verifyDesktopUrl ?? "");
  const [isConnecting, setIsConnecting] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredPeer[]>(
    []
  );
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanDebugDetails, setScanDebugDetails] = useState<string | null>(null);
  const [scanAttempt, setScanAttempt] = useState(0);
  const [showManualInput, setShowManualInput] = useState(!!verifyDesktopUrl);
  const [manualConnectError, setManualConnectError] = useState<string | null>(null);
  const [manualConnectDebugDetails, setManualConnectDebugDetails] = useState<string | null>(
    null
  );
  const discoveredCountRef = useRef(0);

  const selectedLang =
    LANGUAGES.find((l) => l.code === targetLang) ?? LANGUAGES[0];

  const appVersion =
    Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "unknown";
  const appBuild = Constants.nativeBuildVersion ?? "-";
  const reversedLogs = useMemo(() => [...logEntries].reverse(), [logEntries]);
  const totalLogPages = Math.max(1, Math.ceil(reversedLogs.length / LOG_PAGE_SIZE));
  const clampedLogPage = Math.min(logPage, totalLogPages - 1);
  const pagedLogs = reversedLogs.slice(
    clampedLogPage * LOG_PAGE_SIZE,
    clampedLogPage * LOG_PAGE_SIZE + LOG_PAGE_SIZE
  );

  useEffect(() => {
    discoveredCountRef.current = discoveredDevices.length;
  }, [discoveredDevices.length]);

  useEffect(() => {
    const unsubscribe = logger.subscribe((entries) => {
      setLogEntries(entries);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    logger.info("[Mobile Settings] Opened settings", {
      appVersion,
      appBuild,
      isConnected,
      serverUrl,
    });

    return () => {
      logger.info("[Mobile Settings] Closed settings");
    };
  }, [appBuild, appVersion, isConnected, serverUrl]);

  // mDNS scanning when not connected
  useEffect(() => {
    if (isConnected || verifyDesktopUrl) {
      setIsScanning(false);
      setScanError(null);
      setScanDebugDetails(null);
      return;
    }

    let isCancelled = false;
    const startedAt = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    setDiscoveredDevices([]);
    setScanError(null);
    setScanDebugDetails(null);
    setManualConnectError(null);
    setManualConnectDebugDetails(null);
    setIsScanning(true);

    const stopScanWithError = (message: string, details: string) => {
      if (isCancelled) return;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      stopScanning();
      setIsScanning(false);
      setScanError(message);
      setScanDebugDetails(details);
    };

    const beginScan = async () => {
      try {
        logger.info("[Mobile Discovery] Starting scan", {
          attempt: scanAttempt + 1,
          isConnected,
          savedServerUrl: serverUrl ?? null,
          savedServerName: serverName ?? null,
        });
        const permissionStatus = await ensureDiscoveryPermissions();
        if (isCancelled) return;
        if (!permissionStatus.granted) {
          logger.warn("[Mobile Discovery] Permission denied", permissionStatus);
          stopScanWithError(
            "A discovery permission is required to find your desktop app on local Wi-Fi.",
            `attempt=${scanAttempt + 1} ${permissionStatus.details}`
          );
          return;
        }

        startScanning({
          onPeerFound: (peer) => {
            if (isCancelled) return;
            logger.info("[Mobile Discovery] Peer found", {
              name: peer.name,
              host: peer.host,
              hosts: peer.hosts,
              port: peer.port,
            });
            setDiscoveredDevices((prev) => {
              const existing = prev.find((p) => p.name === peer.name);
              if (existing) return prev.map((p) => (p.name === peer.name ? peer : p));
              return [...prev, peer];
            });
          },
          onPeerLost: (name) => {
            if (isCancelled) return;
            logger.info("[Mobile Discovery] Peer lost", { name });
            setDiscoveredDevices((prev) => prev.filter((p) => p.name !== name));
          },
          onError: (error) => {
            console.error("[Settings] mDNS scan error:", error);
            const reason = getErrorMessage(error);
            logger.error("[Mobile Discovery] Scan error", error, {
              attempt: scanAttempt + 1,
              reason,
            });
            stopScanWithError(
              "Nearby discovery failed.",
              `attempt=${scanAttempt + 1} source=zeroconf reason=${reason}`
            );
          },
        });

        timeoutId = setTimeout(() => {
          if (isCancelled) return;
          if (discoveredCountRef.current > 0) return;
          const elapsedMs = Date.now() - startedAt;
          logger.warn("[Mobile Discovery] Scan timed out", {
            attempt: scanAttempt + 1,
            elapsedMs,
            discoveredDevices: discoveredCountRef.current,
          });
          stopScanWithError(
            "Scanning timed out. No nearby desktop found.",
            `attempt=${scanAttempt + 1} timeoutMs=${DISCOVERY_SCAN_TIMEOUT_MS} elapsedMs=${elapsedMs} devices=${discoveredCountRef.current}`
          );
        }, DISCOVERY_SCAN_TIMEOUT_MS);
      } catch (error) {
        const reason = getErrorMessage(error);
        logger.error("[Mobile Discovery] Failed to begin scan", error, {
          attempt: scanAttempt + 1,
          reason,
        });
        stopScanWithError(
          "Could not start nearby discovery.",
          `attempt=${scanAttempt + 1} source=permission-check reason=${reason}`
        );
      }
    };

    void beginScan();

    return () => {
      isCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      stopScanning();
      setIsScanning(false);
      logger.info("[Mobile Discovery] Stopped scan", { attempt: scanAttempt + 1 });
    };
  }, [isConnected, scanAttempt]);

  const handleRetryScan = useCallback(() => {
    logger.info("[Mobile Discovery] Retry scan requested", {
      nextAttempt: scanAttempt + 2,
    });
    setScanAttempt((prev) => prev + 1);
  }, [scanAttempt]);

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

  const handleUpdatePress = useCallback(async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      await checkForAndroidApkUpdate({ manual: true });
    } finally {
      setIsCheckingUpdate(false);
      void refreshUpdateAvailability();
    }
  }, [isCheckingUpdate, refreshUpdateAvailability]);

  const showCompatibilityAlert = (error: SyncCompatibilityError): void => {
    if (error.issue === "desktop_update_required") {
      Alert.alert("Desktop Update Required", error.message);
      return;
    }
    Alert.alert("Mobile Update Required", error.message);
  };

  const handleConnectToDevice = async (device: DiscoveredPeer) => {
    const candidateUrls = buildDiscoveredConnectUrls(device);
    logger.info("[Mobile Discovery] Connecting to discovered device", {
      name: device.name,
      host: device.host,
      hosts: device.hosts,
      port: device.port,
      candidateUrls,
    });
    setIsConnecting(true);
    let lastError: unknown = null;

    try {
      for (const url of candidateUrls) {
        try {
          const info = await api.getInfo(url, {
            timeoutMs: CONNECTION_ATTEMPT_TIMEOUT_MS,
          });
          assertSyncCompatibility(info);
          setServerUrl(url);
          setServerName(info.name);
          logger.info("[Mobile Discovery] Connected to desktop", {
            url,
            serverName: info.name,
          });
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
          if (error instanceof SyncCompatibilityError) throw error;
          lastError = error;
          logger.warn("[Mobile Discovery] Candidate failed", {
            url,
            reason: getErrorMessage(error),
          });
        }
      }
      throw lastError ?? new Error("All connection attempts failed");
    } catch (error) {
      if (error instanceof SyncCompatibilityError) {
        logger.warn("[Mobile Discovery] Compatibility error", {
          issue: error.issue,
          message: error.message,
        });
        showCompatibilityAlert(error);
        return;
      }
      const reason = getErrorMessage(error);
      logger.error("[Mobile Discovery] Connect to discovered device failed", error, {
        peerName: device.name,
        peerHost: device.host,
        peerHosts: device.hosts,
        peerPort: device.port,
        candidateUrls,
        reason,
      });
      Alert.alert(
        "Connection Failed",
        `Could not connect to the device.\n\nTried:\n${candidateUrls.join("\n")}\n\nLast error:\n${reason}\n\nTip: ensure Desktop app Sync is enabled and both devices are on the same Wi-Fi.`
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleManualConnect = async () => {
    if (!ipAddress.trim()) {
      logger.warn("[Mobile Discovery] Manual connect attempted with empty input");
      setManualConnectError("Please enter an IP address");
      setManualConnectDebugDetails(null);
      Alert.alert("Error", "Please enter an IP address");
      return;
    }
    setIsConnecting(true);
    setManualConnectError(null);
    setManualConnectDebugDetails(null);
    const candidateUrls = buildManualConnectUrls(ipAddress);
    logger.info("[Mobile Discovery] Manual connect requested", {
      input: ipAddress,
      normalizedInput: ipAddress.trim(),
      isConnected,
      savedServerUrl: serverUrl ?? null,
      savedServerName: serverName ?? null,
      candidateUrls,
    });
    let lastError: unknown = null;

    try {
      for (const url of candidateUrls) {
        try {
          const info = await api.getInfo(url, {
            timeoutMs: CONNECTION_ATTEMPT_TIMEOUT_MS,
          });
          assertSyncCompatibility(info);
          setServerUrl(url);
          setServerName(info.name);
          logger.info("[Mobile Discovery] Manual connect succeeded", {
            url,
            serverName: info.name,
          });
          setManualConnectError(null);
          setManualConnectDebugDetails(null);
          setShowManualInput(false);
          setIpAddress("");
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
          if (error instanceof SyncCompatibilityError) throw error;
          lastError = error;
          logger.warn("[Mobile Discovery] Manual candidate failed", {
            url,
            reason: getErrorMessage(error),
          });
        }
      }
      throw lastError ?? new Error("All connection attempts failed");
    } catch (error) {
      if (error instanceof SyncCompatibilityError) {
        logger.warn("[Mobile Discovery] Manual compatibility error", {
          issue: error.issue,
          message: error.message,
        });
        showCompatibilityAlert(error);
        return;
      }
      const reason = getErrorMessage(error);
      const debugDetails = `input=${ipAddress}\ntried=${candidateUrls.join(", ")}\nreason=${reason}`;
      logger.error("[Mobile Discovery] Manual connect failed", error, {
        candidateUrls,
        reason,
      });
      setManualConnectError(`Could not connect to desktop. Last error: ${reason}`);
      setManualConnectDebugDetails(debugDetails);
      Alert.alert(
        "Connection Failed",
        `Could not connect to desktop.\n\nTried:\n${candidateUrls.join("\n")}\n\nLast error:\n${reason}`
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    logger.info("[Mobile Discovery] Disconnect requested", {
      serverName,
      serverUrl,
    });
    Alert.alert(
      "Disconnect",
      `Disconnect from ${serverName || "Desktop"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            disconnect();
            setDiscoveredDevices([]);
            logger.info("[Mobile Discovery] Disconnected from desktop");
          },
        },
      ]
    );
  };

  const openLogViewer = useCallback(() => {
    setLogPage(0);
    setShowLogViewer(true);
    logger.info("[Mobile Settings] Opened log viewer");
  }, []);

  const closeLogViewer = useCallback(() => {
    setShowLogViewer(false);
    logger.info("[Mobile Settings] Closed log viewer");
  }, []);

  const clearLogs = useCallback(() => {
    logger.clearEntries();
    logger.info("[Mobile Settings] Cleared app logs");
    setLogPage(0);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView style={styles.scrollView}>
        {/* Connection Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connection</Text>

          {isConnected ? (
            /* Connected state */
            <View style={styles.connectedCard}>
              <View style={styles.connectedHeader}>
                <View style={styles.connectedDot} />
                <View style={styles.connectedInfo}>
                  <Text style={styles.connectedName}>
                    {serverName || "Desktop"}
                  </Text>
                  <Text style={styles.connectedUrl}>{serverUrl}</Text>
                </View>
              </View>
              <Pressable
                style={(state) => [
                  styles.disconnectButton,
                  state.pressed && styles.pressablePressed,
                ]}
                onPress={handleDisconnect}
              >
                <Text style={styles.disconnectButtonText}>Disconnect</Text>
              </Pressable>
            </View>
          ) : (
            /* Disconnected state — show discovery + manual */
            <>
              {/* Discovered devices */}
              {discoveredDevices.length > 0 && (
                <View style={styles.discoveredSection}>
                  <View style={styles.discoveredHeader}>
                    <Text style={styles.discoveredLabel}>Nearby Devices</Text>
                    {isScanning && (
                      <ActivityIndicator color="#4ade80" size="small" />
                    )}
                  </View>
                  {discoveredDevices.map((device) => (
                    <Pressable
                      key={device.name}
                      style={(state) => [
                        styles.deviceItem,
                        state.pressed && styles.pressablePressed,
                      ]}
                      onPress={() => handleConnectToDevice(device)}
                      disabled={isConnecting}
                    >
                      <View style={styles.deviceIcon}>
                        <Text style={styles.deviceIconText}>💻</Text>
                      </View>
                      <View style={styles.deviceInfo}>
                        <Text style={styles.deviceName}>{device.name}</Text>
                        <Text style={styles.deviceMeta}>
                          {device.videoCount} videos • {device.host}
                        </Text>
                      </View>
                      {isConnecting ? (
                        <ActivityIndicator color="#e94560" size="small" />
                      ) : (
                        <Text style={styles.connectArrow}>›</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              )}

              {/* No devices found — scanning indicator */}
              {discoveredDevices.length === 0 && isScanning && (
                <View style={styles.scanningRow}>
                  <ActivityIndicator color="#a0a0a0" size="small" />
                  <Text style={styles.scanningText}>
                    Scanning for nearby devices...
                  </Text>
                </View>
              )}

              {discoveredDevices.length === 0 && !isScanning && scanError && (
                <View style={styles.scanErrorCard}>
                  <Text style={styles.scanErrorTitle}>Discovery stopped</Text>
                  <Text style={styles.scanErrorText}>{scanError}</Text>
                  {scanDebugDetails ? (
                    <Text style={styles.scanErrorDebug}>{scanDebugDetails}</Text>
                  ) : null}
                  <Pressable
                    style={(state) => [
                      styles.scanRetryButton,
                      state.pressed && styles.pressablePressed,
                    ]}
                    onPress={handleRetryScan}
                  >
                    <Text style={styles.scanRetryButtonText}>Retry Scan</Text>
                  </Pressable>
                </View>
              )}

              {/* Manual connect toggle */}
              {!showManualInput ? (
                <Pressable
                  style={(state) => [
                    styles.manualConnectRow,
                    state.pressed && styles.pressablePressed,
                  ]}
                  onPress={() => setShowManualInput(true)}
                >
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>Connect Manually</Text>
                    <Text style={styles.settingDescription}>
                      Enter IP address to connect
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ) : (
                <View style={styles.manualInputCard}>
                  <Text style={styles.manualInputLabel}>
                    Enter desktop IP address
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="192.168.1.100"
                    placeholderTextColor="#666"
                    value={ipAddress}
                    onChangeText={setIpAddress}
                    keyboardType="url"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <View style={styles.manualInputActions}>
                    <Pressable
                      style={(state) => [
                        styles.cancelButton,
                        state.pressed && styles.pressablePressed,
                      ]}
                      onPress={() => {
                        setShowManualInput(false);
                        setIpAddress("");
                        setManualConnectError(null);
                        setManualConnectDebugDetails(null);
                      }}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={(state) => [
                        styles.connectButton,
                        isConnecting && styles.connectButtonDisabled,
                        state.pressed && !isConnecting && styles.pressablePressed,
                      ]}
                      onPress={handleManualConnect}
                      disabled={isConnecting}
                    >
                      {isConnecting ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.connectButtonText}>Connect</Text>
                      )}
                    </Pressable>
                  </View>
                  {manualConnectError ? (
                    <View style={styles.manualErrorCard}>
                      <Text style={styles.manualErrorTitle}>Manual Connection Failed</Text>
                      <Text style={styles.manualErrorText}>{manualConnectError}</Text>
                      {manualConnectDebugDetails ? (
                        <Text style={styles.manualErrorDebug}>
                          {manualConnectDebugDetails}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              )}
            </>
          )}
        </View>

        {/* Translation Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Translation</Text>
          <Pressable
            style={(state) => [
              styles.settingRow,
              state.pressed && styles.pressablePressed,
            ]}
            onPress={() => setShowLangPicker(true)}
          >
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Target Language</Text>
              <Text style={styles.settingDescription}>
                Words will be translated to this language
              </Text>
            </View>
            <View style={styles.settingValue}>
              <Text style={styles.settingValueText}>{selectedLang.name}</Text>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Pressable>
        </View>

        {/* App Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App</Text>

          <Pressable
            style={(state) => [
              styles.settingRow,
              state.pressed && styles.pressablePressed,
            ]}
            onPress={openLogViewer}
          >
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Debug Logs</Text>
              <Text style={styles.settingDescription}>
                Review recent app and connection events
              </Text>
            </View>
            <View style={styles.settingValue}>
              <Text style={styles.settingValueText}>
                {logEntries.length} entries
              </Text>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Pressable>

          {isLoadingUpdateAvailability && (
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Checking updates</Text>
                <Text style={styles.settingDescription}>
                  Looking for the latest APK release
                </Text>
              </View>
              <ActivityIndicator size="small" color="#e94560" />
            </View>
          )}

          {updateAvailability?.hasUpdate && (
            <Pressable
              style={(state) => [
                styles.settingRow,
                isCheckingUpdate && styles.settingRowDisabled,
                state.pressed && !isCheckingUpdate && styles.pressablePressed,
              ]}
              onPress={handleUpdatePress}
              disabled={isCheckingUpdate}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Update App</Text>
                <Text style={styles.settingDescription}>
                  {updateAvailability.latestVersionLabel
                    ? `New version ${updateAvailability.latestVersionLabel} is available`
                    : "A new app version is available"}
                </Text>
              </View>
              <View style={styles.settingValue}>
                <Text style={styles.settingValueText}>
                  {isCheckingUpdate ? "Opening..." : "Update now"}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </View>
            </Pressable>
          )}

          {!isLoadingUpdateAvailability &&
            updateAvailability?.configured &&
            !updateAvailability.hasUpdate && (
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>App is up to date</Text>
                  <Text style={styles.settingDescription}>
                    You already have the latest release
                  </Text>
                </View>
              </View>
            )}
        </View>

        <View style={styles.appInfoFooter}>
          <Text style={styles.appInfoText}>LearnifyTube</Text>
          <Text style={styles.appInfoSubText}>
            Version {appVersion} (build {appBuild})
          </Text>
        </View>
      </ScrollView>

      {/* Language picker modal */}
      <Modal
        visible={showLangPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLangPicker(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowLangPicker(false)}
        >
          <View
            style={styles.modalContent}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Select Target Language</Text>

            <FlatList
              data={LANGUAGES}
              keyExtractor={(item) => item.code}
              style={styles.langList}
              renderItem={({ item }) => (
                <Pressable
                  style={(state) => [
                    styles.langItem,
                    item.code === targetLang && styles.langItemActive,
                    state.pressed && styles.pressablePressed,
                  ]}
                  onPress={() => {
                    setTargetLang(item.code);
                    setShowLangPicker(false);
                  }}
                >
                  <Text
                    style={[
                      styles.langItemText,
                      item.code === targetLang && styles.langItemTextActive,
                    ]}
                  >
                    {item.name}
                  </Text>
                  <Text style={styles.langCode}>{item.code}</Text>
                  {item.code === targetLang && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={showLogViewer}
        transparent
        animationType="slide"
        onRequestClose={closeLogViewer}
      >
        <Pressable style={styles.modalOverlay} onPress={closeLogViewer}>
          <View
            style={[styles.modalContent, styles.logModalContent]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHandle} />
            <View style={styles.logHeader}>
              <View>
                <Text style={styles.modalTitle}>Debug Logs</Text>
                <Text style={styles.logMeta}>
                  Page {clampedLogPage + 1}/{totalLogPages} · {logEntries.length} entries
                </Text>
              </View>
              <Pressable
                style={(state) => [
                  styles.logHeaderButton,
                  state.pressed && styles.pressablePressed,
                ]}
                onPress={clearLogs}
              >
                <Text style={styles.logHeaderButtonText}>Clear</Text>
              </Pressable>
            </View>

            {pagedLogs.length === 0 ? (
              <View style={styles.logEmptyState}>
                <Text style={styles.logEmptyText}>No logs yet</Text>
                <Text style={styles.logEmptySubText}>
                  Connection attempts and app events will appear here.
                </Text>
              </View>
            ) : (
              <FlatList
                data={pagedLogs}
                keyExtractor={(item) => String(item.id)}
                style={styles.logList}
                contentContainerStyle={styles.logListContent}
                renderItem={({ item }) => (
                  <View
                    style={[
                      styles.logEntry,
                      item.level === "warn" && styles.logEntryWarn,
                      item.level === "error" && styles.logEntryError,
                    ]}
                  >
                    <Text style={styles.logTimestamp}>{item.timestamp}</Text>
                    <Text style={styles.logLevel}>{item.level.toUpperCase()}</Text>
                    <Text style={styles.logMessage}>{item.message}</Text>
                    {item.context ? (
                      <Text style={styles.logContext}>{item.context}</Text>
                    ) : null}
                    {item.error ? (
                      <Text style={styles.logError}>{item.error}</Text>
                    ) : null}
                  </View>
                )}
              />
            )}

            <View style={styles.logFooter}>
              <Pressable
                style={(state) => [
                  styles.logPageButton,
                  !(
                    clampedLogPage * LOG_PAGE_SIZE + LOG_PAGE_SIZE < reversedLogs.length
                  ) && styles.logPageButtonDisabled,
                  state.pressed &&
                    clampedLogPage * LOG_PAGE_SIZE + LOG_PAGE_SIZE < reversedLogs.length &&
                    styles.pressablePressed,
                ]}
                disabled={!(clampedLogPage * LOG_PAGE_SIZE + LOG_PAGE_SIZE < reversedLogs.length)}
                onPress={() => setLogPage((prev) => prev + 1)}
              >
                <Text style={styles.logPageButtonText}>Older</Text>
              </Pressable>
              <Pressable
                style={(state) => [
                  styles.logPageButton,
                  !(clampedLogPage > 0) && styles.logPageButtonDisabled,
                  state.pressed && clampedLogPage > 0 && styles.pressablePressed,
                ]}
                disabled={!(clampedLogPage > 0)}
                onPress={() => setLogPage((prev) => Math.max(0, prev - 1))}
              >
                <Text style={styles.logPageButtonText}>Newer</Text>
              </Pressable>
              <Pressable
                style={(state) => [
                  styles.logCloseButton,
                  state.pressed && styles.pressablePressed,
                ]}
                onPress={closeLogViewer}
              >
                <Text style={styles.logCloseButtonText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f23",
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: "#8b9dc3",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 16,
  },

  /* Connected card */
  connectedCard: {
    backgroundColor: "#1a2e1a",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2d4a2d",
  },
  connectedHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  connectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#4ade80",
    marginRight: 10,
  },
  connectedInfo: {
    flex: 1,
  },
  connectedName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  connectedUrl: {
    color: "#a0a0a0",
    fontSize: 12,
    marginTop: 2,
  },
  disconnectButton: {
    backgroundColor: "#3f1515",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#5f2525",
  },
  disconnectButtonText: {
    color: "#f87171",
    fontSize: 14,
    fontWeight: "600",
  },

  /* Discovery */
  discoveredSection: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  discoveredHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  discoveredLabel: {
    color: "#4ade80",
    fontSize: 13,
    fontWeight: "600",
  },
  deviceItem: {
    flexDirection: "row",
    backgroundColor: "#1a2e1a",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2d4a2d",
  },
  deviceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#2d4a2d",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  deviceIconText: {
    fontSize: 20,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 2,
  },
  deviceMeta: {
    color: "#a0a0a0",
    fontSize: 12,
  },
  connectArrow: {
    color: "#4ade80",
    fontSize: 24,
    fontWeight: "300",
  },

  /* Scanning */
  scanningRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
    marginHorizontal: 16,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    marginBottom: 8,
  },
  scanningText: {
    color: "#a0a0a0",
    fontSize: 13,
  },
  scanErrorCard: {
    backgroundColor: "#3b1d20",
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#6b2a31",
    gap: 6,
  },
  scanErrorTitle: {
    color: "#fda4af",
    fontSize: 13,
    fontWeight: "700",
  },
  scanErrorText: {
    color: "#fecdd3",
    fontSize: 13,
    lineHeight: 18,
  },
  scanErrorDebug: {
    color: "#fca5a5",
    fontSize: 11,
    lineHeight: 16,
  },
  scanRetryButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: "#5b2930",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#7f3b44",
  },
  scanRetryButtonText: {
    color: "#ffe4e6",
    fontSize: 12,
    fontWeight: "700",
  },

  /* Manual connect */
  manualConnectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  manualInputCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  manualErrorCard: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(233,69,96,0.45)",
    backgroundColor: "rgba(233,69,96,0.12)",
    padding: 12,
  },
  manualErrorTitle: {
    color: "#ff8fa3",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  manualErrorText: {
    color: "#ffe2e8",
    fontSize: 13,
    lineHeight: 18,
  },
  manualErrorDebug: {
    color: "#ffccd6",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
  manualInputLabel: {
    color: "#a0a0a0",
    fontSize: 13,
    marginBottom: 10,
  },
  input: {
    backgroundColor: "#0f0f23",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: "#fff",
    textAlign: "center",
    borderWidth: 1,
    borderColor: "#2d2d44",
    marginBottom: 12,
  },
  manualInputActions: {
    flexDirection: "row",
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#242c3d",
  },
  cancelButtonText: {
    color: "#a0a0a0",
    fontSize: 14,
    fontWeight: "600",
  },
  connectButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#e94560",
  },
  connectButtonDisabled: {
    opacity: 0.6,
  },
  connectButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  pressablePressed: {
    opacity: 0.85,
  },

  /* General settings */
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  settingRowDisabled: {
    opacity: 0.6,
  },
  settingInfo: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 2,
  },
  settingDescription: {
    color: "#a0a0a0",
    fontSize: 13,
    lineHeight: 18,
  },
  settingValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  settingValueText: {
    color: "#e94560",
    fontSize: 15,
    fontWeight: "500",
  },
  chevron: {
    color: "#666",
    fontSize: 20,
    fontWeight: "300",
  },

  /* Footer */
  appInfoFooter: {
    marginTop: 8,
    marginBottom: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  appInfoText: {
    color: "#8b9dc3",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 2,
  },
  appInfoSubText: {
    color: "#6b7280",
    fontSize: 12,
  },

  /* Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    paddingHorizontal: 16,
    paddingBottom: 34,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: "#666",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
    textAlign: "center",
  },
  logModalContent: {
    maxHeight: "85%",
  },
  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  logMeta: {
    color: "#8b9dc3",
    fontSize: 12,
  },
  logHeaderButton: {
    backgroundColor: "#242c3d",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  logHeaderButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  logList: {
    flexGrow: 0,
  },
  logListContent: {
    paddingBottom: 8,
  },
  logEntry: {
    backgroundColor: "#0f0f23",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2d2d44",
    gap: 4,
  },
  logEntryWarn: {
    borderColor: "#7c5f17",
    backgroundColor: "#221b0f",
  },
  logEntryError: {
    borderColor: "#7f3b44",
    backgroundColor: "#241317",
  },
  logTimestamp: {
    color: "#8b9dc3",
    fontSize: 11,
  },
  logLevel: {
    color: "#4ade80",
    fontSize: 11,
    fontWeight: "700",
  },
  logMessage: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  logContext: {
    color: "#cbd5e1",
    fontSize: 12,
  },
  logError: {
    color: "#fda4af",
    fontSize: 12,
  },
  logEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 8,
  },
  logEmptyText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  logEmptySubText: {
    color: "#8b9dc3",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  logFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 8,
  },
  logPageButton: {
    flex: 1,
    backgroundColor: "#242c3d",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  logPageButtonDisabled: {
    opacity: 0.45,
  },
  logPageButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  logCloseButton: {
    flex: 1.2,
    backgroundColor: "#e94560",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  logCloseButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  langList: {
    flexGrow: 0,
  },
  langItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f0f23",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  langItemActive: {
    backgroundColor: "#e94560",
  },
  langItemText: {
    color: "#fff",
    fontSize: 16,
    flex: 1,
  },
  langItemTextActive: {
    fontWeight: "600",
  },
  langCode: {
    color: "#a0a0a0",
    fontSize: 13,
    marginRight: 8,
    textTransform: "uppercase",
  },
  checkmark: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
});
