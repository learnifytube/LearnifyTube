import {
  useState,
  useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  TextInput,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useConnectionStore } from "../../stores/connection";
import { colors } from "../../theme";
import { api, PairingRequiredError } from "../../services/api";
import { useLibraryStore } from "../../stores/library";
import { downloadQueue } from "../../services/download-queue";
import { ensureDiscoveryPermissions } from "../../services/discovery-permissions";
import { startScanning, stopScanning } from "../../services/p2p/discovery";
import {
  assertSyncCompatibility,
  SyncCompatibilityError,
} from "../../services/sync-compatibility";
import type { RemoteVideo, DiscoveredPeer } from "../../types";

const DEFAULT_SYNC_PORT = 53318;
const LEGACY_SYNC_PORT = 8384;
const CONNECTION_ATTEMPT_TIMEOUT_MS = 4000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function buildManualConnectUrls(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    const protocol = parsed.protocol === "https:" ? "https:" : "http:";

    if (parsed.port) {
      return [`${protocol}//${parsed.hostname}:${parsed.port}`];
    }

    const urls = [
      `${protocol}//${parsed.hostname}:${DEFAULT_SYNC_PORT}`,
      `${protocol}//${parsed.hostname}:${LEGACY_SYNC_PORT}`,
    ];
    return Array.from(new Set(urls));
  } catch {
    if (trimmed.includes(":")) {
      return [`http://${trimmed}`];
    }

    return [
      `http://${trimmed}:${DEFAULT_SYNC_PORT}`,
      `http://${trimmed}:${LEGACY_SYNC_PORT}`,
    ];
  }
}

function normalizeDiscoveredHost(host: string): string {
  const trimmed = host.trim().replace(/%.+$/, "");
  // Wrap IPv6 literals in brackets for URL formatting.
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

export default function ConnectScreen() {
  const [ipAddress, setIpAddress] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [remoteVideos, setRemoteVideos] = useState<RemoteVideo[]>([]);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredPeer[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const { setServerUrl, setServerName, pairingCode, setPairingCode } =
    useConnectionStore();
  const { addVideo } = useLibraryStore();

  // Start mDNS scanning on mount
  useEffect(() => {
    let cancelled = false;

    const beginScanning = async () => {
      const permissionStatus = await ensureDiscoveryPermissions();
      if (cancelled || !permissionStatus.granted) {
        if (!permissionStatus.granted) {
          console.warn("[Connect] Discovery permission denied:", permissionStatus.details);
        }
        setIsScanning(false);
        return;
      }

      console.log("[Connect] Starting mDNS scanning for desktop devices");
      setIsScanning(true);
      startScanning({
        onPeerFound: (peer) => {
          console.log("[Connect] Peer found:", peer.name, peer.host, peer.port);
          setDiscoveredDevices((prev) => {
            const existing = prev.find((p) => p.name === peer.name);
            if (existing) {
              console.log("[Connect] Updating existing peer:", peer.name);
              return prev.map((p) => (p.name === peer.name ? peer : p));
            }
            console.log("[Connect] Adding new peer:", peer.name);
            return [...prev, peer];
          });
        },
        onPeerLost: (name) => {
          console.log("[Connect] Peer lost:", name);
          setDiscoveredDevices((prev) => prev.filter((p) => p.name !== name));
        },
        onError: (error) => {
          console.error("[Connect] mDNS scan error:", error);
        },
      });
    };

    void beginScanning();

    return () => {
      cancelled = true;
      console.log("[Connect] Stopping mDNS scanning");
      stopScanning();
      setIsScanning(false);
    };
  }, []);

  const showCompatibilityAlert = (error: SyncCompatibilityError): void => {
    if (error.issue === "desktop_update_required") {
      Alert.alert("Desktop Update Required", error.message);
      return;
    }

    Alert.alert("Mobile Update Required", error.message);
  };

  const handleConnectToDevice = async (device: DiscoveredPeer) => {
    const candidateUrls = buildDiscoveredConnectUrls(device);
    console.log(
      "[Connect] Connecting to discovered device:",
      device.name,
      candidateUrls
    );
    setIsConnecting(true);
    let lastError: unknown = null;

    try {
      for (const url of candidateUrls) {
        try {
          console.log("[Connect] Trying discovered URL:", url);
          const info = await api.getInfo(url, {
            timeoutMs: CONNECTION_ATTEMPT_TIMEOUT_MS,
          });
          assertSyncCompatibility(info);
          console.log("[Connect] Connected to:", info.name, "via", url);

          setServerUrl(url);
          setServerName(info.name);
          const videosResponse = await api.getVideos(url);
          console.log("[Connect] Got", videosResponse.videos.length, "videos");
          setRemoteVideos(videosResponse.videos);
          return;
        } catch (error) {
          // Ignore AbortError - user navigated away before connection completed
          if (error instanceof Error && error.name === "AbortError") {
            console.log("[Connect] Connection aborted (user navigated away)");
            return;
          }
          if (
            error instanceof SyncCompatibilityError ||
            error instanceof PairingRequiredError
          ) {
            throw error;
          }
          lastError = error;
          console.warn("[Connect] Discovered connection attempt failed:", url, error);
        }
      }

      throw lastError ?? new Error("All discovered connection attempts failed");
    } catch (error) {
      if (error instanceof SyncCompatibilityError) {
        showCompatibilityAlert(error);
        return;
      }
      if (error instanceof PairingRequiredError) {
        Alert.alert("Pairing Code Needed", error.message);
        return;
      }
      console.error("[Connect] Connection failed:", error);
      const reason = getErrorMessage(error);
      Alert.alert(
        "Connection Failed",
        `Could not connect to the device.\n\nTried:\n${candidateUrls.join("\n")}\n\nLast error:\n${reason}\n\nTip: ensure Desktop app Sync is enabled and both devices are on the same Wi-Fi.`
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnect = async () => {
    if (!ipAddress.trim()) {
      Alert.alert("Error", "Please enter an IP address");
      return;
    }

    setIsConnecting(true);
    const candidateUrls = buildManualConnectUrls(ipAddress);
    let lastError: unknown = null;

    try {
      for (const url of candidateUrls) {
        try {
          console.log("[Connect] Trying manual connection:", url);
          const info = await api.getInfo(url, {
            timeoutMs: CONNECTION_ATTEMPT_TIMEOUT_MS,
          });
          assertSyncCompatibility(info);
          console.log("[Connect] Connected to:", info.name, "via", url);

          setServerUrl(url);
          setServerName(info.name);
          const videosResponse = await api.getVideos(url);
          setRemoteVideos(videosResponse.videos);
          return;
        } catch (error) {
          // Ignore AbortError - user navigated away before connection completed
          if (error instanceof Error && error.name === "AbortError") {
            console.log("[Connect] Connection aborted (user navigated away)");
            return;
          }
          if (
            error instanceof SyncCompatibilityError ||
            error instanceof PairingRequiredError
          ) {
            throw error;
          }
          lastError = error;
          console.warn("[Connect] Manual connection attempt failed:", url, error);
        }
      }

      throw lastError ?? new Error("All manual connection attempts failed");
    } catch (error) {
      if (error instanceof SyncCompatibilityError) {
        showCompatibilityAlert(error);
        return;
      }
      if (error instanceof PairingRequiredError) {
        Alert.alert("Pairing Code Needed", error.message);
        return;
      }
      const reason = getErrorMessage(error);
      Alert.alert(
        "Connection Failed",
        `Could not connect to desktop.\n\nTried:\n${candidateUrls.join("\n")}\n\nLast error:\n${reason}\n\nCheck:\n1. Desktop app is running\n2. Sync server is enabled\n3. Both devices are on the same network\n4. If using emulator, try 10.0.2.2:PORT`
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const toggleVideoSelection = (videoId: string) => {
    setSelectedVideos((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  const handleDownloadSelected = () => {
    console.log(
      "[Connect] handleDownloadSelected called, selected:",
      selectedVideos.size
    );

    if (selectedVideos.size === 0) {
      Alert.alert("No Videos Selected", "Please select videos to download");
      return;
    }

    // Queue each selected video for download
    for (const videoId of selectedVideos) {
      const video = remoteVideos.find((v) => v.id === videoId);
      if (!video) continue;

      console.log("[Connect] Queueing download:", video.title);

      // Add to library (the Offline copy module records its file)
      addVideo({
        id: video.id,
        title: video.title,
        channelTitle: video.channelTitle,
        duration: video.duration,
        thumbnailUrl: video.thumbnailUrl,
      });

      // Queue for download
      downloadQueue.request(video);
    }

    Alert.alert(
      "Downloads Queued",
      `${selectedVideos.size} video${selectedVideos.size !== 1 ? "s" : ""} added to download queue`,
      [{ text: "OK", onPress: () => router.back() }]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.content}>
        {remoteVideos.length === 0 ? (
          <>
            {/* Pairing code: the desktop rejects requests without it */}
            <Text style={styles.instruction}>
              Pairing code from desktop Settings → Sync:
            </Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="ABCD-2345"
                placeholderTextColor={colors.textTertiary}
                value={pairingCode ?? ""}
                onChangeText={setPairingCode}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>

            {/* Discovered Devices Section */}
            {discoveredDevices.length > 0 && (
              <View style={styles.discoveredSection}>
                <View style={styles.discoveredHeader}>
                  <Text style={styles.discoveredTitle}>Discovered Devices</Text>
                  {isScanning && (
                    <ActivityIndicator color="#4ade80" size="small" />
                  )}
                </View>
                {discoveredDevices.map((device) => (
                  <Pressable
                    key={device.name}
                    style={styles.deviceItem}
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

            {/* Divider */}
            {discoveredDevices.length > 0 && (
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or enter manually</Text>
                <View style={styles.dividerLine} />
              </View>
            )}

            {/* Manual IP Entry */}
            <Text style={styles.instruction}>
              {discoveredDevices.length === 0
                ? "Enter the IP address shown in your LearnifyTube desktop app:"
                : "Connect using IP address:"}
            </Text>

            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="192.168.1.100 or 192.168.1.100:53318"
                placeholderTextColor="#666"
                value={ipAddress}
                onChangeText={setIpAddress}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <Pressable
              style={[styles.connectButton, isConnecting && styles.connectButtonDisabled]}
              onPress={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.connectButtonText}>Connect</Text>
              )}
            </Pressable>

            {discoveredDevices.length === 0 && (
              <View style={styles.helpSection}>
                <Text style={styles.helpTitle}>How to find IP address:</Text>
                <Text style={styles.helpText}>
                  1. Open LearnifyTube on your computer{"\n"}
                  2. Go to Settings &gt; Sync{"\n"}
                  3. Enable "Allow mobile sync"{"\n"}
                  4. Copy the pairing code and IP address shown
                </Text>
              </View>
            )}

            {/* Scanning indicator when no devices found */}
            {discoveredDevices.length === 0 && isScanning && (
              <View style={styles.scanningSection}>
                <ActivityIndicator color="#a0a0a0" size="small" />
                <Text style={styles.scanningText}>
                  Scanning for nearby devices...
                </Text>
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>
              Available Videos ({remoteVideos.length})
            </Text>
            <FlatList
              data={remoteVideos}
              keyExtractor={(item) => item.id}
              style={styles.videoList}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.videoItem,
                    selectedVideos.has(item.id) && styles.videoItemSelected,
                  ]}
                  onPress={() => toggleVideoSelection(item.id)}
                >
                  <View style={styles.checkbox}>
                    {selectedVideos.has(item.id) && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </View>
                  <View style={styles.videoInfo}>
                    <Text style={styles.videoTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.videoChannel}>{item.channelTitle}</Text>
                    <Text style={styles.videoMeta}>
                      {formatDuration(item.duration)} • {formatFileSize(item.fileSize)}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
            <View style={styles.footer}>
              <Text style={styles.selectedCount}>
                {selectedVideos.size} selected
              </Text>
              <Pressable
                style={[
                  styles.downloadButton,
                  selectedVideos.size === 0 && styles.downloadButtonDisabled,
                ]}
                onPress={handleDownloadSelected}
                disabled={selectedVideos.size === 0}
              >
                <Text style={styles.downloadButtonText}>Download Selected</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#16213e",
  },
  content: {
    flex: 1,
    padding: 20,
  },
  discoveredSection: {
    marginBottom: 20,
  },
  discoveredHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  discoveredTitle: {
    color: "#4ade80",
    fontSize: 16,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#2d4a2d",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  deviceIconText: {
    fontSize: 22,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 4,
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
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#2d2d44",
  },
  dividerText: {
    color: "#666",
    fontSize: 12,
    marginHorizontal: 12,
  },
  instruction: {
    color: "#a0a0a0",
    fontSize: 16,
    marginBottom: 20,
    textAlign: "center",
  },
  inputContainer: {
    marginBottom: 20,
  },
  input: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    color: "#fff",
    textAlign: "center",
    borderWidth: 1,
    borderColor: "#2d2d44",
  },
  connectButton: {
    backgroundColor: "#e94560",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  connectButtonDisabled: {
    opacity: 0.6,
  },
  connectButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  helpSection: {
    marginTop: 40,
    padding: 20,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
  },
  helpTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  helpText: {
    color: "#a0a0a0",
    fontSize: 14,
    lineHeight: 22,
  },
  scanningSection: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 24,
    gap: 8,
  },
  scanningText: {
    color: "#a0a0a0",
    fontSize: 13,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
  },
  videoList: {
    flex: 1,
  },
  videoItem: {
    flexDirection: "row",
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    alignItems: "center",
  },
  videoItemSelected: {
    borderWidth: 2,
    borderColor: "#e94560",
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#444",
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: {
    color: "#e94560",
    fontWeight: "bold",
  },
  videoInfo: {
    flex: 1,
  },
  videoTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  videoChannel: {
    color: "#a0a0a0",
    fontSize: 12,
    marginBottom: 2,
  },
  videoMeta: {
    color: "#666",
    fontSize: 11,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#1a1a2e",
  },
  selectedCount: {
    color: "#a0a0a0",
    fontSize: 14,
  },
  downloadButton: {
    backgroundColor: "#e94560",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  downloadButtonDisabled: {
    opacity: 0.5,
  },
  downloadButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
});
